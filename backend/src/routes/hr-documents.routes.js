const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireOwnerModule } = require('../middleware/ownerModules');
const { logActivity } = require('../utils/activityLog');
const { UUID_RE, erreurMetier } = require('../utils/payrollCash');
const {
  TYPES_DOCUMENT, CHAMPS, MODELES_PAR_DEFAUT, construireChamps, remplirModele, genererPdfDocument,
} = require('../utils/hrDocuments');

const router = express.Router();
router.use(authenticate);
router.use(requireOwnerModule('paie'));
// Documents RH : données personnelles, réservés au manager.
router.use(requireRole('manager'));

function repondre(res, err) {
  if (err.statut) return res.status(err.statut).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: 'Erreur serveur' });
}

function verifierType(type) {
  if (!TYPES_DOCUMENT.includes(type)) throw erreurMetier(400, 'Type de document inconnu.');
}

async function modeleDuCommercant(merchantId, type) {
  const { rows } = await pool.query('SELECT title, body FROM hr_document_templates WHERE merchant_id = $1 AND doc_type = $2', [merchantId, type]);
  return rows[0] ? { ...rows[0], custom: true } : { ...MODELES_PAR_DEFAUT[type], custom: false };
}

// Titre + texte final d'un document pour un employé (aucune écriture).
async function composerDocument(req, { employeeId, type, extra, titre, corps }) {
  verifierType(type);
  if (!UUID_RE.test(String(employeeId || ''))) throw erreurMetier(404, 'Employé introuvable.');
  const e = await pool.query(
    `SELECT e.*, es.monthly_salary FROM employees e LEFT JOIN employee_salaries es ON es.user_id = e.id
     WHERE e.id = $1 AND e.merchant_id = $2`,
    [employeeId, req.user.merchantId]
  );
  if (e.rows.length === 0) throw erreurMetier(404, 'Employé introuvable.');
  const m = await pool.query(
    'SELECT business_name, ninea, rccm, address, bank_details, mobile_money_details, payment_terms FROM merchants WHERE id = $1',
    [req.user.merchantId]
  );
  const modele = await modeleDuCommercant(req.user.merchantId, type);
  const champs = construireChamps({ employe: e.rows[0], entreprise: m.rows[0], salaire: e.rows[0].monthly_salary, extra: extra || {} });
  return {
    employe: e.rows[0],
    entreprise: m.rows[0],
    titre: remplirModele(titre || modele.title, champs),
    texte: remplirModele(corps || modele.body, champs),
  };
}

// GET /hr-documents/templates — modèles du commerçant (ou modèles par défaut) et champs disponibles.
router.get('/templates', async (req, res) => {
  try {
    const modeles = [];
    for (const type of TYPES_DOCUMENT) modeles.push({ type, ...(await modeleDuCommercant(req.user.merchantId, type)) });
    res.json({ templates: modeles, fields: CHAMPS });
  } catch (err) {
    repondre(res, err);
  }
});

// PUT /hr-documents/templates/:type { title, body }
router.put('/templates/:type', async (req, res) => {
  try {
    verifierType(req.params.type);
    const titre = String(req.body.title || '').trim().slice(0, 150);
    const corps = String(req.body.body || '').trim();
    if (!titre || !corps) throw erreurMetier(400, 'Le titre et le texte sont obligatoires.');
    if (corps.length > 20000) throw erreurMetier(400, 'Le texte est trop long (20 000 caractères au maximum).');
    await pool.query(
      `INSERT INTO hr_document_templates (merchant_id, doc_type, title, body, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (merchant_id, doc_type) DO UPDATE SET title = $3, body = $4, updated_by = $5, updated_at = now()`,
      [req.user.merchantId, req.params.type, titre, corps, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    repondre(res, err);
  }
});

// DELETE /hr-documents/templates/:type — revient au modèle par défaut.
router.delete('/templates/:type', async (req, res) => {
  try {
    verifierType(req.params.type);
    await pool.query('DELETE FROM hr_document_templates WHERE merchant_id = $1 AND doc_type = $2', [req.user.merchantId, req.params.type]);
    res.json({ success: true });
  } catch (err) {
    repondre(res, err);
  }
});

// POST /hr-documents/render { employeeId, type, extra? } — texte final pour relecture (rien n'est enregistré).
router.post('/render', async (req, res) => {
  try {
    const d = await composerDocument(req, req.body);
    res.json({ title: d.titre, text: d.texte });
  } catch (err) {
    repondre(res, err);
  }
});

// POST /hr-documents/issue { employeeId, type, extra? } — émet le document : le texte exact est conservé
// dans le journal ; le PDF se récupère ensuite avec GET /hr-documents/issued/:id/pdf.
router.post('/issue', async (req, res) => {
  try {
    const d = await composerDocument(req, req.body);
    const { rows } = await pool.query(
      `INSERT INTO hr_documents (merchant_id, employee_id, doc_type, title, snapshot, issued_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.merchantId, d.employe.id, req.body.type, d.titre, d.texte, req.user.id]
    );
    await logActivity({
      merchantId: req.user.merchantId, userId: req.user.id, action: 'hr_document_issued',
      description: `a émis le document « ${d.titre} » pour ${d.employe.full_name}`,
    });
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    repondre(res, err);
  }
});

// GET /hr-documents/issued?employeeId= — journal des documents émis.
router.get('/issued', async (req, res) => {
  try {
    const filtre = UUID_RE.test(String(req.query.employeeId || '')) ? req.query.employeeId : null;
    const { rows } = await pool.query(
      `SELECT d.id, d.doc_type, d.title, d.issued_at, e.full_name AS employee_name, u.full_name AS issued_by_name
       FROM hr_documents d JOIN employees e ON e.id = d.employee_id LEFT JOIN users u ON u.id = d.issued_by
       WHERE d.merchant_id = $1 AND ($2::uuid IS NULL OR d.employee_id = $2::uuid)
       ORDER BY d.issued_at DESC LIMIT 200`,
      [req.user.merchantId, filtre]
    );
    res.json(rows);
  } catch (err) {
    repondre(res, err);
  }
});

// GET /hr-documents/issued/:id/pdf — PDF du texte émis (identique à chaque appel).
router.get('/issued/:id/pdf', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Document introuvable.' });
    const { rows } = await pool.query(
      `SELECT d.title, d.snapshot, e.full_name FROM hr_documents d JOIN employees e ON e.id = d.employee_id
       WHERE d.id = $1 AND d.merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Document introuvable.' });
    const m = await pool.query(
      'SELECT business_name, ninea, rccm, address, bank_details, mobile_money_details, payment_terms FROM merchants WHERE id = $1',
      [req.user.merchantId]
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="document-rh-${rows[0].full_name.replace(/\s+/g, '-')}.pdf"`);
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);
    genererPdfDocument(doc, { titre: rows[0].title, texte: rows[0].snapshot, entreprise: m.rows[0] });
    doc.end();
  } catch (err) {
    if (!res.headersSent) repondre(res, err);
    else console.error(err);
  }
});

module.exports = router;
