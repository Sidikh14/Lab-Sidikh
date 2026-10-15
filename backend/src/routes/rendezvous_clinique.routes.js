const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireClinique } = require('../middleware/clinique');

const router = express.Router();
router.use(authenticate);

const FUSEAU = 'Africa/Dakar';
const STATUTS_RDV = ['planifie', 'arrive', 'en_consultation', 'termine', 'annule', 'absent'];
const PRIORITES = ['normale', 'rdv', 'urgence'];

// Date du jour au format AAAA-MM-JJ, dans le fuseau de la clinique.
function dateDuJour() {
  return new Date().toLocaleDateString('en-CA', { timeZone: FUSEAU });
}

// Lien WhatsApp pré-rempli (aucun envoi automatique, voir H5). Numéros sénégalais à 9 chiffres
// complétés par l'indicatif 221.
function lienWhatsApp(telephone, message) {
  let numero = String(telephone || '').replace(/\D/g, '');
  if (!numero) return null;
  if (numero.length === 9) numero = `221${numero}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(message)}`;
}

// Un service doit appartenir au commerce et être actif.
async function verifierService(serviceId, merchantId, dbClient = pool) {
  const r = await dbClient.query(
    `SELECT id, name FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
    [serviceId, merchantId]
  );
  if (r.rows.length === 0) throw { status: 404, message: 'Service introuvable.' };
  return r.rows[0];
}

// Vérifie qu'un créneau est libre pour le praticien (les annulés et absents ne bloquent pas).
async function creneauLibre(practitionerId, debut, fin, exclureId = null) {
  if (!practitionerId) return true;
  const r = await pool.query(
    `SELECT id FROM appointments
     WHERE practitioner_id = $1
       AND status NOT IN ('annule', 'absent')
       AND tstzrange(starts_at, ends_at) && tstzrange($2::timestamptz, $3::timestamptz)
       AND ($4::uuid IS NULL OR id <> $4::uuid)
     LIMIT 1`,
    [practitionerId, debut, fin, exclureId]
  );
  return r.rows.length === 0;
}

// ---------------------------------------------------------------------
// AGENDA ET RENDEZ-VOUS
// ---------------------------------------------------------------------

// GET /clinique/agenda?date=AAAA-MM-JJ&practitionerId=&serviceId=
router.get('/agenda', requireClinique('rendez_vous', 'lire'), async (req, res) => {
  const date = req.query.date || dateDuJour();
  try {
    const result = await pool.query(
      `SELECT a.id, a.starts_at, a.ends_at, a.motif, a.status, a.reminder_sent_at,
              a.practitioner_id, u.full_name AS practitioner_name,
              a.service_id, w.name AS service_name,
              a.client_id, c.full_name AS client_name, c.phone AS client_phone
       FROM appointments a
       JOIN clients c ON c.id = a.client_id
       LEFT JOIN users u ON u.id = a.practitioner_id
       LEFT JOIN warehouses w ON w.id = a.service_id
       WHERE a.merchant_id = $1
         AND (a.starts_at AT TIME ZONE '${FUSEAU}')::date = $2::date
         AND ($3::uuid IS NULL OR a.practitioner_id = $3::uuid)
         AND ($4::uuid IS NULL OR a.service_id = $4::uuid)
       ORDER BY a.starts_at`,
      [req.user.merchantId, date, req.query.practitionerId || null, req.query.serviceId || null]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la lecture de l'agenda." });
  }
});

// POST /clinique/rendez-vous — création (accueil, gérant, manager)
router.post('/rendez-vous', requireClinique('rendez_vous', 'ecrire'), async (req, res) => {
  const { clientId, practitionerId, serviceId, startsAt, endsAt, motif } = req.body;
  if (!clientId || !startsAt || !endsAt) {
    return res.status(400).json({ error: 'Patient, début et fin du rendez-vous sont requis.' });
  }
  const debut = new Date(startsAt);
  const fin = new Date(endsAt);
  if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin <= debut) {
    return res.status(400).json({ error: 'Plage horaire invalide.' });
  }
  try {
    const patient = await pool.query(`SELECT id FROM clients WHERE id = $1 AND merchant_id = $2`, [clientId, req.user.merchantId]);
    if (patient.rows.length === 0) return res.status(404).json({ error: 'Patient introuvable.' });
    if (serviceId) await verifierService(serviceId, req.user.merchantId);

    if (!(await creneauLibre(practitionerId, debut, fin))) {
      return res.status(409).json({ error: 'Ce créneau chevauche un autre rendez-vous de ce praticien.' });
    }

    const result = await pool.query(
      `INSERT INTO appointments (merchant_id, client_id, practitioner_id, service_id, starts_at, ends_at, motif, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.merchantId, clientId, practitionerId || null, serviceId || null, debut, fin, motif || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23P01') {
      return res.status(409).json({ error: 'Ce créneau chevauche un autre rendez-vous de ce praticien.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du rendez-vous.' });
  }
});

