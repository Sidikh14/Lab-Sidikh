const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('manager', 'gerant'));

function formatSessionNumber(session) {
  const annee = new Date(session.created_at).getFullYear();
  const numero = String(session.session_seq).padStart(3, '0');
  return `INV-${annee}-${numero}`;
}

// GET /inventory-sessions — liste avec compteurs (produits, comptés, écarts)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.session_seq, s.status, s.created_at, s.closed_at, u.full_name AS created_by_name,
              COUNT(i.id) AS total_produits,
              COUNT(i.counted_quantity) AS total_comptes,
              COUNT(*) FILTER (WHERE i.counted_quantity IS NOT NULL AND i.counted_quantity != i.theoretical_quantity) AS total_ecarts
       FROM inventory_sessions s
       LEFT JOIN users u ON u.id = s.created_by
       LEFT JOIN inventory_session_items i ON i.session_id = s.id
       WHERE s.merchant_id = $1
       GROUP BY s.id, u.full_name
       ORDER BY s.created_at DESC`,
      [req.user.merchantId]
    );
    res.json(result.rows.map((s) => ({ ...s, session_number: formatSessionNumber(s) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des sessions.' });
  }
});

// GET /inventory-sessions/:id — détail avec chaque produit à compter
router.get('/:id', async (req, res) => {
  try {
    const sessionResult = await pool.query(
      `SELECT s.*, u.full_name AS created_by_name
       FROM inventory_sessions s LEFT JOIN users u ON u.id = s.created_by
       WHERE s.id = $1 AND s.merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: 'Session introuvable.' });

    const itemsResult = await pool.query(
      `SELECT i.id, i.product_id, p.name AS product_name, p.sku, i.theoretical_quantity, i.counted_quantity, i.counted_at
       FROM inventory_session_items i JOIN products p ON p.id = i.product_id
       WHERE i.session_id = $1
       ORDER BY p.name`,
      [session.id]
    );

    res.json({ ...session, session_number: formatSessionNumber(session), items: itemsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération de la session.' });
  }
});

// POST /inventory-sessions — crée une session, capture le stock théorique actuel de chaque produit actif
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sessionResult = await client.query(
      `INSERT INTO inventory_sessions (merchant_id, created_by, status)
       VALUES ($1, $2, 'en_cours') RETURNING *`,
      [req.user.merchantId, req.user.id]
    );
    const session = sessionResult.rows[0];

    const produitsResult = await client.query(
      `SELECT id, quantity_in_stock FROM products WHERE merchant_id = $1 AND is_active = TRUE`,
      [req.user.merchantId]
    );

    for (const p of produitsResult.rows) {
      await client.query(
        `INSERT INTO inventory_session_items (session_id, product_id, theoretical_quantity)
         VALUES ($1, $2, $3)`,
        [session.id, p.id, p.quantity_in_stock]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...session, session_number: formatSessionNumber(session) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la session.' });
  } finally {
    client.release();
  }
});

// PATCH /inventory-sessions/:id/items/:itemId — saisir la quantité comptée pour un produit
router.patch('/:id/items/:itemId', async (req, res) => {
  const { countedQuantity } = req.body;
  if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
    return res.status(400).json({ error: 'Quantité comptée invalide.' });
  }
  try {
    const result = await pool.query(
      `UPDATE inventory_session_items i SET counted_quantity = $1, counted_at = now()
       FROM inventory_sessions s
       WHERE i.id = $2 AND i.session_id = $3 AND s.id = i.session_id AND s.merchant_id = $4
       RETURNING i.*`,
      [countedQuantity, req.params.itemId, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Article introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la saisie du comptage.' });
  }
});

// PATCH /inventory-sessions/:id/close — clôture sans toucher au stock
router.patch('/:id/close', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE inventory_sessions SET status = 'cloturee', closed_at = now()
       WHERE id = $1 AND merchant_id = $2 RETURNING *`,
      [req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la clôture.' });
  }
});

// PATCH /inventory-sessions/:id/adjust — applique les quantités comptées au stock réel
// et enregistre un mouvement d'ajustement pour chaque écart.
router.patch('/:id/adjust', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sessionResult = await client.query(
      `SELECT * FROM inventory_sessions WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [req.params.id, req.user.merchantId]
    );
    const session = sessionResult.rows[0];
    if (!session) throw { status: 404, message: 'Session introuvable.' };

    const itemsResult = await client.query(
      `SELECT * FROM inventory_session_items
       WHERE session_id = $1 AND counted_quantity IS NOT NULL AND counted_quantity != theoretical_quantity`,
      [session.id]
    );

    for (const item of itemsResult.rows) {
      const delta = item.counted_quantity - item.theoretical_quantity;
      await client.query(`UPDATE products SET quantity_in_stock = $1 WHERE id = $2`, [
        item.counted_quantity,
        item.product_id,
      ]);
      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason)
         VALUES ($1, $2, $3, 'ajustement', $4, $5)`,
        [req.user.merchantId, item.product_id, req.user.id, Math.abs(delta), `Comptage ${formatSessionNumber(session)}`]
      );
    }

    const updated = await client.query(
      `UPDATE inventory_sessions SET status = 'ajustee', closed_at = now() WHERE id = $1 RETURNING *`,
      [session.id]
    );

    await client.query('COMMIT');
    res.json({ ...updated.rows[0], session_number: formatSessionNumber(updated.rows[0]), ecarts_ajustes: itemsResult.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'ajustement du stock." });
  } finally {
    client.release();
  }
});

module.exports = router;
