const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireClinique } = require('../middleware/clinique');
const { aRole } = require('../middleware/roles');
const { COULEURS, dessinerEntete } = require('../utils/pdfHelpers');

const router = express.Router();
router.use(authenticate);

const TYPES_DOCUMENT = ['ordonnance', 'certificat', 'arret_travail', 'compte_rendu'];
const PREFIXES = { ordonnance: 'ORD', certificat: 'CER', arret_travail: 'ARR', compte_rendu: 'CR' };
const TITRES = { ordonnance: 'Ordonnance', certificat: 'Certificat médical', arret_travail: 'Arrêt de travail', compte_rendu: 'Compte rendu' };

// Vérifie qu'un patient appartient au commerce (les routes sont déjà journalisées par requireClinique).
async function patientDuCommerce(patientId, merchantId) {
  const r = await pool.query(`SELECT id, full_name FROM clients WHERE id = $1 AND merchant_id = $2`, [patientId, merchantId]);
  return r.rows[0] || null;
}

// ---------------------------------------------------------------------
// CONSULTATIONS
// ---------------------------------------------------------------------

// GET /clinique/patients/:patientId/consultations
router.get('/patients/:patientId/consultations', requireClinique('dossier_medical', 'lire', { patient: 'patientId' }), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.motif, c.constantes, c.examen, c.diagnostic, c.status, c.signed_at, c.created_at,
              u.full_name AS praticien,
              COALESCE((SELECT json_agg(json_build_object('libelle', a.libelle, 'quantite', a.quantite))
                        FROM consultation_actes a WHERE a.consultation_id = c.id), '[]') AS actes,
              COALESCE((SELECT json_agg(json_build_object('texte', d.texte, 'created_at', d.created_at) ORDER BY d.created_at)
                        FROM consultation_addenda d WHERE d.consultation_id = c.id), '[]') AS addenda
       FROM consultations c
       JOIN users u ON u.id = c.practitioner_id
       WHERE c.merchant_id = $1 AND c.client_id = $2
       ORDER BY c.created_at DESC`,
      [req.user.merchantId, req.params.patientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des consultations.' });
  }
});

// POST /clinique/patients/:patientId/consultations — ouverture d'un brouillon
router.post('/patients/:patientId/consultations', requireClinique('dossier_medical', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const { motif, constantes, appointmentId, serviceId } = req.body;
  try {
    const patient = await patientDuCommerce(req.params.patientId, req.user.merchantId);
    if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });

    const result = await pool.query(
      `INSERT INTO consultations (merchant_id, client_id, practitioner_id, appointment_id, service_id, motif, constantes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $3) RETURNING id, status, created_at`,
      [req.user.merchantId, patient.id, req.user.id, appointmentId || null, serviceId || null, motif || null, JSON.stringify(constantes || {})]
    );
    if (appointmentId) {
      await pool.query(`UPDATE appointments SET status = 'en_consultation' WHERE id = $1 AND merchant_id = $2`, [appointmentId, req.user.merchantId]);
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'ouverture de la consultation." });
  }
});

// PUT /clinique/patients/:patientId/consultations/:id — modification d'un brouillon (refusée une fois signée)
router.put('/patients/:patientId/consultations/:id', requireClinique('dossier_medical', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const { motif, constantes, examen, diagnostic, actes } = req.body;
  if (actes !== undefined && (!Array.isArray(actes) || actes.some((a) => !a.libelle || !(Number(a.quantite) > 0)))) {
    return res.status(400).json({ error: 'Liste des actes invalide.' });
  }
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const existant = await dbClient.query(
      `SELECT id, status FROM consultations WHERE id = $1 AND merchant_id = $2 AND client_id = $3 FOR UPDATE`,
      [req.params.id, req.user.merchantId, req.params.patientId]
    );
    if (existant.rows.length === 0) throw { status: 404, message: 'Consultation introuvable.' };
    if (existant.rows[0].status === 'signee') throw { status: 409, message: 'Consultation signée : utilisez un addendum.' };

    const result = await dbClient.query(
      `UPDATE consultations SET
         motif = COALESCE($1, motif),
         constantes = COALESCE($2, constantes),
         examen = COALESCE($3, examen),
         diagnostic = COALESCE($4, diagnostic),
         updated_at = now()
       WHERE id = $5 RETURNING *`,
      [motif ?? null, constantes ? JSON.stringify(constantes) : null, examen ?? null, diagnostic ?? null, req.params.id]
    );

    if (actes !== undefined) {
      await dbClient.query(`DELETE FROM consultation_actes WHERE consultation_id = $1`, [req.params.id]);
      for (const a of actes) {
        await dbClient.query(
          `INSERT INTO consultation_actes (consultation_id, libelle, quantite) VALUES ($1, $2, $3)`,
          [req.params.id, String(a.libelle).trim().slice(0, 200), Number(a.quantite)]
        );
      }
    }
    await dbClient.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde de la consultation.' });
  } finally {
    dbClient.release();
  }
});

// POST /clinique/patients/:patientId/consultations/:id/signer — signature médicale (médecin uniquement)
router.post('/patients/:patientId/consultations/:id/signer', requireClinique('dossier_medical', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  if (!aRole(req.user, 'medecin')) {
    return res.status(403).json({ error: 'Seul un médecin peut signer une consultation.' });
  }
  try {
    const verif = await pool.query(
      `SELECT motif, diagnostic FROM consultations WHERE id = $1 AND merchant_id = $2 AND client_id = $3 AND status = 'brouillon'`,
      [req.params.id, req.user.merchantId, req.params.patientId]
    );
    if (verif.rows.length === 0) return res.status(404).json({ error: 'Brouillon introuvable.' });
    if (!verif.rows[0].motif || !verif.rows[0].diagnostic) {
      return res.status(400).json({ error: 'Le motif et le diagnostic sont requis avant signature.' });
    }
    const result = await pool.query(
      `UPDATE consultations SET status = 'signee', signed_at = now() WHERE id = $1 RETURNING id, status, signed_at`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la signature.' });
  }
});

// POST /clinique/patients/:patientId/consultations/:id/addenda — complément daté sur une consultation signée
router.post('/patients/:patientId/consultations/:id/addenda', requireClinique('dossier_medical', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const texte = typeof req.body.texte === 'string' ? req.body.texte.trim() : '';
  if (!texte) return res.status(400).json({ error: "Le texte de l'addendum est requis." });
  try {
    const verif = await pool.query(
      `SELECT id FROM consultations WHERE id = $1 AND merchant_id = $2 AND client_id = $3 AND status = 'signee'`,
      [req.params.id, req.user.merchantId, req.params.patientId]
    );
    if (verif.rows.length === 0) return res.status(404).json({ error: 'Consultation signée introuvable.' });
    const result = await pool.query(
      `INSERT INTO consultation_addenda (consultation_id, merchant_id, auteur_id, texte) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, req.user.merchantId, req.user.id, texte]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'ajout de l'addendum." });
  }
});

