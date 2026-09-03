const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate);

// GET /orders — liste des commandes récentes du commerçant
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.status, o.total_amount, o.created_at,
              c.full_name AS client_name
       FROM orders o
       LEFT JOIN clients c ON c.id = o.client_id
       WHERE o.merchant_id = $1
       ORDER BY o.created_at DESC
       LIMIT 100`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des commandes.' });
  }
});

// GET /orders/:id — détail d'une commande avec ses lignes
router.get('/:id', async (req, res) => {
  try {
    const orderResult = await pool.query(
      `SELECT o.*, c.full_name AS client_name
       FROM orders o LEFT JOIN clients c ON c.id = o.client_id
       WHERE o.id = $1 AND o.merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const order = orderResult.rows[0];
    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable.' });
    }

    const itemsResult = await pool.query(
      `SELECT oi.id, oi.product_id, p.name AS product_name, oi.quantity, oi.unit_price, oi.line_total
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [order.id]
    );

    res.json({ ...order, items: itemsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération de la commande.' });
  }
});

// POST /orders
// Crée une commande avec ses lignes, déduit le stock automatiquement et
// enregistre le mouvement de stock correspondant. Tout se fait dans une
// transaction : si un produit n'a pas assez de stock, rien n'est enregistré.
// Accessible à tous les rôles : un vendeur doit pouvoir enregistrer une vente.
router.post('/', async (req, res) => {
  const { clientId, items, notes } = req.body;
  // items attendu : [{ productId, quantity }, ...]

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'La commande doit contenir au moins un article.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let totalAmount = 0;
    const resolvedItems = [];

    for (const item of items) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw { status: 400, message: 'Article de commande invalide.' };
      }

      const productResult = await client.query(
        `SELECT id, name, unit_price, quantity_in_stock
         FROM products WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
        [item.productId, req.user.merchantId]
      );
      const product = productResult.rows[0];

      if (!product) {
        throw { status: 404, message: `Produit ${item.productId} introuvable.` };
      }
      if (product.quantity_in_stock < item.quantity) {
        throw { status: 400, message: `Stock insuffisant pour ${product.name}.` };
      }

      const lineTotal = product.unit_price * item.quantity;
      totalAmount += Number(lineTotal);
      resolvedItems.push({ product, quantity: item.quantity, unitPrice: product.unit_price });
    }

    const orderResult = await client.query(
      `INSERT INTO orders (merchant_id, client_id, created_by, status, total_amount, notes)
       VALUES ($1, $2, $3, 'en_attente', $4, $5)
       RETURNING *`,
      [req.user.merchantId, clientId || null, req.user.id, totalAmount, notes || null]
    );
    const order = orderResult.rows[0];

    for (const resolved of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [order.id, resolved.product.id, resolved.quantity, resolved.unitPrice]
      );

      const newQuantity = resolved.product.quantity_in_stock - resolved.quantity;
      await client.query(`UPDATE products SET quantity_in_stock = $1 WHERE id = $2`, [
        newQuantity,
        resolved.product.id,
      ]);

      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason)
         VALUES ($1, $2, $3, 'sortie', $4, $5)`,
        [req.user.merchantId, resolved.product.id, req.user.id, resolved.quantity, `Commande ${order.id}`]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la commande.' });
  } finally {
    client.release();
  }
});

// PATCH /orders/:id/status
// Réservé au manager et au gérant : un vendeur ne valide/annule pas une commande.
router.patch('/:id/status', requireRole('manager', 'gerant'), async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['en_attente', 'validee', 'livree', 'annulee'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Statut invalide.' });
  }

  try {
    const result = await pool.query(
      `UPDATE orders SET status = $1 WHERE id = $2 AND merchant_id = $3 RETURNING *`,
      [status, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Commande introuvable.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du statut.' });
  }
});

module.exports = router;
