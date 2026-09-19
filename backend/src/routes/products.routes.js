const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { COULEURS, formatMontant, dessinerEntete, dessinerEnteteTableau } = require('../utils/pdfHelpers');
const { creerAlerte, getNomUtilisateur } = require('../services/alerts.service');
const { getSoldeActuel, LABEL_METHODE } = require('../utils/cashBalance');

const router = express.Router();
router.use(authenticate);

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
         p.name, p.sku, ps.quantity_in_stock,
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

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    let y = dessinerEntete(doc, {
      businessName,
      titre: 'Catalogue produits',
      sousTitre: `${warehouseName} · ${result.rows.length} référence(s) · généré le ${new Date().toLocaleDateString('fr-FR')}`,
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
         p.quantity_alert_threshold, p.is_weighted, c.name AS category,
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
      [req.user.merchantId, warehouseId]
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
  const { name, sku, categoryId, unitPrice, quantityInStock, quantityAlertThreshold, units, isWeighted, warehouseId: warehouseIdInput } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Le nom du produit est requis.' });
  }

  const client = await pool.connect();
  try {
    const warehouseId = await resolveWarehouseId(req, client, warehouseIdInput);

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO products (merchant_id, category_id, name, sku, unit_price, quantity_alert_threshold, is_weighted)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.user.merchantId,
        categoryId || null,
        name,
        sku || null,
        unitPrice || 0,
        quantityAlertThreshold || 5,
        Boolean(isWeighted),
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
  const { name, sku, categoryId, unitPrice, quantityAlertThreshold, isWeighted } = req.body;

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
         quantity_alert_threshold = COALESCE($5, quantity_alert_threshold),
         is_weighted = COALESCE($6, is_weighted)
       WHERE id = $7 AND merchant_id = $8
       RETURNING *`,
      [name, sku, categoryId, unitPrice, quantityAlertThreshold, isWeighted, req.params.id, req.user.merchantId]
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
// Une entrée peut être au comptant ou à crédit ; le crédit exige un
// fournisseur enregistré (pour pouvoir suivre la dette) et un montant total.
router.post('/:id/stock-movement', async (req, res) => {
  const { movementType, quantity, reason, supplierId, movementDate, paymentMethod, totalCost, cashMethod, warehouseId: warehouseIdInput } = req.body;
  const validTypes = ['entree', 'sortie', 'ajustement'];
  const MOYENS_PAIEMENT = ['especes', 'wave', 'orange_money', 'cheque', 'virement'];

  if (!validTypes.includes(movementType) || typeof quantity !== 'number' || quantity <= 0) {
    return res.status(400).json({ error: 'Mouvement de stock invalide.' });
  }

  let paiementFinal = null;
  let coutFinal = null;
  let cashMethodFinal = null;
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

    await client.query('BEGIN');

    const productResult = await client.query(
      `SELECT p.id, p.name, p.is_weighted, p.quantity_alert_threshold, COALESCE(ps.quantity_in_stock, 0) AS quantity_in_stock
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

    await client.query(
      `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, supplier_id, movement_date, payment_method, total_cost, cash_method, warehouse_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
      ]
    );

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

    res.json({ productId: product.id, warehouseId, quantityInStock: newQuantity });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du mouvement de stock." });
  } finally {
    client.release();
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
  const { items, supplierId, movementDate, paymentMethod, totalCost, cashMethod, warehouseId: warehouseIdInput } = req.body;
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
  if (!Number(totalCost) || Number(totalCost) <= 0) {
    return res.status(400).json({ error: "Le montant total de l'achat est requis." });
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
  const coutFinal = Number(totalCost);

  const client = await pool.connect();
  try {
    const warehouseId = await resolveWarehouseId(req, client, warehouseIdInput);

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

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];

      const productResult = await client.query(
        `SELECT p.id, p.name, p.is_weighted, p.quantity_alert_threshold, COALESCE(ps.quantity_in_stock, 0) AS quantity_in_stock
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

      const mouvement = await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, supplier_id, movement_date, payment_method, total_cost, cash_method, warehouse_id)
         VALUES ($1, $2, $3, 'entree', $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
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
          cashMethodFinal,
          warehouseId,
        ]
      );
      mouvementsCrees.push(mouvement.rows[0].id);

      const seuil = product.quantity_alert_threshold;
      const etaitDejaBas = product.quantity_in_stock <= seuil;
      const franchitSeuil = !etaitDejaBas && newQuantity <= seuil;
      const entreEnRupture = newQuantity === 0 && product.quantity_in_stock > 0;
      if (franchitSeuil || entreEnRupture) {
        alertesStock.push({ productId: product.id, productName: product.name, newQuantity });
      }
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

    res.status(201).json({ warehouseId, movementIds: mouvementsCrees });
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

module.exports = router;
