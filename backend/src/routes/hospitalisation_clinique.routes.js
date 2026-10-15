const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireClinique } = require('../middleware/clinique');

const router = express.Router();
router.use(authenticate);

const STATUTS_LIT = ['libre', 'occupe', 'nettoyage', 'hors_service'];
const STATUTS_URGENCE = ['attente', 'en_soins', 'observation', 'sorti', 'transfere', 'hospitalise'];
const STATUTS_URGENCE_FERMES = ['sorti', 'transfere', 'hospitalise'];
const MOYENS_CAUTION = ['especes', 'wave', 'orange_money', 'cheque', 'virement'];
const JOUR_MS = 24 * 3600 * 1000;

async function serviceDuCommerce(serviceId, merchantId, dbClient = pool) {
  const r = await dbClient.query(`SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`, [serviceId, merchantId]);
  if (r.rows.length === 0) throw { status: 404, message: 'Service introuvable.' };
}

// ---------------------------------------------------------------------
// LITS
// ---------------------------------------------------------------------

// GET /clinique/lits?serviceId=
router.get('/lits', requireClinique('lits', 'lire'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.numero, b.statut, b.tarif_journalier, b.service_id, w.name AS service_name,
              a.id AS admission_id, a.admitted_at, a.motif AS motif_admission, c.id AS patient_id, c.full_name AS patient_name
       FROM clinic_beds b
       JOIN warehouses w ON w.id = b.service_id
       LEFT JOIN clinic_admissions a ON a.bed_id = b.id AND a.statut = 'en_cours'
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE b.merchant_id = $1 AND ($2::uuid IS NULL OR b.service_id = $2::uuid)
       ORDER BY w.name, b.numero`,
      [req.user.merchantId, req.query.serviceId || null]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des lits.' });
  }
});

// POST /clinique/lits — création d'un lit (gérant, manager)
router.post('/lits', requireClinique('lits_gestion', 'ecrire'), async (req, res) => {
  const { serviceId, numero, tarifJournalier } = req.body;
  const tarif = Number(tarifJournalier);
  if (!serviceId || !numero || !String(numero).trim()) return res.status(400).json({ error: 'Service et numéro du lit requis.' });
  if (!Number.isFinite(tarif) || tarif < 0) return res.status(400).json({ error: 'Tarif journalier invalide.' });
  try {
    await serviceDuCommerce(serviceId, req.user.merchantId);
    const result = await pool.query(
      `INSERT INTO clinic_beds (merchant_id, service_id, numero, tarif_journalier) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.merchantId, serviceId, String(numero).trim().slice(0, 20), tarif]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'Ce numéro de lit existe déjà.' });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du lit.' });
  }
});

