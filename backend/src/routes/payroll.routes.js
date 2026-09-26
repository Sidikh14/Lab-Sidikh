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
      `SELECT u.id, u.full_name, es.monthly_salary
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

  let y = dessinerEntete(doc, {
    businessName: bulletin.business_name,
    titre: 'Bulletin de paie',
    sousTitre: nomMois(bulletin.month),
    merchant,
  });

  doc.fontSize(10).fillColor(COULEURS.encre).font('Helvetica-Bold').text(bulletin.full_name, 50, y);
  doc.fontSize(9).fillColor(COULEURS.muted).font('Helvetica').text(bulletin.role, 50, y + 14);
  y += 40;

  y = dessinerEnteteTableau(doc, y, [
    { texte: 'Élément', x: 50, largeur: 300 },
    { texte: 'Montant (FCFA)', x: 400, largeur: 145, aligner: 'right' },
  ]);

  function ligne(label, montant, gras = false) {
    doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(COULEURS.encre);
    doc.text(label, 50, y, { width: 300 });
    doc.text(formatMontant(montant), 400, y, { width: 145, align: 'right' });
    y += 18;
  }

  ligne('Salaire de base', bulletin.base_salary);
  (bulletin.bonuses_detail || []).forEach((b) => ligne(`Prime — ${b.label}`, b.amount));
  ligne('Salaire brut', bulletin.gross_salary, true);
  y += 6;
  traitSeparateur(doc, y);
  y += 14;

  ligne('IPRES (retraite, part salariale)', -bulletin.ipres_salarial);
  if (Number(bulletin.css_salarial) > 0) ligne('CSS (part salariale)', -bulletin.css_salarial);
  ligne('Revenu imposable', bulletin.revenu_imposable);
  ligne('Impôt sur le revenu (IRPP)', -bulletin.irpp);
  ligne('TRIMF', -bulletin.trimf);
  y += 6;
  traitSeparateur(doc, y);
  y += 14;

  ligne('Net à payer', bulletin.net_a_payer, true);
  y += 30;

  doc.fontSize(8).fillColor(COULEURS.mutedClair).font('Helvetica').text(
    `Charges patronales (informatif, non déduites du net) — IPRES : ${formatMontant(bulletin.ipres_patronal)} FCFA · CSS : ${formatMontant(bulletin.css_patronal)} FCFA · CFCE : ${formatMontant(bulletin.cfce)} FCFA · Coût total employeur : ${formatMontant(bulletin.cout_total_employeur)} FCFA`,
    50, y, { width: doc.page.width - 100 }
  );

  dessinerPiedDePage(doc, merchant);
}

module.exports = router;