// PATCH /clinique/rendez-vous/:id/statut — arrivé, en consultation, terminé, annulé, absent
router.patch('/rendez-vous/:id/statut', requireClinique('rendez_vous', 'ecrire'), async (req, res) => {
  const { status } = req.body;
  if (!STATUTS_RDV.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
  try {
    const result = await pool.query(
      `UPDATE appointments SET status = $1 WHERE id = $2 AND merchant_id = $3 RETURNING *`,
      [status, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du rendez-vous.' });
  }
});

// GET /clinique/rappels/demain — liste des rappels à envoyer pour le lendemain, avec lien WhatsApp pré-rempli.
// Le message ne contient aucune information médicale.
router.get('/rappels/demain', requireClinique('rendez_vous', 'lire'), async (req, res) => {
  try {
    const demain = new Date(Date.now() + 24 * 3600 * 1000).toLocaleDateString('en-CA', { timeZone: FUSEAU });
    const result = await pool.query(
      `SELECT a.id, a.starts_at, a.reminder_sent_at, c.full_name AS client_name, c.phone AS client_phone,
              u.full_name AS practitioner_name
       FROM appointments a
       JOIN clients c ON c.id = a.client_id
       LEFT JOIN users u ON u.id = a.practitioner_id
       WHERE a.merchant_id = $1
         AND (a.starts_at AT TIME ZONE '${FUSEAU}')::date = $2::date
         AND a.status = 'planifie'
       ORDER BY a.starts_at`,
      [req.user.merchantId, demain]
    );
    const rappels = result.rows.map((r) => {
      const heure = new Date(r.starts_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: FUSEAU });
      const message = `Bonjour ${r.client_name}, rappel de votre rendez-vous demain à ${heure}${r.practitioner_name ? ` avec ${r.practitioner_name}` : ''}. Merci de vous présenter quelques minutes avant.`;
      return { ...r, message, lien_whatsapp: lienWhatsApp(r.client_phone, message) };
    });
    res.json(rappels);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la préparation des rappels.' });
  }
});

// POST /clinique/rendez-vous/:id/rappel-envoye — l'accueil marque le rappel comme envoyé après avoir cliqué sur le lien
router.post('/rendez-vous/:id/rappel-envoye', requireClinique('rendez_vous', 'ecrire'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE appointments SET reminder_sent_at = now() WHERE id = $1 AND merchant_id = $2 RETURNING id, reminder_sent_at`,
      [req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du rappel.' });
  }
});

// ---------------------------------------------------------------------
// LISTE D'ATTENTE
// ---------------------------------------------------------------------

// GET /clinique/liste-attente
router.get('/liste-attente', requireClinique('rendez_vous', 'lire'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.motif, w.created_at, c.full_name AS client_name, c.phone AS client_phone,
              u.full_name AS practitioner_name, s.name AS service_name
       FROM waitlist w
       JOIN clients c ON c.id = w.client_id
       LEFT JOIN users u ON u.id = w.practitioner_id
       LEFT JOIN warehouses s ON s.id = w.service_id
       WHERE w.merchant_id = $1 AND w.status = 'en_attente'
       ORDER BY w.created_at`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la lecture de la liste d'attente." });
  }
});

// POST /clinique/liste-attente
router.post('/liste-attente', requireClinique('rendez_vous', 'ecrire'), async (req, res) => {
  const { clientId, practitionerId, serviceId, motif } = req.body;
  if (!clientId) return res.status(400).json({ error: 'Le patient est requis.' });
  try {
    const result = await pool.query(
      `INSERT INTO waitlist (merchant_id, client_id, practitioner_id, service_id, motif)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.merchantId, clientId, practitionerId || null, serviceId || null, motif || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'ajout à la liste d'attente." });
  }
});

// ---------------------------------------------------------------------
// FILE D'ATTENTE
// ---------------------------------------------------------------------

// POST /clinique/file/tickets — prise d'un ticket à l'arrivée
// Priorité : urgence > rendez-vous > normale. Numérotation par service et par jour.
router.post('/file/tickets', requireClinique('file_attente', 'ecrire'), async (req, res) => {
  const { serviceId, clientId, appointmentId, priorite } = req.body;
  const prio = priorite || (appointmentId ? 'rdv' : 'normale');
  if (!serviceId) return res.status(400).json({ error: 'Le service est requis.' });
  if (!PRIORITES.includes(prio)) return res.status(400).json({ error: 'Priorité invalide.' });

  const dbClient = await pool.connect();
  try {
    await verifierService(serviceId, req.user.merchantId, dbClient);
    const jour = dateDuJour();
    await dbClient.query('BEGIN');

    const compteur = await dbClient.query(
      `INSERT INTO queue_counters (service_id, ticket_date, last_number) VALUES ($1, $2, 1)
       ON CONFLICT (service_id, ticket_date) DO UPDATE SET last_number = queue_counters.last_number + 1
       RETURNING last_number`,
      [serviceId, jour]
    );
    const numero = compteur.rows[0].last_number;

    const ticket = await dbClient.query(
      `INSERT INTO queue_tickets (merchant_id, service_id, ticket_date, number, client_id, appointment_id, priorite)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.merchantId, serviceId, jour, numero, clientId || null, appointmentId || null, prio]
    );

    await dbClient.query('COMMIT');
    res.status(201).json(ticket.rows[0]);
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la prise de ticket.' });
  } finally {
    dbClient.release();
  }
});

