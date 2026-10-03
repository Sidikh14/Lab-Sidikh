const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireOwnerModule } = require('../middleware/ownerModules');
const { logActivity } = require('../utils/activityLog');
const { broadcast } = require('../utils/eventsBus');
const { calculerBulletin } = require('../utils/payrollCalc');
const {
  LABEL_TYPE_RETENUE,
  RetenueError,
  normaliserRetenues,
  verifierAbsences,
  appliquerRetenues,
} = require('../utils/payrollDeductions');
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
// Module Paie : activé par l'owner commerçant par commerçant.
router.use(requireOwnerModule('paie'));

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

// Quand l'employé consulte SON PROPRE bulletin (quel que soit son rôle,
// caissier/vendeur/manager…), il ne peut le tirer que si le mois est marqué
// payé. Un manager/gérant qui consulte le bulletin d'un AUTRE employé n'est
// pas soumis à cette règle (il doit pouvoir le prévisualiser avant paiement).
async function moisEstPaye(userId, month) {
  const { rows } = await pool.query(
    'SELECT 1 FROM salary_payments WHERE user_id = $1 AND month = $2',
    [userId, month]
  );
  return rows.length > 0;
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

// GET /payroll/:userId/deductions?month=YYYY-MM — retenues saisies pour le mois
router.get('/:userId/deductions', requireRole('manager'), async (req, res) => {
  try {
    const month = req.query.month || moisActuel();
    const { rows } = await pool.query(
      `SELECT sd.id, sd.type, sd.label, sd.amount
       FROM salary_deductions sd
       JOIN users u ON u.id = sd.user_id
       WHERE sd.user_id = $1 AND sd.month = $2 AND u.merchant_id = $3
       ORDER BY sd.created_at`,
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
    const { month, bonuses, deductions } = req.body;
    const targetMonth = month || moisActuel();

    const employe = await client.query(
      `SELECT u.id, u.full_name, es.monthly_salary, es.parts_fiscales, es.ipres_enabled, es.css_enabled
       FROM users u
       LEFT JOIN employee_salaries es ON es.user_id = u.id
       WHERE u.id = $1 AND u.merchant_id = $2`,
      [userId, req.user.merchantId]
    );
    if (employe.rows.length === 0) return res.status(404).json({ error: 'Employé introuvable.' });
    if (!employe.rows[0].monthly_salary) {
      return res.status(400).json({ error: "Configurez d'abord le salaire de base de cet employé." });
    }

    const reglagesMarchand = await recupererOuCreerReglages(req.user.merchantId);
    // Les parts IPRES et CSS ne s'appliquent que si elles sont activées sur la fiche du salarié :
    // sinon leurs taux sont mis à zéro pour ce bulletin (salarial comme patronal).
    const reglages = { ...reglagesMarchand };
    if (employe.rows[0].ipres_enabled !== true) {
      reglages.ipres_taux_salarial = 0;
      reglages.ipres_taux_patronal = 0;
    }
    if (employe.rows[0].css_enabled !== true) {
      reglages.css_taux_salarial = 0;
      reglages.css_taux_patronal = 0;
    }
    const listeBonus = Array.isArray(bonuses)
      ? bonuses.filter((b) => b.label && Number(b.amount)).map((b) => ({ label: String(b.label).slice(0, 120), amount: Number(b.amount) }))
      : [];

    // Retenues manuelles : les absences réduisent le brut (donc cotisations et
    // impôt) ; avances/prêts/autres sont déduits du net, après impôts.
    const retenues = normaliserRetenues(deductions);
    const salaireBase = Number(employe.rows[0].monthly_salary);
    let resultat;
    try {
      const absences = verifierAbsences(salaireBase, retenues);
      const calcule = calculerBulletin({
        baseSalary: salaireBase - absences,
        bonuses: listeBonus,
        settings: reglages,
        partsFiscales: employe.rows[0].parts_fiscales,
      });
      resultat = appliquerRetenues(calcule, salaireBase, retenues);
    } catch (err) {
      if (err instanceof RetenueError) return res.status(400).json({ error: err.message });
      throw err;
    }

    await client.query('BEGIN');

    await client.query('DELETE FROM salary_bonuses WHERE user_id = $1 AND month = $2', [userId, targetMonth]);
    for (const b of listeBonus) {
      await client.query(
        `INSERT INTO salary_bonuses (user_id, month, label, amount) VALUES ($1, $2, $3, $4)`,
        [userId, targetMonth, b.label, b.amount]
      );
    }

    await client.query('DELETE FROM salary_deductions WHERE user_id = $1 AND month = $2', [userId, targetMonth]);
    for (const d of retenues) {
      await client.query(
        `INSERT INTO salary_deductions (user_id, month, type, label, amount) VALUES ($1, $2, $3, $4, $5)`,
        [userId, targetMonth, d.type, d.label, d.amount]
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
        ...colonnes.map((c) => (['bonuses_detail', 'deductions_detail'].includes(c) ? JSON.stringify(resultat[c]) : resultat[c])),
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

// GET /payroll/mine — liste des bulletins de l'utilisateur connecté, limitée
// aux mois marqués payés (le bulletin peut exister avant le paiement, mais
// l'employé ne doit pouvoir le tirer qu'une fois payé).
router.get('/mine', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.month, p.gross_salary, p.net_a_payer, p.generated_at
       FROM payslips p
       JOIN salary_payments sp ON sp.user_id = p.user_id AND sp.month = p.month
       WHERE p.user_id = $1
       ORDER BY p.month DESC`,
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
  if (req.user.id === req.params.userId && !(await moisEstPaye(req.params.userId, req.params.month))) {
    return res.status(403).json({ error: "Ce mois n'est pas encore marqué payé." });
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
  if (req.user.id === req.params.userId && !(await moisEstPaye(req.params.userId, req.params.month))) {
    return res.status(403).json({ error: "Ce mois n'est pas encore marqué payé." });
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
// visuelle que les autres documents : noir et blanc, textes en gras).
//
// Lecture du bulletin, de haut en bas :
//   GAINS      salaire de base + primes            = salaire brut
//   RETENUES   absences, cotisations, impôts, avances/prêts/autres
//   NET        salaire brut - total des retenues
// Les absences sont présentées parmi les retenues (c'est une retenue pour le
// salarié) ; en interne elles réduisent bien l'assiette des cotisations et de
// l'impôt, ce que rappelle la ligne « Revenu imposable » sous le tableau.
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
  const largeurUtile = xDroite - xGauche;
  const HAUTEUR_LIGNE = 20;
  const xMontant = xDroite - 190;

  let y = dessinerEntete(doc, {
    businessName: bulletin.business_name,
    titre: 'Bulletin de paie',
    sousTitre: nomMois(bulletin.month),
    merchant,
  });

  // --- Bloc identité du salarié, encadré ---
  const hauteurBloc = 50;
  doc.rect(xGauche, y, largeurUtile, hauteurBloc).lineWidth(1.25).strokeColor(COULEURS.encre).stroke();
  const colonnes = [
    { x: xGauche + 14, titre: 'SALARIÉ', valeur: bulletin.full_name, taille: 12.5 },
    { x: xGauche + largeurUtile * 0.5, titre: 'POSTE', valeur: libelleRole(bulletin.role), taille: 11 },
    { x: xGauche + largeurUtile * 0.78, titre: 'PARTS FISCALES', valeur: String(Number(bulletin.parts_fiscales) || 1), taille: 11 },
  ];
  colonnes.forEach((c) => {
    doc.fillColor(COULEURS.mutedClair).font('Helvetica-Bold').fontSize(7.5).text(c.titre, c.x, y + 10, { characterSpacing: 0.8, lineBreak: false });
    doc.fillColor(COULEURS.encre).font('Helvetica-Bold').fontSize(c.taille).text(c.valeur, c.x, y + 24, { width: largeurUtile * 0.42, lineBreak: false, ellipsis: true });
  });
  y += hauteurBloc + 22;

  let indexLigne = 0;
  function ligne(label, montant, { gras = false, indent = false, negatif = false } = {}) {
    if (indexLigne % 2 === 1) doc.rect(xGauche, y - 4, largeurUtile, HAUTEUR_LIGNE).fill(COULEURS.fondAlterne);
    doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5).fillColor(COULEURS.encre);
    doc.text(label, xGauche + 8 + (indent ? 14 : 0), y, { width: xMontant - xGauche - 20, lineBreak: false, ellipsis: true });
    doc.text(`${negatif ? '- ' : ''}${formatMontant(montant)}`, xMontant, y, { width: 182, align: 'right', lineBreak: false });
    y += HAUTEUR_LIGNE;
    indexLigne += 1;
  }

  function totalLigne(label, montant) {
    y += 2;
    doc.moveTo(xGauche, y).lineTo(xDroite, y).strokeColor(COULEURS.encre).lineWidth(1.25).stroke();
    y += 8;
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(COULEURS.encre);
    doc.text(label, xGauche + 8, y, { width: xMontant - xGauche - 20, lineBreak: false });
    doc.text(formatMontant(montant), xMontant, y, { width: 182, align: 'right', lineBreak: false });
    y += HAUTEUR_LIGNE + 6;
  }

  const retenuesDetail = Array.isArray(bulletin.deductions_detail) ? bulletin.deductions_detail : [];
  const absencesDetail = retenuesDetail.filter((d) => d.type === 'absence');
  const autresRetenues = retenuesDetail.filter((d) => d.type !== 'absence');
  const salaireBrut = Number(bulletin.base_salary) + Number(bulletin.bonuses_total || 0);

  // --- GAINS ---
  y = dessinerEnteteTableau(doc, y, [
    { texte: 'Gains', x: xGauche + 8, largeur: 300 },
    { texte: 'Montant (FCFA)', x: xMontant, largeur: 182, aligner: 'right' },
  ]);
  ligne('Salaire de base', bulletin.base_salary);
  (bulletin.bonuses_detail || []).forEach((b) => ligne(`Prime — ${b.label}`, b.amount, { indent: true }));
  totalLigne('SALAIRE BRUT', salaireBrut);
  y += 12;

  // --- RETENUES ---
  indexLigne = 0;
  y = dessinerEnteteTableau(doc, y, [
    { texte: 'Retenues', x: xGauche + 8, largeur: 300 },
    { texte: 'Montant (FCFA)', x: xMontant, largeur: 182, aligner: 'right' },
  ]);
  absencesDetail.forEach((d) => ligne(`Absence — ${d.label}`, d.amount, { negatif: true }));
  if (Number(bulletin.ipres_salarial) > 0) ligne('IPRES (retraite)', bulletin.ipres_salarial, { negatif: true });
  if (Number(bulletin.css_salarial) > 0) ligne('CSS', bulletin.css_salarial, { negatif: true });
  ligne('Impôt sur le revenu (IRPP)', bulletin.irpp, { negatif: true });
  ligne('TRIMF', bulletin.trimf, { negatif: true });
  // Avances, prêts et autres retenues : déduits du net, après impôts.
  autresRetenues.forEach((d) => {
    const prefixe = LABEL_TYPE_RETENUE[d.type] || 'Retenue';
    ligne(d.label && d.label !== prefixe ? `${prefixe} — ${d.label}` : prefixe, d.amount, { negatif: true });
  });
  totalLigne('TOTAL DES RETENUES', salaireBrut - Number(bulletin.net_a_payer));

  // Information de calcul : base de l'IRPP (brut moins absences et cotisations).
  doc.fillColor(COULEURS.mutedClair).font('Helvetica').fontSize(8.5)
    .text(`Revenu imposable (base de calcul de l'IRPP) : ${formatMontant(bulletin.revenu_imposable)} FCFA`, xGauche + 8, y - 6, { width: largeurUtile - 16, lineBreak: false });
  y += 18;

  // --- NET À PAYER : encadré épais, fond blanc ---
  const hauteurNet = 46;
  doc.roundedRect(xGauche, y, largeurUtile, hauteurNet, 4).lineWidth(3).strokeColor(COULEURS.encre).stroke();
  doc.fillColor(COULEURS.encre).font('Helvetica-Bold').fontSize(14)
    .text('NET À PAYER', xGauche + 18, y + 15, { lineBreak: false });
  doc.fontSize(17).text(`${formatMontant(bulletin.net_a_payer)} FCFA`, xGauche, y + 13, { width: largeurUtile - 18, align: 'right', lineBreak: false });
  y += hauteurNet + 26;

  // --- Charges patronales : informatif, séparé par un filet ---
  doc.moveTo(xGauche, y).lineTo(xDroite, y).strokeColor(COULEURS.bordure).lineWidth(1).stroke();
  y += 10;
  doc.fillColor(COULEURS.muted).font('Helvetica-Bold').fontSize(8)
    .text('CHARGES PATRONALES · INFORMATIF, NON DÉDUITES DU NET', xGauche, y, { characterSpacing: 0.6, lineBreak: false });
  y += 16;
  const charges = [
    ['IPRES patronal', bulletin.ipres_patronal],
    ['CSS patronal', bulletin.css_patronal],
    ['CFCE', bulletin.cfce],
    ['Coût total employeur', bulletin.cout_total_employeur],
  ].filter(([label, montant]) => !['IPRES patronal', 'CSS patronal'].includes(label) || Number(montant) > 0);
  const largeurCase = largeurUtile / charges.length;
  charges.forEach(([label, montant], i) => {
    const x = xGauche + i * largeurCase;
    doc.fillColor(COULEURS.mutedClair).font('Helvetica-Bold').fontSize(7.5).text(label.toUpperCase(), x, y, { width: largeurCase - 8, characterSpacing: 0.3, lineBreak: false });
    doc.fillColor(COULEURS.encre).font('Helvetica-Bold').fontSize(10.5).text(`${formatMontant(montant)} FCFA`, x, y + 13, { width: largeurCase - 8, lineBreak: false });
  });

  dessinerPiedDePage(doc, merchant);
}

function libelleRole(role) {
  const LABELS = { gerant: 'Gérant', vendeur: 'Vendeur', caissier: 'Caissier', vendeur_caissier: 'Vendeur / Caissier', manager: 'Manager' };
  return LABELS[role] || role;
}

module.exports = router;
