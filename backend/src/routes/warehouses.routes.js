const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
router.use(authenticate);

// GET /warehouses — liste des boutiques du commerçant. Accessible à tous
// les rôles (le manager en a besoin pour choisir une boutique à chaque
// vente/entrée de stock ; les autres rôles n'en ont normalement pas
// besoin puisqu'ils sont assignés à la leur, mais ça reste inoffensif).
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, address, is_active, created_at
       FROM warehouses
       WHERE merchant_id = $1
       ORDER BY name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des boutiques.' });
  }
});

// POST /warehouses — créer une boutique (manager uniquement)
router.post('/', requireRole('manager'), async (req, res) => {
  const { name, address } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom de la boutique est requis.' });
  }

  try {
    // Plafond fixé par le propriétaire de la plateforme (merchants.max_warehouses) :
    // impossible à dépasser depuis cette route, seule la page d'administration
    // du propriétaire peut l'augmenter (même principe que max_team_members).
    const { rows: merchantRows } = await pool.query(
      'SELECT max_warehouses FROM merchants WHERE id = $1',
      [req.user.merchantId]
    );
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*)::int AS total FROM warehouses WHERE merchant_id = $1',
      [req.user.merchantId]
    );
    const plafond = merchantRows[0]?.max_warehouses ?? 3;
    if (countRows[0].total >= plafond) {
      return res.status(403).json({
        error: `Limite de ${plafond} boutiques atteinte pour votre commerce. Contactez le propriétaire de la plateforme pour l'augmenter.`,
      });
    }

    const result = await pool.query(
      `INSERT INTO warehouses (merchant_id, name, address)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.user.merchantId, name.trim(), address || null]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'warehouse_created',
      description: `a créé la boutique ${result.rows[0].name}`,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la boutique.' });
  }
});

// PATCH /warehouses/:id — modifier nom/adresse (manager uniquement)
router.patch('/:id', requireRole('manager'), async (req, res) => {
  const { name, address } = req.body;

  try {
    const result = await pool.query(
      `UPDATE warehouses SET
         name = COALESCE($1, name),
         address = COALESCE($2, address)
       WHERE id = $3 AND merchant_id = $4
       RETURNING *`,
      [name, address, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Boutique introuvable.' });
    }

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'warehouse_updated',
      description: `a modifié la boutique ${result.rows[0].name}`,
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la boutique.' });
  }
});

// PATCH /warehouses/:id/status — activer/désactiver (pas de suppression,
// comme les fournisseurs : une boutique désactivée disparaît des
// sélecteurs mais son historique reste intact). Manager uniquement.
router.patch('/:id/status', requireRole('manager'), async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive doit être un booléen.' });
  }

  try {
    const result = await pool.query(
      `UPDATE warehouses SET is_active = $1 WHERE id = $2 AND merchant_id = $3 RETURNING *`,
      [isActive, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Boutique introuvable.' });
    }

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'warehouse_status_changed',
      description: `a ${isActive ? 'réactivé' : 'désactivé'} la boutique ${result.rows[0].name}`,
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la boutique.' });
  }
});

module.exports = router;
