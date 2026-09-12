const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
router.use(authenticate);

// Calcule la créance d'un ou plusieurs clients : somme des ventes à crédit
// (payment_method = 'a_credit') moins les règlements déjà enregistrés.
// On ne stocke jamais ce montant en colonne pour éviter toute
// désynchronisation — il est toujours recalculé à la demande.
const SOUS_REQUETE_CREANCE = `
  COALESCE((
    SELECT SUM(o.total_amount) FROM orders o
    WHERE o.client_id = clients.id AND o.payment_method = 'a_credit' AND o.status != 'annulee'
  ), 0) - COALESCE((
    SELECT SUM(cp.amount) FROM credit_payments cp WHERE cp.client_id = clients.id
  ), 0)
`;

// GET /clients
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, phone, email, address, created_at, (${SOUS_REQUETE_CREANCE}) AS balance_due
       FROM clients WHERE merchant_id = $1 ORDER BY full_name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des clients.' });
  }
});

// GET /clients/:id  — fiche client avec son historique d'achats et sa créance
router.get('/:id', async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT id, full_name, phone, email, address, created_at, (${SOUS_REQUETE_CREANCE}) AS balance_due
       FROM clients WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const client = clientResult.rows[0];
    if (!client) {
      return res.status(404).json({ error: 'Client introuvable.' });
    }

    const ordersResult = await pool.query(
      `SELECT id, status, total_amount, payment_method, created_at
       FROM orders WHERE client_id = $1 AND merchant_id = $2
       ORDER BY created_at DESC`,
      [req.params.id, req.user.merchantId]
    );

    const reglementsResult = await pool.query(
      `SELECT cp.id, cp.amount, cp.note, cp.created_at, u.full_name AS recorded_by_name
       FROM credit_payments cp LEFT JOIN users u ON u.id = cp.recorded_by
       WHERE cp.client_id = $1 AND cp.merchant_id = $2
       ORDER BY cp.created_at DESC`,
      [req.params.id, req.user.merchantId]
    );

    res.json({ ...client, orderHistory: ordersResult.rows, creditPayments: reglementsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du client.' });
  }
});

// POST /clients/:id/credit-payments — enregistrer un règlement de créance
// (partiel ou total). Accessible au caissier, au manager et au gérant.
router.post('/:id/credit-payments', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  const { amount, note } = req.body;

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Le montant du règlement doit être un nombre positif.' });
  }

  try {
    const clientResult = await pool.query(
      `SELECT id, full_name, (${SOUS_REQUETE_CREANCE}) AS balance_due FROM clients WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ error: 'Client introuvable.' });

    if (amount > Number(client.balance_due)) {
      return res.status(400).json({ error: 'Le montant du règlement dépasse la créance restante.' });
    }

    const result = await pool.query(
      `INSERT INTO credit_payments (merchant_id, client_id, amount, recorded_by, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.merchantId, req.params.id, amount, req.user.id, note || null]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'credit_payment',
      description: `a enregistré un règlement de ${amount.toLocaleString('fr-FR')} pour ${client.full_name}`,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du règlement." });
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
