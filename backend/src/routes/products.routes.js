const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
router.use(authenticate);

// GET /products
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         p.id, p.name, p.sku, p.unit_price, p.quantity_in_stock,
         p.quantity_alert_threshold, c.name AS category,
         CASE
           WHEN p.quantity_in_stock = 0 THEN 'rupture'
           WHEN p.quantity_in_stock <= p.quantity_alert_threshold THEN 'faible'
           ELSE 'en_stock'
         END AS status
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.merchant_id = $1 AND p.is_active = TRUE
       ORDER BY p.name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du stock.' });
  }
});

// POST /products
router.post('/', requireRole('manager', 'gerant'), async (req, res) => {
  const { name, sku, categoryId, unitPrice, quantityInStock, quantityAlertThreshold } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Le nom du produit est requis.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO products (merchant_id, category_id, name, sku, unit_price, quantity_in_stock, quantity_alert_threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.user.merchantId,
        categoryId || null,
        name,
        sku || null,
        unitPrice || 0,
        quantityInStock || 0,
        quantityAlertThreshold || 5,
      ]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'product_created',
      description: `a ajouté le produit ${name} au catalogue`,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du produit.' });
  }
});

// PATCH /products/:id — journalise un changement de prix, s'il y en a un
router.patch('/:id', requireRole('manager', 'gerant'), async (req, res) => {
  const { name, sku, categoryId, unitPrice, quantityAlertThreshold } = req.body;

  try {
    const avant = await pool.query(
      `SELECT name, unit_price FROM products WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    if (avant.rows.length === 0) {
      return res.status(404).json({ error: 'Produit introuvable.' });
    }
    const ancienPrix = Number(avant.rows[0].unit_price);
    const nomProduit = avant.rows[0].name;

    const result = await pool.query(
      `UPDATE products SET
         name = COALESCE($1, name),
         sku = COALESCE($2, sku),
         category_id = COALESCE($3, category_id),
         unit_price = COALESCE($4, unit_price),
         quantity_alert_threshold = COALESCE($5, quantity_alert_threshold)
       WHERE id = $6 AND merchant_id = $7
       RETURNING *`,
      [name, sku, categoryId, unitPrice, quantityAlertThreshold, req.params.id, req.user.merchantId]
    );

    if (unitPrice !== undefined && Number(unitPrice) !== ancienPrix) {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'product_price_updated',
        description: `a changé le prix de ${nomProduit} : ${Math.round(ancienPrix).toLocaleString('fr-FR')} → ${Math.round(Number(unitPrice)).toLocaleString('fr-FR')} FCFA`,
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du produit.' });
  }
});

// POST /products/:id/stock-movement
// Entrée (réapprovisionnement, avec fournisseur/date facultatifs), sortie ou
// ajustement. Accessible à tous les rôles (un vendeur enregistre ses ventes).
router.post('/:id/stock-movement', async (req, res) => {
  const { movementType, quantity, reason, supplierId, movementDate } = req.body;
  const validTypes = ['entree', 'sortie', 'ajustement'];

  if (!validTypes.includes(movementType) || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Mouvement de stock invalide.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const productResult = await client.query(
      `SELECT id, name, quantity_in_stock FROM products
       WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [req.params.id, req.user.merchantId]
    );
    const product = productResult.rows[0];

    if (!product) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produit introuvable.' });
    }

    const delta = movementType === 'sortie' ? -quantity : quantity;
    const newQuantity = product.quantity_in_stock + delta;

    if (newQuantity < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Quantité insuffisante en stock.' });
    }

    await client.query(
      `UPDATE products SET quantity_in_stock = $1 WHERE id = $2`,
      [newQuantity, product.id]
    );

    await client.query(
      `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, supplier_id, movement_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.user.merchantId,
        product.id,
        req.user.id,
        movementType,
        quantity,
        reason || null,
        supplierId || null,
        movementDate || null,
      ]
    );

    await client.query('COMMIT');
    res.json({ productId: product.id, quantityInStock: newQuantity });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du mouvement de stock." });
  } finally {
    client.release();
  }
});

// DELETE /products/:id
router.delete('/:id', requireRole('manager'), async (req, res) => {
  try {
    const avant = await pool.query(
      `SELECT name FROM products WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const result = await pool.query(
      `UPDATE products SET is_active = FALSE WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produit introuvable.' });
    }

    if (avant.rows[0]) {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'product_deleted',
        description: `a retiré ${avant.rows[0].name} du catalogue`,
      });
    }

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression du produit.' });
  }
});

module.exports = router;
