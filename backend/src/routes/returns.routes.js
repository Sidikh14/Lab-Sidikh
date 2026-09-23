const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { MOYENS_PAIEMENT, LABEL_METHODE, getSoldeActuel } = require('../utils/cashBalance');

const router = express.Router();
router.use(authenticate);

// Même logique que products/orders/cash : manager choisit toujours
// explicitement la boutique, les autres rôles utilisent la leur.
async function resolveWarehouseId(req, dbClient, providedId) {
  const runner = dbClient || pool;

  if (req.user.role === 'manager') {
    if (!providedId) {
      throw { status: 400, message: 'La boutique est requise.' };
    }
    const result = await runner.query(
      `SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [providedId, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      throw { status: 404, message: 'Boutique introuvable.' };
    }
    return providedId;
  }

  if (!req.user.warehouseId) {
    throw { status: 403, message: "Vous n'êtes assigné à aucune boutique." };
  }
  return req.user.warehouseId;
}

// GET /returns?warehouseId= — liste des retours de la boutique, séparée du
// flux de vente (orders/historique).
router.get('/', async (req, res) => {
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const result = await pool.query(
      `SELECT pr.*, p.name AS product_name, c.name AS client_name,
              o.order_seq, o.created_at AS order_created_at, u.full_name AS recorded_by_name
       FROM product_returns pr
       JOIN products p ON p.id = pr.product_id
       LEFT JOIN clients c ON c.id = pr.client_id
       JOIN orders o ON o.id = pr.order_id
       JOIN users u ON u.id = pr.recorded_by
       WHERE pr.merchant_id = $1 AND pr.warehouse_id = $2
       ORDER BY pr.created_at DESC
       LIMIT 200`,
      [req.user.merchantId, warehouseId]
    );
    res.json(result.rows);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des retours.' });
  }
});

// POST /returns — enregistre un retour client lié à une commande existante :
// motif obligatoire, remise en stock des articles retournés, remboursement
// obligatoire (sort de la caisse). Réservé manager/gérant.
router.post('/', requireRole('manager', 'gerant'), async (req, res) => {
  const { orderId, items, reason, refundMethod, refundAmount, warehouseId: warehouseIdInput } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: 'La commande est requise.' });
  }
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'Le motif du retour est obligatoire.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Au moins un article est requis.' });
  }
  if (!MOYENS_PAIEMENT.includes(refundMethod)) {
    return res.status(400).json({ error: 'Le moyen de remboursement est requis.' });
  }
  if (!Number(refundAmount) || Number(refundAmount) <= 0) {
    return res.status(400).json({ error: 'Le montant du remboursement est requis.' });
  }

  const client = await pool.connect();
  try {
    const warehouseId = await resolveWarehouseId(req, client, warehouseIdInput);

    // Le remboursement ne doit jamais rendre la caisse négative — même
    // contrôle qu'une sortie de caisse manuelle ou un achat au comptant.
    const soldeActuel = await getSoldeActuel(req, warehouseId, refundMethod);
    if (soldeActuel < Number(refundAmount)) {
      return res.status(400).json({
        error: `Solde insuffisant sur ${LABEL_METHODE[refundMethod]} (solde actuel : ${Math.round(soldeActuel).toLocaleString('fr-FR')} FCFA, remboursement : ${Math.round(Number(refundAmount)).toLocaleString('fr-FR')} FCFA).`,
      });
    }

    const orderResult = await client.query(
      `SELECT id, client_id, warehouse_id, order_seq FROM orders WHERE id = $1 AND merchant_id = $2`,
      [orderId, req.user.merchantId]
    );
    const order = orderResult.rows[0];
    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable.' });
    }
    if (order.warehouse_id !== warehouseId) {
      return res.status(400).json({ error: 'Cette commande ne correspond pas à la boutique sélectionnée.' });
    }

    await client.query('BEGIN');

    const retoursEnregistres = [];
    for (const item of items) {
      const { productId, quantity } = item;
      if (!productId || !Number(quantity) || Number(quantity) <= 0) {
        throw { status: 400, message: 'Article de retour invalide.' };
      }

      const productResult = await client.query(
        `SELECT p.id, p.name, COALESCE(ps.quantity_in_stock, 0) AS quantity_in_stock
         FROM products p
         LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.warehouse_id = $2
         WHERE p.id = $1 AND p.merchant_id = $3 FOR UPDATE OF p`,
        [productId, warehouseId, req.user.merchantId]
      );
      const product = productResult.rows[0];
      if (!product) {
        throw { status: 404, message: 'Produit introuvable.' };
      }

      const newQuantity = Number(product.quantity_in_stock) + Number(quantity);
      await client.query(
        `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity_in_stock = $4`,
        [req.user.merchantId, productId, warehouseId, newQuantity]
      );

      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id)
         VALUES ($1, $2, $3, 'retour_client', $4, $5, $6)`,
        [req.user.merchantId, productId, req.user.id, quantity, reason, warehouseId]
      );

      const returnResult = await client.query(
        `INSERT INTO product_returns (merchant_id, warehouse_id, order_id, product_id, client_id, quantity, reason, refund_amount, refund_method, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          req.user.merchantId,
          warehouseId,
          orderId,
          productId,
          order.client_id || null,
          quantity,
          reason,
          retoursEnregistres.length === 0 ? Number(refundAmount) : null,
          retoursEnregistres.length === 0 ? refundMethod : null,
          req.user.id,
        ]
      );
      retoursEnregistres.push(returnResult.rows[0]);
    }

    // Remboursement = une seule sortie de caisse pour tout le retour, même
    // si plusieurs articles (même convention que total_cost sur un achat
    // multi-articles : pas de double comptage).
    await client.query(
      `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date, movement_type, warehouse_id)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'sortie', $6)`,
      [
        req.user.merchantId,
        req.user.id,
        refundMethod,
        Number(refundAmount),
        `Remboursement retour client (commande #${order.id}) : ${reason}`,
        warehouseId,
      ]
    );

    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'product_return',
      description: `a enregistré un retour client sur la commande #${order.id} (${reason})`,
    });

    res.status(201).json(retoursEnregistres);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du retour." });
  } finally {
    client.release();
  }
});

module.exports = router;
