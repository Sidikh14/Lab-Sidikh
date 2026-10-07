const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { COULEURS, formatMontant, dessinerEntete, dessinerEnteteTableau, traitSeparateur } = require('../utils/pdfHelpers');
const { creerAlerte, getNomUtilisateur } = require('../services/alerts.service');
const { getSoldeActuel, LABEL_METHODE } = require('../utils/cashBalance');
const { addLot } = require('../utils/lots');

const router = express.Router();
router.use(authenticate);

// Reliquat (commande client en attente sur rupture de stock) : mêmes
// secteurs que côté orders_routes.js — à garder synchronisé.
const SECTEURS_RELIQUAT = ['grossiste', 'textile', 'electromenager'];

// Même logique que formatOrderNumber() dans orders_routes.js — dupliquée
// ici car non exportée par ce module (uniquement utilisée pour l'affichage
// du numéro de commande sur la liste des reliquats).
function formatOrderNumberSimple(order) {
  const annee = new Date(order.created_at).getFullYear();
  const numero = String(order.order_seq).padStart(4, '0');
  return `CMD-${annee}-${numero}`;
}

// Détermine la boutique à utiliser pour une opération de stock/vente.
// - manager (aucune boutique assignée) : doit choisir explicitement via
//   warehouseId (query ou body) à chaque fois.
// - gérant/caissier/vendeur : toujours SA boutique assignée
//   (req.user.warehouseId), tout warehouseId fourni par le client est
//   ignoré — on ne fait jamais confiance à ce que l'appelant envoie pour
//   ces rôles.
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

// GET /products/pdf — catalogue produits en PDF (avant les routes /:id pour éviter tout conflit de route)
router.get('/pdf', async (req, res) => {
  let doc;
  try {
    let warehouseId;
    try {
      warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message || 'Erreur.' });
    }

    const merchantResult = await pool.query(`SELECT business_name FROM merchants WHERE id = $1`, [req.user.merchantId]);
    const businessName = merchantResult.rows[0]?.business_name || 'Commerce';
    const warehouseResult = await pool.query(`SELECT name FROM warehouses WHERE id = $1`, [warehouseId]);
    const warehouseName = warehouseResult.rows[0]?.name || '';

    const result = await pool.query(
      `SELECT
         p.name, p.sku, ps.quantity_in_stock, p.is_weighted,
         p.unit_price, p.quantity_alert_threshold,
         CASE
           WHEN ps.quantity_in_stock = 0 THEN 'Rupture'
           WHEN ps.quantity_in_stock <= p.quantity_alert_threshold THEN 'Faible'
           ELSE 'En stock'
         END AS status
       FROM product_stock ps
       JOIN products p ON p.id = ps.product_id
       WHERE ps.warehouse_id = $1 AND p.merchant_id = $2 AND p.is_active = TRUE
       ORDER BY p.name`,
      [warehouseId, req.user.merchantId]
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="catalogue-produits-${new Date().toISOString().slice(0, 10)}.pdf"`);

    doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.on('error', (e) => console.error('pdfkit (catalogue) :', e));
    doc.pipe(res);

    let y = dessinerEntete(doc, {
      businessName,
      titre: 'Catalogue produits',
      sousTitre: `${warehouseName} · ${result.rows.length} référence(s) · généré le ${new Date().toLocaleDateString('fr-FR')}`,
    });
    y += 10;

    function entete() {
      y = dessinerEnteteTableau(doc, y, [
        { texte: 'Produit', x: 58, largeur: 226 },
        { texte: 'Référence', x: 290, largeur: 62 },
        { texte: 'Prix', x: 356, largeur: 84, aligner: 'right' },
        { texte: 'Stock', x: 444, largeur: 44, aligner: 'right' },
        { texte: 'Statut', x: 496, largeur: 52 },
      ]);
    }
    entete();

    result.rows.forEach((p, index) => {
      // Le nom du produit peut passer sur 2 lignes : la hauteur de ligne
      // s'adapte pour ne jamais couper un nom.
      doc.font('Helvetica').fontSize(9.5);
      const hauteurLigne = Math.max(22, doc.heightOfString(p.name, { width: 226 }) + 10);
      if (y + hauteurLigne > 770) {
        doc.addPage();
        y = 50;
        entete();
      }
      if (index % 2 === 1) {
        doc.rect(50, y, doc.page.width - 100, hauteurLigne).fill(COULEURS.fondAlterne);
      }
      doc.fillColor(COULEURS.encre).text(p.name, 58, y + 5, { width: 226 });
      doc.fillColor(COULEURS.muted).text(p.sku || '—', 290, y + 5, { width: 62, height: 16, ellipsis: true });
      doc.fillColor(COULEURS.encre).text(`${formatMontant(p.unit_price)} FCFA`, 356, y + 5, { width: 84, align: 'right' });
      doc.text(p.is_weighted ? `${Number(p.quantity_in_stock).toFixed(1)} kg` : String(Math.round(p.quantity_in_stock)), 444, y + 5, { width: 44, align: 'right' });
      doc.font(p.status === 'Rupture' ? 'Helvetica-Bold' : 'Helvetica')
        .text(p.status, 496, y + 5, { width: 52 });
      doc.font('Helvetica');
      y += hauteurLigne;
    });

    doc.end();
  } catch (err) {
    console.error('Erreur PDF catalogue produits :', err);
    // Si le flux PDF a déjà commencé, on ne peut plus répondre en JSON :
    // on coupe proprement, sinon pdfkit écrit dans une réponse fermée
    // (ERR_STREAM_WRITE_AFTER_END) et fait planter tout le serveur.
    if (doc) doc.destroy();
    if (res.headersSent) return res.end();
    res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});

// ---------------------------------------------------------------------------
// Inventaire général par article : entrées/sorties/marge sur une période
// (manager/gérant uniquement — expose le prix d'achat et la marge).
// ---------------------------------------------------------------------------

async function calculerInventaireGeneral(req, { from, to, warehouseId }) {
  const merchantId = req.user.merchantId;
  const params = [merchantId, from, to];
  let filtreWarehouseMouvements = '';
  let filtreWarehouseVentes = '';
  let filtreWarehouseStock = '';

  if (req.user.role !== 'manager') {
    if (!req.user.warehouseId) throw { status: 403, message: "Vous n'êtes assigné à aucune boutique." };
    params.push(req.user.warehouseId);
    filtreWarehouseMouvements = ` AND sm.warehouse_id = $${params.length}`;
    filtreWarehouseVentes = ` AND o.warehouse_id = $${params.length}`;
    filtreWarehouseStock = ` AND ps.warehouse_id = $${params.length}`;
  } else if (warehouseId) {
    params.push(warehouseId);
    filtreWarehouseMouvements = ` AND sm.warehouse_id = $${params.length}`;
    filtreWarehouseVentes = ` AND o.warehouse_id = $${params.length}`;
    filtreWarehouseStock = ` AND ps.warehouse_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `WITH mouvements AS (
       SELECT sm.product_id,
              SUM(CASE WHEN sm.movement_type = 'entree' THEN sm.quantity ELSE 0 END) AS entrees,
              SUM(CASE WHEN sm.movement_type = 'sortie' THEN sm.quantity ELSE 0 END) AS sorties,
              SUM(CASE WHEN sm.movement_type = 'ajustement' THEN sm.quantity ELSE 0 END) AS ajustements
       FROM stock_movements sm
       WHERE sm.merchant_id = $1 AND COALESCE(sm.movement_date, sm.created_at)::date BETWEEN $2 AND $3${filtreWarehouseMouvements}
       GROUP BY sm.product_id
     ),
     ventes AS (
       SELECT oi.product_id,
              SUM(oi.quantity) AS quantite_vendue,
              SUM(oi.line_total) AS chiffre_affaires
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.merchant_id = $1 AND o.status <> 'annulee' AND o.created_at::date BETWEEN $2 AND $3${filtreWarehouseVentes}
       GROUP BY oi.product_id
     ),
     stock AS (
       SELECT ps.product_id, SUM(ps.quantity_in_stock) AS stock_actuel
       FROM product_stock ps
       WHERE ps.merchant_id = $1${filtreWarehouseStock}
       GROUP BY ps.product_id
     )
     SELECT p.id, p.name, p.sku, cat.name AS category_name,
            p.cost_price, p.unit_price,
            COALESCE(s.stock_actuel, 0) AS stock_actuel,
            COALESCE(m.entrees, 0) AS entrees,
            COALESCE(m.sorties, 0) AS sorties,
            COALESCE(m.ajustements, 0) AS ajustements,
            COALESCE(v.quantite_vendue, 0) AS quantite_vendue,
            COALESCE(v.chiffre_affaires, 0) AS chiffre_affaires,
            (COALESCE(v.chiffre_affaires, 0) - COALESCE(v.quantite_vendue, 0) * COALESCE(p.cost_price, 0)) AS marge
     FROM products p
     LEFT JOIN categories cat ON cat.id = p.category_id
     LEFT JOIN mouvements m ON m.product_id = p.id
     LEFT JOIN ventes v ON v.product_id = p.id
     LEFT JOIN stock s ON s.product_id = p.id
     WHERE p.merchant_id = $1
     ORDER BY p.name`,
    params
  );

  return rows;
}