// ---------------------------------------------------------------------
// DOCUMENTS MÉDICAUX (médecin uniquement pour l'émission)
// ---------------------------------------------------------------------

// POST /clinique/patients/:patientId/documents — émission d'un document numéroté
// Body : { type, consultationId?, contenu: { lignes?, texte?, ... } }
// Les lignes d'ordonnance sont { designation, posologie, duree, quantite }.
router.post('/patients/:patientId/documents', requireClinique('documents_medicaux', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  const { type, consultationId, contenu } = req.body;
  if (!TYPES_DOCUMENT.includes(type)) return res.status(400).json({ error: 'Type de document invalide.' });
  if (!contenu || typeof contenu !== 'object') return res.status(400).json({ error: 'Contenu requis.' });
  if (type === 'ordonnance' && (!Array.isArray(contenu.lignes) || contenu.lignes.length === 0)) {
    return res.status(400).json({ error: "Une ordonnance doit contenir au moins une ligne." });
  }

  const dbClient = await pool.connect();
  try {
    const patient = await patientDuCommerce(req.params.patientId, req.user.merchantId);
    if (!patient) throw { status: 404, message: 'Patient introuvable.' };

    if (consultationId) {
      const c = await dbClient.query(
        `SELECT id FROM consultations WHERE id = $1 AND client_id = $2 AND merchant_id = $3 AND status = 'signee'`,
        [consultationId, req.params.patientId, req.user.merchantId]
      );
      if (c.rows.length === 0) throw { status: 400, message: 'Le document doit se rattacher à une consultation signée de ce patient.' };
    }

    await dbClient.query('BEGIN');
    const annee = new Date().getFullYear();
    const compteur = await dbClient.query(
      `INSERT INTO clinic_document_counters (merchant_id, type, annee, last_number) VALUES ($1, $2, $3, 1)
       ON CONFLICT (merchant_id, type, annee) DO UPDATE SET last_number = clinic_document_counters.last_number + 1
       RETURNING last_number`,
      [req.user.merchantId, type, annee]
    );
    const numero = `${PREFIXES[type]}-${annee}-${String(compteur.rows[0].last_number).padStart(4, '0')}`;

    const doc = await dbClient.query(
      `INSERT INTO clinic_documents (merchant_id, client_id, consultation_id, type, numero, contenu, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, numero, type, created_at`,
      [req.user.merchantId, req.params.patientId, consultationId || null, type, numero, JSON.stringify(contenu), req.user.id]
    );
    await dbClient.query('COMMIT');
    res.status(201).json(doc.rows[0]);
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'émission du document." });
  } finally {
    dbClient.release();
  }
});

