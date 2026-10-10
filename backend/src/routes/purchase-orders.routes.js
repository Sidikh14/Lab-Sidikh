const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const {
  COULEURS, formatMontant, dessinerEntete, dessinerEnteteTableau, dessinerBandeauTotal,
  enregistrerPolices, lireLogoCommercant, dessinerLogoCommercant,
} = require('../utils/pdfHelpers');
const { FORMATS, TAILLES, mmEnPt, nomFichierPdf, metadonneesPdf } = require('../utils/pdfTheme');

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
            m.business_name, m.currency, m.ninea, m.rccm, m.address AS merchant_address,
            to_jsonb(m) AS merchant_json
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
    // merchant_json (ligne complète du commerçant, logo compris) ne sert qu'au PDF : on ne l'envoie pas au navigateur.
    const { merchant_json: _ignore, ...visible } = po;
    res.json(visible);
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
// (charte Amaterasu v8 : A4, marges de 20 mm, tableau à en-tête Marine, total sur bandeau Marine).
router.get('/:id/pdf', async (req, res) => {
  try {
    const po = await getPurchaseOrderDetail(req.user.merchantId, req.params.id);
    if (!po) return res.status(404).json({ error: 'Commande fournisseur introuvable.' });

    const reference = po.id.slice(0, 8).toUpperCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nomFichierPdf('Bon-commande', reference)}"`);

    const M = FORMATS.marge;
    const doc = new PDFDocument({
      margin: M,
      size: 'A4',
      ...metadonneesPdf({ titre: `Bon de commande ${reference}`, commercant: po.business_name }),
    });
    doc.on('error', (err) => {
      console.error('Erreur pdfkit (bon de commande) :', err);
      if (!res.headersSent) res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
      else if (!res.writableEnded) res.end();
    });
    doc.pipe(res);
    enregistrerPolices(doc);

    const droite = doc.page.width - M;
    const largeurContenu = droite - M;
    const devise = po.currency || 'FCFA';
    const logoCommercant = lireLogoCommercant(po.merchant_json);
    const merchant = { ninea: po.ninea, rccm: po.rccm, address: po.merchant_address };

    const libelle = (texte, x, yy, w) => doc.font('Helvetica-Bold').fontSize(TAILLES.libelle).fillColor(COULEURS.muted)
      .text(texte, x, yy, { width: w, characterSpacing: 0.6, lineBreak: false });
    const entetePage = () => dessinerEntete(doc, {
      businessName: po.business_name,
      titre: 'Bon de commande',
      sousTitre: `Réf. ${reference}  ·  ${new Date(po.created_at).toLocaleDateString('fr-FR')}`,
      merchant,
      marge: M,
    });
    let y = entetePage() + 10;

    // Émetteur (gauche) et fournisseur (droite), sur deux colonnes.
    const largeurCol = (largeurContenu - 28) / 2;
    const xG = M;
    const xD = M + largeurCol + 28;
    libelle('ÉMETTEUR', xG, y, largeurCol);
    libelle('FOURNISSEUR', xD, y, largeurCol);
    let yG = y + 13;
    let yD = y + 13;

    if (logoCommercant && dessinerLogoCommercant(doc, logoCommercant, xG, yG, mmEnPt(30), mmEnPt(14))) {
      yG += mmEnPt(14) + 6;
    }
    doc.font('Helvetica-Bold').fontSize(TAILLES.texte + 1).fillColor(COULEURS.encre)
      .text(po.business_name || 'Commerce', xG, yG, { width: largeurCol });
    yG += 16;
    doc.font('Helvetica').fontSize(TAILLES.texte).fillColor(COULEURS.encre);
    [merchant.address, merchant.ninea && `NINEA ${merchant.ninea}`, merchant.rccm && `RCCM ${merchant.rccm}`]
      .filter(Boolean)
      .forEach((ligne) => { doc.text(ligne, xG, yG, { width: largeurCol }); yG += 14; });

    doc.font('Helvetica-Bold').fontSize(TAILLES.texte + 1).fillColor(COULEURS.encre)
      .text(po.supplier_name, xD, yD, { width: largeurCol });
    yD += 16;
    doc.font('Helvetica').fontSize(TAILLES.texte).fillColor(COULEURS.encre);
    [po.supplier_phone, po.supplier_email, po.supplier_address].filter(Boolean).forEach((ligne) => {
      doc.text(ligne, xD, yD, { width: largeurCol });
      yD += doc.heightOfString(ligne, { width: largeurCol }) + 3;
    });

    y = Math.max(yG, yD) + 22;

    // Tableau : en-tête Marine, lignes alternées Brume, montants alignés à droite.
    const COLONNES = [
      { texte: 'Produit', x: M + 8, largeur: 235 },
      { texte: 'Quantité', x: M + 252, largeur: 60, aligner: 'right' },
      { texte: 'Prix unitaire', x: M + 322, largeur: 70, aligner: 'right' },
      { texte: 'Total', x: M + 402, largeur: largeurContenu - 402 - 8, aligner: 'right' },
    ];
    y = dessinerEnteteTableau(doc, y, COLONNES, M);

    po.items.forEach((item, index) => {
      if (y + 24 > doc.page.height - 90) {
        doc.addPage();
        y = entetePage() + 18;
        y = dessinerEnteteTableau(doc, y, COLONNES, M);
      }
      if (index % 2 === 1) doc.rect(M, y - 6, largeurContenu, 24).fill(COULEURS.fondAlterne);
      doc.font('Helvetica').fontSize(TAILLES.tableau).fillColor(COULEURS.encre);
      doc.text(item.product_name, COLONNES[0].x, y, { width: COLONNES[0].largeur, lineBreak: false, ellipsis: true });
      doc.text(String(item.quantity), COLONNES[1].x, y, { width: COLONNES[1].largeur, align: 'right', lineBreak: false });
      doc.text(formatMontant(item.unit_cost), COLONNES[2].x, y, { width: COLONNES[2].largeur, align: 'right', lineBreak: false });
      doc.font('Helvetica-Bold').text(formatMontant(item.line_total), COLONNES[3].x, y, { width: COLONNES[3].largeur, align: 'right', lineBreak: false });
      y += 24;
    });

    doc.moveTo(M, y - 2).lineTo(droite, y - 2).strokeColor(COULEURS.bordure).lineWidth(0.8).stroke();
    y += 16;

    // Total : bandeau Marine, montant en Soleil.
    if (y + 60 > doc.page.height - 70) {
      doc.addPage();
      y = entetePage() + 18;
    }
    y = dessinerBandeauTotal(doc, {
      x: droite - 260, y, largeur: 260, label: 'Total', texteMontant: `${formatMontant(po.total_amount)} ${devise}`, hauteur: 32,
    }) + 20;

    if (po.notes) {
      const hauteurNotes = doc.heightOfString(po.notes, { width: largeurContenu });
      if (y + hauteurNotes + 20 > doc.page.height - 70) {
        doc.addPage();
        y = entetePage() + 18;
      }
      libelle('NOTES', M, y, largeurContenu);
      doc.font('Helvetica').fontSize(TAILLES.texte).fillColor(COULEURS.encre)
        .text(po.notes, M, y + 13, { width: largeurContenu });
    }

    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});

module.exports = router;
