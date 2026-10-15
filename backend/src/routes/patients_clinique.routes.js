const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireClinique } = require('../middleware/clinique');

const router = express.Router();

// Toutes les routes sont réservées au secteur clinique (vérifié dans requireClinique).
router.use(authenticate);

const GROUPES_SANGUINS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// ---------------------------------------------------------------------
// IDENTITÉ DU PATIENT (accueil, caissier, soignants en lecture)
// ---------------------------------------------------------------------

// GET /clinique/patients?q= — recherche par nom ou téléphone
router.get('/patients', requireClinique('identite_patient', 'lire'), async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const result = await pool.query(
      `SELECT id, full_name, phone, email, address, insurer_id, insurance_coverage_percent, created_at
       FROM clients
       WHERE merchant_id = $1
         AND ($2 = '' OR full_name ILIKE '%' || $2 || '%' OR phone ILIKE '%' || $2 || '%')
       ORDER BY full_name
       LIMIT 200`,
      [req.user.merchantId, q]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la recherche des patients.' });
  }
});

// POST /clinique/patients — création d'un patient (accueil, gérant, manager)
// Détection des doublons : si le téléphone existe déjà, on renvoie 409 avec la fiche existante
// au lieu de créer un second dossier. L'accueil peut alors confirmer le rattachement.
router.post('/patients', requireClinique('identite_patient', 'ecrire'), async (req, res) => {
  const { fullName, phone, email, address } = req.body;
  if (!fullName || !String(fullName).trim()) {
    return res.status(400).json({ error: 'Le nom du patient est requis.' });
  }
  const telephone = phone ? String(phone).trim() : null;

  try {
    if (telephone) {
      const doublon = await pool.query(
        `SELECT id, full_name, phone FROM clients WHERE merchant_id = $1 AND phone = $2 LIMIT 1`,
        [req.user.merchantId, telephone]
      );
      if (doublon.rows[0]) {
        return res.status(409).json({
          error: 'Un patient avec ce numéro existe déjà.',
          doublon: doublon.rows[0],
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO clients (merchant_id, full_name, phone, email, address)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, phone, email, address, created_at`,
      [req.user.merchantId, String(fullName).trim(), telephone, email || null, address || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du patient.' });
  }
});

// PATCH /clinique/patients/:id — modification de l'identité (accueil, gérant, manager)
router.patch('/patients/:id', requireClinique('identite_patient', 'ecrire'), async (req, res) => {
  const { fullName, phone, email, address } = req.body;
  try {
    const result = await pool.query(
      `UPDATE clients SET
         full_name = COALESCE($1, full_name),
         phone = COALESCE($2, phone),
         email = COALESCE($3, email),
         address = COALESCE($4, address),
         updated_at = now()
       WHERE id = $5 AND merchant_id = $6
       RETURNING id, full_name, phone, email, address, updated_at`,
      [fullName || null, phone || null, email || null, address || null, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Patient introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du patient.' });
  }
});

// ---------------------------------------------------------------------
// DOSSIER LÉGER (médecins et soignants). Chaque lecture est journalisée.
// ---------------------------------------------------------------------

// GET /clinique/patients/:patientId/dossier
router.get(
  '/patients/:patientId/dossier',
  requireClinique('dossier_medical', 'lire', { patient: 'patientId' }),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT c.id AS client_id, c.full_name, c.phone,
                d.allergies, d.antecedents, d.groupe_sanguin, d.notes_generales, d.updated_at
         FROM clients c
         LEFT JOIN patient_dossiers d ON d.client_id = c.id
         WHERE c.id = $1 AND c.merchant_id = $2`,
        [req.params.patientId, req.user.merchantId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Patient introuvable.' });
      res.json({ ...result.rows[0], urgence: req.clinique.urgence });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur lors de la lecture du dossier.' });
    }
  }
);

// PUT /clinique/patients/:patientId/dossier — création ou mise à jour du dossier léger
router.put(
  '/patients/:patientId/dossier',
  requireClinique('dossier_medical', 'ecrire', { patient: 'patientId' }),
  async (req, res) => {
    const { allergies, antecedents, groupeSanguin, notesGenerales } = req.body;
    if (groupeSanguin && !GROUPES_SANGUINS.includes(groupeSanguin)) {
      return res.status(400).json({ error: 'Groupe sanguin invalide.' });
    }
    try {
      const patient = await pool.query(
        `SELECT id FROM clients WHERE id = $1 AND merchant_id = $2`,
        [req.params.patientId, req.user.merchantId]
      );
      if (patient.rows.length === 0) return res.status(404).json({ error: 'Patient introuvable.' });

      const result = await pool.query(
        `INSERT INTO patient_dossiers (client_id, merchant_id, allergies, antecedents, groupe_sanguin, notes_generales, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (client_id) DO UPDATE SET
           allergies = EXCLUDED.allergies,
           antecedents = EXCLUDED.antecedents,
           groupe_sanguin = EXCLUDED.groupe_sanguin,
           notes_generales = EXCLUDED.notes_generales,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by
         RETURNING *`,
        [req.params.patientId, req.user.merchantId, allergies || null, antecedents || null, groupeSanguin || null, notesGenerales || null, req.user.id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur lors de la sauvegarde du dossier.' });
    }
  }
);

// ---------------------------------------------------------------------
// AUDIT : journal d'accès (manager uniquement)
// ---------------------------------------------------------------------

// GET /clinique/journal-acces?patientId=&limit=
router.get('/journal-acces', requireClinique('journal_acces', 'lire_journal'), async (req, res) => {
  const limite = Math.min(Number(req.query.limit) || 100, 500);
  const patientId = req.query.patientId || null;
  try {
    const result = await pool.query(
      `SELECT al.id, al.action, al.urgence, al.motif, al.created_at,
              u.full_name AS utilisateur, c.full_name AS patient
       FROM access_log al
       JOIN users u ON u.id = al.user_id
       LEFT JOIN clients c ON c.id = al.patient_id
       WHERE al.merchant_id = $1 AND ($2::uuid IS NULL OR al.patient_id = $2::uuid)
       ORDER BY al.created_at DESC
       LIMIT $3`,
      [req.user.merchantId, patientId, limite]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture du journal.' });
  }
});

module.exports = router;
