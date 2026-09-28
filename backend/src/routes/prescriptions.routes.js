const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Même pattern que dans products_routes.js / orders_routes.js.
async function resolveWarehouseId(req, dbClient, providedId) {
  const runner = dbClient || pool;
  if (req.user.role === 'manager') {
    if (!providedId) throw { status: 400, message: 'La boutique est requise.' };
    const result = await runner.query(
      `SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [providedId, req.user.merchantId]
    );
    if (result.rows.length === 0) throw { status: 404, message: 'Boutique introuvable.' };
    return providedId;
  }
  if (!req.user.warehouseId) throw { status: 403, message: "Vous n'êtes assigné à aucune boutique." };
  return req.user.warehouseId;
}

// GET /prescriptions — liste récente, boutique courante (même filtrage que les autres listes)
router.get('/', async (req, res) => {
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    // ?renewable=true : uniquement les ordonnances renouvelables, avec pour
    // chaque produit la quantité prescrite, délivrée (ventes non annulées
    // liées à l'ordonnance) et l'état d'expiration.
    const seulementRenouvelables = req.query.renewable === 'true';
    const result = await pool.query(
      `SELECT p.*,
              (p.valid_until IS NOT NULL AND p.valid_until < CURRENT_DATE) AS expired,
              CASE WHEN p.is_renewable THEN COALESCE((
                SELECT json_agg(json_build_object(
                         'productId', pi.product_id,
                         'productName', pr.name,
                         'prescribed', pi.quantity_prescribed,
                         'delivered', COALESCE(d.qty, 0)
                       ) ORDER BY pr.name)
                FROM prescription_items pi
                JOIN products pr ON pr.id = pi.product_id
                LEFT JOIN LATERAL (
                  SELECT SUM(oi.quantity) AS qty
                  FROM order_items oi
                  JOIN orders o ON o.id = oi.order_id
                  WHERE o.prescription_id = pi.prescription_id
                    AND oi.product_id = pi.product_id
                    AND o.status <> 'annulee'
                ) d ON true
                WHERE pi.prescription_id = p.id
              ), '[]'::json) ELSE NULL END AS items
       FROM prescriptions p
       WHERE p.merchant_id = $1 AND (p.warehouse_id = $2 OR p.warehouse_id IS NULL)
         ${seulementRenouvelables ? 'AND p.is_renewable = TRUE' : ''}
       ORDER BY p.created_at DESC LIMIT 200`,
      [req.user.merchantId, warehouseId]
    );
    res.json(result.rows);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des ordonnances.' });
  }
});

// POST /prescriptions — créer une ordonnance, à lier ensuite à une vente
// (voir orders_routes.js : prescriptionId dans le body de POST/PUT /orders).
router.post('/', async (req, res) => {
  const { patientName, patientPhone, clientId, doctorName, prescriptionDate, insurerId, insurerMemberNumber, coverageRate, warehouseId: warehouseIdInput, isRenewable, validUntil, items } = req.body;
  if ((!patientName && !clientId) || !prescriptionDate) {
    return res.status(400).json({ error: 'Le nom du patient et la date de prescription sont requis.' });
  }

  // Ordonnance renouvelable/chronique : au moins un produit avec la
  // quantité totale autorisée ; date de fin de validité facultative mais,
  // si fournie, jamais antérieure à la date de prescription.
  const renouvelable = Boolean(isRenewable);
  const lignes = [];
  if (renouvelable) {
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Une ordonnance renouvelable doit lister au moins un produit avec sa quantité prescrite.' });
    }
    const vus = new Set();
    for (const it of items) {
      const quantite = Number(it.quantity);
      if (!it.productId || !Number.isFinite(quantite) || quantite <= 0) {
        return res.status(400).json({ error: 'Produit ou quantité prescrite invalide.' });
      }
      if (vus.has(it.productId)) {
        return res.status(400).json({ error: 'Un même produit ne peut apparaître qu\'une fois sur l\'ordonnance.' });
      }
      vus.add(it.productId);
      lignes.push({ productId: it.productId, quantity: quantite });
    }
    if (validUntil && validUntil < prescriptionDate) {
      return res.status(400).json({ error: 'La date de fin de validité ne peut pas précéder la date de prescription.' });
    }
  }

  if (insurerId && (coverageRate === undefined || coverageRate === null || coverageRate === '')) {
    return res.status(400).json({ error: 'Le taux de prise en charge est requis quand une mutuelle est sélectionnée.' });
  }
  if (coverageRate !== undefined && coverageRate !== null && coverageRate !== '') {
    const taux = Number(coverageRate);
    if (!Number.isFinite(taux) || taux < 0 || taux > 100) {
      return res.status(400).json({ error: 'Le taux de prise en charge doit être compris entre 0 et 100.' });
    }
  }

  const dbClient = await pool.connect();
  try {
    const warehouseId = await resolveWarehouseId(req, dbClient, warehouseIdInput);
    await dbClient.query('BEGIN');

    // Mutuelle choisie sur la liste déroulante (tiers payant) : elle doit
    // appartenir au commerçant. Son nom sert à l'affichage sur l'ordonnance
    // (colonne insurer_name, inchangée) ; son id sera aussi appliqué à la
    // fiche du patient plus bas, pour piloter le tiers payant en caisse.
    let assureurChoisi = null;
    if (insurerId) {
      const assureurResult = await dbClient.query(
        `SELECT id, name FROM insurers WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
        [insurerId, req.user.merchantId]
      );
      if (assureurResult.rows.length === 0) throw { status: 404, message: 'Mutuelle introuvable.' };
      assureurChoisi = assureurResult.rows[0];
    }

    if (renouvelable) {
      const ids = lignes.map((l) => l.productId);
      const produits = await dbClient.query(
        `SELECT id FROM products WHERE merchant_id = $1 AND id = ANY($2::uuid[])`,
        [req.user.merchantId, ids]
      );
      if (produits.rows.length !== ids.length) {
        throw { status: 404, message: 'Un des produits de l\'ordonnance est introuvable.' };
      }
    }

    // Dossier patient : l'ordonnance est rattachée à une fiche client. Si un
    // client existant est fourni on l'utilise ; sinon on réutilise celui qui a
    // le même téléphone, et à défaut on crée la fiche (nom + téléphone).
    let clientIdFinal = null;
    let nomPatient = patientName;
    if (clientId) {
      const clientResult = await dbClient.query(
        `SELECT id, full_name FROM clients WHERE id = $1 AND merchant_id = $2`,
        [clientId, req.user.merchantId]
      );
      if (clientResult.rows.length === 0) throw { status: 404, message: 'Patient introuvable.' };
      clientIdFinal = clientResult.rows[0].id;
      nomPatient = nomPatient || clientResult.rows[0].full_name;
    } else {
      const telephone = patientPhone ? String(patientPhone).trim() : '';
      if (telephone) {
        const existant = await dbClient.query(
          `SELECT id FROM clients WHERE merchant_id = $1 AND phone = $2 LIMIT 1`,
          [req.user.merchantId, telephone]
        );
        if (existant.rows[0]) clientIdFinal = existant.rows[0].id;
      }
      if (!clientIdFinal) {
        const nouveau = await dbClient.query(
          `INSERT INTO clients (merchant_id, full_name, phone) VALUES ($1, $2, $3) RETURNING id`,
          [req.user.merchantId, nomPatient, telephone || null]
        );
        clientIdFinal = nouveau.rows[0].id;
      }
    }

    const result = await dbClient.query(
      `INSERT INTO prescriptions (merchant_id, warehouse_id, patient_name, doctor_name, prescription_date, insurer_name, insurer_member_number, coverage_rate, created_by, is_renewable, valid_until, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [req.user.merchantId, warehouseId, nomPatient, doctorName || null, prescriptionDate, assureurChoisi ? assureurChoisi.name : null, insurerMemberNumber || null, coverageRate || null, req.user.id, renouvelable, renouvelable ? (validUntil || null) : null, clientIdFinal]
    );
    const ordonnance = result.rows[0];

    // La mutuelle et le taux saisis sur l'ordonnance pilotent le tiers
    // payant en caisse pour ce patient : on les applique à sa fiche client.
    if (assureurChoisi) {
      await dbClient.query(
        `UPDATE clients SET insurer_id = $1, insurance_coverage_percent = $2 WHERE id = $3 AND merchant_id = $4`,
        [assureurChoisi.id, Number(coverageRate), clientIdFinal, req.user.merchantId]
      );
    }

    for (const l of lignes) {
      await dbClient.query(
        `INSERT INTO prescription_items (prescription_id, product_id, quantity_prescribed) VALUES ($1, $2, $3)`,
        [ordonnance.id, l.productId, l.quantity]
      );
    }

    await dbClient.query('COMMIT');
    res.status(201).json(ordonnance);
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création de l'ordonnance." });
  } finally {
    dbClient.release();
  }
});

module.exports = router;