// GET /products/inventory-report?from&to&warehouseId — entrées/sorties/marge
// par article sur une période. La marge est calculée sur le prix d'achat
// ACTUEL du produit (cost_price), pas sur un coût moyen pondéré historique
// des entrées — plus simple, cohérent avec le reste de l'appli qui ne suit
// pas de coût par lot d'entrée.
router.get('/inventory-report', requireRole('manager', 'gerant'), async (req, res) => {
  const { from, to, warehouseId } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'La période (from/to) est requise.' });
  }
  try {
    const rows = await calculerInventaireGeneral(req, { from, to, warehouseId });
    res.json(rows);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /products/inventory-report/pdf?from&to&warehouseId
router.get('/inventory-report/pdf', requireRole('manager', 'gerant'), async (req, res) => {
  const { from, to, warehouseId } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'La période (from/to) est requise.' });
  }
  let doc;
  try {
    const rows = await calculerInventaireGeneral(req, { from, to, warehouseId });
    const merchantResult = await pool.query('SELECT business_name FROM merchants WHERE id = $1', [req.user.merchantId]);
    const businessName = merchantResult.rows[0]?.business_name || 'Commerce';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="inventaire-general-${from}-au-${to}.pdf"`);

    doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });
    doc.on('error', (e) => console.error('pdfkit (inventaire) :', e));
    doc.pipe(res);

    const COLONNES = [
      { texte: 'Article', x: 58, largeur: 246 },
      { texte: 'Stock actuel', x: 308, largeur: 68, aligner: 'right' },
      { texte: 'Entrées', x: 380, largeur: 62, aligner: 'right' },
      { texte: 'Sorties', x: 446, largeur: 62, aligner: 'right' },
      { texte: 'Qté vendue', x: 512, largeur: 68, aligner: 'right' },
      { texte: 'Chiffre d\u2019affaires', x: 584, largeur: 102, aligner: 'right' },
      { texte: 'Marge', x: 690, largeur: 96, aligner: 'right' },
    ];

    function dessinerEnTete() {
      let y0 = dessinerEntete(doc, {
        businessName,
        titre: 'Inventaire général',
        sousTitre: `Du ${new Date(from).toLocaleDateString('fr-FR')} au ${new Date(to).toLocaleDateString('fr-FR')} · ${rows.length} article(s)`,
      });
      return dessinerEnteteTableau(doc, y0, COLONNES);
    }

    let y = dessinerEnTete();

    if (rows.length === 0) {
      doc.fontSize(10).fillColor(COULEURS.muted).text('Aucun article.', 56, y + 10);
    }

    let totalCA = 0;
    let totalMarge = 0;
    rows.forEach((r, index) => {
      doc.font('Helvetica').fontSize(9);
      const hauteurLigne = Math.max(22, doc.heightOfString(r.name, { width: 246 }) + 10);
      if (y + hauteurLigne > doc.page.height - 90) {
        doc.addPage();
        y = dessinerEnTete();
      }
      if (index % 2 === 1) {
        doc.rect(50, y, doc.page.width - 100, hauteurLigne).fill(COULEURS.fondAlterne);
      }
      doc.fillColor(COULEURS.encre);
      doc.text(r.name, 58, y + 5, { width: 246 });
      doc.text(String(Math.round(r.stock_actuel)), 308, y + 5, { width: 68, align: 'right' });
      doc.text(String(Math.round(r.entrees)), 380, y + 5, { width: 62, align: 'right' });
      doc.text(String(Math.round(r.sorties)), 446, y + 5, { width: 62, align: 'right' });
      doc.text(String(Math.round(r.quantite_vendue)), 512, y + 5, { width: 68, align: 'right' });
      doc.text(formatMontant(r.chiffre_affaires), 584, y + 5, { width: 102, align: 'right' });
      doc.text(formatMontant(r.marge), 690, y + 5, { width: 96, align: 'right' });
      totalCA += Number(r.chiffre_affaires);
      totalMarge += Number(r.marge);
      y += hauteurLigne;
    });

    if (y > doc.page.height - 90) {
      doc.addPage();
      y = dessinerEnTete();
    }
    traitSeparateur(doc, y + 4);
    y += 14;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COULEURS.encre);
    doc.text('TOTAL', 512, y, { width: 68, align: 'right' });
    doc.text(formatMontant(totalCA), 584, y, { width: 102, align: 'right' });
    doc.text(formatMontant(totalMarge), 690, y, { width: 96, align: 'right' });

    doc.end();
  } catch (err) {
    console.error('Erreur PDF inventaire général :', err);
    if (doc) doc.destroy();
    if (res.headersSent) return res.end();
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});

// GET /products
router.get('/', async (req, res) => {
  let warehouseId;
  try {
    warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Erreur.' });
  }

  try {
    const result = await pool.query(
      `SELECT
         p.id, p.name, p.sku, p.unit_price,
         COALESCE(ps.quantity_in_stock, 0) AS quantity_in_stock,
         p.quantity_alert_threshold, p.is_weighted, p.tva_applicable, c.name AS category, p.category_id,
         p.is_vital, p.requires_prescription, p.requires_cold_chain,
         CASE WHEN $3::boolean THEN p.cost_price END AS cost_price,
         CASE
           WHEN COALESCE(ps.quantity_in_stock, 0) = 0 THEN 'rupture'
           WHEN ps.quantity_in_stock <= p.quantity_alert_threshold THEN 'faible'
           ELSE 'en_stock'
         END AS status
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.warehouse_id = $2
       WHERE p.merchant_id = $1 AND p.is_active = TRUE
       ORDER BY p.name`,
      [req.user.merchantId, warehouseId, ['manager', 'gerant'].includes(req.user.role)]
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
  const { name, sku, categoryId, unitPrice, costPrice, quantityInStock, quantityAlertThreshold, units, isWeighted, tvaApplicable, isVital, requiresPrescription, requiresColdChain, attributes, warehouseId: warehouseIdInput, lotNumber, expiryDate } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Le nom du produit est requis.' });
  }

  const client = await pool.connect();
  try {
    const warehouseId = await resolveWarehouseId(req, client, warehouseIdInput);

    await client.query('BEGIN');

    // L'anti-rupture-immédiate (statut "À activer" tant qu'aucune entrée de
    // stock n'a été faite) a été retirée pour tous les secteurs — un produit
    // est désormais toujours considéré comme activé dès sa création.
    const isActivated = true;

    const result = await client.query(
      `INSERT INTO products (merchant_id, category_id, name, sku, unit_price, cost_price, quantity_alert_threshold, is_weighted, tva_applicable, attributes, is_activated, is_vital, requires_prescription, requires_cold_chain)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        req.user.merchantId,
        categoryId || null,
        name,
        sku || null,
        unitPrice || 0,
        costPrice || 0,
        quantityAlertThreshold || 5,
        Boolean(isWeighted),
        tvaApplicable === undefined ? true : Boolean(tvaApplicable),
        JSON.stringify(attributes && typeof attributes === 'object' ? attributes : {}),
        isActivated,
        Boolean(isVital),
        Boolean(requiresPrescription),
        Boolean(requiresColdChain),
      ]
    );
    const product = result.rows[0];

    // Le stock initial n'est créé que pour la boutique où le produit est
    // ajouté ; les autres boutiques démarrent à 0 (COALESCE côté lecture).
    await client.query(
      `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
       VALUES ($1, $2, $3, $4)`,
      [req.user.merchantId, product.id, warehouseId, quantityInStock || 0]
    );

    // Pharmacie : si un stock initial et une date de péremption sont
    // fournis dès la création, on crée directement le premier lot.
    if (req.user.sector === 'pharmacie' && Number(quantityInStock) > 0) {
      await addLot(client, {
        merchantId: req.user.merchantId,
        productId: product.id,
        warehouseId,
        lotNumber,
        expiryDate,
        quantity: quantityInStock,
      });
    }

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
    if (err.status) return res.status(err.status).json({ error: err.message });
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
  const { name, sku, categoryId, unitPrice, costPrice, quantityAlertThreshold, isWeighted, tvaApplicable, isVital, requiresPrescription, requiresColdChain, attributes } = req.body;

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
         cost_price = COALESCE($5, cost_price),
         quantity_alert_threshold = COALESCE($6, quantity_alert_threshold),
         is_weighted = COALESCE($7, is_weighted),
         tva_applicable = COALESCE($8, tva_applicable),
         attributes = COALESCE($9, attributes),
         is_vital = COALESCE($10, is_vital),
         requires_prescription = COALESCE($11, requires_prescription),
         requires_cold_chain = COALESCE($12, requires_cold_chain)
       WHERE id = $13 AND merchant_id = $14
       RETURNING *`,
      [
        name, sku, categoryId, unitPrice, costPrice, quantityAlertThreshold, isWeighted,
        tvaApplicable === undefined ? null : Boolean(tvaApplicable),
        attributes && typeof attributes === 'object' ? JSON.stringify(attributes) : null,
        isVital === undefined ? null : Boolean(isVital),
        requiresPrescription === undefined ? null : Boolean(requiresPrescription),
        requiresColdChain === undefined ? null : Boolean(requiresColdChain),
        req.params.id, req.user.merchantId,
      ]
    );

    if (unitPrice !== undefined && Number(unitPrice) !== ancienPrix) {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'product_price_updated',
        description: `a changé le prix de ${nomProduit} : ${Math.round(ancienPrix).toLocaleString('fr-FR')} → ${Math.round(Number(unitPrice)).toLocaleString('fr-FR')} FCFA`,
      });
      // Fire-and-forget : une alerte qui échoue (ex : valeur d'enum pas
      // encore migrée) ne doit jamais faire échouer la mise à jour du prix,
      // déjà enregistrée en base à ce stade.
      getNomUtilisateur(req.user.id).then((nomAuteur) => {
        creerAlerte({
          merchantId: req.user.merchantId,
          type: 'prix_modifie',
          titre: 'Prix produit modifié',
          message: `${nomAuteur || 'Un membre de l\'équipe'} a changé le prix de ${nomProduit} : ${Math.round(ancienPrix).toLocaleString('fr-FR')} → ${Math.round(Number(unitPrice)).toLocaleString('fr-FR')} FCFA.`,
          referenceId: req.params.id,
        }).catch((err) => console.error('Erreur alerte prix_modifie :', err));
      }).catch((err) => console.error('Erreur getNomUtilisateur (prix_modifie) :', err));
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
// Importation (entrée de stock dédouanée) : numéro de déclaration en douane, valeur en douane et droits.
// La TVA à l'importation est le montant de TVA de l'achat (tvaAmount) : elle est déductible et alimente
// l'annexe « Importations » de la déclaration de TVA.
function lireImportation(body, { total, tva }) {
  if (body.purchaseKind !== 'import') return { kind: 'local', declaration: null, value: null, duties: null };
  const declaration = String(body.customsDeclaration || '').trim().slice(0, 60);
  if (!declaration) throw { status: 400, message: "Le numéro de déclaration en douane est requis pour une importation." };
  const duties = body.customsDuties === undefined || body.customsDuties === null || body.customsDuties === '' ? 0 : Number(body.customsDuties);
  if (!Number.isFinite(duties) || duties < 0) throw { status: 400, message: 'Le montant des droits de douane est invalide.' };
  let value = body.customsValue === undefined || body.customsValue === null || body.customsValue === '' ? null : Number(body.customsValue);
  if (value !== null && (!Number.isFinite(value) || value < 0)) throw { status: 400, message: 'La valeur en douane est invalide.' };
  if (value === null) value = Math.max(0, Math.round((Number(total) || 0) - (Number(tva) || 0) - duties));
  return { kind: 'import', declaration, value, duties };
}

// Une entrée peut être au comptant ou à crédit ; le crédit exige un
// fournisseur enregistré (pour pouvoir suivre la dette) et un montant total.
router.post('/:id/stock-movement', async (req, res) => {
  const {
    movementType, quantity, reason, supplierId, movementDate,
    paymentMethod, totalCost, cashMethod, tvaAmount,
    advanceAmount, advanceCashMethod,
    warehouseId: warehouseIdInput,
    lotNumber, expiryDate,
  } = req.body;
  const validTypes = ['entree', 'sortie', 'ajustement'];
  const MOYENS_PAIEMENT = ['especes', 'wave', 'orange_money', 'cheque', 'virement'];

  if (!validTypes.includes(movementType) || typeof quantity !== 'number' || quantity <= 0) {
    return res.status(400).json({ error: 'Mouvement de stock invalide.' });
  }

  let paiementFinal = null;
  let coutFinal = null;
  let cashMethodFinal = null;
  let avanceFinale = null;
  let avanceCashMethodFinal = null;
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
      // Avance facultative : un versement immédiat au fournisseur, prélevé
      // sur une caisse, qui réduit la dette dès la création de l'entrée
      // (via une ligne supplier_payments insérée dans la même transaction).
      if (advanceAmount !== undefined && advanceAmount !== null && advanceAmount !== '') {
        if (!Number(advanceAmount) || Number(advanceAmount) <= 0) {
          return res.status(400).json({ error: "Le montant de l'avance est invalide." });
        }
        if (Number(advanceAmount) > Number(totalCost)) {
          return res.status(400).json({ error: "L'avance ne peut pas dépasser le montant total de l'achat." });
        }
        if (!MOYENS_PAIEMENT.includes(advanceCashMethod)) {
          return res.status(400).json({ error: "Le moyen de paiement de l'avance (espèces, Wave...) est requis." });
        }
        avanceFinale = Number(advanceAmount);
        avanceCashMethodFinal = advanceCashMethod;
      }
    }
    if (paymentMethod === 'comptant') {
      if (!Number(totalCost) || Number(totalCost) <= 0) {
        return res.status(400).json({ error: "Le montant total de l'achat est requis pour une entrée au comptant." });
      }
      if (!MOYENS_PAIEMENT.includes(cashMethod)) {
        return res.status(400).json({ error: 'Le moyen de paiement de la caisse (espèces, Wave...) est requis pour une entrée au comptant.' });
      }
      cashMethodFinal = cashMethod;
    }
    paiementFinal = paymentMethod;
    coutFinal = totalCost ? Number(totalCost) : null;
  }

  // TVA déductible de l'achat : comprise dans le montant total payé (TTC).
  let tvaFinale = 0;
  if (tvaAmount !== undefined && tvaAmount !== null && tvaAmount !== '') {
    tvaFinale = Number(tvaAmount);
    if (movementType !== 'entree' || !coutFinal) {
      return res.status(400).json({ error: "La TVA ne se renseigne que sur une entrée de stock avec montant d'achat." });
    }
    if (!Number.isFinite(tvaFinale) || tvaFinale < 0 || tvaFinale > coutFinal) {
      return res.status(400).json({ error: "Le montant de TVA est invalide (il ne peut dépasser le montant de l'achat)." });
    }
  }

  let importation;
  try {
    if (req.body.purchaseKind === 'import' && (movementType !== 'entree' || !coutFinal)) {
      throw { status: 400, message: "Une importation se saisit sur une entrée de stock avec montant d'achat." };
    }
    importation = lireImportation(req.body, { total: coutFinal, tva: tvaFinale });
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const client = await pool.connect();
  try {
    const warehouseId = await resolveWarehouseId(req, client, warehouseIdInput);

    // Un achat au comptant ne doit jamais rendre une caisse négative : on
    // vérifie le solde théorique actuel de la caisse choisie (même calcul
    // que /cash/balances) AVANT d'ouvrir la transaction de stock.
    if (cashMethodFinal) {
      const soldeActuel = await getSoldeActuel(req, warehouseId, cashMethodFinal);
      if (soldeActuel < coutFinal) {
        return res.status(400).json({
          error: `Solde insuffisant sur ${LABEL_METHODE[cashMethodFinal]} (solde actuel : ${Math.round(soldeActuel).toLocaleString('fr-FR')} FCFA, achat : ${Math.round(coutFinal).toLocaleString('fr-FR')} FCFA).`,
        });
      }
    }
    // Même contrôle pour l'avance sur un achat à crédit : c'est elle, et
    // elle seule, qui sort réellement de la caisse à cet instant.
    if (avanceCashMethodFinal) {
      const soldeAvance = await getSoldeActuel(req, warehouseId, avanceCashMethodFinal);
      if (soldeAvance < avanceFinale) {
        return res.status(400).json({
          error: `Solde insuffisant sur ${LABEL_METHODE[avanceCashMethodFinal]} pour l'avance (solde actuel : ${Math.round(soldeAvance).toLocaleString('fr-FR')} FCFA, avance : ${Math.round(avanceFinale).toLocaleString('fr-FR')} FCFA).`,
        });
      }
    }

    await client.query('BEGIN');

    const productResult = await client.query(
      `SELECT p.id, p.name, p.is_weighted, p.tva_applicable, p.quantity_alert_threshold, COALESCE(ps.quantity_in_stock, 0) AS quantity_in_stock
       FROM products p
       LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.warehouse_id = $3
       WHERE p.id = $1 AND p.merchant_id = $2 FOR UPDATE OF p`,
      [req.params.id, req.user.merchantId, warehouseId]
    );
    const product = productResult.rows[0];

    if (!product) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produit introuvable.' });
    }
    if (tvaFinale > 0 && product.tva_applicable === false) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `${product.name} n'est pas soumis à la TVA : aucune TVA déductible à renseigner.` });
    }

    if (!product.is_weighted && !Number.isInteger(quantity)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `${product.name} n'est pas vendu au poids : la quantité doit être un nombre entier.` });
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
    const newQuantity = Number(product.quantity_in_stock) + delta;

    if (newQuantity < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Quantité insuffisante en stock.' });
    }

    await client.query(
      `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, warehouse_id)
       DO UPDATE SET quantity_in_stock = $4`,
      [req.user.merchantId, product.id, warehouseId, newQuantity]
    );

    // Pharmacie : une entrée de stock "active" le produit (ne sera plus
    // affiché en rupture par défaut) et, si une péremption est fournie,
    // crée le lot correspondant pour le suivi FEFO.
    if (movementType === 'entree' && req.user.sector === 'pharmacie') {
      await client.query(`UPDATE products SET is_activated = TRUE WHERE id = $1`, [product.id]);
      await addLot(client, {
        merchantId: req.user.merchantId,
        productId: product.id,
        warehouseId,
        lotNumber,
        expiryDate,
        quantity,
      });
    }

    await client.query(
      `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, supplier_id, movement_date, payment_method, total_cost, cash_method, warehouse_id, tva_amount,
                                    purchase_kind, customs_declaration, customs_value, customs_duties)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
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
        cashMethodFinal,
        warehouseId,
        tvaFinale,
        importation.kind,
        importation.declaration,
        importation.value,
        importation.duties,
      ]
    );

    if (avanceFinale) {
      await client.query(
        `INSERT INTO supplier_payments (merchant_id, supplier_id, user_id, amount, payment_method, notes, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user.merchantId,
          supplierId,
          req.user.id,
          avanceFinale,
          avanceCashMethodFinal,
          "Avance versée à la création de l'entrée de stock",
          warehouseId,
        ]
      );
    }

    await client.query('COMMIT');

    // Alerte rupture / seuil bas : seulement au franchissement du seuil (pas
    // à chaque sortie si le produit y était déjà, pour éviter de spammer) —
    // sauf la rupture complète (newQuantity === 0), toujours notifiée même
    // si le seuil avait déjà été franchi avant, car plus grave que "bas".
    // Fire-and-forget après le COMMIT : une alerte qui échoue ne doit jamais
    // faire échouer le mouvement de stock, déjà enregistré en base.
    const seuil = product.quantity_alert_threshold;
    const etaitDejaBas = product.quantity_in_stock <= seuil;
    const franchitSeuil = !etaitDejaBas && newQuantity <= seuil;
    const entreEnRupture = newQuantity === 0 && product.quantity_in_stock > 0;
    if (franchitSeuil || entreEnRupture) {
      creerAlerte({
        merchantId: req.user.merchantId,
        type: newQuantity === 0 ? 'rupture_stock' : 'seuil_stock',
        titre: newQuantity === 0 ? 'Rupture de stock' : "Stock sous le seuil d'alerte",
        message: newQuantity === 0
          ? `${product.name} est en rupture de stock.`
          : `${product.name} est passé sous le seuil d'alerte (${newQuantity} restant(s)).`,
        referenceId: product.id,
      }).catch((err) => console.error('Erreur alerte stock :', err));
    }

    res.json({
      productId: product.id,
      warehouseId,
      quantityInStock: newQuantity,
      advancePaid: avanceFinale || 0,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du mouvement de stock." });
  } finally {
    client.release();
  }
});

