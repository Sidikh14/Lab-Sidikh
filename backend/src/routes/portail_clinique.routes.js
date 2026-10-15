const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireClinique } = require('../middleware/clinique');

// Deux routeurs : l'un pour le personnel (sous /clinique, connecté), l'autre pour le patient (sous /portail, sans compte).
const staff = express.Router();
const patient = express.Router();

const MAX_ECHECS = 5;
const BLOCAGE_MIN = 15;
const DUREE_SESSION = '12h';

function normaliserTelephone(t) {
  return String(t || '').replace(/\D/g, '');
}

// Secret distinct de celui du personnel : un jeton patient n'ouvre jamais les routes du personnel.
function signerPatient(clientId, merchantId) {
  return jwt.sign({ typ: 'patient', sub: clientId, merchantId }, process.env.PORTAIL_JWT_SECRET, { expiresIn: DUREE_SESSION });
}

function authentifierPatient(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Connexion requise.' });
  try {
    const payload = jwt.verify(token, process.env.PORTAIL_JWT_SECRET);
    if (payload.typ !== 'patient') throw new Error('mauvais type de jeton');
    req.patient = { clientId: payload.sub, merchantId: payload.merchantId };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
  }
}

// ---------------------------------------------------------------------
// PERSONNEL : remise du code d'accès (accueil, gérant, manager). Le code s'affiche une seule fois.
// ---------------------------------------------------------------------

// POST /clinique/patients/:patientId/acces-portail
staff.post('/patients/:patientId/acces-portail', authenticate, requireClinique('portail', 'ecrire', { patient: 'patientId' }), async (req, res) => {
  try {
    const patient = await pool.query(`SELECT id, phone FROM clients WHERE id = $1 AND merchant_id = $2`, [req.params.patientId, req.user.merchantId]);
    if (patient.rows.length === 0) return res.status(404).json({ error: 'Patient introuvable.' });
    if (!normaliserTelephone(patient.rows[0].phone)) {
      return res.status(400).json({ error: "Le patient doit avoir un numéro de téléphone pour accéder au portail." });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const hash = await bcrypt.hash(code, 10);
    await pool.query(
      `INSERT INTO portail_acces (client_id, merchant_id, code_hash, tentatives_echouees, bloque_jusqua, cree_par)
       VALUES ($1, $2, $3, 0, NULL, $4)
       ON CONFLICT (client_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, tentatives_echouees = 0, bloque_jusqua = NULL, cree_par = EXCLUDED.cree_par, cree_at = now()`,
      [patient.rows[0].id, req.user.merchantId, hash, req.user.id]
    );
    // Le code est renvoyé une seule fois : il n'est pas conservé en clair.
    res.status(201).json({ code, message: 'Communiquez ce code au patient. Il ne sera plus affiché.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création de l'accès." });
  }
});

// ---------------------------------------------------------------------
// PATIENT : connexion (téléphone + code), sans compte préalable
// ---------------------------------------------------------------------

// POST /portail/:merchantId/connexion  { telephone, code }
patient.post('/:merchantId/connexion', async (req, res) => {
  const { merchantId } = req.params;
  const telephone = normaliserTelephone(req.body.telephone);
  const code = String(req.body.code || '').trim();
  if (!telephone || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Téléphone et code à 6 chiffres requis.' });

  try {
    const r = await pool.query(
      `SELECT c.id, a.code_hash, a.tentatives_echouees, a.bloque_jusqua
       FROM clients c
       JOIN portail_acces a ON a.client_id = c.id
       WHERE c.merchant_id = $1 AND regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') = $2`,
      [merchantId, telephone]
    );
    const acces = r.rows[0];
    // Réponse identique dans tous les cas d'échec, pour ne rien révéler sur les comptes existants.
    const refus = { error: 'Téléphone ou code incorrect.' };
    if (!acces) return res.status(401).json(refus);

    if (acces.bloque_jusqua && new Date(acces.bloque_jusqua) > new Date()) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez plus tard ou contactez la clinique.' });
    }

    const valide = await bcrypt.compare(code, acces.code_hash);
    if (!valide) {
      const echecs = acces.tentatives_echouees + 1;
      const bloque = echecs >= MAX_ECHECS ? new Date(Date.now() + BLOCAGE_MIN * 60000) : null;
      await pool.query(
        `UPDATE portail_acces SET tentatives_echouees = $1, bloque_jusqua = $2 WHERE client_id = $3`,
        [bloque ? 0 : echecs, bloque, acces.id]
      );
      return res.status(401).json(refus);
    }

    await pool.query(`UPDATE portail_acces SET tentatives_echouees = 0, bloque_jusqua = NULL WHERE client_id = $1`, [acces.id]);
    res.json({ token: signerPatient(acces.id, merchantId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la connexion.' });
  }
});

// GET /portail/mes-resultats — résultats PUBLIÉS uniquement
patient.get('/mes-resultats', authentifierPatient, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.libelle, r.type, res.valeurs, res.interpretation, res.publie_at
       FROM exam_results res
       JOIN exam_requests r ON r.id = res.request_id
       WHERE res.statut = 'publie' AND r.client_id = $1 AND res.merchant_id = $2
       ORDER BY res.publie_at DESC`,
      [req.patient.clientId, req.patient.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des résultats.' });
  }
});

// GET /portail/mes-factures — historique (lecture seule)
patient.get('/mes-factures', authentifierPatient, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT order_seq, total_amount, payment_method, status, created_at
       FROM orders
       WHERE client_id = $1 AND merchant_id = $2 AND status IN ('validee', 'livree')
       ORDER BY created_at DESC`,
      [req.patient.clientId, req.patient.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des factures.' });
  }
});

// GET /portail/mes-rendez-vous — rendez-vous à venir
patient.get('/mes-rendez-vous', authentifierPatient, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.starts_at, a.ends_at, a.motif, a.status, u.full_name AS praticien
       FROM appointments a
       LEFT JOIN users u ON u.id = a.practitioner_id
       WHERE a.client_id = $1 AND a.merchant_id = $2 AND a.starts_at >= now()
         AND a.status NOT IN ('annule', 'absent')
       ORDER BY a.starts_at`,
      [req.patient.clientId, req.patient.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des rendez-vous.' });
  }
});

// POST /portail/rendez-vous — prise de rendez-vous en ligne (créneau libre et futur uniquement)
patient.post('/rendez-vous', authentifierPatient, async (req, res) => {
  const { practitionerId, startsAt, endsAt, motif } = req.body;
  const debut = new Date(startsAt);
  const fin = new Date(endsAt);
  if (!practitionerId || Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin <= debut) {
    return res.status(400).json({ error: 'Praticien et créneau valides requis.' });
  }
  if (debut <= new Date()) return res.status(400).json({ error: 'Le créneau doit être dans le futur.' });
  try {
    const praticien = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND merchant_id = $2 AND roles @> ARRAY['medecin']::text[] AND is_active = TRUE`,
      [practitionerId, req.patient.merchantId]
    );
    if (praticien.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable.' });

    const result = await pool.query(
      `INSERT INTO appointments (merchant_id, client_id, practitioner_id, starts_at, ends_at, motif)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, starts_at, ends_at, status`,
      [req.patient.merchantId, req.patient.clientId, practitionerId, debut, fin, motif ? String(motif).slice(0, 200) : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23P01') return res.status(409).json({ error: "Ce créneau n'est plus disponible. Choisissez-en un autre." });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la prise de rendez-vous.' });
  }
});

module.exports = { staff, patient };
