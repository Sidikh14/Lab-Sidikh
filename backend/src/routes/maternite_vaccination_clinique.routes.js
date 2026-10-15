const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireClinique } = require('../middleware/clinique');

const router = express.Router();
router.use(authenticate);

const MODES_ACCOUCHEMENT = ['voie_basse', 'cesarienne', 'autre'];
const SEXES = ['masculin', 'feminin', 'indetermine'];
const JOUR_MS = 24 * 3600 * 1000;

function ajouterJours(date, jours) {
  return new Date(new Date(date).getTime() + jours * JOUR_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// GROSSESSE
// ---------------------------------------------------------------------

// POST /clinique/patients/:patientId/grossesses
router.post('/patients/:patientId/grossesses', requireClinique('maternite', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const { datePrevueAccouchement } = req.body;
  if (!datePrevueAccouchement) return res.status(400).json({ error: "La date prévue d'accouchement est requise." });
  try {
    const patient = await pool.query(`SELECT id FROM clients WHERE id = $1 AND merchant_id = $2`, [req.params.patientId, req.user.merchantId]);
    if (patient.rows.length === 0) return res.status(404).json({ error: 'Patient introuvable.' });
    const result = await pool.query(
      `INSERT INTO pregnancies (merchant_id, client_id, date_prevue_accouchement, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.merchantId, req.params.patientId, datePrevueAccouchement, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une grossesse est déjà en cours pour cette patiente.' });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la grossesse.' });
  }
});

// GET /clinique/patients/:patientId/grossesses
router.get('/patients/:patientId/grossesses', requireClinique('maternite', 'lire', { patient: 'patientId' }), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.*, (SELECT json_agg(v ORDER BY v.date_visite) FROM pregnancy_visits v WHERE v.pregnancy_id = g.id) AS visites
       FROM pregnancies g
       WHERE g.merchant_id = $1 AND g.client_id = $2
       ORDER BY g.created_at DESC`,
      [req.user.merchantId, req.params.patientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des grossesses.' });
  }
});

// POST /clinique/patients/:patientId/grossesses/:id/visites — visite prénatale
router.post('/patients/:patientId/grossesses/:id/visites', requireClinique('maternite', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const { semaineAmenorrhee, poidsKg, tension, notes, dateVisite } = req.body;
  try {
    const g = await pool.query(
      `SELECT id FROM pregnancies WHERE id = $1 AND merchant_id = $2 AND client_id = $3 AND statut = 'en_cours'`,
      [req.params.id, req.user.merchantId, req.params.patientId]
    );
    if (g.rows.length === 0) return res.status(404).json({ error: 'Grossesse en cours introuvable.' });
    const result = await pool.query(
      `INSERT INTO pregnancy_visits (pregnancy_id, merchant_id, date_visite, semaine_amenorrhee, poids_kg, tension, notes, created_by)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.id, req.user.merchantId, dateVisite || null, semaineAmenorrhee ?? null, poidsKg ?? null, tension || null, notes || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la visite prénatale.' });
  }
});

// POST /clinique/patients/:patientId/grossesses/:id/accouchement — clôt la grossesse et crée le dossier du nouveau-né
router.post('/patients/:patientId/grossesses/:id/accouchement', requireClinique('maternite', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const { deliveredAt, mode, admissionId, nouveauNe } = req.body;
  if (!deliveredAt || Number.isNaN(new Date(deliveredAt).getTime())) return res.status(400).json({ error: "Date et heure de l'accouchement requises." });
  if (!MODES_ACCOUCHEMENT.includes(mode)) return res.status(400).json({ error: "Mode d'accouchement invalide." });
  if (!nouveauNe || typeof nouveauNe !== 'object') return res.status(400).json({ error: 'Informations du nouveau-né requises.' });
  if (nouveauNe.sexe !== undefined && !SEXES.includes(nouveauNe.sexe)) return res.status(400).json({ error: 'Sexe du nouveau-né invalide.' });

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const g = await dbClient.query(
      `SELECT g.id, c.full_name FROM pregnancies g JOIN clients c ON c.id = g.client_id
       WHERE g.id = $1 AND g.merchant_id = $2 AND g.client_id = $3 AND g.statut = 'en_cours' FOR UPDATE`,
      [req.params.id, req.user.merchantId, req.params.patientId]
    );
    if (g.rows.length === 0) throw { status: 404, message: 'Grossesse en cours introuvable.' };
    const mere = g.rows[0];

    const acc = await dbClient.query(
      `INSERT INTO deliveries (merchant_id, pregnancy_id, mother_client_id, delivered_at, mode, admission_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.merchantId, mere.id, req.params.patientId, deliveredAt, mode, admissionId || null, req.user.id]
    );

    // Dossier propre au nouveau-né, lié à la mère (H12).
    const enfant = await dbClient.query(
      `INSERT INTO clients (merchant_id, full_name, phone) VALUES ($1, $2, NULL) RETURNING id`,
      [req.user.merchantId, nouveauNe.nom ? String(nouveauNe.nom).trim() : `Nouveau-né de ${mere.full_name}`]
    );
    const bebe = await dbClient.query(
      `INSERT INTO newborns (merchant_id, delivery_id, mother_client_id, client_id, date_naissance, sexe, poids_grammes, apgar_1, apgar_5)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        req.user.merchantId, acc.rows[0].id, req.params.patientId, enfant.rows[0].id, deliveredAt,
        nouveauNe.sexe || 'indetermine', nouveauNe.poidsGrammes ?? null, nouveauNe.apgar1 ?? null, nouveauNe.apgar5 ?? null,
      ]
    );

    await dbClient.query(`UPDATE pregnancies SET statut = 'accouchee', closed_at = now() WHERE id = $1`, [mere.id]);
    await dbClient.query('COMMIT');
    res.status(201).json({ accouchement: acc.rows[0], nouveauNe: bebe.rows[0] });
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'Cet accouchement est déjà enregistré.' });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement de l'accouchement." });
  } finally {
    dbClient.release();
  }
});

// GET /clinique/patients/:patientId/nouveau-nes — enfants nés de la patiente (journalisé)
router.get('/patients/:patientId/nouveau-nes', requireClinique('maternite', 'lire', { patient: 'patientId' }), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT n.client_id, n.date_naissance, n.sexe, n.poids_grammes, n.apgar_1, n.apgar_5, c.full_name
       FROM newborns n JOIN clients c ON c.id = n.client_id
       WHERE n.merchant_id = $1 AND n.mother_client_id = $2
       ORDER BY n.date_naissance`,
      [req.user.merchantId, req.params.patientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des nouveau-nés.' });
  }
});

// ---------------------------------------------------------------------
// CATALOGUE DE VACCINS (paramétrable par le commerce)
// ---------------------------------------------------------------------

// GET /clinique/vaccins
router.get('/vaccins', requireClinique('vaccins_catalogue', 'lire'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM vaccine_catalog WHERE merchant_id = $1 ORDER BY age_premiere_dose_jours NULLS LAST, nom`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture du catalogue.' });
  }
});

// POST /clinique/vaccins
router.post('/vaccins', requireClinique('vaccins_catalogue', 'ecrire'), async (req, res) => {
  const { nom, nombreDoses, agePremiereDoseJours, delaiEntreDosesJours, rappelJours } = req.body;
  if (!nom || !String(nom).trim()) return res.status(400).json({ error: 'Le nom du vaccin est requis.' });
  try {
    const result = await pool.query(
      `INSERT INTO vaccine_catalog (merchant_id, nom, nombre_doses, age_premiere_dose_jours, delai_entre_doses_jours, rappel_jours)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.merchantId, String(nom).trim().slice(0, 120), nombreDoses || 1, agePremiereDoseJours ?? null, delaiEntreDosesJours ?? null, rappelJours ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce vaccin existe déjà.' });
    if (err.code === '23514') return res.status(400).json({ error: 'Valeurs du calendrier invalides.' });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du vaccin.' });
  }
});

// ---------------------------------------------------------------------
// VACCINATIONS ET CARNET
// ---------------------------------------------------------------------

// POST /clinique/patients/:patientId/vaccinations — enregistre une dose et calcule le prochain rappel
router.post('/patients/:patientId/vaccinations', requireClinique('vaccination', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const { vaccineId, dateAdministration, lotNumero } = req.body;
  if (!vaccineId || !dateAdministration) return res.status(400).json({ error: 'Vaccin et date sont requis.' });
  try {
    const vaccin = await pool.query(`SELECT * FROM vaccine_catalog WHERE id = $1 AND merchant_id = $2`, [vaccineId, req.user.merchantId]);
    const v = vaccin.rows[0];
    if (!v) return res.status(404).json({ error: 'Vaccin introuvable.' });

    const dejaFaites = await pool.query(
      `SELECT COALESCE(MAX(dose_numero), 0) AS derniere FROM vaccinations WHERE client_id = $1 AND vaccine_id = $2 AND merchant_id = $3`,
      [req.params.patientId, vaccineId, req.user.merchantId]
    );
    const dose = Number(dejaFaites.rows[0].derniere) + 1;
    if (dose > v.nombre_doses) return res.status(409).json({ error: 'Toutes les doses de ce vaccin ont déjà été administrées.' });

    // Prochain rappel : entre deux doses, sinon rappel périodique si le calendrier le prévoit.
    let prochain = null;
    if (dose < v.nombre_doses && v.delai_entre_doses_jours) prochain = ajouterJours(dateAdministration, v.delai_entre_doses_jours);
    else if (dose === v.nombre_doses && v.rappel_jours) prochain = ajouterJours(dateAdministration, v.rappel_jours);

    const result = await pool.query(
      `INSERT INTO vaccinations (merchant_id, client_id, vaccine_id, dose_numero, date_administration, lot_numero, prochain_rappel, administered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.merchantId, req.params.patientId, vaccineId, dose, dateAdministration, lotNumero || null, prochain, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement de la vaccination." });
  }
});

// GET /clinique/patients/:patientId/carnet — carnet vaccinal et vaccins à faire (journalisé)
router.get('/patients/:patientId/carnet', requireClinique('vaccination', 'lire', { patient: 'patientId' }), async (req, res) => {
  try {
    const catalogue = await pool.query(
      `SELECT id, nom, nombre_doses, age_premiere_dose_jours, delai_entre_doses_jours, rappel_jours
       FROM vaccine_catalog WHERE merchant_id = $1 AND actif = TRUE ORDER BY age_premiere_dose_jours NULLS LAST, nom`,
      [req.user.merchantId]
    );
    const doses = await pool.query(
      `SELECT vaccine_id, dose_numero, date_administration, lot_numero, prochain_rappel
       FROM vaccinations WHERE merchant_id = $1 AND client_id = $2 ORDER BY date_administration`,
      [req.user.merchantId, req.params.patientId]
    );
    // Date de naissance : si la patiente est un nouveau-né suivi ici, les vaccins à âge fixe se calculent depuis la naissance.
    const naissance = await pool.query(
      `SELECT date_naissance FROM newborns WHERE client_id = $1 AND merchant_id = $2`,
      [req.params.patientId, req.user.merchantId]
    );
    const dateNaissance = naissance.rows[0] ? naissance.rows[0].date_naissance : null;

    const carnet = catalogue.rows.map((v) => {
      const faites = doses.rows.filter((d) => d.vaccine_id === v.id);
      const derniere = faites[faites.length - 1];
      let prochaineDate = null;
      if (faites.length === 0) {
        if (v.age_premiere_dose_jours !== null && dateNaissance) prochaineDate = ajouterJours(dateNaissance, v.age_premiere_dose_jours);
      } else if (faites.length < v.nombre_doses) {
        prochaineDate = derniere.prochain_rappel;
      } else {
        prochaineDate = derniere.prochain_rappel;
      }
      const termine = faites.length >= v.nombre_doses && !derniere?.prochain_rappel;
      return {
        vaccin: v.nom,
        doses_faites: faites.length,
        doses_total: v.nombre_doses,
        doses: faites,
        prochaine_echeance: termine ? null : prochaineDate,
        a_planifier: faites.length === 0 && v.age_premiere_dose_jours !== null && !dateNaissance,
      };
    });
    res.json({ carnet });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture du carnet.' });
  }
});

module.exports = router;
