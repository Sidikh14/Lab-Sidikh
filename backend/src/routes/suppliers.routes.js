const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('manager', 'gerant'));

// GET /suppliers — liste avec la dette (créance du fournisseur envers nous,
// pour les achats à crédit) calculée à la volée : jamais stockée, pour
// éviter toute désynchronisation.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         s.id, s.name, s.phone, s.email, s.address, s.created_at,
         COALESCE(entrees.total, 0) - COALESCE(paiements.total, 0) AS debt
       FROM suppliers s
       LEFT JOIN (
         SELECT supplier_id, SUM(total_cost) AS total
         FROM stock_movements
         WHERE merchant_id = $1 AND movement_type = 'entree' AND payment_method = 'a_credit'
         GROUP BY supplier_id
       ) entrees ON entrees.supplier_id = s.id
       LEFT JOIN (
         SELECT supplier_id, SUM(amount) AS total
         FROM supplier_payments
         WHERE merchant_id = $1
         GROUP BY supplier_id
       ) paiements ON paiements.supplier_id = s.id
       WHERE s.merchant_id = $1 AND s.is_active = TRUE
       ORDER BY s.name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des fournisseurs.' });
  }
});

// GET /suppliers/:id — détail d'un fournisseur : dette + historique des
// entrées à crédit et des règlements (pour la modale de règlement).
router.get('/:id', async (req, res) => {
  try {
    const supplierResult = await pool.query(
      `SELECT id, name, phone, email, address, created_at
       FROM suppliers WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [req.params.id, req.user.merchantId]
    );
    const supplier = supplierResult.rows[0];
    if (!supplier) return res.status(404).json({ error: 'Fournisseur introuvable.' });

    const entreesResult = await pool.query(
      `SELECT sm.id, sm.quantity, sm.total_cost, sm.movement_date, sm.created_at, p.name AS product_name
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       WHERE sm.supplier_id = $1 AND sm.merchant_id = $2 AND sm.movement_type = 'entree' AND sm.payment_method = 'a_credit'
       ORDER BY sm.created_at DESC`,
      [req.params.id, req.user.merchantId]
    );
    const paiementsResult = await pool.query(
      `SELECT sp.id, sp.amount, sp.paid_at, sp.notes, u.full_name AS user_name
       FROM supplier_payments sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.supplier_id = $1 AND sp.merchant_id = $2
       ORDER BY sp.paid_at DESC`,
      [req.params.id, req.user.merchantId]
    );

    const totalAchatsCredit = entreesResult.rows.reduce((s, e) => s + Number(e.total_cost || 0), 0);
    const totalPaiements = paiementsResult.rows.reduce((s, p) => s + Number(p.amount), 0);

    res.json({
      ...supplier,
      debt: totalAchatsCredit - totalPaiements,
      creditEntries: entreesResult.rows,
      payments: paiementsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du fournisseur.' });
  }
});

// POST /suppliers/:id/payments — enregistrer un règlement de dette
router.post('/:id/payments', async (req, res) => {
  const { amount, notes } = req.body;
  if (!Number(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Montant de règlement invalide.' });
  }
  try {
    const supplier = await pool.query(
      `SELECT id, name FROM suppliers WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [req.params.id, req.user.merchantId]
    );
    if (supplier.rows.length === 0) return res.status(404).json({ error: 'Fournisseur introuvable.' });

    const result = await pool.query(
      `INSERT INTO supplier_payments (merchant_id, supplier_id, user_id, amount, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.merchantId, req.params.id, req.user.id, Number(amount), notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du règlement." });
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
