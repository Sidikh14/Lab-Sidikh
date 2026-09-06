const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate);

// Qui peut créer qui : un manager peut créer des gérants et des vendeurs,
// un gérant ne peut créer que des vendeurs. Personne ne crée de second
// manager depuis cette route (ça reste le rôle du premier compte créé
// à l'inscription du commerce).
const ROLES_AUTORISES_PAR_CREATEUR = {
  manager: ['gerant', 'vendeur', 'caissier'],
  gerant: ['vendeur'],
};

// GET /users — liste de l'équipe du commerce (manager et gérant uniquement)
router.get('/', requireRole('manager', 'gerant'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, role, is_active, last_login_at, created_at, visible_modules
       FROM users
       WHERE merchant_id = $1
       ORDER BY
         CASE role WHEN 'manager' THEN 0 WHEN 'gerant' THEN 1 ELSE 2 END,
         full_name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la récupération de l'équipe." });
  }
});

// POST /users — créer un membre de l'équipe (gérant ou vendeur selon le rôle du créateur)
router.post('/', requireRole('manager', 'gerant'), async (req, res) => {
  const { fullName, email, password, role } = req.body;

  if (!fullName || !email || !password || !role) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  const rolesAutorises = ROLES_AUTORISES_PAR_CREATEUR[req.user.role] || [];
  if (!rolesAutorises.includes(role)) {
    return res.status(403).json({
      error: `Vous ne pouvez pas créer un compte avec le rôle "${role}".`,
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (merchant_id, full_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name, email, role, is_active, created_at`,
      [req.user.merchantId, fullName, email, passwordHash, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création du membre de l'équipe." });
  }
});

// PATCH /users/:id/status — activer/désactiver un membre (manager uniquement)
router.patch('/:id/status', requireRole('manager'), async (req, res) => {
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive doit être un booléen.' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre compte ici.' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET is_active = $1
       WHERE id = $2 AND merchant_id = $3 AND role != 'manager'
       RETURNING id, full_name, role, is_active`,
      [isActive, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du membre.' });
  }
});

// PATCH /users/:id/permissions — manager choisit les modules visibles pour un
// gérant ou un vendeur. modules: null = accès complet par défaut du rôle.
const MODULES_VALIDES = ['stock', 'ventes', 'clients', 'fournisseurs', 'achats'];

router.patch('/:id/permissions', requireRole('manager'), async (req, res) => {
  const { modules } = req.body;

  if (modules !== null && (!Array.isArray(modules) || !modules.every((m) => MODULES_VALIDES.includes(m)))) {
    return res.status(400).json({ error: 'Liste de modules invalide.' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET visible_modules = $1
       WHERE id = $2 AND merchant_id = $3 AND role != 'manager'
       RETURNING id, full_name, role, visible_modules`,
      [modules, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour des permissions.' });
  }
});

module.exports = router;
