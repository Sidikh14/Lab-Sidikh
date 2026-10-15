const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireClinique } = require('../middleware/clinique');

const router = express.Router();
router.use(authenticate);

const TAILLE_MAX_PIECE = 1572864; // 1,5 Mo (H8)
const TYPES_EXAMEN = ['laboratoire', 'imagerie'];

// Vérifie le contenu réel du fichier (signature), pas seulement le type déclaré.
function typeReel(buffer) {
  if (buffer.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.slice(0, 4).toString('latin1') === 'RIFF' && buffer.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Valide la liste des paramètres d'un résultat : chacun doit avoir un nom et une valeur.
function validerValeurs(valeurs) {
  if (!Array.isArray(valeurs) || valeurs.length === 0) return 'Au moins un paramètre de résultat est requis.';
  for (const v of valeurs) {
    if (!v || !String(v.parametre || '').trim() || v.valeur === undefined || v.valeur === null || String(v.valeur).trim() === '') {
      return 'Chaque paramètre doit avoir un nom et une valeur.';
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// DEMANDES D'EXAMENS
// ---------------------------------------------------------------------

// POST /clinique/patients/:patientId/examens — demande d'examen par le médecin
router.post('/patients/:patientId/examens', requireClinique('examens', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const { type, libelle, consultationId } = req.body;
  if (!TYPES_EXAMEN.includes(type)) return res.status(400).json({ error: 'Type d\'examen invalide.' });
  if (!libelle || !String(libelle).trim()) return res.status(400).json({ error: "Le libellé de l'examen est requis." });
  try {
    const patient = await pool.query(`SELECT id FROM clients WHERE id = $1 AND merchant_id = $2`, [req.params.patientId, req.user.merchantId]);
    if (patient.rows.length === 0) return res.status(404).json({ error: 'Patient introuvable.' });

    const result = await pool.query(
      `INSERT INTO exam_requests (merchant_id, client_id, consultation_id, requested_by, type, libelle)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.merchantId, req.params.patientId, consultationId || null, req.user.id, type, String(libelle).trim().slice(0, 200)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la demande d'examen." });
  }
});

// GET /clinique/patients/:patientId/examens — examens et résultats du patient (journalisé)
router.get('/patients/:patientId/examens', requireClinique('examens', 'lire', { patient: 'patientId' }), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.type, r.libelle, r.statut, r.created_at,
              u.full_name AS prescripteur,
              res.valeurs, res.interpretation, res.statut AS statut_resultat, res.valide_at, res.publie_at
       FROM exam_requests r
       JOIN users u ON u.id = r.requested_by
       LEFT JOIN exam_results res ON res.request_id = r.id
       WHERE r.merchant_id = $1 AND r.client_id = $2
       ORDER BY r.created_at DESC`,
      [req.user.merchantId, req.params.patientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des examens.' });
  }
});

// GET /clinique/examens/a-traiter?type=laboratoire|imagerie — liste de travail du laborantin
router.get('/examens/a-traiter', requireClinique('resultats_examens', 'lire'), async (req, res) => {
  const type = TYPES_EXAMEN.includes(req.query.type) ? req.query.type : null;
  try {
    const result = await pool.query(
      `SELECT r.id, r.type, r.libelle, r.statut, r.created_at, r.client_id AS patient_id, c.full_name AS patient_name, res.statut AS statut_resultat
       FROM exam_requests r
       JOIN clients c ON c.id = r.client_id
       LEFT JOIN exam_results res ON res.request_id = r.id
       WHERE r.merchant_id = $1 AND r.statut IN ('demande', 'en_cours')
         AND ($2::text IS NULL OR r.type = $2)
       ORDER BY r.created_at`,
      [req.user.merchantId, type]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture de la liste de travail.' });
  }
});

// ---------------------------------------------------------------------
// RÉSULTATS : saisie (laborantin), validation (médecin), publication (médecin)
// ---------------------------------------------------------------------

// POST /clinique/examens/:requestId/resultat — saisie du résultat
router.post('/examens/:requestId/resultat', requireClinique('resultats_examens', 'ecrire'), async (req, res) => {
  const { valeurs, interpretation } = req.body;
  const erreur = validerValeurs(valeurs);
  if (erreur) return res.status(400).json({ error: erreur });
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const demande = await dbClient.query(
      `SELECT id, statut FROM exam_requests WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [req.params.requestId, req.user.merchantId]
    );
    if (demande.rows.length === 0) throw { status: 404, message: 'Demande introuvable.' };
    if (demande.rows[0].statut === 'annule') throw { status: 409, message: 'Cette demande a été annulée.' };

    const result = await dbClient.query(
      `INSERT INTO exam_results (request_id, merchant_id, valeurs, interpretation, saisi_par)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.requestId, req.user.merchantId, JSON.stringify(valeurs), interpretation || null, req.user.id]
    );
    await dbClient.query(`UPDATE exam_requests SET statut = 'en_cours' WHERE id = $1`, [req.params.requestId]);
    await dbClient.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'Un résultat existe déjà pour cette demande.' });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la saisie du résultat.' });
  } finally {
    dbClient.release();
  }
});

// PATCH /clinique/examens/:requestId/resultat — correction tant que le résultat n'est pas validé
router.patch('/examens/:requestId/resultat', requireClinique('resultats_examens', 'ecrire'), async (req, res) => {
  const { valeurs, interpretation } = req.body;
  if (valeurs !== undefined) {
    const erreur = validerValeurs(valeurs);
    if (erreur) return res.status(400).json({ error: erreur });
  }
  try {
    const result = await pool.query(
      `UPDATE exam_results SET
         valeurs = COALESCE($1::jsonb, valeurs),
         interpretation = COALESCE($2, interpretation)
       WHERE request_id = $3 AND merchant_id = $4 AND statut = 'saisi'
       RETURNING *`,
      [valeurs !== undefined ? JSON.stringify(valeurs) : null, interpretation ?? null, req.params.requestId, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(409).json({ error: 'Résultat introuvable ou déjà validé.' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.message && err.message.includes('validé')) return res.status(409).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la correction du résultat.' });
  }
});

// POST /clinique/examens/:requestId/valider — validation médicale (médecin)
router.post('/examens/:requestId/valider', requireClinique('resultats_examens', 'valider'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE exam_results SET statut = 'valide', valide_par = $1, valide_at = now()
       WHERE request_id = $2 AND merchant_id = $3 AND statut = 'saisi'
       RETURNING *`,
      [req.user.id, req.params.requestId, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(409).json({ error: 'Résultat introuvable ou déjà validé.' });
    await pool.query(`UPDATE exam_requests SET statut = 'termine' WHERE id = $1`, [req.params.requestId]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la validation.' });
  }
});

// POST /clinique/examens/:requestId/publier — mise à disposition du patient sur le portail (médecin, après validation)
router.post('/examens/:requestId/publier', requireClinique('resultats_examens', 'publier'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE exam_results SET statut = 'publie', publie_par = $1, publie_at = now()
       WHERE request_id = $2 AND merchant_id = $3 AND statut = 'valide'
       RETURNING *`,
      [req.user.id, req.params.requestId, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(409).json({ error: 'Le résultat doit être validé avant publication.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la publication.' });
  }
});

// ---------------------------------------------------------------------
// PIÈCES JOINTES (PDF, JPEG, PNG, WebP ; 1,5 Mo maximum)
// Envoi en base64 dans le JSON : { fileName, contenuBase64, requestId? }
// ---------------------------------------------------------------------

// POST /clinique/patients/:patientId/pieces-jointes
router.post('/patients/:patientId/pieces-jointes', requireClinique('pieces_jointes', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const { fileName, contenuBase64, requestId } = req.body;
  if (!fileName || !contenuBase64) return res.status(400).json({ error: 'Nom du fichier et contenu requis.' });

  const contenu = Buffer.from(String(contenuBase64), 'base64');
  if (contenu.length === 0) return res.status(400).json({ error: 'Fichier vide.' });
  if (contenu.length > TAILLE_MAX_PIECE) {
    return res.status(413).json({ error: 'Fichier trop volumineux : 1,5 Mo maximum.' });
  }
  const mime = typeReel(contenu);
  if (!mime) return res.status(400).json({ error: 'Type de fichier non accepté : PDF, JPEG, PNG ou WebP uniquement.' });

  try {
    const patient = await pool.query(`SELECT id FROM clients WHERE id = $1 AND merchant_id = $2`, [req.params.patientId, req.user.merchantId]);
    if (patient.rows.length === 0) return res.status(404).json({ error: 'Patient introuvable.' });

    const result = await pool.query(
      `INSERT INTO exam_attachments (merchant_id, client_id, request_id, file_name, mime_type, taille_octets, contenu, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, file_name, mime_type, taille_octets, created_at`,
      [req.user.merchantId, req.params.patientId, requestId || null, String(fileName).slice(0, 200), mime, contenu.length, contenu, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du fichier." });
  }
});

// GET /clinique/patients/:patientId/pieces-jointes — liste (sans le contenu)
router.get('/patients/:patientId/pieces-jointes', requireClinique('pieces_jointes', 'lire', { patient: 'patientId' }), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, file_name, mime_type, taille_octets, request_id, created_at
       FROM exam_attachments WHERE merchant_id = $1 AND client_id = $2 ORDER BY created_at DESC`,
      [req.user.merchantId, req.params.patientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des pièces jointes.' });
  }
});

// GET /clinique/patients/:patientId/pieces-jointes/:id — téléchargement (journalisé)
router.get('/patients/:patientId/pieces-jointes/:id', requireClinique('pieces_jointes', 'lire', { patient: 'patientId' }), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT file_name, mime_type, contenu FROM exam_attachments
       WHERE id = $1 AND merchant_id = $2 AND client_id = $3`,
      [req.params.id, req.user.merchantId, req.params.patientId]
    );
    const f = result.rows[0];
    if (!f) return res.status(404).json({ error: 'Pièce jointe introuvable.' });
    res.setHeader('Content-Type', f.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${f.file_name.replace(/"/g, '')}"`);
    res.send(f.contenu);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du téléchargement.' });
  }
});

module.exports = router;
