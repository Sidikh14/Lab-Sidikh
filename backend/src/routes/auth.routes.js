const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { requireAdminKey } = require('../middleware/adminKey');
const { CATEGORIES_PHARMACIE, PRODUITS_PHARMACIE } = require('../data/pharmacieCatalogue');

const router = express.Router();

const SECTEURS_VALIDES = ['grossiste', 'pharmacie', 'electromenager', 'textile'];

function signToken(user) {
  return jwt.sign(
    { sub: user.id, merchantId: user.merchant_id, role: user.role, warehouseId: user.warehouse_id || null, sector: user.sector || null },
    process.env.JWT_SECRET
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
  if (!SECTEURS_VALIDES.includes(sector)) {
    return res.status(400).json({ error: `Secteur d'activité invalide. Valeurs acceptées : ${SECTEURS_VALIDES.join(', ')}.` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const merchantResult = await client.query(
      `INSERT INTO merchants (business_name, sector, email)
       VALUES ($1, $2, $3) RETURNING id, business_name, sector, currency`,
      [businessName, sector, email]
    );
    const merchant = merchantResult.rows[0];

    // Pour tout nouveau commerce du secteur pharmacie, on pré-remplit un
    // catalogue de départ (catégories + médicaments/parapharmacie courants)
    // pour accélérer l'installation — l'utilisateur ajuste ensuite les
    // quantités réelles via l'entrée de stock habituelle (quantité à 0
    // pour tous à la création). is_activated = FALSE : ces produits ne
    // s'affichent pas en rupture tant qu'aucune entrée de stock ne leur a
    // été faite (activation automatique dès la première entrée).
    if (sector === 'pharmacie') {
      const categorieIdParNom = {};
      for (const nomCategorie of CATEGORIES_PHARMACIE) {
        const catResult = await client.query(
          `INSERT INTO categories (merchant_id, name) VALUES ($1, $2) RETURNING id`,
          [merchant.id, nomCategorie]
        );
        categorieIdParNom[nomCategorie] = catResult.rows[0].id;
      }
      for (const produit of PRODUITS_PHARMACIE) {
        await client.query(
          `INSERT INTO products (merchant_id, category_id, name, unit_price, tva_applicable, quantity_alert_threshold, is_weighted, attributes, is_activated)
           VALUES ($1, $2, $3, $4, $5, $6, FALSE, '{}', FALSE)`,
          [merchant.id, categorieIdParNom[produit.categorie] || null, produit.name, produit.unitPrice, produit.tvaApplicable, 5]
        );
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      `INSERT INTO users (merchant_id, full_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'manager')
       RETURNING id, full_name, email, role, merchant_id`,
      [merchant.id, fullName, email, passwordHash]
    );
    const user = { ...userResult.rows[0], sector: merchant.sector };

    await client.query('COMMIT');

    const token = signToken(user);
    res.status(201).json({
      token,
      user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role },
      merchant: { id: merchant.id, businessName: merchant.business_name, sector: merchant.sector, currency: merchant.currency },
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

// POST /auth/create-owner
// Crée VOTRE compte propriétaire de la plateforme (rôle "owner"), rattaché
// à aucun commerçant. Protégé par la même clé secrète (X-Admin-Key) que
// /register — à utiliser une seule fois pour créer votre propre accès à la
// page d'administration, puis vous connectez ensuite avec /auth/login
// comme n'importe quel utilisateur.
router.post('/create-owner', requireAdminKey, async (req, res) => {
  const { fullName, email, password } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (merchant_id, full_name, email, password_hash, role)
       VALUES (NULL, $1, $2, $3, 'owner')
       RETURNING id, full_name, email, role`,
      [fullName, email, passwordHash]
    );
    res.status(201).json({ message: 'Compte propriétaire créé avec succès.', user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du compte propriétaire.' });
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
              u.visible_modules, u.warehouse_id, w.name AS warehouse_name,
              m.business_name, m.sector, m.currency, m.is_active AS merchant_is_active
       FROM users u
       LEFT JOIN merchants m ON m.id = u.merchant_id
       LEFT JOIN warehouses w ON w.id = u.warehouse_id
       WHERE u.email = $1`,
      [email]
    );
    const user = result.rows[0];

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    // Un compte owner n'a pas de commerçant (merchant_is_active est alors
    // null) — seul le blocage d'un commerçant par le propriétaire doit
    // empêcher la connexion de ses employés.
    if (user.role !== 'owner' && user.merchant_is_active === false) {
      return res.status(403).json({ error: 'Ce commerce a été suspendu. Contactez le support.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        visibleModules: user.visible_modules,
        warehouseId: user.warehouse_id,
        warehouseName: user.warehouse_name,
      },
      merchant: user.merchant_id
        ? { id: user.merchant_id, businessName: user.business_name, sector: user.sector, currency: user.currency }
        : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la connexion.' });
  }
});

module.exports = router;

