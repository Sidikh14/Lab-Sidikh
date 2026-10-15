const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireClinique } = require('../middleware/clinique');

const router = express.Router();
router.use(authenticate);

const DELAI_ALERTE_PEREMPTION_JOURS = 60;

// Un lieu (service) doit appartenir au commerce et être actif.
async function verifierLieu(warehouseId, merchantId, dbClient = pool) {
  const r = await dbClient.query(
    `SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
    [warehouseId, merchantId]
  );
  if (r.rows.length === 0) throw { status: 404, message: 'Service introuvable.' };
}

// ---------------------------------------------------------------------
// STOCK
// ---------------------------------------------------------------------

// GET /clinique/pharmacie/stock?warehouseId= — produits suivis en stock, quantité du service, lots proches de péremption
router.get('/pharmacie/stock', requireClinique('pharmacie', 'lire'), async (req, res) => {
  const { warehouseId } = req.query;
  if (!warehouseId) return res.status(400).json({ error: 'Le service est requis.' });
  try {
    const produits = await pool.query(
      `SELECT p.id, p.name, p.requires_prescription, p.is_vital,
              COALESCE(ps.quantity_in_stock, 0) AS quantite,
              p.quantity_alert_threshold AS seuil_alerte
       FROM products p
       LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.warehouse_id = $2
       WHERE p.merchant_id = $1 AND p.track_stock = TRUE AND p.is_active = TRUE
       ORDER BY p.name`,
      [req.user.merchantId, warehouseId]
    );
    const peremption = await pool.query(
      `SELECT l.id, l.lot_number, l.expiry_date, l.quantity, p.name AS product_name
       FROM product_lots l
       JOIN products p ON p.id = l.product_id
       WHERE l.merchant_id = $1 AND l.warehouse_id = $2 AND l.quantity > 0
         AND l.expiry_date IS NOT NULL
         AND l.expiry_date <= CURRENT_DATE + ($3 || ' days')::interval
       ORDER BY l.expiry_date`,
      [req.user.merchantId, warehouseId, String(DELAI_ALERTE_PEREMPTION_JOURS)]
    );
    res.json({ produits: produits.rows, lotsProchesPeremption: peremption.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture du stock.' });
  }
});

// POST /clinique/pharmacie/entrees — réception de marchandise, un lot à la fois (gestionnaire uniquement)
router.post('/pharmacie/entrees', requireClinique('pharmacie_entrees', 'ecrire'), async (req, res) => {
  const { productId, warehouseId, lotNumber, expiryDate, quantity } = req.body;
  const qte = Number(quantity);
  if (!productId || !warehouseId || !Number.isFinite(qte) || qte <= 0) {
    return res.status(400).json({ error: 'Produit, service et quantité positive requis.' });
  }
  const dbClient = await pool.connect();
  try {
    await verifierLieu(warehouseId, req.user.merchantId, dbClient);
    const produit = await dbClient.query(
      `SELECT id FROM products WHERE id = $1 AND merchant_id = $2 AND track_stock = TRUE`,
      [productId, req.user.merchantId]
    );
    if (produit.rows.length === 0) throw { status: 404, message: 'Produit suivi en stock introuvable.' };

    await dbClient.query('BEGIN');
    await dbClient.query(
      `INSERT INTO product_lots (merchant_id, product_id, warehouse_id, lot_number, expiry_date, quantity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.merchantId, productId, warehouseId, lotNumber || null, expiryDate || null, qte]
    );
    await dbClient.query(
      `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity_in_stock = product_stock.quantity_in_stock + $4`,
      [req.user.merchantId, productId, warehouseId, qte]
    );
    await dbClient.query(
      `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id)
       VALUES ($1, $2, $3, 'entree', $4, $5, $6)`,
      [req.user.merchantId, productId, req.user.id, qte, `Réception lot ${lotNumber || 'sans numéro'}`, warehouseId]
    );
    await dbClient.query('COMMIT');
    res.status(201).json({ message: 'Entrée enregistrée.' });
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'entrée de stock." });
  } finally {
    dbClient.release();
  }
});

// ---------------------------------------------------------------------
// SORTIES
// Cœur de l'étape : sortie FEFO (premier périmé, premier sorti), lot par lot, avec traçabilité.
// ---------------------------------------------------------------------