// ---------- Calcul automatique d'un achat ----------
// Le montant d'un achat n'est jamais saisi : il vient du prix d'achat des produits
// (HT, quantité × prix). Une réduction commerciale éventuelle (en % ou en FCFA) est
// déduite du total HT, puis la TVA est calculée sur le HT net pour les seuls produits
// soumis à la TVA. Total à payer = HT net + TVA.
const TAUX_TVA = 18;
const arrondi2 = (n) => Math.round(n * 100) / 100;

function erreurAchat(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function calculerAchat(db, merchantId, items, discountType, discountValue, tolerant = false) {
  const result = await db.query(
    `SELECT id, name, cost_price, tva_applicable FROM products WHERE merchant_id = $1 AND id = ANY($2::uuid[])`,
    [merchantId, items.map((i) => i.productId)]
  );
  const parId = new Map(result.rows.map((r) => [String(r.id), r]));
  const lignes = [];
  const manquants = [];
  let sousTotal = 0;
  for (const item of items) {
    const p = parId.get(String(item.productId));
    if (!p) throw erreurAchat(404, `Produit introuvable (${item.productId}).`);
    const surcharge = Number(item.unitCost);
    const unitaire = surcharge > 0 ? surcharge : Number(p.cost_price);
    if (!(unitaire > 0)) {
      if (!tolerant) throw erreurAchat(400, `${p.name} n'a pas de prix d'achat : renseignez-le dans la fiche produit.`);
      manquants.push(p.id);
    }
    const ht = unitaire > 0 ? arrondi2(item.quantity * unitaire) : 0;
    sousTotal += ht;
    lignes.push({ productId: p.id, name: p.name, unitaire, ht, soumis: p.tva_applicable !== false });
  }
  sousTotal = arrondi2(sousTotal);

  let remise = 0;
  if (discountType) {
    const v = Number(discountValue);
    if (!['percent', 'amount'].includes(discountType) || !Number.isFinite(v) || v <= 0) {
      throw erreurAchat(400, 'Réduction commerciale invalide.');
    }
    if (discountType === 'percent') {
      if (v >= 100) throw erreurAchat(400, 'La réduction ne peut pas atteindre 100 %.');
      remise = arrondi2((sousTotal * v) / 100);
    } else {
      if (sousTotal > 0 && v >= sousTotal) throw erreurAchat(400, 'La réduction ne peut pas atteindre le montant de l\'achat.');
      remise = arrondi2(v);
    }
  }
  const ratio = sousTotal > 0 ? remise / sousTotal : 0;
  let htNet = 0;
  let tva = 0;
  for (const l of lignes) {
    l.htNet = arrondi2(l.ht * (1 - ratio));
    l.tva = l.soumis ? arrondi2((l.htNet * TAUX_TVA) / 100) : 0;
    htNet += l.htNet;
    tva += l.tva;
  }
  htNet = arrondi2(htNet);
  tva = arrondi2(tva);
  return { lignes, manquants, sousTotal, remise, htNet, tva, total: arrondi2(htNet + tva) };
}

// Achat importé : le fournisseur étranger ne facture pas de TVA sénégalaise. Le total payé est la valeur
// des marchandises (HT après réduction) + les droits de douane + la TVA acquittée en douane. La TVA à
// l'importation est celle saisie, sinon 18 % de (valeur + droits). Les droits entrent dans le coût du stock.
function ajusterAchatImportation(body, achat) {
  if (body.purchaseKind !== 'import') return { total: achat.total, tva: achat.tva, duties: 0 };
  const duties = body.customsDuties === undefined || body.customsDuties === null || body.customsDuties === '' ? 0 : Number(body.customsDuties);
  if (!Number.isFinite(duties) || duties < 0) throw { status: 400, message: 'Le montant des droits de douane est invalide.' };
  const base = achat.htNet + duties;
  let vat = body.importVat === undefined || body.importVat === null || body.importVat === '' ? Math.round((base * TAUX_TVA) / 100) : Number(body.importVat);
  if (!Number.isFinite(vat) || vat < 0) throw { status: 400, message: "La TVA à l'importation est invalide." };
  return { total: Math.round(base + vat), tva: Math.round(vat), duties };
}

// POST /products/purchases/preview — aperçu des montants (rien n'est enregistré).
router.post('/purchases/preview', async (req, res) => {
  const { items, discountType, discountValue } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Au moins un article est requis.' });
  }
  for (const item of items) {
    if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0) {
      return res.status(400).json({ error: 'Article invalide dans la liste.' });
    }
  }
  try {
    const a = await calculerAchat(pool, req.user.merchantId, items, discountType, discountValue, true);
    const imp = ajusterAchatImportation(req.body, a);
    res.json({
      taxRate: TAUX_TVA,
      subtotal: a.sousTotal, discount: a.remise, ht: a.htNet, tva: imp.tva, total: imp.total,
      import: req.body.purchaseKind === 'import', duties: imp.duties,
      missingCost: a.manquants,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors du calcul de l'achat." });
  }
});

// POST /products/purchases
// Entrée de stock pour PLUSIEURS articles en une seule fois, chez UN même
// fournisseur (même paiement — comptant ou à crédit — et un seul montant
// total pour tout l'achat). Même règles qu'une entrée simple
// (POST /:id/stock-movement) mais appliquées à toute la liste d'articles
// dans une seule transaction : soit tout est enregistré, soit rien ne
// l'est. Le montant total de l'achat n'est rattaché qu'au PREMIER article
// (les autres ont total_cost = null) pour que les sommes déjà utilisées
// ailleurs (dette fournisseur, solde de caisse) ne comptent ce montant
// qu'une seule fois — cette appli ne suit pas de coût par article.
router.post('/purchases', async (req, res) => {
  const {
    items, supplierId, movementDate, paymentMethod, invoiceNumber, cashMethod, discountType, discountValue,
    advanceAmount, advanceCashMethod,
    warehouseId: warehouseIdInput,
  } = req.body;
  const MOYENS_PAIEMENT = ['especes', 'wave', 'orange_money', 'cheque', 'virement'];

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Au moins un article est requis.' });
  }
  for (const item of items) {
    if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0) {
      return res.status(400).json({ error: 'Article invalide dans la liste.' });
    }
  }
  const productIds = items.map((i) => i.productId);
  if (new Set(productIds).size !== productIds.length) {
    return res.status(400).json({ error: 'Un même produit apparaît plusieurs fois — regroupez-le en une seule ligne.' });
  }
  if (!['comptant', 'a_credit'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Mode de paiement invalide.' });
  }
  if (paymentMethod === 'a_credit' && !supplierId) {
    return res.status(400).json({ error: 'Un fournisseur est requis pour un achat à crédit.' });
  }
  let cashMethodFinal = null;
  if (paymentMethod === 'comptant') {
    if (!MOYENS_PAIEMENT.includes(cashMethod)) {
      return res.status(400).json({ error: 'Le moyen de paiement de la caisse (espèces, Wave...) est requis pour un achat au comptant.' });
    }
    cashMethodFinal = cashMethod;
  }

  // Avance facultative sur un achat groupé à crédit — même règle que pour
  // une entrée unitaire : réduit la dette dès la création, via une ligne
  // supplier_payments insérée dans la même transaction. Son plafond (le total
  // de l'achat) est vérifié plus bas, une fois le total calculé.
  const avanceDemandee = paymentMethod === 'a_credit' && advanceAmount !== undefined && advanceAmount !== null && advanceAmount !== '';
  let avanceFinale = null;
  let avanceCashMethodFinal = null;
  if (avanceDemandee) {
    if (!Number(advanceAmount) || Number(advanceAmount) <= 0) {
      return res.status(400).json({ error: "Le montant de l'avance est invalide." });
    }
    if (!MOYENS_PAIEMENT.includes(advanceCashMethod)) {
      return res.status(400).json({ error: "Le moyen de paiement de l'avance (espèces, Wave...) est requis." });
    }
  }

  const client = await pool.connect();
  try {
    const warehouseId = await resolveWarehouseId(req, client, warehouseIdInput);

    // Montants calculés automatiquement depuis le prix d'achat des produits.
    const achat = await calculerAchat(client, req.user.merchantId, items, discountType, discountValue);
    let imp;
    try {
      imp = ajusterAchatImportation(req.body, achat);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
    const coutFinal = imp.total;
    const tvaTotale = imp.tva;
    let importation;
    try {
      // Valeur en douane par défaut : valeur des marchandises (HT après réduction).
      importation = lireImportation({ ...req.body, customsValue: req.body.customsValue === undefined || req.body.customsValue === '' ? achat.htNet : req.body.customsValue, customsDuties: imp.duties }, { total: coutFinal, tva: tvaTotale });
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
    if (avanceDemandee) {
      if (Number(advanceAmount) > coutFinal) {
        return res.status(400).json({ error: "L'avance ne peut pas dépasser le montant total de l'achat." });
      }
      avanceFinale = Number(advanceAmount);
      avanceCashMethodFinal = advanceCashMethod;
    }

    // Même règle que pour une entrée simple : jamais de caisse négative.
    // Un seul contrôle pour tout l'achat (un seul montant, une seule caisse).
    if (cashMethodFinal) {
      const soldeActuel = await getSoldeActuel(req, warehouseId, cashMethodFinal);
      if (soldeActuel < coutFinal) {
        return res.status(400).json({
          error: `Solde insuffisant sur ${LABEL_METHODE[cashMethodFinal]} (solde actuel : ${Math.round(soldeActuel).toLocaleString('fr-FR')} FCFA, achat : ${Math.round(coutFinal).toLocaleString('fr-FR')} FCFA).`,
        });
      }
    }
    if (avanceCashMethodFinal) {
      const soldeAvance = await getSoldeActuel(req, warehouseId, avanceCashMethodFinal);
      if (soldeAvance < avanceFinale) {
        return res.status(400).json({
          error: `Solde insuffisant sur ${LABEL_METHODE[avanceCashMethodFinal]} pour l'avance (solde actuel : ${Math.round(soldeAvance).toLocaleString('fr-FR')} FCFA, avance : ${Math.round(avanceFinale).toLocaleString('fr-FR')} FCFA).`,
        });
      }
    }

    if (supplierId) {
      const fournisseur = await client.query(
        `SELECT id FROM suppliers WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
        [supplierId, req.user.merchantId]
      );
      if (fournisseur.rows.length === 0) {
        return res.status(404).json({ error: 'Fournisseur introuvable.' });
      }
    }

    await client.query('BEGIN');

    const alertesStock = [];
    const mouvementsCrees = [];
    const reservationsFulfillies = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];

      const productResult = await client.query(
        `SELECT p.id, p.name, p.is_weighted, p.tva_applicable, p.quantity_alert_threshold, COALESCE(ps.quantity_in_stock, 0) AS quantity_in_stock
         FROM products p
         LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.warehouse_id = $3
         WHERE p.id = $1 AND p.merchant_id = $2 FOR UPDATE OF p`,
        [item.productId, req.user.merchantId, warehouseId]
      );
      const product = productResult.rows[0];

      if (!product) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Produit introuvable (${item.productId}).` });
      }

      if (!product.is_weighted && !Number.isInteger(item.quantity)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `${product.name} n'est pas vendu au poids : la quantité doit être un nombre entier.` });
      }

      const newQuantity = Number(product.quantity_in_stock) + item.quantity;

      await client.query(
        `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity_in_stock = $4`,
        [req.user.merchantId, product.id, warehouseId, newQuantity]
      );

      // Pharmacie : activation auto + lot (péremption) par article, comme
      // pour l'entrée simple.
      if (req.user.sector === 'pharmacie') {
        await client.query(`UPDATE products SET is_activated = TRUE WHERE id = $1`, [product.id]);
        await addLot(client, {
          merchantId: req.user.merchantId,
          productId: product.id,
          warehouseId,
          lotNumber: item.lotNumber,
          expiryDate: item.expiryDate,
          quantity: item.quantity,
        });
      }

      const mouvement = await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, supplier_id, movement_date, payment_method, total_cost, invoice_number, cash_method, warehouse_id, tva_amount, discount_amount,
                                      purchase_kind, customs_declaration, customs_value, customs_duties)
         VALUES ($1, $2, $3, 'entree', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
        [
          req.user.merchantId,
          product.id,
          req.user.id,
          item.quantity,
          'Réapprovisionnement (achat groupé)',
          supplierId || null,
          movementDate || null,
          paymentMethod,
          index === 0 ? coutFinal : null,
          index === 0 ? (invoiceNumber || null) : null,
          cashMethodFinal,
          warehouseId,
          index === 0 ? tvaTotale : 0,
          index === 0 ? achat.remise : 0,
          importation.kind,
          index === 0 ? importation.declaration : null,
          index === 0 ? importation.value : null,
          index === 0 ? importation.duties : null,
        ]
      );
      mouvementsCrees.push(mouvement.rows[0].id);

      // Reliquat : cette réception sert-elle une ou plusieurs commandes
      // clients en attente sur ce produit/boutique ? On consomme les
      // réservations les plus anciennes en premier (FIFO), et on retire
      // aussitôt la part servie du stock disponible à la vente — sinon un
      // autre caissier pourrait la revendre par erreur avant l'encaissement
      // du client qui l'attendait.
      if (SECTEURS_RELIQUAT.includes(req.user.sector)) {
        const reservationsResult = await client.query(
          `SELECT pr.id, pr.order_id, pr.quantity, pr.quantity_fulfilled, c.full_name AS client_name
           FROM pending_reservations pr
           LEFT JOIN clients c ON c.id = pr.client_id
           WHERE pr.merchant_id = $1 AND pr.product_id = $2 AND pr.warehouse_id = $3
             AND pr.status IN ('en_attente', 'partielle')
           ORDER BY pr.created_at ASC
           FOR UPDATE OF pr`,
          [req.user.merchantId, product.id, warehouseId]
        );

        let quantiteAServir = item.quantity;
        let quantiteServieTotale = 0;
        const reservationsServies = [];

        for (const reservation of reservationsResult.rows) {
          if (quantiteAServir <= 0) break;
          const restant = Number(reservation.quantity) - Number(reservation.quantity_fulfilled);
          const quantiteServie = Math.min(restant, quantiteAServir);
          if (quantiteServie <= 0) continue;

          const nouveauFulfilled = Number(reservation.quantity_fulfilled) + quantiteServie;
          const nouveauStatut = nouveauFulfilled >= Number(reservation.quantity) ? 'complete' : 'partielle';

          await client.query(
            `UPDATE pending_reservations
             SET quantity_fulfilled = $1, status = $2::reservation_status, fulfilled_at = CASE WHEN $2::text = 'complete' THEN now() ELSE fulfilled_at END
             WHERE id = $3`,
            [nouveauFulfilled, nouveauStatut, reservation.id]
          );

          quantiteAServir -= quantiteServie;
          quantiteServieTotale += quantiteServie;
          reservationsServies.push({
            orderId: reservation.order_id,
            clientName: reservation.client_name,
            quantiteServie,
            statut: nouveauStatut,
          });
        }

        if (quantiteServieTotale > 0) {
          // On retire la part réservée du stock qu'on vient d'ajouter ci-dessus.
          await client.query(
            `UPDATE product_stock SET quantity_in_stock = GREATEST(0, quantity_in_stock - $1)
             WHERE product_id = $2 AND warehouse_id = $3`,
            [quantiteServieTotale, product.id, warehouseId]
          );
          await client.query(
            `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id)
             VALUES ($1, $2, $3, 'sortie', $4, $5, $6)`,
            [req.user.merchantId, product.id, req.user.id, quantiteServieTotale, 'Réservation(s) client servie(s) à la réception', warehouseId]
          );
          reservationsFulfillies.push({ productName: product.name, reservationsServies });
        }
      }

      const seuil = product.quantity_alert_threshold;
      const etaitDejaBas = product.quantity_in_stock <= seuil;
      const franchitSeuil = !etaitDejaBas && newQuantity <= seuil;
      const entreEnRupture = newQuantity === 0 && product.quantity_in_stock > 0;
      if (franchitSeuil || entreEnRupture) {
        alertesStock.push({ productId: product.id, productName: product.name, newQuantity });
      }
    }

    if (avanceFinale) {
      await client.query(
        `INSERT INTO supplier_payments (merchant_id, supplier_id, user_id, amount, payment_method, notes, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user.merchantId,
          supplierId,
          req.user.id,
          avanceFinale,
          avanceCashMethodFinal,
          "Avance versée à la création de l'achat groupé",
          warehouseId,
        ]
      );
    }

    await client.query('COMMIT');

    // Fire-and-forget après le COMMIT, comme partout ailleurs : une alerte
    // qui échoue ne doit jamais faire échouer l'achat déjà enregistré.
    alertesStock.forEach(({ productId, productName, newQuantity }) => {
      creerAlerte({
        merchantId: req.user.merchantId,
        type: newQuantity === 0 ? 'rupture_stock' : 'seuil_stock',
        titre: newQuantity === 0 ? 'Rupture de stock' : "Stock sous le seuil d'alerte",
        message: newQuantity === 0
          ? `${productName} est en rupture de stock.`
          : `${productName} est passé sous le seuil d'alerte (${newQuantity} restant(s)).`,
        referenceId: productId,
      }).catch((err) => console.error('Erreur alerte stock (achat groupé) :', err));
    });

    // Reliquat honoré : notifie manager/gérant que l'article réservé est
    // arrivé, avec le(s) client(s) concerné(s) pour l'encaissement à venir.
    reservationsFulfillies.forEach(({ productName, reservationsServies }) => {
      const nomsClients = reservationsServies.map((r) => `${r.clientName || 'Client'} (${r.quantiteServie})`).join(', ');
      creerAlerte({
        merchantId: req.user.merchantId,
        type: 'reliquat_disponible',
        titre: 'Article réservé reçu',
        message: `${productName} reçu — réservation(s) à honorer : ${nomsClients}.`,
        roles: ['manager', 'gerant'],
      }).catch((err) => console.error('Erreur alerte reliquat_disponible :', err));
    });

    res.status(201).json({ warehouseId, movementIds: mouvementsCrees, totalCost: coutFinal, tvaAmount: tvaTotale, discountAmount: achat.remise, advancePaid: avanceFinale || 0, reservationsFulfilled: reservationsFulfillies });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement de l'achat groupé." });
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

