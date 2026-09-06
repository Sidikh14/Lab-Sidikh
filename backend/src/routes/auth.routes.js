const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { requireAdminKey } = require('../middleware/adminKey');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { sub: user.id, merchantId: user.merchant_id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

// POST /auth/register
// Crée un nouveau commerçant ET son premier compte utilisateur (rôle manager).
// Protégé par une clé secrète (X-Admin-Key) : seul vous pouvez créer un nouveau
// commerce sur la plateforme. Les commerçants existants ajoutent ensuite leurs
// gérants/vendeurs via /users, qui ne nécessite pas cette clé.
router.post('/register', requireAdminKey, async (req, res) => {
  const { businessName, sector, fullName, email, password } = req.body;

  if (!businessName || !fullName || !email || !password) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const merchantResult = await client.query(
      `INSERT INTO merchants (business_name, sector, email)
       VALUES ($1, $2, $3) RETURNING id, business_name, currency`,
      [businessName, sector || null, email]
    );
    const merchant = merchantResult.rows[0];

    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      `INSERT INTO users (merchant_id, full_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'manager')
       RETURNING id, full_name, email, role, merchant_id`,
      [merchant.id, fullName, email, passwordHash]
    );
    const user = userResult.rows[0];

    await client.query('COMMIT');

    const token = signToken(user);
    res.status(201).json({
      token,
      user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role },
      merchant: { id: merchant.id, businessName: merchant.business_name, currency: merchant.currency },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création du compte." });
  } finally {
    client.release();
  }
});

// POST /auth/login
// Renvoie aussi le nom du commerce, pour l'afficher dans l'interface.
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.merchant_id, u.full_name, u.email, u.password_hash, u.role, u.is_active,
              u.visible_modules, m.business_name, m.currency
       FROM users u
       JOIN merchants m ON m.id = u.merchant_id
       WHERE u.email = $1`,
      [email]
    );
    const user = result.rows[0];

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role, visibleModules: user.visible_modules },
      merchant: { id: user.merchant_id, businessName: user.business_name, currency: user.currency },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la connexion.' });
  }
});

module.exports = router;

