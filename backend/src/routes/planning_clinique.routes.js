const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireClinique } = require('../middleware/clinique');

const router = express.Router();
router.use(authenticate);

const TYPES_CRENEAU = ['jour', 'nuit', 'garde', 'astreinte'];

// GET /clinique/planning?from=AAAA-MM-JJ&to=AAAA-MM-JJ&serviceId=
router.get('/planning', requireClinique('planning', 'lire'), async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Les dates from et to sont requises.' });
  try {
    const result = await pool.query(
      `SELECT s.id, s.debut, s.fin, s.type, s.prime, s.service_id, w.name AS service_name,
              s.user_id, u.full_name AS personnel
       FROM clinic_shifts s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN warehouses w ON w.id = s.service_id
       WHERE s.merchant_id = $1
         AND s.debut < ($3::date + INTERVAL '1 day') AND s.fin > $2::date
         AND ($4::uuid IS NULL OR s.service_id = $4::uuid)
       ORDER BY s.debut`,
      [req.user.merchantId, from, to, req.query.serviceId || null]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture du planning.' });
  }
});

// POST /clinique/planning — ajout d'un créneau ou d'une garde (gérant, manager)
router.post('/planning', requireClinique('planning', 'ecrire'), async (req, res) => {
  const { userId, serviceId, debut, fin, type, prime } = req.body;
  const d = new Date(debut);
  const f = new Date(fin);
  if (!userId || Number.isNaN(d.getTime()) || Number.isNaN(f.getTime()) || f <= d) {
    return res.status(400).json({ error: 'Personnel et plage horaire valides requis.' });
  }
  if (!TYPES_CRENEAU.includes(type)) return res.status(400).json({ error: 'Type de créneau invalide.' });
  const montantPrime = prime === undefined ? 0 : Number(prime);
  if (!Number.isFinite(montantPrime) || montantPrime < 0) return res.status(400).json({ error: 'Prime invalide.' });
  try {
    const personne = await pool.query(`SELECT id FROM users WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`, [userId, req.user.merchantId]);
    if (personne.rows.length === 0) return res.status(404).json({ error: 'Personnel introuvable.' });

    const result = await pool.query(
      `INSERT INTO clinic_shifts (merchant_id, service_id, user_id, debut, fin, type, prime, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.merchantId, serviceId || null, userId, d, f, type, montantPrime, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23P01') return res.status(409).json({ error: 'Cette personne est déjà planifiée sur ce créneau.' });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'ajout au planning." });
  }
});

// DELETE /clinique/planning/:id — retrait d'un créneau (gérant, manager)
router.delete('/planning/:id', requireClinique('planning', 'ecrire'), async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM clinic_shifts WHERE id = $1 AND merchant_id = $2 AND debut > now() RETURNING id`,
      [req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(409).json({ error: 'Créneau introuvable ou déjà commencé.' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression du créneau.' });
  }
});

// GET /clinique/primes-garde?month=AAAA-MM — total des primes de garde par personne, à reprendre dans la paie
router.get('/primes-garde', requireClinique('primes_garde', 'lire'), async (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Le mois est requis, au format AAAA-MM.' });
  try {
    const result = await pool.query(
      `SELECT u.id AS user_id, u.full_name AS personnel,
              COUNT(*) AS creneaux,
              SUM(s.prime) AS total_primes
       FROM clinic_shifts s
       JOIN users u ON u.id = s.user_id
       WHERE s.merchant_id = $1
         AND s.prime > 0
         AND to_char(s.debut AT TIME ZONE 'Africa/Dakar', 'YYYY-MM') = $2
       GROUP BY u.id, u.full_name
       ORDER BY u.full_name`,
      [req.user.merchantId, month]
    );
    const total = result.rows.reduce((somme, r) => somme + Number(r.total_primes), 0);
    res.json({ mois: month, personnel: result.rows, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul des primes.' });
  }
});

module.exports = router;
