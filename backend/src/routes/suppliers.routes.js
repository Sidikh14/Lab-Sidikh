const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('manager', 'gerant'));

// GET /suppliers
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, phone, email, address, created_at
       FROM suppliers WHERE merchant_id = $1 AND is_active = TRUE ORDER BY name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des fournisseurs.' });
  }
});

// POST /suppliers
router.post('/', async (req, res) => {
  const { name, phone, email, address } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Le nom du fournisseur est requis.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO suppliers (merchant_id, name, phone, email, address)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.merchantId, name, phone || null, email || null, address || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du fournisseur.' });
  }
});

// DELETE /suppliers/:id — désactivation (pas de suppression physique)
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE suppliers SET is_active = FALSE WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fournisseur introuvable.' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression du fournisseur.' });
  }
});

module.exports = router;