// GET /products/:id/lots — lots (péremption) d'un produit pour la boutique
// courante, triés FEFO (péremption la plus proche en premier). Pharmacie
// uniquement en pratique (vide pour les autres secteurs, sans erreur).
router.get('/:id/lots', async (req, res) => {
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const result = await pool.query(
      `SELECT id, lot_number, expiry_date, quantity,
              (expiry_date < CURRENT_DATE) AS is_expired,
              (expiry_date >= CURRENT_DATE AND expiry_date < CURRENT_DATE + INTERVAL '90 days') AS is_expiring_soon
       FROM product_lots
       WHERE product_id = $1 AND merchant_id = $2 AND warehouse_id = $3 AND quantity > 0
       ORDER BY expiry_date ASC`,
      [req.params.id, req.user.merchantId, warehouseId]
    );
    res.json(result.rows);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des lots.' });
  }
});

// POST /products/:id/losses — déclare une perte de stock (casse, péremption, vol…).
// Le stock diminue, un mouvement « perte » valorisé au prix de revient est enregistré, et la
// comptabilité en tire une charge « pertes sur stocks » (débit 6581, crédit 311).
// Les lots (pharmacie) sont consommés du plus proche de la péremption au plus lointain.
const MOTIFS_PERTE = { casse: 'Casse', peremption: 'Péremption', vol: 'Vol / démarque', autre: 'Autre perte' };
router.post('/:id/losses', requireRole('manager', 'gerant'), async (req, res) => {
  const { quantity, reason, note, warehouseId: warehouseIdInput } = req.body;
  if (typeof quantity !== 'number' || !(quantity > 0)) {
    return res.status(400).json({ error: 'La quantité perdue doit être un nombre positif.' });
  }
  if (!MOTIFS_PERTE[reason]) {
    return res.status(400).json({ error: 'Motif de perte invalide (casse, péremption, vol ou autre).' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const warehouseId = await resolveWarehouseId(req, client, warehouseIdInput);

    const stockResult = await client.query(
      `SELECT ps.quantity_in_stock, p.name, p.is_weighted, p.cost_price
       FROM product_stock ps JOIN products p ON p.id = ps.product_id
       WHERE ps.product_id = $1 AND ps.warehouse_id = $2 AND ps.merchant_id = $3
       FOR UPDATE OF ps`,
      [req.params.id, warehouseId, req.user.merchantId]
    );
    const stock = stockResult.rows[0];
    if (!stock) throw { status: 404, message: 'Produit introuvable dans cette boutique.' };
    if (!stock.is_weighted && !Number.isInteger(quantity)) {
      throw { status: 400, message: `${stock.name} n'est pas vendu au poids : la quantité doit être un nombre entier.` };
    }
    if (Number(stock.quantity_in_stock) < quantity) {
      throw { status: 400, message: `Stock insuffisant : ${Number(stock.quantity_in_stock)} en stock, ${quantity} déclaré(s) perdu(s).` };
    }

    await client.query(
      `UPDATE product_stock SET quantity_in_stock = quantity_in_stock - $1 WHERE product_id = $2 AND warehouse_id = $3`,
      [quantity, req.params.id, warehouseId]
    );

    // Lots : on retire d'abord ce qui périme le plus tôt.
    let reste = quantity;
    const lots = await client.query(
      `SELECT id, quantity FROM product_lots
       WHERE product_id = $1 AND warehouse_id = $2 AND merchant_id = $3 AND quantity > 0
       ORDER BY expiry_date ASC NULLS LAST FOR UPDATE`,
      [req.params.id, warehouseId, req.user.merchantId]
    );
    for (const lot of lots.rows) {
      if (reste <= 0) break;
      const retire = Math.min(Number(lot.quantity), reste);
      await client.query(`UPDATE product_lots SET quantity = quantity - $1 WHERE id = $2`, [retire, lot.id]);
      reste -= retire;
    }

    const detail = String(note || '').trim().slice(0, 200);
    await client.query(
      `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id, unit_cost)
       VALUES ($1, $2, $3, 'perte', $4, $5, $6, $7)`,
      [req.user.merchantId, req.params.id, req.user.id, quantity,
        `${MOTIFS_PERTE[reason]}${detail ? ` — ${detail}` : ''}`, warehouseId, stock.cost_price]
    );

    await client.query('COMMIT');
    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'stock_loss',
      description: `a déclaré une perte de stock (${MOTIFS_PERTE[reason].toLowerCase()})`,
    });
    res.status(201).json({
      newStock: Number(stock.quantity_in_stock) - quantity,
      lossValue: Math.round(quantity * (Number(stock.cost_price) || 0)),
      missingCost: !(Number(stock.cost_price) > 0),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la déclaration de la perte.' });
  } finally {
    client.release();
  }
});

// DELETE /products/:id/lots/:lotId — détruit (met au rebut) un lot périmé.
// Contrairement à une simple suppression, ça décrémente aussi le stock
// affiché (product_stock) de la quantité détruite, sinon le lot périmé
// continuerait à gonfler le stock affiché indéfiniment — juste bloqué à
// la vente. Trace conservée via un mouvement de stock ('perte').
// Le lot n'est jamais vraiment vendable une fois périmé : on ne permet
// la destruction que d'un lot déjà périmé (expiry_date < aujourd'hui),
// pour éviter qu'un lot valide soit détruit par erreur au lieu d'être
// simplement corrigé/vendu.
router.delete('/:id/lots/:lotId', requireRole('manager', 'gerant'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const warehouseId = await resolveWarehouseId(req, client, req.query.warehouseId);

    const lotResult = await client.query(
      `SELECT * FROM product_lots
       WHERE id = $1 AND product_id = $2 AND merchant_id = $3 AND warehouse_id = $4
       FOR UPDATE`,
      [req.params.lotId, req.params.id, req.user.merchantId, warehouseId]
    );
    const lot = lotResult.rows[0];
    if (!lot) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lot introuvable.' });
    }
    if (new Date(lot.expiry_date) >= new Date(new Date().toISOString().slice(0, 10))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "Ce lot n'est pas périmé — seul un lot périmé peut être détruit." });
    }

    const quantiteDetruite = Number(lot.quantity);
    await client.query(`UPDATE product_lots SET quantity = 0 WHERE id = $1`, [lot.id]);

    const stockResult = await client.query(
      `UPDATE product_stock SET quantity_in_stock = GREATEST(0, quantity_in_stock - $1)
       WHERE product_id = $2 AND warehouse_id = $3
       RETURNING quantity_in_stock`,
      [quantiteDetruite, req.params.id, warehouseId]
    );

    // Registre des destructions (affiché sur le tableau de bord pharmacie).
    // Valeur = quantité × prix de vente enregistré (unit_price), comme l'alerte "lots périmés".
    await client.query(
      `INSERT INTO lot_destructions
         (merchant_id, warehouse_id, product_id, lot_id, lot_number, expiry_date, quantity, unit_price, destroyed_by)
       SELECT $1, $2, p.id, $3, $4, $5, $6::numeric, p.unit_price, $7
       FROM products p WHERE p.id = $8 AND p.merchant_id = $1`,
      [req.user.merchantId, warehouseId, lot.id, lot.lot_number || null, lot.expiry_date, quantiteDetruite, req.user.id, req.params.id]
    );

    await client.query(
      `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id, unit_cost)
       VALUES ($1, $2, $3, 'perte', $4, $5, $6, (SELECT cost_price FROM products WHERE id = $2 AND merchant_id = $1))`,
      [req.user.merchantId, req.params.id, req.user.id, quantiteDetruite,
        `Lot périmé détruit${lot.lot_number ? ` (n° ${lot.lot_number})` : ''} — péremption ${lot.expiry_date.toISOString().slice(0, 10)}`,
        warehouseId]
    );

    await client.query('COMMIT');
    res.json({ quantityDestroyed: quantiteDetruite, newStock: stockResult.rows[0]?.quantity_in_stock ?? 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la destruction du lot.' });
  } finally {
    client.release();
  }
});

