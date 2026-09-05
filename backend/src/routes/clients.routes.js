const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /clients
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, phone, email, address, created_at
       FROM clients WHERE merchant_id = $1 ORDER BY full_name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des clients.' });
  }
});

// GET /clients/:id  — fiche client avec son historique d'achats
router.get('/:id', async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT id, full_name, phone, email, address, created_at
       FROM clients WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const client = clientResult.rows[0];
    if (!client) {
      return res.status(404).json({ error: 'Client introuvable.' });
    }

    const ordersResult = await pool.query(
      `SELECT id, status, total_amount, created_at
       FROM orders WHERE client_id = $1 AND merchant_id = $2
       ORDER BY created_at DESC`,
      [req.params.id, req.user.merchantId]
    );

    res.json({ ...client, orderHistory: ordersResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du client.' });
  }
});

// POST /clients — tous les rôles peuvent créer une fiche client (utile au comptoir)
router.post('/', async (req, res) => {
  const { fullName, phone, email, address } = req.body;

  if (!fullName) {
    return res.status(400).json({ error: 'Le nom du client est requis.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO clients (merchant_id, full_name, phone, email, address)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.merchantId, fullName, phone || null, email || null, address || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du client.' });
  }
});

module.exports = router;
