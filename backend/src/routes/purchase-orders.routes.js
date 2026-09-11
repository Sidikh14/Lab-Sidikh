const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { COULEURS, formatMontant, dessinerEntete, dessinerEnteteTableau, traitSeparateur } = require('../utils/pdfHelpers');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('manager', 'gerant'));

// GET /purchase-orders — liste des commandes fournisseurs récentes
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT po.id, po.status, po.total_amount, po.created_at, s.name AS supplier_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.merchant_id = $1
       ORDER BY po.created_at DESC
       LIMIT 100`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des commandes fournisseurs.' });
  }
});

async function getPurchaseOrderDetail(merchantId, id) {
  const poResult = await pool.query(
    `SELECT po.*, s.name AS supplier_name, s.phone AS supplier_phone,
            s.email AS supplier_email, s.address AS supplier_address,
            m.business_name, m.currency
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     JOIN merchants m ON m.id = po.merchant_id
     WHERE po.id = $1 AND po.merchant_id = $2`,
    [id, merchantId]
  );
  const po = poResult.rows[0];
  if (!po) return null;

  const itemsResult = await pool.query(
    `SELECT poi.id, poi.product_id, p.name AS product_name, poi.quantity, poi.unit_cost, poi.line_total
     FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id
     WHERE poi.purchase_order_id = $1`,
    [po.id]
  );
  return { ...po, items: itemsResult.rows };
}

// GET /purchase-orders/:id — détail avec ses lignes
router.get('/:id', async (req, res) => {
  try {
    const po = await getPurchaseOrderDetail(req.user.merchantId, req.params.id);
    if (!po) return res.status(404).json({ error: 'Commande fournisseur introuvable.' });
    res.json(po);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération de la commande.' });
  }
});

// POST /purchase-orders
// items attendu : [{ productId, quantity, unitCost }]
router.post('/', async (req, res) => {
  const { supplierId, items, notes } = req.body;

  if (!supplierId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Un fournisseur et au moins un article sont requis.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const supplierResult = await client.query(
      `SELECT id FROM suppliers WHERE id = $1 AND merchant_id = $2`,
      [supplierId, req.user.merchantId]
    );
    if (supplierResult.rows.length === 0) {
      throw { status: 404, message: 'Fournisseur introuvable.' };
    }

    let totalAmount = 0;
    const resolvedItems = [];
    for (const item of items) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw { status: 400, message: 'Article invalide.' };
      }
      const productResult = await client.query(
        `SELECT id, name, unit_price FROM products WHERE id = $1 AND merchant_id = $2`,
        [item.productId, req.user.merchantId]
      );
      const product = productResult.rows[0];
      if (!product) throw { status: 404, message: `Produit ${item.productId} introuvable.` };

      const unitCost = Number(item.unitCost) > 0 ? Number(item.unitCost) : Number(product.unit_price);
      totalAmount += unitCost * item.quantity;
      resolvedItems.push({ product, quantity: item.quantity, unitCost });
    }

    const poResult = await client.query(
      `INSERT INTO purchase_orders (merchant_id, supplier_id, created_by, status, total_amount, notes)
       VALUES ($1, $2, $3, 'envoyee', $4, $5) RETURNING *`,
      [req.user.merchantId, supplierId, req.user.id, totalAmount, notes || null]
    );
    const po = poResult.rows[0];

    for (const resolved of resolvedItems) {
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost)
         VALUES ($1, $2, $3, $4)`,
        [po.id, resolved.product.id, resolved.quantity, resolved.unitCost]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(po);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la commande fournisseur.' });
  } finally {
    client.release();
  }
});

// PATCH /purchase-orders/:id/status
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  const valides = ['envoyee', 'recue', 'annulee'];
  if (!valides.includes(status)) {
    return res.status(400).json({ error: 'Statut invalide.' });
  }
  try {
    const result = await pool.query(
      `UPDATE purchase_orders SET status = $1 WHERE id = $2 AND merchant_id = $3 RETURNING *`,
      [status, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Commande introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du statut.' });
  }
});

// GET /purchase-orders/:id/pdf — génère le bon de commande à adresser au fournisseur
router.get('/:id/pdf', async (req, res) => {
  try {
    const po = await getPurchaseOrderDetail(req.user.merchantId, req.params.id);
    if (!po) return res.status(404).json({ error: 'Commande fournisseur introuvable.' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="bon-de-commande-${po.id.slice(0, 8)}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    let y = dessinerEntete(doc, {
      businessName: po.business_name,
      titre: 'Bon de commande',
      sousTitre: `Réf. ${po.id.slice(0, 8).toUpperCase()} · ${new Date(po.created_at).toLocaleDateString('fr-FR')}`,
    });

    // Bloc fournisseur
    doc.fontSize(9).fillColor(COULEURS.muted).text('ADRESSÉ À', 50, y);
    y += 14;
    doc.fontSize(11).fillColor(COULEURS.encre).font('Helvetica-Bold').text(po.supplier_name, 50, y);
    doc.font('Helvetica');
    y += 16;
    doc.fontSize(9).fillColor(COULEURS.muted);
    if (po.supplier_phone) { doc.text(po.supplier_phone, 50, y); y += 12; }
    if (po.supplier_email) { doc.text(po.supplier_email, 50, y); y += 12; }
    if (po.supplier_address) { doc.text(po.supplier_address, 50, y); y += 12; }
    y += 14;

    y = dessinerEnteteTableau(doc, y, [
      { texte: 'Produit', x: 56, largeur: 210 },
      { texte: 'Qté', x: 280, largeur: 60, aligner: 'right' },
      { texte: 'Prix unitaire', x: 360, largeur: 85, aligner: 'right' },
      { texte: 'Total', x: 460, largeur: 85, aligner: 'right' },
    ]);

    po.items.forEach((item, index) => {
      if (index % 2 === 1) {
        doc.rect(50, y, doc.page.width - 100, 20).fill(COULEURS.fondAlterne);
        doc.fillColor(COULEURS.encre);
      }
      doc.fontSize(9.5);
      doc.text(item.product_name, 56, y + 5, { width: 210 });
      doc.text(String(item.quantity), 280, y + 5, { width: 60, align: 'right' });
      doc.text(`${formatMontant(item.unit_cost)} ${po.currency}`, 360, y + 5, { width: 85, align: 'right' });
      doc.text(`${formatMontant(item.line_total)} ${po.currency}`, 460, y + 5, { width: 85, align: 'right' });
      y += 20;
    });

    traitSeparateur(doc, y + 4);
    y += 16;
    doc.fontSize(9).fillColor(COULEURS.muted).text('MONTANT TOTAL', 300, y, { width: 145, align: 'right' });
    doc.fontSize(15).fillColor(COULEURS.accent).font('Helvetica-Bold')
      .text(`${formatMontant(po.total_amount)} ${po.currency}`, 460, y - 2, { width: 85, align: 'right' });
    doc.fillColor(COULEURS.encre).font('Helvetica');

    if (po.notes) {
      y += 40;
      doc.fontSize(9).fillColor(COULEURS.muted).text('NOTES', 50, y);
      doc.fontSize(10).fillColor(COULEURS.encre).text(po.notes, 50, y + 14, { width: doc.page.width - 100 });
    }

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});

module.exports = router;
