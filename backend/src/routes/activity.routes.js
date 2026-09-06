const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /activity/today
// Manager et gérant voient l'activité de toute l'équipe ; un vendeur ne voit
// que ses propres actions.
router.get('/today', async (req, res) => {
  const scopedToUser = req.user.role === 'vendeur';

  try {
    const ordersResult = await pool.query(
      `SELECT o.id, 'vente' AS type, o.total_amount AS montant, o.created_at,
              u.full_name AS user_name, c.full_name AS client_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.created_by
       LEFT JOIN clients c ON c.id = o.client_id
       WHERE o.merchant_id = $1 AND o.created_at >= date_trunc('day', now())
       ${scopedToUser ? 'AND o.created_by = $2' : ''}
       ORDER BY o.created_at DESC
       LIMIT 50`,
      scopedToUser ? [req.user.merchantId, req.user.id] : [req.user.merchantId]
    );

    const stockResult = await pool.query(
      `SELECT sm.id, 'stock' AS type, sm.movement_type, sm.quantity, sm.created_at,
              u.full_name AS user_name, p.name AS product_name
       FROM stock_movements sm
       LEFT JOIN users u ON u.id = sm.user_id
       LEFT JOIN products p ON p.id = sm.product_id
       WHERE sm.merchant_id = $1 AND sm.created_at >= date_trunc('day', now())
       ${scopedToUser ? 'AND sm.user_id = $2' : ''}
       ORDER BY sm.created_at DESC
       LIMIT 50`,
      scopedToUser ? [req.user.merchantId, req.user.id] : [req.user.merchantId]
    );

    const activite = [...ordersResult.rows, ...stockResult.rows].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    res.json(activite.slice(0, 30));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la récupération de l'activité." });
  }
});

module.exports = router;