// GET /clinique/patients/:patientId/documents
router.get('/patients/:patientId/documents', requireClinique('documents_medicaux', 'lire', { patient: 'patientId' }), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.id, d.numero, d.type, d.created_at, d.consultation_id, u.full_name AS emis_par
       FROM clinic_documents d JOIN users u ON u.id = d.created_by
       WHERE d.merchant_id = $1 AND d.client_id = $2
       ORDER BY d.created_at DESC`,
      [req.user.merchantId, req.params.patientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des documents.' });
  }
});

// GET /clinique/patients/:patientId/documents/:docId/pdf — document en PDF avec en-tête du commerce
router.get('/patients/:patientId/documents/:docId/pdf', requireClinique('documents_medicaux', 'lire', { patient: 'patientId' }), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.numero, d.type, d.contenu, d.created_at, c.full_name AS patient_name, u.full_name AS medecin,
              m.business_name
       FROM clinic_documents d
       JOIN clients c ON c.id = d.client_id
       JOIN users u ON u.id = d.created_by
       JOIN merchants m ON m.id = d.merchant_id
       WHERE d.id = $1 AND d.merchant_id = $2 AND d.client_id = $3`,
      [req.params.docId, req.user.merchantId, req.params.patientId]
    );
    const d = result.rows[0];
    if (!d) return res.status(404).json({ error: 'Document introuvable.' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${d.numero}.pdf"`);
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    let y = dessinerEntete(doc, {
      businessName: d.business_name,
      titre: TITRES[d.type],
      sousTitre: `N° ${d.numero} · émis le ${new Date(d.created_at).toLocaleDateString('fr-FR')}`,
    });
    y += 20;

    doc.fontSize(11).font('Helvetica-Bold').fillColor(COULEURS.encre).text(`Patient : ${d.patient_name}`, 50, y);
    y += 18;
    doc.font('Helvetica').text(`Médecin : ${d.medecin}`, 50, y);
    y += 30;

    if (d.type === 'ordonnance') {
      doc.font('Helvetica-Bold').fontSize(10).text('Prescription', 50, y);
      y += 18;
      doc.font('Helvetica').fontSize(10);
      for (const l of d.contenu.lignes || []) {
        const texte = `${l.quantite} × ${l.designation} — ${l.posologie || ''}${l.duree ? ` pendant ${l.duree}` : ''}`;
        doc.text(texte, 60, y, { width: 480 });
        y = doc.y + 8;
      }
    } else {
      doc.font('Helvetica').fontSize(10).text(d.contenu.texte || '', 50, y, { width: 495, align: 'left' });
    }

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});

// ---------------------------------------------------------------------
// MODÈLES DE DOCUMENTS (modifiables)
// ---------------------------------------------------------------------

// GET /clinique/modeles?type=
router.get('/modeles', requireClinique('modeles', 'lire'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, type, nom, corps, updated_at FROM clinic_templates
       WHERE merchant_id = $1 AND ($2::text IS NULL OR type = $2)
       ORDER BY type, nom`,
      [req.user.merchantId, req.query.type || null]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des modèles.' });
  }
});

// POST /clinique/modeles
router.post('/modeles', requireClinique('modeles', 'ecrire'), async (req, res) => {
  const { type, nom, corps } = req.body;
  if (!TYPES_DOCUMENT.includes(type) || !nom || !String(nom).trim()) {
    return res.status(400).json({ error: 'Type et nom du modèle requis.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO clinic_templates (merchant_id, type, nom, corps, updated_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.merchantId, type, String(nom).trim().slice(0, 120), corps || '', req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du modèle.' });
  }
});

// PATCH /clinique/modeles/:id
router.patch('/modeles/:id', requireClinique('modeles', 'ecrire'), async (req, res) => {
  const { nom, corps } = req.body;
  try {
    const result = await pool.query(
      `UPDATE clinic_templates SET nom = COALESCE($1, nom), corps = COALESCE($2, corps),
         updated_at = now(), updated_by = $3
       WHERE id = $4 AND merchant_id = $5 RETURNING *`,
      [nom || null, corps ?? null, req.user.id, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Modèle introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du modèle.' });
  }
});

module.exports = router;
