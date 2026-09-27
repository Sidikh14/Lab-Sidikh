const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { broadcast } = require('../utils/eventsBus');
const { calculerBulletin } = require('../utils/payrollCalc');
const {
  dessinerEntete,
  dessinerEnteteTableau,
  dessinerPiedDePage,
  traitSeparateur,
  formatMontant,
  COULEURS,
} = require('../utils/pdfHelpers');

const router = express.Router();
router.use(authenticate);

function moisActuel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nomMois(moisStr) {
  const NOMS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const [annee, mois] = moisStr.split('-');
  return `${NOMS[Number(mois) - 1]} ${annee}`;
}

// Un employé ne peut consulter que son propre bulletin ; manager/gérant
// peuvent consulter ceux de toute leur équipe.
function peutConsulter(req, userId) {
  return req.user.id === userId || ['manager', 'gerant'].includes(req.user.role);
}

async function recupererOuCreerReglages(merchantId) {
  const existant = await pool.query('SELECT * FROM payroll_settings WHERE merchant_id = $1', [merchantId]);
  if (existant.rows.length > 0) return existant.rows[0];
  const cree = await pool.query(
    `INSERT INTO payroll_settings (merchant_id) VALUES ($1) RETURNING *`,
    [merchantId]
  );
  return cree.rows[0];
}

// ---------------------------------------------------------------------------
// Réglages fiscaux/sociaux (manager uniquement)
// ---------------------------------------------------------------------------