// GET /clinique/file?serviceId= — liste d'attente du jour, dans l'ordre d'appel (urgences d'abord)
router.get('/file', requireClinique('file_attente', 'lire'), async (req, res) => {
  const { serviceId } = req.query;
  if (!serviceId) return res.status(400).json({ error: 'Le service est requis.' });
  try {
    const result = await pool.query(
      `SELECT t.id, t.number, t.priorite, t.status, t.guichet, t.created_at, t.called_at,
              c.full_name AS client_name
       FROM queue_tickets t
       LEFT JOIN clients c ON c.id = t.client_id
       WHERE t.merchant_id = $1 AND t.service_id = $2 AND t.ticket_date = $3
         AND t.status IN ('en_attente', 'appele', 'en_cours')
       ORDER BY CASE t.priorite WHEN 'urgence' THEN 0 WHEN 'rdv' THEN 1 ELSE 2 END, t.created_at`,
      [req.user.merchantId, serviceId, dateDuJour()]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture de la file.' });
  }
});

// POST /clinique/file/:ticketId/appeler — appel au guichet ou au cabinet
router.post('/file/:ticketId/appeler', requireClinique('file_attente', 'ecrire'), async (req, res) => {
  const guichet = typeof req.body.guichet === 'string' ? req.body.guichet.trim().slice(0, 30) : '';
  if (!guichet) return res.status(400).json({ error: 'Le guichet ou le cabinet est requis.' });
  try {
    const result = await pool.query(
      `UPDATE queue_tickets SET status = 'appele', guichet = $1, called_at = now()
       WHERE id = $2 AND merchant_id = $3 AND status IN ('en_attente', 'appele')
       RETURNING *`,
      [guichet, req.params.ticketId, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ticket introuvable ou déjà traité.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'appel." });
  }
});

// PATCH /clinique/file/:ticketId/statut — en_cours, termine, absent
router.patch('/file/:ticketId/statut', requireClinique('file_attente', 'ecrire'), async (req, res) => {
  const { status } = req.body;
  if (!['en_cours', 'termine', 'absent'].includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
  try {
    const result = await pool.query(
      `UPDATE queue_tickets SET status = $1 WHERE id = $2 AND merchant_id = $3 RETURNING *`,
      [status, req.params.ticketId, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ticket introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du ticket.' });
  }
});

// GET /clinique/file/ecran?serviceId= — données de l'écran d'appel de la salle d'attente.
// Ne contient AUCUN nom de patient : seulement le numéro, le guichet et les derniers appels.
router.get('/file/ecran', requireClinique('file_attente', 'lire'), async (req, res) => {
  const { serviceId } = req.query;
  if (!serviceId) return res.status(400).json({ error: 'Le service est requis.' });
  try {
    const result = await pool.query(
      `SELECT number, priorite, guichet, called_at
       FROM queue_tickets
       WHERE merchant_id = $1 AND service_id = $2 AND ticket_date = $3 AND status = 'appele'
       ORDER BY called_at DESC
       LIMIT 5`,
      [req.user.merchantId, serviceId, dateDuJour()]
    );
    res.json({ derniersAppels: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la lecture de l'écran d'appel." });
  }
});

module.exports = router;