// GET /products/equivalences — toutes les liaisons de substitution
// (princeps <-> génériques) du commerçant. Chargé une fois côté frontend et
// croisé avec la liste des produits déjà en mémoire (statut/stock par
// boutique) : pas de requête supplémentaire par produit.
// GET /products/expired-lots — lots DÉJÀ périmés encore en stock (quantité > 0),
// pour l'alerte du tableau de bord pharmacie. Chaque lot peut être détruit via
// DELETE /products/:id/lots/:lotId.
router.get('/expired-lots', async (req, res) => {
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const result = await pool.query(
      `SELECT l.id AS lot_id, l.lot_number, l.expiry_date, l.quantity,
              p.id AS product_id, p.name AS product_name, p.unit_price,
              (CURRENT_DATE - l.expiry_date) AS days_expired
       FROM product_lots l
       JOIN products p ON p.id = l.product_id
       WHERE l.merchant_id = $1 AND l.warehouse_id = $2
         AND l.quantity > 0 AND l.expiry_date < CURRENT_DATE
       ORDER BY l.expiry_date ASC, p.name`,
      [req.user.merchantId, warehouseId]
    );
    const lots = result.rows;
    const totalValue = lots.reduce((somme, l) => somme + Number(l.quantity) * Number(l.unit_price), 0);
    res.json({ count: lots.length, totalValue, lots });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des lots périmés.' });
  }
});