// GET /payroll/settings
router.get('/settings', requireRole('manager'), async (req, res) => {
  try {
    const reglages = await recupererOuCreerReglages(req.user.merchantId);
    res.json(reglages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const CHAMPS_REGLAGES = [
  'abattement_taux', 'abattement_plafond_annuel',
  'ipres_taux_salarial', 'ipres_taux_patronal', 'ipres_plafond_mensuel',
  'css_taux_salarial', 'css_taux_patronal', 'css_plafond_mensuel',
  'cfce_taux', 'bareme_irpp', 'trimf_bareme',
];

// PUT /payroll/settings
router.put('/settings', requireRole('manager'), async (req, res) => {
  try {
    await recupererOuCreerReglages(req.user.merchantId); // garantit qu'une ligne existe déjà

    const colonnes = [];
    const valeurs = [];
    CHAMPS_REGLAGES.forEach((champ) => {
      if (req.body[champ] !== undefined) {
        colonnes.push(champ);
        const valeur = ['bareme_irpp', 'trimf_bareme'].includes(champ)
          ? JSON.stringify(req.body[champ])
          : req.body[champ];
        valeurs.push(valeur);
      }
    });
    if (colonnes.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });

    const affectations = colonnes.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const resultat = await pool.query(
      `UPDATE payroll_settings SET ${affectations}, updated_at = now() WHERE merchant_id = $1 RETURNING *`,
      [req.user.merchantId, ...valeurs]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'payroll_settings_updated',
      description: 'a modifié les paramètres de paie (taux/barèmes)',
    });

    res.json(resultat.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------------------------------------------------------------------------
// Primes/indemnités du mois (manager uniquement)
// ---------------------------------------------------------------------------

// GET /payroll/:userId/bonuses?month=YYYY-MM
router.get('/:userId/bonuses', requireRole('manager'), async (req, res) => {
  try {
    const month = req.query.month || moisActuel();
    const { rows } = await pool.query(
      `SELECT sb.id, sb.label, sb.amount
       FROM salary_bonuses sb
       JOIN users u ON u.id = sb.user_id
       WHERE sb.user_id = $1 AND sb.month = $2 AND u.merchant_id = $3
       ORDER BY sb.created_at`,
      [req.params.userId, month, req.user.merchantId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------------------------------------------------------------------------
// Génération et consultation des bulletins
// ---------------------------------------------------------------------------

// POST /payroll/:userId/generate — calcule et enregistre le bulletin d'un
// mois donné (remplace les primes existantes de ce mois par celles fournies).
router.post('/:userId/generate', requireRole('manager'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;
    const { month, bonuses } = req.body;
    const targetMonth = month || moisActuel();

    const employe = await client.query(
      `SELECT u.id, u.full_name, es.monthly_salary, es.parts_fiscales
       FROM users u
       LEFT JOIN employee_salaries es ON es.user_id = u.id
       WHERE u.id = $1 AND u.merchant_id = $2`,
      [userId, req.user.merchantId]
    );
    if (employe.rows.length === 0) return res.status(404).json({ error: 'Employé introuvable.' });
    if (!employe.rows[0].monthly_salary) {
      return res.status(400).json({ error: "Configurez d'abord le salaire de base de cet employé." });
    }

    const reglages = await recupererOuCreerReglages(req.user.merchantId);
    const listeBonus = Array.isArray(bonuses)
      ? bonuses.filter((b) => b.label && Number(b.amount)).map((b) => ({ label: String(b.label).slice(0, 120), amount: Number(b.amount) }))
      : [];

    const resultat = calculerBulletin({
      baseSalary: employe.rows[0].monthly_salary,
      bonuses: listeBonus,
      settings: reglages,
      partsFiscales: employe.rows[0].parts_fiscales,
    });

    await client.query('BEGIN');

    await client.query('DELETE FROM salary_bonuses WHERE user_id = $1 AND month = $2', [userId, targetMonth]);
    for (const b of listeBonus) {
      await client.query(
        `INSERT INTO salary_bonuses (user_id, month, label, amount) VALUES ($1, $2, $3, $4)`,
        [userId, targetMonth, b.label, b.amount]
      );
    }

    const colonnes = Object.keys(resultat);
    const placeholders = colonnes.map((_, i) => `$${i + 5}`).join(', ');
    const affectationsMaj = colonnes.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    await client.query(
      `INSERT INTO payslips (merchant_id, user_id, month, generated_by, ${colonnes.join(', ')})
       VALUES ($1, $2, $3, $4, ${placeholders})
       ON CONFLICT (user_id, month) DO UPDATE SET ${affectationsMaj}, generated_by = $4, generated_at = now()`,
      [
        req.user.merchantId,
        userId,
        targetMonth,
        req.user.id,
        ...colonnes.map((c) => (c === 'bonuses_detail' ? JSON.stringify(resultat[c]) : resultat[c])),
      ]
    );

    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'payslip_generated',
      description: `a généré le bulletin de paie de ${employe.rows[0].full_name} (${targetMonth}) — net ${formatMontant(resultat.net_a_payer)} FCFA`,
    });
    broadcast(req.user.merchantId, 'activity:created', {});

    res.json({ month: targetMonth, ...resultat });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// GET /payroll/mine — liste des bulletins de l'utilisateur connecté
router.get('/mine', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT month, gross_salary, net_a_payer, generated_at
       FROM payslips WHERE user_id = $1 ORDER BY month DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /payroll/:userId/:month — détail d'un bulletin (manager/gérant ou
// l'employé lui-même)
router.get('/:userId/:month', async (req, res) => {
  if (!peutConsulter(req, req.params.userId)) {
    return res.status(403).json({ error: 'Accès refusé.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.full_name
       FROM payslips p JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1 AND p.month = $2 AND p.merchant_id = $3`,
      [req.params.userId, req.params.month, req.user.merchantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Bulletin introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /payroll/:userId/:month/pdf — bulletin en PDF (manager/gérant ou
// l'employé lui-même)
router.get('/:userId/:month/pdf', async (req, res) => {
  if (!peutConsulter(req, req.params.userId)) {
    return res.status(403).json({ error: 'Accès refusé.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.full_name, u.role,
              m.business_name, m.ninea, m.rccm, m.address, m.bank_details, m.mobile_money_details, m.payment_terms
       FROM payslips p
       JOIN users u ON u.id = p.user_id
       JOIN merchants m ON m.id = p.merchant_id
       WHERE p.user_id = $1 AND p.month = $2 AND p.merchant_id = $3`,
      [req.params.userId, req.params.month, req.user.merchantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Bulletin introuvable.' });

    const bulletin = rows[0];
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="bulletin-${bulletin.full_name.replace(/\s+/g, '-')}-${bulletin.month}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);
    genererBulletinPDF(doc, bulletin);
    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------------------------------------------------------------------------
// Mise en page PDF du bulletin — réutilise pdfHelpers.js (même identité
// visuelle que les autres documents de l'application : noir/gris, Newsreader).
// ---------------------------------------------------------------------------
function genererBulletinPDF(doc, bulletin) {
  const merchant = {
    ninea: bulletin.ninea,
    rccm: bulletin.rccm,
    address: bulletin.address,
    bank_details: bulletin.bank_details,
    mobile_money_details: bulletin.mobile_money_details,
    payment_terms: bulletin.payment_terms,
  };
  const largeurPage = doc.page.width;
  const xGauche = 50;
  const xDroite = largeurPage - 50;

  let y = dessinerEntete(doc, {
    businessName: bulletin.business_name,
    titre: 'Bulletin de paie',
    sousTitre: nomMois(bulletin.month),
    merchant,
  });

  // Bandeau identité employé, sur fond légèrement grisé, avec les infos clés
  // (nom, poste, quotient familial) réparties sur la largeur.
  const hauteurBandeau = 44;
  doc.rect(xGauche, y, xDroite - xGauche, hauteurBandeau).fill(COULEURS.fondAlterne);
  doc.fillColor(COULEURS.mutedClair).font('Helvetica').fontSize(7.5)
    .text('SALARIÉ', xGauche + 14, y + 9, { characterSpacing: 0.5 });
  doc.fillColor(COULEURS.encre).font('Helvetica-Bold').fontSize(12)
    .text(bulletin.full_name, xGauche + 14, y + 20);

  const xColonne2 = xGauche + (xDroite - xGauche) * 0.42;
  doc.fillColor(COULEURS.mutedClair).font('Helvetica').fontSize(7.5)
    .text('POSTE', xColonne2, y + 9, { characterSpacing: 0.5 });
  doc.fillColor(COULEURS.encre).font('Helvetica').fontSize(10)
    .text(libelleRole(bulletin.role), xColonne2, y + 20);

  const xColonne3 = xGauche + (xDroite - xGauche) * 0.74;
  doc.fillColor(COULEURS.mutedClair).font('Helvetica').fontSize(7.5)
    .text('QUOTIENT FAMILIAL', xColonne3, y + 9, { characterSpacing: 0.5 });
  doc.fillColor(COULEURS.encre).font('Helvetica').fontSize(10)
    .text(`${formatMontant(bulletin.parts_fiscales).replace(/\s/g, '')} part(s)`, xColonne3, y + 20);

  y += hauteurBandeau + 20;

  // --- Section GAINS ---
  y = dessinerEnteteTableau(doc, y, [
    { texte: 'Gains', x: xGauche, largeur: 300 },
    { texte: 'Montant (FCFA)', x: xColonne3 - 30, largeur: 175, aligner: 'right' },
  ]);

  let indexLigne = 0;
  function ligne(label, montant, { gras = false, indent = false } = {}) {
    const fond = indexLigne % 2 === 1 ? COULEURS.fondAlterne : null;
    if (fond) doc.rect(xGauche - 4, y - 3, xDroite - xGauche + 8, 17).fill(fond);
    doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(COULEURS.encre);
    doc.text(label, xGauche + (indent ? 12 : 0), y, { width: 290 - (indent ? 12 : 0) });
    doc.text(formatMontant(montant), xColonne3 - 30, y, { width: 175, align: 'right' });
    y += 17;
    indexLigne += 1;
  }

  ligne('Salaire de base', bulletin.base_salary);
  (bulletin.bonuses_detail || []).forEach((b) => ligne(`Prime — ${b.label}`, b.amount, { indent: true }));
  y += 4;
  traitSeparateur(doc, y);
  y += 10;
  ligne('Salaire brut', bulletin.gross_salary, { gras: true });
  y += 14;

  // --- Section RETENUES ---
  indexLigne = 0;
  y = dessinerEnteteTableau(doc, y, [
    { texte: 'Retenues salariales', x: xGauche, largeur: 300 },
    { texte: 'Montant (FCFA)', x: xColonne3 - 30, largeur: 175, aligner: 'right' },
  ]);

  ligne('IPRES (retraite)', bulletin.ipres_salarial);
  if (Number(bulletin.css_salarial) > 0) ligne('CSS', bulletin.css_salarial);
  ligne('Revenu imposable', bulletin.revenu_imposable);
  ligne('Impôt sur le revenu (IRPP)', bulletin.irpp);
  ligne('TRIMF', bulletin.trimf);
  y += 10;

  // --- Encart NET À PAYER, mis en évidence ---
  const hauteurNet = 40;
  doc.roundedRect(xGauche, y, xDroite - xGauche, hauteurNet, 6).fill(COULEURS.encre);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12.5)
    .text('NET À PAYER', xGauche + 16, y + 13);
  doc.fontSize(14).text(`${formatMontant(bulletin.net_a_payer)} FCFA`, xGauche, y + 11, { width: xDroite - xGauche - 16, align: 'right' });
  y += hauteurNet + 24;

  // --- Charges patronales, informatif, distinct visuellement ---
  doc.fillColor(COULEURS.muted).font('Helvetica-Bold').fontSize(8)
    .text('CHARGES PATRONALES (INFORMATIF — NON DÉDUITES DU NET)', xGauche, y, { characterSpacing: 0.5 });
  y += 14;
  const charges = [
    ['IPRES patronal', bulletin.ipres_patronal],
    ['CSS patronal', bulletin.css_patronal],
    ['CFCE', bulletin.cfce],
    ['Coût total employeur', bulletin.cout_total_employeur],
  ];
  const largeurCase = (xDroite - xGauche) / charges.length;
  charges.forEach(([label, montant], i) => {
    const x = xGauche + i * largeurCase;
    doc.fillColor(COULEURS.mutedClair).font('Helvetica').fontSize(7.5).text(label.toUpperCase(), x, y, { width: largeurCase - 8, characterSpacing: 0.3 });
    doc.fillColor(COULEURS.muted).font('Helvetica-Bold').fontSize(10).text(`${formatMontant(montant)} FCFA`, x, y + 11, { width: largeurCase - 8 });
  });

  dessinerPiedDePage(doc, merchant);
}

function libelleRole(role) {
  const LABELS = { gerant: 'Gérant', vendeur: 'Vendeur', caissier: 'Caissier', vendeur_caissier: 'Vendeur / Caissier', manager: 'Manager' };
  return LABELS[role] || role;
}

module.exports = router;