// Consomme une quantité sur les lots valides, du plus proche de péremption au plus lointain.
// Renvoie les lots utilisés. Doit être appelée dans une transaction.
async function consommerFEFO(dbClient, merchantId, productId, warehouseId, quantite) {
  const lots = await dbClient.query(
    `SELECT id, quantity, lot_number, expiry_date FROM product_lots
     WHERE merchant_id = $1 AND product_id = $2 AND warehouse_id = $3
       AND quantity > 0 AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
     ORDER BY expiry_date NULLS LAST, created_at
     FOR UPDATE`,
    [merchantId, productId, warehouseId]
  );
  const disponible = lots.rows.reduce((s, l) => s + Number(l.quantity), 0);
  if (disponible < quantite) throw { status: 409, message: `Stock insuffisant : ${disponible} disponible(s), ${quantite} demandé(s).` };

  const utilises = [];
  let reste = quantite;
  for (const lot of lots.rows) {
    if (reste <= 0) break;
    const prise = Math.min(Number(lot.quantity), reste);
    await dbClient.query(`UPDATE product_lots SET quantity = quantity - $1 WHERE id = $2`, [prise, lot.id]);
    utilises.push({ lotId: lot.id, lotNumber: lot.lot_number, quantite: prise });
    reste -= prise;
  }
  await dbClient.query(
    `UPDATE product_stock SET quantity_in_stock = quantity_in_stock - $1
     WHERE product_id = $2 AND warehouse_id = $3`,
    [quantite, productId, warehouseId]
  );
  return utilises;
}

// Coeur partagé : vérifie le produit, l'ordonnance éventuelle, consomme FEFO et enregistre les dispensations.
async function dispenser(req, res, { productId, warehouseId, quantity, clientId, documentId, consultationId, motif }) {
  const qte = Number(quantity);
  if (!productId || !warehouseId || !Number.isFinite(qte) || qte <= 0) {
    return res.status(400).json({ error: 'Produit, service et quantité positive requis.' });
  }
  const dbClient = await pool.connect();
  try {
    await verifierLieu(warehouseId, req.user.merchantId, dbClient);
    const produit = await dbClient.query(
      `SELECT id, name, requires_prescription FROM products WHERE id = $1 AND merchant_id = $2 AND track_stock = TRUE`,
      [productId, req.user.merchantId]
    );
    const p = produit.rows[0];
    if (!p) throw { status: 404, message: 'Produit suivi en stock introuvable.' };

    // Médicament soumis à prescription : une ordonnance émise pour ce patient est obligatoire.
    if (p.requires_prescription) {
      if (!documentId || !clientId) throw { status: 400, message: 'Ce médicament exige une ordonnance pour le patient.' };
      const ord = await dbClient.query(
        `SELECT id FROM clinic_documents WHERE id = $1 AND merchant_id = $2 AND client_id = $3 AND type = 'ordonnance'`,
        [documentId, req.user.merchantId, clientId]
      );
      if (ord.rows.length === 0) throw { status: 400, message: "Ordonnance introuvable pour ce patient." };
    }

    await dbClient.query('BEGIN');
    const utilises = await consommerFEFO(dbClient, req.user.merchantId, productId, warehouseId, qte);

    for (const u of utilises) {
      await dbClient.query(
        `INSERT INTO clinic_dispensations (merchant_id, warehouse_id, product_id, lot_id, quantity, client_id, document_id, consultation_id, motif, dispensed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [req.user.merchantId, warehouseId, productId, u.lotId, u.quantite, clientId || null, documentId || null, consultationId || null, motif || null, req.user.id]
      );
      await dbClient.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id)
         VALUES ($1, $2, $3, 'sortie', $4, $5, $6)`,
        [req.user.merchantId, productId, req.user.id, u.quantite, motif || `Sortie lot ${u.lotNumber || ''}`.trim(), warehouseId]
      );
    }
    await dbClient.query('COMMIT');
    res.status(201).json({ produit: p.name, quantite: qte, lots: utilises });
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la sortie de stock.' });
  } finally {
    dbClient.release();
  }
}

// POST /clinique/patients/:patientId/dispensations — médicament remis à un patient (journalisé)
router.post('/patients/:patientId/dispensations', requireClinique('pharmacie', 'ecrire', { patient: 'patientId' }), (req, res) => {
  const { productId, warehouseId, quantity, documentId, consultationId, motif } = req.body;
  return dispenser(req, res, {
    productId, warehouseId, quantity, clientId: req.params.patientId, documentId, consultationId, motif,
  });
});

// POST /clinique/pharmacie/consommations — consommable utilisé en salle (sans patient)
router.post('/pharmacie/consommations', requireClinique('pharmacie', 'ecrire'), (req, res) => {
  const { productId, warehouseId, quantity, motif } = req.body;
  return dispenser(req, res, { productId, warehouseId, quantity, motif: motif || 'Consommable' });
});

// GET /clinique/patients/:patientId/dispensations — historique des remises à un patient (journalisé)
router.get('/patients/:patientId/dispensations', requireClinique('pharmacie', 'lire', { patient: 'patientId' }), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.id, d.quantity, d.created_at, d.motif, p.name AS product_name, l.lot_number, u.full_name AS remis_par
       FROM clinic_dispensations d
       JOIN products p ON p.id = d.product_id
       LEFT JOIN product_lots l ON l.id = d.lot_id
       JOIN users u ON u.id = d.dispensed_by
       WHERE d.merchant_id = $1 AND d.client_id = $2
       ORDER BY d.created_at DESC`,
      [req.user.merchantId, req.params.patientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la lecture de l'historique." });
  }
});

module.exports = router;
