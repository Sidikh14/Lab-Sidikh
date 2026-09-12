const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { COULEURS, formatMontant, dessinerEntete, dessinerEnteteTableau } = require('../utils/pdfHelpers');

const router = express.Router();
router.use(authenticate);

// GET /products/pdf — catalogue produits en PDF (avant les routes /:id pour éviter tout conflit de route)
router.get('/pdf', async (req, res) => {
  try {
    const merchantResult = await pool.query(`SELECT business_name FROM merchants WHERE id = $1`, [req.user.merchantId]);
    const businessName = merchantResult.rows[0]?.business_name || 'Commerce';

    const result = await pool.query(
      `SELECT
         p.name, p.sku, p.unit_price, p.quantity_in_stock,
         CASE
           WHEN p.quantity_in_stock = 0 THEN 'Rupture'
           WHEN p.quantity_in_stock <= p.quantity_alert_threshold THEN 'Faible'
           ELSE 'En stock'
         END AS status
       FROM products p
       WHERE p.merchant_id = $1 AND p.is_active = TRUE
       ORDER BY p.name`,
      [req.user.merchantId]
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="catalogue-produits-${new Date().toISOString().slice(0, 10)}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    let y = dessinerEntete(doc, {
      businessName,
      titre: 'Catalogue produits',
      sousTitre: `${result.rows.length} référence(s) · généré le ${new Date().toLocaleDateString('fr-FR')}`,
    });
    y += 10;

    function entete() {
      y = dessinerEnteteTableau(doc, y, [
        { texte: 'Produit', x: 56, largeur: 190 },
        { texte: 'Référence', x: 250, largeur: 90 },
        { texte: 'Prix', x: 345, largeur: 80, aligner: 'right' },
        { texte: 'Stock', x: 435, largeur: 50, aligner: 'right' },
        { texte: 'Statut', x: 495, largeur: 55 },
      ]);
    }
    entete();

    result.rows.forEach((p, index) => {
      if (y > 760) {
        doc.addPage();
        y = 50;
        entete();
      }
      if (index % 2 === 1) {
        doc.rect(50, y, doc.page.width - 100, 20).fill(COULEURS.fondAlterne);
        doc.fillColor(COULEURS.encre);
      }
      doc.fontSize(9.5);
      doc.text(p.name, 56, y + 5, { width: 190 });
      doc.fillColor(COULEURS.muted).text(p.sku || '—', 250, y + 5, { width: 90 });
      doc.fillColor(COULEURS.encre).text(`${formatMontant(p.unit_price)} FCFA`, 345, y + 5, { width: 80, align: 'right' });
      doc.text(String(p.quantity_in_stock), 435, y + 5, { width: 50, align: 'right' });
      doc.font(p.status === 'Rupture' ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
        .text(p.status, 495, y + 6, { width: 55 });
      doc.font('Helvetica');
      y += 20;
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});

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

    const unitsResult = await pool.query(
      `SELECT id, product_id, label, price, quantity_per_unit
       FROM product_units WHERE merchant_id = $1
       ORDER BY quantity_per_unit`,
      [req.user.merchantId]
    );
    const unitsParProduit = {};
    unitsResult.rows.forEach((u) => {
      if (!unitsParProduit[u.product_id]) unitsParProduit[u.product_id] = [];
      unitsParProduit[u.product_id].push(u);
    });

    res.json(result.rows.map((p) => ({ ...p, units: unitsParProduit[p.id] || [] })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du stock.' });
  }
});

// POST /products
router.post('/', requireRole('manager', 'gerant'), async (req, res) => {
  const { name, sku, categoryId, unitPrice, quantityInStock, quantityAlertThreshold, units } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Le nom du produit est requis.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
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
    const product = result.rows[0];

    const conditionnements = [];
    if (Array.isArray(units)) {
      for (const u of units) {
        if (!u.label || !Number(u.price) || !Number.isInteger(Number(u.quantityPerUnit)) || Number(u.quantityPerUnit) < 1) continue;
        const uResult = await client.query(
          `INSERT INTO product_units (product_id, merchant_id, label, price, quantity_per_unit)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [product.id, req.user.merchantId, u.label, Number(u.price), Number(u.quantityPerUnit)]
        );
        conditionnements.push(uResult.rows[0]);
      }
    }

    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'product_created',
      description: `a ajouté le produit ${name} au catalogue`,
    });

    res.status(201).json({ ...product, units: conditionnements });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du produit.' });
  } finally {
    client.release();
  }
});

// POST /products/:id/units — ajouter un conditionnement à un produit existant
router.post('/:id/units', requireRole('manager', 'gerant'), async (req, res) => {
  const { label, price, quantityPerUnit } = req.body;

  if (!label || !Number(price) || !Number.isInteger(Number(quantityPerUnit)) || Number(quantityPerUnit) < 1) {
    return res.status(400).json({ error: 'Conditionnement invalide.' });
  }

  try {
    const produit = await pool.query(`SELECT id FROM products WHERE id = $1 AND merchant_id = $2`, [req.params.id, req.user.merchantId]);
    if (produit.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable.' });

    const result = await pool.query(
      `INSERT INTO product_units (product_id, merchant_id, label, price, quantity_per_unit)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, req.user.merchantId, label, Number(price), Number(quantityPerUnit)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'ajout du conditionnement." });
  }
});

// DELETE /products/:id/units/:unitId
router.delete('/:id/units/:unitId', requireRole('manager', 'gerant'), async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM product_units WHERE id = $1 AND product_id = $2 AND merchant_id = $3 RETURNING id`,
      [req.params.unitId, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Conditionnement introuvable.' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression du conditionnement.' });
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
    } else if (name !== undefined || sku !== undefined || quantityAlertThreshold !== undefined) {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'product_updated',
        description: `a modifié la fiche du produit ${nomProduit}`,
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
// Une entrée peut être au comptant ou à crédit ; le crédit exige un
// fournisseur enregistré (pour pouvoir suivre la dette) et un montant total.
router.post('/:id/stock-movement', async (req, res) => {
  const { movementType, quantity, reason, supplierId, movementDate, paymentMethod, totalCost } = req.body;
  const validTypes = ['entree', 'sortie', 'ajustement'];

  if (!validTypes.includes(movementType) || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Mouvement de stock invalide.' });
  }

  let paiementFinal = null;
  let coutFinal = null;
  if (movementType === 'entree' && paymentMethod) {
    if (!['comptant', 'a_credit'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'Mode de paiement invalide.' });
    }
    if (paymentMethod === 'a_credit') {
      if (!supplierId) {
        return res.status(400).json({ error: 'Un fournisseur est requis pour une entrée à crédit.' });
      }
      if (!Number(totalCost) || Number(totalCost) <= 0) {
        return res.status(400).json({ error: "Le montant total de l'achat est requis pour une entrée à crédit." });
      }
    }
    paiementFinal = paymentMethod;
    coutFinal = totalCost ? Number(totalCost) : null;
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

    if (supplierId) {
      const fournisseur = await client.query(
        `SELECT id FROM suppliers WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
        [supplierId, req.user.merchantId]
      );
      if (fournisseur.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Fournisseur introuvable.' });
      }
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
      `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, supplier_id, movement_date, payment_method, total_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        req.user.merchantId,
        product.id,
        req.user.id,
        movementType,
        quantity,
        reason || null,
        supplierId || null,
        movementDate || null,
        paiementFinal,
        coutFinal,
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
