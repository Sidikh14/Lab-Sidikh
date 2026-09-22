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
    const result = await pool.query(
      `SELECT * FROM prescriptions WHERE merchant_id = $1 AND (warehouse_id = $2 OR warehouse_id IS NULL)
       ORDER BY created_at DESC LIMIT 100`,
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
  const { patientName, doctorName, prescriptionDate, insurerName, insurerMemberNumber, coverageRate, warehouseId: warehouseIdInput } = req.body;
  if (!patientName || !prescriptionDate) {
    return res.status(400).json({ error: 'Le nom du patient et la date de prescription sont requis.' });
  }
  try {
    const warehouseId = await resolveWarehouseId(req, null, warehouseIdInput);
    const result = await pool.query(
      `INSERT INTO prescriptions (merchant_id, warehouse_id, patient_name, doctor_name, prescription_date, insurer_name, insurer_member_number, coverage_rate, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.user.merchantId, warehouseId, patientName, doctorName || null, prescriptionDate, insurerName || null, insurerMemberNumber || null, coverageRate || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création de l'ordonnance." });
  }
});

module.exports = router;
