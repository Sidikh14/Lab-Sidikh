const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
router.use(authenticate);

// GET /credit-requests?status=en_attente — liste des demandes (manager/gérant)
router.get('/', requireRole('manager', 'gerant'), async (req, res) => {
  const { status } = req.query;
  try {
    const params = [req.user.merchantId];
    let filtreStatut = '';
    if (status) {
      params.push(status);
      filtreStatut = `AND cr.status = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT cr.*, o.order_seq, o.total_amount, o.created_at AS order_created_at,
              u.full_name AS requested_by_name
       FROM credit_requests cr
       JOIN orders o ON o.id = cr.order_id
       LEFT JOIN users u ON u.id = cr.requested_by
       WHERE cr.merchant_id = $1 ${filtreStatut}
       ORDER BY cr.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des demandes de crédit.' });
  }
});

// POST /credit-requests — le caissier (ou manager) demande la création d'un
// client et l'autorisation de vente à crédit pour une commande de client de
// passage actuellement en attente d'encaissement.
router.post('/', requireRole('manager', 'caissier'), async (req, res) => {
  const { orderId, fullName, phone, address } = req.body;

  if (!orderId || !fullName) {
    return res.status(400).json({ error: 'La commande et le nom du client sont requis.' });
  }

  try {
    const orderResult = await pool.query(
      `SELECT id, status, client_id FROM orders WHERE id = $1 AND merchant_id = $2`,
      [orderId, req.user.merchantId]
    );
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (order.client_id) {
      return res.status(400).json({ error: 'Cette commande est déjà rattachée à un client enregistré.' });
    }
    if (order.status !== 'en_attente') {
      return res.status(400).json({ error: 'Cette commande a déjà été traitée.' });
    }

    const existante = await pool.query(
      `SELECT id FROM credit_requests WHERE order_id = $1 AND status = 'en_attente'`,
      [orderId]
    );
    if (existante.rows[0]) {
      return res.status(400).json({ error: 'Une demande est déjà en attente pour cette commande.' });
    }

    const result = await pool.query(
      `INSERT INTO credit_requests (merchant_id, order_id, requested_by, full_name, phone, address)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.merchantId, orderId, req.user.id, fullName, phone || null, address || null]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'credit_request_created',
      description: `a demandé la création du client ${fullName} pour une vente à crédit`,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la demande.' });
  }
});

// PATCH /credit-requests/:id/approve — crée le client et l'associe à la
// commande, qui reste "en_attente" : le caissier doit ensuite finaliser
// l'encaissement à crédit lui-même.
router.patch('/:id/approve', requireRole('manager', 'gerant'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const demandeResult = await client.query(
      `SELECT * FROM credit_requests WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [req.params.id, req.user.merchantId]
    );
    const demande = demandeResult.rows[0];
    if (!demande) throw { status: 404, message: 'Demande introuvable.' };
    if (demande.status !== 'en_attente') {
      throw { status: 400, message: 'Cette demande a déjà été traitée.' };
    }

    const nouveauClient = await client.query(
      `INSERT INTO clients (merchant_id, full_name, phone, address)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.merchantId, demande.full_name, demande.phone, demande.address]
    );

    await client.query(
      `UPDATE orders SET client_id = $1 WHERE id = $2 AND merchant_id = $3`,
      [nouveauClient.rows[0].id, demande.order_id, req.user.merchantId]
    );

    await client.query(
      `UPDATE credit_requests SET status = 'approuvee', reviewed_by = $1, reviewed_at = now() WHERE id = $2`,
      [req.user.id, demande.id]
    );

    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'credit_request_approved',
      description: `a approuvé la demande de crédit et créé le client ${demande.full_name}`,
    });

    res.json({ client: nouveauClient.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'approbation de la demande." });
  } finally {
    client.release();
  }
});

// PATCH /credit-requests/:id/reject — rejette la demande, la commande reste
// une vente à un client de passage (le caissier devra choisir un autre
// moyen de paiement).
router.patch('/:id/reject', requireRole('manager', 'gerant'), async (req, res) => {
  const { reason } = req.body;
  try {
    const result = await pool.query(
      `UPDATE credit_requests SET status = 'rejetee', reviewed_by = $1, reviewed_at = now(), rejection_reason = $2
       WHERE id = $3 AND merchant_id = $4 AND status = 'en_attente'
       RETURNING *`,
      [req.user.id, reason || null, req.params.id, req.user.merchantId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Demande introuvable ou déjà traitée.' });
    }

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'credit_request_rejected',
      description: `a rejeté la demande de crédit pour ${result.rows[0].full_name}`,
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du rejet de la demande.' });
  }
});

module.exports = router;