// GET /products/destructions — registre des lots périmés détruits (les 100
// plus récents) avec les totaux sur toutes les destructions du lieu.
router.get('/destructions', async (req, res) => {
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const liste = await pool.query(
      `SELECT d.id, d.destroyed_at, COALESCE(p.name, 'Produit supprimé') AS product_name,
              d.lot_number, d.expiry_date, d.quantity,
              (d.quantity * COALESCE(d.unit_price, 0)) AS lost_value,
              u.full_name AS destroyed_by_name
       FROM lot_destructions d
       LEFT JOIN products p ON p.id = d.product_id
       LEFT JOIN users u ON u.id = d.destroyed_by
       WHERE d.merchant_id = $1 AND d.warehouse_id = $2
       ORDER BY d.destroyed_at DESC
       LIMIT 100`,
      [req.user.merchantId, warehouseId]
    );
    const totaux = await pool.query(
      `SELECT COALESCE(SUM(quantity), 0) AS total_quantity, COALESCE(SUM(quantity * COALESCE(unit_price, 0)), 0) AS total_value
       FROM lot_destructions
       WHERE merchant_id = $1 AND warehouse_id = $2`,
      [req.user.merchantId, warehouseId]
    );
    res.json({
      totalQuantity: Number(totaux.rows[0].total_quantity),
      totalValue: Number(totaux.rows[0].total_value),
      destructions: liste.rows,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du registre des destructions.' });
  }
});

// GET /products/expiring-lots — tableau de bord des lots bientôt périmés,
// répartis en 3 horizons (≤ 3 mois / ≤ 6 mois / ≤ 12 mois, exclusifs : un
// lot n'apparaît que dans l'horizon le plus proche qui le couvre). Les
// lots déjà périmés ne sont PAS inclus ici — ils sont gérés séparément
// (surlignage rouge + destruction, voir GET /:id/lots).
router.get('/expiring-lots', async (req, res) => {
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const result = await pool.query(
      `SELECT l.id AS lot_id, l.lot_number, l.expiry_date, l.quantity,
              p.id AS product_id, p.name AS product_name, p.unit_price,
              CASE
                WHEN l.expiry_date <= CURRENT_DATE + INTERVAL '3 months' THEN '3_mois'
                WHEN l.expiry_date <= CURRENT_DATE + INTERVAL '6 months' THEN '6_mois'
                ELSE '12_mois'
              END AS horizon
       FROM product_lots l
       JOIN products p ON p.id = l.product_id
       WHERE l.merchant_id = $1 AND l.warehouse_id = $2 AND l.quantity > 0
         AND l.expiry_date >= CURRENT_DATE AND l.expiry_date <= CURRENT_DATE + INTERVAL '12 months'
       ORDER BY l.expiry_date ASC`,
      [req.user.merchantId, warehouseId]
    );

    const horizons = { '3_mois': [], '6_mois': [], '12_mois': [] };
    for (const row of result.rows) {
      horizons[row.horizon].push(row);
    }
    const resume = Object.entries(horizons).map(([horizon, lots]) => ({
      horizon,
      count: lots.length,
      totalQuantity: lots.reduce((s, l) => s + Number(l.quantity), 0),
      totalValue: lots.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0),
      lots,
    }));
    res.json(resume);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des lots bientôt périmés.' });
  }
});