// PATCH /clinique/lits/:id/statut — libre, nettoyage, hors service (un lit occupé ne change pas ici)
router.patch('/lits/:id/statut', requireClinique('lits', 'ecrire'), async (req, res) => {
  const { statut } = req.body;
  if (!['libre', 'nettoyage', 'hors_service'].includes(statut)) return res.status(400).json({ error: 'Statut invalide.' });
  try {
    const result = await pool.query(
      `UPDATE clinic_beds SET statut = $1 WHERE id = $2 AND merchant_id = $3 AND statut <> 'occupe' RETURNING *`,
      [statut, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(409).json({ error: 'Lit introuvable ou occupé.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du lit.' });
  }
});

// ---------------------------------------------------------------------
// ADMISSIONS (hospitalisation)
// ---------------------------------------------------------------------

// POST /clinique/patients/:patientId/admissions — admission sur un lit libre
router.post('/patients/:patientId/admissions', requireClinique('admissions', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const { bedId, motif, cautionMontant, cautionMoyen } = req.body;
  const caution = cautionMontant === undefined ? 0 : Number(cautionMontant);
  if (!bedId) return res.status(400).json({ error: 'Le lit est requis.' });
  if (!motif || !String(motif).trim()) return res.status(400).json({ error: "Le motif d'hospitalisation est requis." });
  if (!Number.isFinite(caution) || caution < 0) return res.status(400).json({ error: 'Montant de caution invalide.' });
  if (caution > 0 && !MOYENS_CAUTION.includes(cautionMoyen)) return res.status(400).json({ error: 'Moyen de paiement de la caution invalide.' });

  const dbClient = await pool.connect();
  try {
    const patient = await dbClient.query(`SELECT id FROM clients WHERE id = $1 AND merchant_id = $2`, [req.params.patientId, req.user.merchantId]);
    if (patient.rows.length === 0) throw { status: 404, message: 'Patient introuvable.' };

    await dbClient.query('BEGIN');
    const lit = await dbClient.query(
      `SELECT id, service_id, tarif_journalier, statut FROM clinic_beds WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [bedId, req.user.merchantId]
    );
    const l = lit.rows[0];
    if (!l) throw { status: 404, message: 'Lit introuvable.' };
    if (l.statut !== 'libre') throw { status: 409, message: `Ce lit n'est pas libre (${l.statut}).` };

    const adm = await dbClient.query(
      `INSERT INTO clinic_admissions (merchant_id, client_id, bed_id, service_id, medecin_id, motif, tarif_journalier, caution_montant, caution_moyen, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.user.merchantId, req.params.patientId, l.id, l.service_id, req.user.id, String(motif).trim(), l.tarif_journalier, caution, caution > 0 ? cautionMoyen : null, req.user.id]
    );
    await dbClient.query(`UPDATE clinic_beds SET statut = 'occupe' WHERE id = $1`, [l.id]);
    await dbClient.query('COMMIT');
    res.status(201).json(adm.rows[0]);
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'Ce lit a déjà un séjour en cours.' });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'admission." });
  } finally {
    dbClient.release();
  }
});

// GET /clinique/patients/:patientId/admissions (journalisé)
router.get('/patients/:patientId/admissions', requireClinique('admissions', 'lire', { patient: 'patientId' }), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.motif, a.statut, a.admitted_at, a.discharged_at, a.tarif_journalier, a.caution_montant,
              a.caution_restituee, a.montant_sejour, b.numero AS lit, w.name AS service_name, u.full_name AS medecin
       FROM clinic_admissions a
       JOIN clinic_beds b ON b.id = a.bed_id
       JOIN warehouses w ON w.id = a.service_id
       JOIN users u ON u.id = a.medecin_id
       WHERE a.merchant_id = $1 AND a.client_id = $2
       ORDER BY a.admitted_at DESC`,
      [req.user.merchantId, req.params.patientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des séjours.' });
  }
});

// POST /clinique/patients/:patientId/admissions/:id/surveillance — constantes et notes infirmières
router.post('/patients/:patientId/admissions/:id/surveillance', requireClinique('surveillance', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const { constantes, notes } = req.body;
  if (!constantes && !notes) return res.status(400).json({ error: 'Constantes ou notes requises.' });
  try {
    const verif = await pool.query(
      `SELECT id FROM clinic_admissions WHERE id = $1 AND merchant_id = $2 AND client_id = $3 AND statut = 'en_cours'`,
      [req.params.id, req.user.merchantId, req.params.patientId]
    );
    if (verif.rows.length === 0) return res.status(404).json({ error: 'Séjour en cours introuvable.' });
    const result = await pool.query(
      `INSERT INTO clinic_surveillance (admission_id, merchant_id, constantes, notes, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, req.user.merchantId, JSON.stringify(constantes || {}), notes || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la surveillance.' });
  }
});

// GET /clinique/patients/:patientId/admissions/:id/surveillance (journalisé)
router.get('/patients/:patientId/admissions/:id/surveillance', requireClinique('surveillance', 'lire', { patient: 'patientId' }), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.constantes, s.notes, s.created_at, u.full_name AS saisi_par
       FROM clinic_surveillance s
       JOIN clinic_admissions a ON a.id = s.admission_id
       JOIN users u ON u.id = s.created_by
       WHERE s.admission_id = $1 AND a.merchant_id = $2 AND a.client_id = $3
       ORDER BY s.created_at`,
      [req.params.id, req.user.merchantId, req.params.patientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture de la surveillance.' });
  }
});

// POST /clinique/patients/:patientId/admissions/:id/sortie — sortie : calcul du séjour, lit libéré pour nettoyage
// Le montant est renvoyé à la caisse, qui l'encaisse comme une vente normale (la caution est restituée ici ou non).
router.post('/patients/:patientId/admissions/:id/sortie', requireClinique('admissions', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const cautionRestituee = Boolean(req.body.cautionRestituee);
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const adm = await dbClient.query(
      `SELECT * FROM clinic_admissions WHERE id = $1 AND merchant_id = $2 AND client_id = $3 AND statut = 'en_cours' FOR UPDATE`,
      [req.params.id, req.user.merchantId, req.params.patientId]
    );
    const a = adm.rows[0];
    if (!a) throw { status: 404, message: 'Séjour en cours introuvable.' };

    // Journée commencée = journée facturée (minimum une nuit).
    const sortie = new Date();
    const nuits = Math.max(1, Math.ceil((sortie - new Date(a.admitted_at)) / JOUR_MS));
    const montant = Math.round(nuits * Number(a.tarif_journalier));

    const result = await dbClient.query(
      `UPDATE clinic_admissions SET statut = 'sorti', discharged_at = $1, montant_sejour = $2, caution_restituee = $3
       WHERE id = $4 RETURNING *`,
      [sortie, montant, cautionRestituee, a.id]
    );
    await dbClient.query(`UPDATE clinic_beds SET statut = 'nettoyage' WHERE id = $1`, [a.bed_id]);
    await dbClient.query('COMMIT');
    res.json({ ...result.rows[0], nuits, montant_a_encaisser: montant });
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la sortie.' });
  } finally {
    dbClient.release();
  }
});

// ---------------------------------------------------------------------
// URGENCES
// ---------------------------------------------------------------------

// POST /clinique/urgences — accueil du passage avec triage (accueil, soignants)
router.post('/urgences', requireClinique('urgences', 'ecrire'), async (req, res) => {
  const { nomPatient, clientId, triageNiveau, motif } = req.body;
  const niveau = Number(triageNiveau);
  if (!nomPatient || !String(nomPatient).trim()) return res.status(400).json({ error: 'Le nom du patient est requis (même approximatif).' });
  if (!Number.isInteger(niveau) || niveau < 1 || niveau > 5) return res.status(400).json({ error: 'Niveau de triage entre 1 et 5 requis.' });
  try {
    if (clientId) {
      const p = await pool.query(`SELECT id FROM clients WHERE id = $1 AND merchant_id = $2`, [clientId, req.user.merchantId]);
      if (p.rows.length === 0) return res.status(404).json({ error: 'Patient introuvable.' });
    }
    const result = await pool.query(
      `INSERT INTO clinic_urgences (merchant_id, client_id, nom_patient, triage_niveau, motif, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.merchantId, clientId || null, String(nomPatient).trim().slice(0, 200), niveau, motif || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du passage." });
  }
});

// GET /clinique/urgences/salle — passages ouverts, les plus urgents d'abord
router.get('/urgences/salle', requireClinique('urgences', 'lire'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nom_patient, triage_niveau, motif, statut, arrived_at, medecin_id
       FROM clinic_urgences
       WHERE merchant_id = $1 AND closed_at IS NULL
       ORDER BY triage_niveau, arrived_at`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture de la salle.' });
  }
});

// PATCH /clinique/urgences/:id/statut — prise en charge, observation, sortie, transfert
router.patch('/urgences/:id/statut', requireClinique('urgences', 'ecrire'), async (req, res) => {
  const { statut } = req.body;
  if (!STATUTS_URGENCE.includes(statut)) return res.status(400).json({ error: 'Statut invalide.' });
  const ferme = STATUTS_URGENCE_FERMES.includes(statut);
  try {
    const result = await pool.query(
      `UPDATE clinic_urgences SET
         statut = $1,
         medecin_id = COALESCE(medecin_id, CASE WHEN $1 = 'en_soins' THEN $2::uuid ELSE NULL END),
         closed_at = CASE WHEN $3 THEN now() ELSE NULL END
       WHERE id = $4 AND merchant_id = $5 AND closed_at IS NULL
       RETURNING *`,
      [statut, req.user.id, ferme, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(409).json({ error: 'Passage introuvable ou déjà clos.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du passage.' });
  }
});

module.exports = router;
