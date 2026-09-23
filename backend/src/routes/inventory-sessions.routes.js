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

// Même logique que products.routes.js (resolveWarehouseId) : le manager
// choisit sa boutique à chaque fois (aucune par défaut), le gérant est
// toujours restreint à la sienne, quoi qu'il envoie.
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

// GET /inventory-sessions — liste avec compteurs (produits, comptés, écarts, perte),
// scopée à une boutique (manager : ?warehouseId= requis ; gérant : la sienne).
router.get('/', async (req, res) => {
  let warehouseId;
  try {
    warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Erreur.' });
  }

  try {
    const result = await pool.query(
      `SELECT s.id, s.session_seq, s.status, s.created_at, s.closed_at, u.full_name AS created_by_name,
              COUNT(i.id) AS total_produits,
              COUNT(i.counted_quantity) AS total_comptes,
              COUNT(*) FILTER (WHERE i.counted_quantity IS NOT NULL AND i.counted_quantity != i.theoretical_quantity) AS total_ecarts,
              COALESCE(SUM(
                CASE WHEN i.counted_quantity IS NOT NULL AND i.counted_quantity < i.theoretical_quantity
                     THEN (i.theoretical_quantity - i.counted_quantity) * p.unit_price
                     ELSE 0 END
              ), 0) AS total_perte
       FROM inventory_sessions s
       LEFT JOIN users u ON u.id = s.created_by
       LEFT JOIN inventory_session_items i ON i.session_id = s.id
       LEFT JOIN products p ON p.id = i.product_id
       WHERE s.merchant_id = $1 AND s.warehouse_id = $2
       GROUP BY s.id, u.full_name
       ORDER BY s.created_at DESC`,
      [req.user.merchantId, warehouseId]
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
      `SELECT s.*, u.full_name AS created_by_name, w.name AS warehouse_name
       FROM inventory_sessions s
       LEFT JOIN users u ON u.id = s.created_by
       LEFT JOIN warehouses w ON w.id = s.warehouse_id
       WHERE s.id = $1 AND s.merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: 'Session introuvable.' });
    if (req.user.role !== 'manager' && session.warehouse_id !== req.user.warehouseId) {
      return res.status(403).json({ error: 'Cette session ne concerne pas votre boutique.' });
    }

    const itemsResult = await pool.query(
      `SELECT i.id, i.product_id, p.name AS product_name, p.sku, p.unit_price, i.theoretical_quantity, i.counted_quantity, i.counted_at
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

// POST /inventory-sessions — crée une session pour UNE boutique, capture le
// stock théorique actuel (product_stock, pas products — le stock est par
// boutique depuis le multi-boutique) de chaque produit actif.
router.post('/', async (req, res) => {
  let warehouseId;
  try {
    warehouseId = await resolveWarehouseId(req, null, req.body.warehouseId);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Erreur.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sessionResult = await client.query(
      `INSERT INTO inventory_sessions (merchant_id, created_by, status, warehouse_id)
       VALUES ($1, $2, 'en_cours', $3) RETURNING *`,
      [req.user.merchantId, req.user.id, warehouseId]
    );
    const session = sessionResult.rows[0];

    const produitsResult = await client.query(
      `SELECT p.id, COALESCE(ps.quantity_in_stock, 0) AS quantity_in_stock
       FROM products p
       LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.warehouse_id = $2
       WHERE p.merchant_id = $1 AND p.is_active = TRUE`,
      [req.user.merchantId, warehouseId]
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
  if (typeof countedQuantity !== 'number' || Number.isNaN(countedQuantity) || countedQuantity < 0) {
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

// PATCH /inventory-sessions/:id/adjust — applique les quantités comptées au
// stock réel de la boutique de la session (product_stock) et enregistre un
// mouvement d'ajustement pour chaque écart.
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
      await client.query(
        `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity_in_stock = $4`,
        [req.user.merchantId, item.product_id, session.warehouse_id, item.counted_quantity]
      );
      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id)
         VALUES ($1, $2, $3, 'ajustement', $4, $5, $6)`,
        [req.user.merchantId, item.product_id, req.user.id, Math.abs(delta), `Comptage ${formatSessionNumber(session)}`, session.warehouse_id]
      );

      // Pharmacie : un produit créé sans stock initial reste "À activer"
      // (is_activated = FALSE) tant qu'aucune entrée de stock classique ne
      // lui a été faite (voir products.routes.js). Le comptage initial
      // (Sessions d'inventaire) est une autre façon légitime de mettre un
      // produit en stock pour la première fois — sans ça, un produit
      // renseigné uniquement via un comptage resterait éternellement
      // affiché "À activer" malgré un stock réel positif.
      if (Number(item.counted_quantity) > 0) {
        await client.query(`UPDATE products SET is_activated = TRUE WHERE id = $1`, [item.product_id]);
      }
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