router.get('/equivalences', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, product_id_1, product_id_2 FROM product_equivalences WHERE merchant_id = $1`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des équivalences.' });
  }
});

// POST /products/equivalences — lie deux produits comme équivalents
// (princeps <-> générique). La relation est symétrique : peu importe quel
// produit est envoyé en premier, elle sert dans les deux sens à la caisse.
router.post('/equivalences', requireRole('manager', 'gerant'), async (req, res) => {
  const { productId1, productId2 } = req.body;
  if (!productId1 || !productId2 || productId1 === productId2) {
    return res.status(400).json({ error: 'Deux produits distincts sont requis.' });
  }
  try {
    const produits = await pool.query(
      `SELECT id FROM products WHERE id = ANY($1::uuid[]) AND merchant_id = $2 AND is_active = TRUE`,
      [[productId1, productId2], req.user.merchantId]
    );
    if (produits.rows.length !== 2) {
      return res.status(404).json({ error: 'Produit introuvable.' });
    }

    const result = await pool.query(
      `INSERT INTO product_equivalences (merchant_id, product_id_1, product_id_2)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id, product_id_1, product_id_2`,
      [req.user.merchantId, productId1, productId2]
    );
    if (result.rows.length > 0) {
      return res.status(201).json(result.rows[0]);
    }

    // Déjà liée (conflit sur l'index unique symétrique, quel que soit
    // l'ordre des deux ids envoyés) : on renvoie la liaison existante au
    // lieu d'une erreur, pour rester idempotent côté frontend.
    const existante = await pool.query(
      `SELECT id, product_id_1, product_id_2 FROM product_equivalences
       WHERE merchant_id = $1
         AND LEAST(product_id_1, product_id_2) = LEAST($2::uuid, $3::uuid)
         AND GREATEST(product_id_1, product_id_2) = GREATEST($2::uuid, $3::uuid)`,
      [req.user.merchantId, productId1, productId2]
    );
    res.status(200).json(existante.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création de l'équivalence." });
  }
});

// DELETE /products/equivalences/:linkId
router.delete('/equivalences/:linkId', requireRole('manager', 'gerant'), async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM product_equivalences WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [req.params.linkId, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Équivalence introuvable.' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la suppression de l'équivalence." });
  }
});

// GET /products/reservations — reliquats en attente/partiels + réservations
// reçues mais pas encore remises au client, groupés par produit. Placée
// avant les routes /:id pour éviter tout conflit (comme /pdf et /equivalences).
router.get('/reservations', async (req, res) => {
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const result = await pool.query(
      `SELECT pr.id, pr.product_id, p.name AS product_name, p.sku AS product_sku,
              pr.quantity, pr.quantity_fulfilled,
              pr.status, pr.created_at, pr.delivered_at, c.id AS client_id, c.full_name AS client_name, c.phone AS client_phone,
              pr.order_id, o.order_seq, o.created_at AS order_created_at, o.status AS order_status
       FROM pending_reservations pr
       JOIN products p ON p.id = pr.product_id
       JOIN orders o ON o.id = pr.order_id
       LEFT JOIN clients c ON c.id = pr.client_id
       WHERE pr.merchant_id = $1 AND pr.warehouse_id = $2
         AND (pr.status IN ('en_attente', 'partielle') OR (pr.status = 'complete' AND pr.delivered_at IS NULL))
       ORDER BY p.name, pr.created_at ASC`,
      [req.user.merchantId, warehouseId]
    );

    const parProduit = {};
    result.rows.forEach((r) => {
      if (!parProduit[r.product_id]) {
        parProduit[r.product_id] = {
          productId: r.product_id,
          productName: r.product_name,
          productSku: r.product_sku || r.product_id.slice(0, 6).toUpperCase(),
          quantiteRestanteTotale: 0,
          reservations: [],
        };
      }
      const restant = Number(r.quantity) - Number(r.quantity_fulfilled);
      // Une réservation "complete" (déjà reçue) n'a plus de quantité
      // manquante — elle n'entre pas dans le total à commander, mais reste
      // affichée pour que le manager la marque livrée.
      if (r.status !== 'complete') {
        parProduit[r.product_id].quantiteRestanteTotale += restant;
      }
      parProduit[r.product_id].reservations.push({
        ...r,
        quantiteRestante: restant,
        orderNumber: formatOrderNumberSimple({ order_seq: r.order_seq, created_at: r.order_created_at }),
      });
    });

    res.json(Object.values(parProduit));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des réservations en attente.' });
  }
});

// PATCH /products/reservations/:id/cancel — le client renonce à sa commande
// en attente (ou le manager annule pour toute autre raison). Ne touche pas
// au stock : la part manquante n'a jamais été physiquement prélevée.
// Uniquement pour une réservation pas encore reçue (en_attente/partielle) —
// une fois "complete", le stock a déjà été prélevé, il faut la livrer.
router.patch('/reservations/:id/cancel', requireRole('manager', 'gerant'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE pending_reservations
       SET status = 'annulee'
       WHERE id = $1 AND merchant_id = $2 AND status IN ('en_attente', 'partielle')
       RETURNING *`,
      [req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Réservation introuvable ou déjà traitée.' });
    }
    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'reservation_cancelled',
      description: `a annulé une réservation (reliquat) en attente.`,
    });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'annulation de la réservation." });
  }
});

// PATCH /products/reservations/:id/deliver — le client est venu récupérer
// (ou a été livré) l'article réservé, une fois le stock effectivement reçu.
router.patch('/reservations/:id/deliver', requireRole('manager', 'gerant'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE pending_reservations
       SET delivered_at = now()
       WHERE id = $1 AND merchant_id = $2 AND status = 'complete' AND delivered_at IS NULL
       RETURNING *`,
      [req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Réservation introuvable, pas encore reçue, ou déjà livrée.' });
    }
    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'reservation_delivered',
      description: `a marqué une réservation (reliquat) comme livrée au client.`,
    });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors du marquage de la livraison." });
  }
});

module.exports = router;
