const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole, aRole } = require('../middleware/roles');
const { requireOwnerModule } = require('../middleware/ownerModules');
const { logActivity } = require('../utils/activityLog');
const { broadcast } = require('../utils/eventsBus');
const {
  composerBulletin,
  rafraichirAvances,
  primesDuMois,
  retenuesManuellesDuMois,
  RetenueError,
} = require('../utils/payrollCompose');
const { formatMontant } = require('../utils/pdfHelpers');
const { genererBulletinPDF, bulletinEnBuffer, genererBulletinsGroupes, nomMois } = require('../utils/payslipPdf');
const { sendMailWithAttachments } = require('../utils/alertMailer');
const { envoyerEtat, sommer } = require('../utils/payrollReports');

const router = express.Router();
router.use(authenticate);
// Module Paie : activé par l'owner commerçant par commerçant.
router.use(requireOwnerModule('paie'));

const MOIS_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const GESTION = requireRole('manager', 'comptable');

function moisActuel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function erreur(statut, message) {
  return Object.assign(new Error(message), { statut });
}

function repondre(res, err, defaut = 'Erreur serveur') {
  if (err instanceof RetenueError) return res.status(400).json({ error: err.message });
  if (err.statut) return res.status(err.statut).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: defaut });
}

function verifierMois(mois) {
  if (!MOIS_RE.test(String(mois || ''))) throw erreur(400, 'Mois invalide (AAAA-MM).');
}

// Un compte connecté qui consulte « son » bulletin est reconnu par son id d'utilisateur : on le
// traduit en id d'employé (identique pour les comptes repris, différent pour une fiche liée ensuite).
async function idEmploye(req, parametre) {
  if (parametre === req.user.id || parametre === 'me') {
    const { rows } = await pool.query('SELECT id FROM employees WHERE user_id = $1', [req.user.id]);
    if (rows.length > 0) return rows[0].id;
  }
  return parametre;
}

async function estMonBulletin(req, empId) {
  const { rows } = await pool.query('SELECT 1 FROM employees WHERE id = $1 AND user_id = $2', [empId, req.user.id]);
  return rows.length > 0;
}

async function peutConsulter(req, empId) {
  return aRole(req.user, 'manager', 'gerant', 'comptable') || (await estMonBulletin(req, empId));
}

// Un employé qui consulte SON bulletin ne peut le tirer que si le mois est marqué payé.
async function moisEstPaye(empId, month) {
  const { rows } = await pool.query('SELECT 1 FROM salary_payments WHERE user_id = $1 AND month = $2', [empId, month]);
  return rows.length > 0;
}

async function recupererOuCreerReglages(merchantId, db = pool) {
  const existant = await db.query('SELECT * FROM payroll_settings WHERE merchant_id = $1', [merchantId]);
  if (existant.rows.length > 0) return existant.rows[0];
  const cree = await db.query('INSERT INTO payroll_settings (merchant_id) VALUES ($1) RETURNING *', [merchantId]);
  return cree.rows[0];
}

// Employés actifs, avec salaire configuré, en poste (même partiellement) sur le mois $2.
const SQL_EMPLOYES_DU_MOIS = `
  FROM employees e
  JOIN employee_salaries es ON es.user_id = e.id
  WHERE e.merchant_id = $1 AND e.status = 'actif'
    AND (e.hire_date IS NULL OR e.hire_date <= (to_date($2 || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date)
    AND (e.end_date IS NULL OR e.end_date >= to_date($2 || '-01', 'YYYY-MM-DD'))`;

const COLONNES_EMPLOYE = `e.id, e.full_name, e.email, e.user_id, e.hire_date, e.end_date,
  es.monthly_salary, es.parts_fiscales, es.ipres_enabled, es.css_enabled, es.recurring_bonuses, es.payment_method`;

// ---------------------------------------------------------------------------
// Réglages fiscaux/sociaux (manager et comptable)
// ---------------------------------------------------------------------------

router.get('/settings', GESTION, async (req, res) => {
  try {
    res.json(await recupererOuCreerReglages(req.user.merchantId));
  } catch (err) {
    repondre(res, err);
  }
});

const CHAMPS_REGLAGES = [
  'abattement_taux', 'abattement_plafond_annuel',
  'ipres_taux_salarial', 'ipres_taux_patronal', 'ipres_plafond_mensuel',
  'css_taux_salarial', 'css_taux_patronal', 'css_plafond_mensuel',
  'cfce_taux', 'bareme_irpp', 'trimf_bareme',
  'working_days_base', 'hours_per_day', 'overtime_rates', 'employer_ipres_number', 'employer_css_number',
];
const CHAMPS_JSON = ['bareme_irpp', 'trimf_bareme', 'overtime_rates'];

function validerReglagesPeriode(body) {
  if (body.working_days_base !== undefined) {
    const n = Number(body.working_days_base);
    if (!Number.isInteger(n) || n < 20 || n > 31) throw erreur(400, 'La base de jours doit être un entier entre 20 et 31.');
  }
  if (body.hours_per_day !== undefined) {
    const n = Number(body.hours_per_day);
    if (!(n > 0 && n <= 24)) throw erreur(400, "Le nombre d'heures par jour doit être compris entre 0 et 24.");
  }
  if (body.overtime_rates !== undefined) {
    if (!Array.isArray(body.overtime_rates)) throw erreur(400, 'Les majorations doivent être une liste.');
    const codes = new Set();
    body.overtime_rates = body.overtime_rates.map((t) => {
      const code = String((t && t.code) || '').trim().slice(0, 40);
      const rate = Number(t && t.rate);
      if (!code || !(rate > 0 && rate <= 5)) throw erreur(400, 'Chaque majoration a un code et un coefficient (par exemple 1,15 pour +15 %).');
      if (codes.has(code)) throw erreur(400, `La majoration « ${code} » est en double.`);
      codes.add(code);
      return { code, label: String((t && t.label) || code).trim().slice(0, 80), rate };
    });
  }
}

router.put('/settings', GESTION, async (req, res) => {
  try {
    await recupererOuCreerReglages(req.user.merchantId); // garantit qu'une ligne existe déjà
    validerReglagesPeriode(req.body);

    const colonnes = [];
    const valeurs = [];
    CHAMPS_REGLAGES.forEach((champ) => {
      if (req.body[champ] !== undefined) {
        colonnes.push(champ);
        valeurs.push(CHAMPS_JSON.includes(champ) ? JSON.stringify(req.body[champ]) : req.body[champ]);
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
    repondre(res, err);
  }
});

// ---------------------------------------------------------------------------
// Écriture d'un bulletin (utilisée par la génération simple, en masse et le rectificatif)
// ---------------------------------------------------------------------------

async function bulletinCourant(client, empId, mois) {
  const { rows } = await client.query(
    `SELECT id, version, number FROM payslips WHERE user_id = $1 AND month = $2 AND status <> 'remplace' ORDER BY version DESC LIMIT 1`,
    [empId, mois]
  );
  return rows[0] || null;
}

async function prochainNumero(client, merchantId, mois) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payslip:${merchantId}:${mois}`]);
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(substring(number from '^BUL-[0-9]{4}-[0-9]{2}-([0-9]+)$')::int), 0) + 1 AS n
     FROM payslips WHERE merchant_id = $1 AND month = $2`,
    [merchantId, mois]
  );
  return `BUL-${mois}-${String(rows[0].n).padStart(3, '0')}`;
}

// À appeler dans une transaction. rectifier = null (génération) ou { raison } (nouvelle version).
async function ecrireBulletin(client, { req, employe, mois, bonuses, deductions, rectifier = null }) {
  const paye = await client.query('SELECT 1 FROM salary_payments WHERE user_id = $1 AND month = $2', [employe.id, mois]);
  if (paye.rows.length > 0) {
    throw erreur(409, 'Ce mois est déjà payé pour cet employé : le bulletin est verrouillé.');
  }
  const courant = await bulletinCourant(client, employe.id, mois);
  if (rectifier && !courant) throw erreur(404, 'Aucun bulletin à rectifier pour ce mois : générez-le d\'abord.');

  const reglagesMarchand = await recupererOuCreerReglages(req.user.merchantId, client);
  const { resultat, retenues, listeBonus, utilisationsAvances } = await composerBulletin({
    db: client, employe, mois, reglagesMarchand, bonuses, deductions,
  });

  await client.query('DELETE FROM salary_bonuses WHERE user_id = $1 AND month = $2', [employe.id, mois]);
  for (const b of listeBonus) {
    await client.query('INSERT INTO salary_bonuses (user_id, month, label, amount) VALUES ($1, $2, $3, $4)', [employe.id, mois, b.label, b.amount]);
  }
  await client.query('DELETE FROM salary_deductions WHERE user_id = $1 AND month = $2', [employe.id, mois]);
  for (const d of retenues) {
    await client.query(
      'INSERT INTO salary_deductions (user_id, month, type, label, amount, source) VALUES ($1, $2, $3, $4, $5, $6)',
      [employe.id, mois, d.type, d.label, d.amount, d.source || 'manuel']
    );
  }

  const colonnes = Object.keys(resultat);
  const valeurs = colonnes.map((c) => (['bonuses_detail', 'deductions_detail'].includes(c) ? JSON.stringify(resultat[c]) : resultat[c]));
  let payslipId;
  let numero;
  let version;

  if (rectifier) {
    version = courant.version + 1;
    numero = `${String(courant.number).replace(/-R\d+$/, '')}-R${version - 1}`;
    const placeholders = colonnes.map((_, i) => `$${i + 10}`).join(', ');
    const cree = await client.query(
      `INSERT INTO payslips (merchant_id, user_id, month, generated_by, number, version, rectifies_id, rectify_reason, status, ${colonnes.join(', ')})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'emis', ${placeholders}) RETURNING id`,
      [req.user.merchantId, employe.id, mois, req.user.id, numero, version, courant.id, rectifier.raison || null, ...valeurs]
    );
    payslipId = cree.rows[0].id;
    await client.query(`UPDATE payslips SET status = 'remplace' WHERE id = $1`, [courant.id]);
    await client.query('DELETE FROM employee_advance_repayments WHERE payslip_id = $1', [courant.id]);
  } else if (courant) {
    payslipId = courant.id;
    numero = courant.number;
    version = courant.version;
    const affectations = colonnes.map((c, i) => `${c} = $${i + 3}`).join(', ');
    await client.query(
      `UPDATE payslips SET ${affectations}, generated_by = $2, generated_at = now() WHERE id = $1`,
      [courant.id, req.user.id, ...valeurs]
    );
    await client.query('DELETE FROM employee_advance_repayments WHERE payslip_id = $1', [courant.id]);
  } else {
    version = 1;
    numero = await prochainNumero(client, req.user.merchantId, mois);
    const placeholders = colonnes.map((_, i) => `$${i + 7}`).join(', ');
    const cree = await client.query(
      `INSERT INTO payslips (merchant_id, user_id, month, generated_by, number, version, ${colonnes.join(', ')})
       VALUES ($1, $2, $3, $4, $5, $6, ${placeholders}) RETURNING id`,
      [req.user.merchantId, employe.id, mois, req.user.id, numero, version, ...valeurs]
    );
    payslipId = cree.rows[0].id;
  }

  for (const u of utilisationsAvances) {
    await client.query(
      'INSERT INTO employee_advance_repayments (advance_id, payslip_id, month, amount) VALUES ($1, $2, $3, $4)',
      [u.advance_id, payslipId, mois, u.amount]
    );
  }
  await rafraichirAvances(client, employe.id);

  return { resultat, payslipId, number: numero, version };
}

async function chargerEmploye(db, merchantId, empId) {
  const { rows } = await db.query(
    `SELECT ${COLONNES_EMPLOYE} FROM employees e LEFT JOIN employee_salaries es ON es.user_id = e.id
     WHERE e.id = $1 AND e.merchant_id = $2`,
    [empId, merchantId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Routes fixes (déclarées avant /:userId/... pour ne pas être prises pour un employé)
// ---------------------------------------------------------------------------

// GET /payroll/mine — bulletins de l'utilisateur connecté, limités aux mois payés.
router.get('/mine', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.month, p.number, p.gross_salary, p.net_a_payer, p.generated_at
       FROM payslips p
       JOIN employees e ON e.id = p.user_id
       JOIN salary_payments sp ON sp.user_id = p.user_id AND sp.month = p.month
       WHERE e.user_id = $1 AND p.status <> 'remplace'
       ORDER BY p.month DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    repondre(res, err);
  }
});

// GET /payroll/preview-month?month= — aperçu de la masse salariale du mois (rien n'est enregistré).
router.get('/preview-month', GESTION, async (req, res) => {
  try {
    const mois = req.query.month || moisActuel();
    verifierMois(mois);
    const reglagesMarchand = await recupererOuCreerReglages(req.user.merchantId);
    const { rows: employes } = await pool.query(
      `SELECT ${COLONNES_EMPLOYE} ${SQL_EMPLOYES_DU_MOIS} ORDER BY e.full_name`,
      [req.user.merchantId, mois]
    );
    const lignes = [];
    for (const e of employes) {
      const paye = await pool.query('SELECT 1 FROM salary_payments WHERE user_id = $1 AND month = $2', [e.id, mois]);
      const stocke = await pool.query(
        `SELECT gross_salary, net_a_payer, ipres_patronal, css_patronal, cfce, cout_total_employeur, number
         FROM payslips WHERE user_id = $1 AND month = $2 AND status <> 'remplace' ORDER BY version DESC LIMIT 1`,
        [e.id, mois]
      );
      const ligne = { id: e.id, name: e.full_name, paid: paye.rows.length > 0, hasPayslip: stocke.rows.length > 0, number: stocke.rows[0]?.number || null };
      try {
        if (ligne.paid && stocke.rows.length > 0) {
          Object.assign(ligne, {
            gross: Number(stocke.rows[0].gross_salary), net: Number(stocke.rows[0].net_a_payer),
            employerCost: Number(stocke.rows[0].cout_total_employeur),
          });
        } else {
          const primes = await primesDuMois(pool, e.id, mois, e.recurring_bonuses);
          const manuelles = await retenuesManuellesDuMois(pool, e.id, mois);
          const { resultat } = await composerBulletin({ db: pool, employe: e, mois, reglagesMarchand, bonuses: primes, deductions: manuelles });
          Object.assign(ligne, { gross: resultat.gross_salary, net: resultat.net_a_payer, employerCost: resultat.cout_total_employeur });
        }
      } catch (err) {
        if (!(err instanceof RetenueError)) throw err;
        ligne.error = err.message;
      }
      lignes.push(ligne);
    }
    const totaux = lignes.reduce(
      (t, l) => ({ gross: t.gross + (l.gross || 0), net: t.net + (l.net || 0), employerCost: t.employerCost + (l.employerCost || 0) }),
      { gross: 0, net: 0, employerCost: 0 }
    );
    res.json({ month: mois, employees: lignes, totals: totaux });
  } catch (err) {
    repondre(res, err);
  }
});

// POST /payroll/generate-all { month, regenerate? } — génère les bulletins du mois pour tous les employés.
// Les mois déjà payés sont ignorés ; sans `regenerate`, les bulletins déjà générés ne sont pas recalculés.
router.post('/generate-all', GESTION, async (req, res) => {
  const client = await pool.connect();
  try {
    const mois = req.body.month || moisActuel();
    verifierMois(mois);
    const regenerer = req.body.regenerate === true;
    const { rows: employes } = await client.query(
      `SELECT ${COLONNES_EMPLOYE} ${SQL_EMPLOYES_DU_MOIS} ORDER BY e.full_name`,
      [req.user.merchantId, mois]
    );
    const generes = [];
    const ignores = [];
    const erreurs = [];
    for (const e of employes) {
      try {
        const existe = await bulletinCourant(client, e.id, mois);
        if (existe && !regenerer) {
          ignores.push({ id: e.id, name: e.full_name, reason: 'Bulletin déjà généré' });
          continue;
        }
        await client.query('BEGIN');
        const primes = await primesDuMois(client, e.id, mois, e.recurring_bonuses);
        const manuelles = await retenuesManuellesDuMois(client, e.id, mois);
        const r = await ecrireBulletin(client, { req, employe: e, mois, bonuses: primes, deductions: manuelles });
        await client.query('COMMIT');
        generes.push({ id: e.id, name: e.full_name, number: r.number, net: r.resultat.net_a_payer });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.statut === 409) ignores.push({ id: e.id, name: e.full_name, reason: 'Mois déjà payé' });
        else if (err instanceof RetenueError || err.statut) erreurs.push({ id: e.id, name: e.full_name, error: err.message });
        else {
          console.error(err);
          erreurs.push({ id: e.id, name: e.full_name, error: 'Erreur serveur' });
        }
      }
    }
    if (generes.length > 0) {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'payslips_generated',
        description: `a généré ${generes.length} bulletin(s) de paie pour ${mois}`,
      });
      broadcast(req.user.merchantId, 'activity:created', {});
    }
    res.json({ month: mois, generated: generes, skipped: ignores, errors: erreurs });
  } catch (err) {
    repondre(res, err);
  } finally {
    client.release();
  }
});

// Bulletins courants et payés d'un mois, avec le nécessaire pour le PDF.
async function bulletinsPayesDuMois(merchantId, mois, empIds) {
  const { rows } = await pool.query(
    `SELECT p.*, e.full_name, e.email, e.user_id AS compte_id, COALESCE(e.job_title, u.role) AS role,
            m.business_name, m.ninea, m.rccm, m.address, m.bank_details, m.mobile_money_details, m.payment_terms
     FROM payslips p
     JOIN employees e ON e.id = p.user_id
     LEFT JOIN users u ON u.id = e.user_id
     JOIN merchants m ON m.id = p.merchant_id
     JOIN salary_payments sp ON sp.user_id = p.user_id AND sp.month = p.month
     WHERE p.merchant_id = $1 AND p.month = $2 AND p.status <> 'remplace'
       AND ($3::uuid[] IS NULL OR p.user_id = ANY($3::uuid[]))
     ORDER BY e.full_name`,
    [merchantId, mois, Array.isArray(empIds) && empIds.length > 0 ? empIds : null]
  );
  return rows;
}

// POST /payroll/send { month, employeeIds? } — e-mail avec le PDF pour les fiches renseignées d'une adresse.
// Les autres : « compte » (téléchargement par l'employé) ou « à imprimer » (voir /payroll/print).
router.post('/send', GESTION, async (req, res) => {
  try {
    const mois = req.body.month || moisActuel();
    verifierMois(mois);
    const bulletins = await bulletinsPayesDuMois(req.user.merchantId, mois, req.body.employeeIds);
    const envoyes = [];
    const aImprimer = [];
    const comptes = [];
    const erreurs = [];
    for (const b of bulletins) {
      const adresse = String(b.email || '').trim();
      if (adresse) {
        try {
          const pdf = await bulletinEnBuffer(b);
          await sendMailWithAttachments({
            to: adresse,
            subject: `Votre bulletin de paie — ${nomMois(mois)}`,
            text: `Bonjour ${b.full_name},\n\nVeuillez trouver ci-joint votre bulletin de paie de ${nomMois(mois)} (n° ${b.number}).\n\n${b.business_name || ''}`,
            attachments: [{ filename: `bulletin-${b.number}.pdf`, content: pdf, contentType: 'application/pdf' }],
          });
          await pool.query('UPDATE payslips SET sent_at = now(), sent_to = $2 WHERE id = $1', [b.id, adresse]);
          envoyes.push({ id: b.user_id, name: b.full_name, to: adresse });
        } catch (err) {
          console.error(err);
          erreurs.push({ id: b.user_id, name: b.full_name, error: err.message || "Échec de l'envoi" });
        }
      } else if (b.compte_id) {
        comptes.push({ id: b.user_id, name: b.full_name });
      } else {
        aImprimer.push({ id: b.user_id, name: b.full_name });
      }
    }
    if (envoyes.length > 0) {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'payslips_sent',
        description: `a envoyé ${envoyes.length} bulletin(s) de paie par e-mail (${mois})`,
      });
    }
    res.json({ month: mois, sent: envoyes, toPrint: aImprimer, accounts: comptes, errors: erreurs });
  } catch (err) {
    repondre(res, err);
  }
});

// GET /payroll/print?month=&includeAccounts=1 — un seul PDF avec les bulletins des employés sans e-mail.
router.get('/print', GESTION, async (req, res) => {
  try {
    const mois = req.query.month || moisActuel();
    verifierMois(mois);
    const inclureComptes = req.query.includeAccounts === '1';
    const tous = await bulletinsPayesDuMois(req.user.merchantId, mois, null);
    const choisis = tous.filter((b) => !String(b.email || '').trim() && (inclureComptes || !b.compte_id));
    if (choisis.length === 0) return res.status(404).json({ error: 'Aucun bulletin à imprimer pour ce mois.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="bulletins-${mois}.pdf"`);
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);
    genererBulletinsGroupes(doc, choisis);
    doc.end();
  } catch (err) {
    if (!res.headersSent) repondre(res, err);
  }
});

// GET /payroll/alerts — rappels de paie (bulletin non généré, avances en cours, fin de CDD).
router.get('/alerts', GESTION, async (req, res) => {
  try {
    const merchantId = req.user.merchantId;
    const jour = new Date().getDate();
    const mois = moisActuel();
    const items = [];

    // Bulletins manquants : à partir du 20 du mois en cours (paie en fin de mois).
    if (jour >= 20) {
      const manquants = await pool.query(
        `SELECT e.id, e.full_name ${SQL_EMPLOYES_DU_MOIS}
           AND NOT EXISTS (SELECT 1 FROM payslips p WHERE p.user_id = e.id AND p.month = $2 AND p.status <> 'remplace')
         ORDER BY e.full_name`,
        [merchantId, mois]
      );
      if (manquants.rows.length > 0) {
        items.push({
          type: 'bulletin_manquant', severity: 'warning', month: mois, count: manquants.rows.length,
          message: `${manquants.rows.length} bulletin(s) de ${nomMois(mois)} pas encore généré(s).`,
          employees: manquants.rows.map((r) => ({ id: r.id, name: r.full_name })),
        });
      }
    }

    const avances = await pool.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(a.balance), 0) AS reste
       FROM employee_advances a JOIN employees e ON e.id = a.employee_id
       WHERE a.merchant_id = $1 AND a.status = 'en_cours' AND e.status = 'actif'`,
      [merchantId]
    );
    if (Number(avances.rows[0].n) > 0) {
      items.push({
        type: 'avance_en_cours', severity: 'info', count: Number(avances.rows[0].n), amount: Number(avances.rows[0].reste),
        message: `${avances.rows[0].n} avance(s) ou prêt(s) en cours de remboursement (reste ${formatMontant(avances.rows[0].reste)} FCFA).`,
      });
    }

    const cdd = await pool.query(
      `SELECT id, full_name, to_char(end_date, 'YYYY-MM-DD') AS fin
       FROM employees
       WHERE merchant_id = $1 AND status = 'actif' AND contract_type = 'cdd' AND end_date IS NOT NULL
         AND end_date <= CURRENT_DATE + 30
       ORDER BY end_date`,
      [merchantId]
    );
    cdd.rows.forEach((r) => {
      const depasse = r.fin < new Date().toISOString().slice(0, 10);
      items.push({
        type: 'fin_cdd', severity: depasse ? 'danger' : 'warning', employeeId: r.id, date: r.fin,
        message: depasse ? `Le CDD de ${r.full_name} est arrivé à échéance le ${r.fin}.` : `Le CDD de ${r.full_name} se termine le ${r.fin}.`,
      });
    });

    res.json({ items });
  } catch (err) {
    repondre(res, err);
  }
});

// ---------------------------------------------------------------------------
// États de paie : livre de paie, cotisations, récapitulatif annuel, masse salariale
// format = json (défaut) | pdf | csv
// ---------------------------------------------------------------------------

async function nomEntreprise(merchantId) {
  const { rows } = await pool.query('SELECT business_name FROM merchants WHERE id = $1', [merchantId]);
  return rows[0]?.business_name || '';
}

router.get('/reports/livre', GESTION, async (req, res) => {
  try {
    const mois = req.query.month || moisActuel();
    verifierMois(mois);
    const { rows } = await pool.query(
      `SELECT p.number, e.full_name AS nom, p.base_salary, (p.bonuses_total - p.overtime_total) AS primes, p.overtime_total,
              p.absences_total, p.gross_salary, p.ipres_salarial, p.css_salarial, p.irpp, p.trimf, p.deductions_total,
              p.net_a_payer, (p.ipres_patronal + p.css_patronal) AS patronal, p.cfce, p.cout_total_employeur
       FROM payslips p JOIN employees e ON e.id = p.user_id
       WHERE p.merchant_id = $1 AND p.month = $2 AND p.status <> 'remplace' ORDER BY e.full_name`,
      [req.user.merchantId, mois]
    );
    const cles = ['base_salary', 'primes', 'overtime_total', 'absences_total', 'gross_salary', 'ipres_salarial', 'css_salarial', 'irpp', 'trimf', 'deductions_total', 'net_a_payer', 'patronal', 'cfce', 'cout_total_employeur'];
    envoyerEtat(res, req.query.format, {
      titre: `Livre de paie — ${nomMois(mois)}`, sousTitre: `${rows.length} bulletin(s)`, entreprise: await nomEntreprise(req.user.merchantId),
      nomFichier: `livre-de-paie-${mois}`,
      colonnes: [
        { key: 'number', label: 'N°', width: 1.6 }, { key: 'nom', label: 'Employé', width: 2.2 },
        { key: 'base_salary', label: 'Base', money: true }, { key: 'primes', label: 'Primes', money: true },
        { key: 'overtime_total', label: 'Heures sup', money: true }, { key: 'absences_total', label: 'Absences', money: true },
        { key: 'gross_salary', label: 'Brut', money: true }, { key: 'ipres_salarial', label: 'IPRES sal.', money: true },
        { key: 'css_salarial', label: 'CSS sal.', money: true }, { key: 'irpp', label: 'IRPP', money: true },
        { key: 'trimf', label: 'TRIMF', money: true }, { key: 'deductions_total', label: 'Retenues', money: true },
        { key: 'net_a_payer', label: 'Net à payer', money: true }, { key: 'patronal', label: 'Charges patron.', money: true },
        { key: 'cfce', label: 'CFCE', money: true }, { key: 'cout_total_employeur', label: 'Coût employeur', money: true },
      ],
      lignes: rows, totaux: { nom: 'TOTAL', ...sommer(rows, cles) },
    });
  } catch (err) {
    repondre(res, err);
  }
});

router.get('/reports/cotisations', GESTION, async (req, res) => {
  try {
    const mois = req.query.month || moisActuel();
    verifierMois(mois);
    const reglages = await recupererOuCreerReglages(req.user.merchantId);
    const { rows } = await pool.query(
      `SELECT e.full_name AS nom, e.ipres_number, e.css_number, p.gross_salary, p.ipres_salarial, p.ipres_patronal,
              p.css_salarial, p.css_patronal, (p.ipres_salarial + p.ipres_patronal) AS ipres_total, (p.css_salarial + p.css_patronal) AS css_total
       FROM payslips p JOIN employees e ON e.id = p.user_id
       WHERE p.merchant_id = $1 AND p.month = $2 AND p.status <> 'remplace' ORDER BY e.full_name`,
      [req.user.merchantId, mois]
    );
    const cles = ['gross_salary', 'ipres_salarial', 'ipres_patronal', 'ipres_total', 'css_salarial', 'css_patronal', 'css_total'];
    const numeros = [reglages.employer_ipres_number && `IPRES employeur ${reglages.employer_ipres_number}`, reglages.employer_css_number && `CSS employeur ${reglages.employer_css_number}`].filter(Boolean).join(' · ');
    envoyerEtat(res, req.query.format, {
      titre: `Cotisations IPRES et CSS — ${nomMois(mois)}`, sousTitre: numeros, entreprise: await nomEntreprise(req.user.merchantId),
      nomFichier: `cotisations-${mois}`,
      colonnes: [
        { key: 'nom', label: 'Employé', width: 2.2 }, { key: 'ipres_number', label: 'N° IPRES', width: 1.4 }, { key: 'css_number', label: 'N° CSS', width: 1.4 },
        { key: 'gross_salary', label: 'Brut', money: true }, { key: 'ipres_salarial', label: 'IPRES salarial', money: true },
        { key: 'ipres_patronal', label: 'IPRES patronal', money: true }, { key: 'ipres_total', label: 'IPRES total', money: true },
        { key: 'css_salarial', label: 'CSS salarial', money: true }, { key: 'css_patronal', label: 'CSS patronal', money: true },
        { key: 'css_total', label: 'CSS total', money: true },
      ],
      lignes: rows, totaux: { nom: 'TOTAL', ...sommer(rows, cles) },
    });
  } catch (err) {
    repondre(res, err);
  }
});

router.get('/reports/annuel', GESTION, async (req, res) => {
  try {
    const annee = String(req.query.year || new Date().getFullYear());
    if (!/^\d{4}$/.test(annee)) return res.status(400).json({ error: 'Année invalide.' });
    const { rows } = await pool.query(
      `SELECT e.full_name AS nom, COUNT(*) AS mois, SUM(p.gross_salary) AS gross_salary, SUM(p.ipres_salarial + p.css_salarial) AS cotisations_sal,
              SUM(p.irpp + p.trimf) AS impots, SUM(p.deductions_total) AS deductions_total, SUM(p.net_a_payer) AS net_a_payer,
              SUM(p.cout_total_employeur) AS cout_total_employeur
       FROM payslips p JOIN employees e ON e.id = p.user_id
       WHERE p.merchant_id = $1 AND p.month LIKE $2 AND p.status <> 'remplace'
       GROUP BY e.id, e.full_name ORDER BY e.full_name`,
      [req.user.merchantId, `${annee}-%`]
    );
    envoyerEtat(res, req.query.format, {
      titre: `Récapitulatif annuel de paie — ${annee}`, sousTitre: `${rows.length} employé(s)`, entreprise: await nomEntreprise(req.user.merchantId),
      nomFichier: `recap-annuel-${annee}`,
      colonnes: [
        { key: 'nom', label: 'Employé', width: 2.4 }, { key: 'mois', label: 'Mois' },
        { key: 'gross_salary', label: 'Brut annuel', money: true }, { key: 'cotisations_sal', label: 'Cotisations sal.', money: true },
        { key: 'impots', label: 'IRPP + TRIMF', money: true }, { key: 'deductions_total', label: 'Retenues', money: true },
        { key: 'net_a_payer', label: 'Net annuel', money: true }, { key: 'cout_total_employeur', label: 'Coût employeur', money: true },
      ],
      lignes: rows, totaux: { nom: 'TOTAL', ...sommer(rows, ['gross_salary', 'cotisations_sal', 'impots', 'deductions_total', 'net_a_payer', 'cout_total_employeur']) },
    });
  } catch (err) {
    repondre(res, err);
  }
});

router.get('/reports/masse-salariale', GESTION, async (req, res) => {
  try {
    const annee = String(req.query.year || new Date().getFullYear());
    if (!/^\d{4}$/.test(annee)) return res.status(400).json({ error: 'Année invalide.' });
    const { rows } = await pool.query(
      `SELECT p.month AS mois, COUNT(*) AS effectif, SUM(p.gross_salary) AS gross_salary, SUM(p.net_a_payer) AS net_a_payer,
              SUM(p.ipres_patronal + p.css_patronal + p.cfce) AS charges_patronales, SUM(p.cout_total_employeur) AS cout_total_employeur,
              COALESCE(SUM(sp.amount), 0) AS paye
       FROM payslips p LEFT JOIN salary_payments sp ON sp.user_id = p.user_id AND sp.month = p.month
       WHERE p.merchant_id = $1 AND p.month LIKE $2 AND p.status <> 'remplace'
       GROUP BY p.month ORDER BY p.month`,
      [req.user.merchantId, `${annee}-%`]
    );
    envoyerEtat(res, req.query.format, {
      titre: `Masse salariale — ${annee}`, sousTitre: '', entreprise: await nomEntreprise(req.user.merchantId), nomFichier: `masse-salariale-${annee}`,
      colonnes: [
        { key: 'mois', label: 'Mois' }, { key: 'effectif', label: 'Effectif' },
        { key: 'gross_salary', label: 'Brut', money: true }, { key: 'net_a_payer', label: 'Net', money: true },
        { key: 'charges_patronales', label: 'Charges patronales', money: true }, { key: 'cout_total_employeur', label: 'Coût employeur', money: true },
        { key: 'paye', label: 'Déjà payé', money: true },
      ],
      lignes: rows, totaux: { mois: 'TOTAL', ...sommer(rows, ['gross_salary', 'net_a_payer', 'charges_patronales', 'cout_total_employeur', 'paye']) },
    });
  } catch (err) {
    repondre(res, err);
  }
});

// ---------------------------------------------------------------------------
// Primes et retenues saisies d'un employé
// ---------------------------------------------------------------------------

router.get('/:userId/bonuses', GESTION, async (req, res) => {
  try {
    const month = req.query.month || moisActuel();
    const { rows } = await pool.query(
      `SELECT sb.id, sb.label, sb.amount
       FROM salary_bonuses sb JOIN employees e ON e.id = sb.user_id
       WHERE sb.user_id = $1 AND sb.month = $2 AND e.merchant_id = $3 ORDER BY sb.created_at`,
      [req.params.userId, month, req.user.merchantId]
    );
    res.json(rows);
  } catch (err) {
    repondre(res, err);
  }
});

// Retenues saisies à la main : les lignes calculées (absences, prorata, avances) sont recréées à chaque génération.
router.get('/:userId/deductions', GESTION, async (req, res) => {
  try {
    const month = req.query.month || moisActuel();
    const { rows } = await pool.query(
      `SELECT sd.id, sd.type, sd.label, sd.amount
       FROM salary_deductions sd JOIN employees e ON e.id = sd.user_id
       WHERE sd.user_id = $1 AND sd.month = $2 AND e.merchant_id = $3 AND sd.source = 'manuel' ORDER BY sd.created_at`,
      [req.params.userId, month, req.user.merchantId]
    );
    res.json(rows);
  } catch (err) {
    repondre(res, err);
  }
});

// ---------------------------------------------------------------------------
// Génération, rectificatif et consultation d'un bulletin
// ---------------------------------------------------------------------------

async function genererOuRectifier(req, res, rectifier) {
  const client = await pool.connect();
  try {
    const { userId } = req.params;
    const mois = (rectifier ? req.params.month : req.body.month) || moisActuel();
    verifierMois(mois);
    const employe = await chargerEmploye(client, req.user.merchantId, userId);
    if (!employe) return res.status(404).json({ error: 'Employé introuvable.' });
    if (!employe.monthly_salary) return res.status(400).json({ error: "Configurez d'abord le salaire de base de cet employé." });

    await client.query('BEGIN');
    const r = await ecrireBulletin(client, {
      req, employe, mois, bonuses: req.body.bonuses, deductions: req.body.deductions,
      rectifier: rectifier ? { raison: String(req.body.reason || '').trim().slice(0, 300) } : null,
    });
    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: rectifier ? 'payslip_rectified' : 'payslip_generated',
      description: `a ${rectifier ? 'rectifié' : 'généré'} le bulletin de paie de ${employe.full_name} (${mois}) — net ${formatMontant(r.resultat.net_a_payer)} FCFA`,
    });
    broadcast(req.user.merchantId, 'activity:created', {});
    res.json({ month: mois, number: r.number, version: r.version, ...r.resultat });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondre(res, err);
  } finally {
    client.release();
  }
}

// POST /payroll/:userId/generate — calcule et enregistre le bulletin d'un mois (un mois payé est verrouillé).
router.post('/:userId/generate', GESTION, (req, res) => genererOuRectifier(req, res, false));

// POST /payroll/:userId/:month/rectify — nouvelle version du bulletin ; l'ancien reste intact (statut « remplacé »).
// Interdit sur un mois déjà payé.
router.post('/:userId/:month/rectify', GESTION, (req, res) => genererOuRectifier(req, res, true));

// GET /payroll/:userId/:month/versions — historique des versions d'un bulletin.
router.get('/:userId/:month/versions', GESTION, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, number, version, status, rectify_reason, net_a_payer, generated_at, sent_at
       FROM payslips WHERE user_id = $1 AND month = $2 AND merchant_id = $3 ORDER BY version`,
      [req.params.userId, req.params.month, req.user.merchantId]
    );
    res.json(rows);
  } catch (err) {
    repondre(res, err);
  }
});

const FILTRE_VERSION = `AND (($4::int IS NULL AND p.status <> 'remplace') OR p.version = $4::int)`;

// GET /payroll/:userId/:month?version= — détail d'un bulletin (gestion ou l'employé lui-même, une fois payé).
router.get('/:userId/:month', async (req, res) => {
  try {
    const empId = await idEmploye(req, req.params.userId);
    if (!(await peutConsulter(req, empId))) return res.status(403).json({ error: 'Accès refusé.' });
    const moi = await estMonBulletin(req, empId);
    if (moi && !aRole(req.user, 'manager', 'gerant', 'comptable') && !(await moisEstPaye(empId, req.params.month))) {
      return res.status(403).json({ error: "Ce mois n'est pas encore marqué payé." });
    }
    const version = aRole(req.user, 'manager', 'gerant', 'comptable') && req.query.version ? Number(req.query.version) : null;
    const { rows } = await pool.query(
      `SELECT p.*, e.full_name
       FROM payslips p JOIN employees e ON e.id = p.user_id
       WHERE p.user_id = $1 AND p.month = $2 AND p.merchant_id = $3 ${FILTRE_VERSION}`,
      [empId, req.params.month, req.user.merchantId, version]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Bulletin introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    repondre(res, err);
  }
});

// GET /payroll/:userId/:month/pdf?version= — bulletin en PDF.
router.get('/:userId/:month/pdf', async (req, res) => {
  try {
    const empId = await idEmploye(req, req.params.userId);
    if (!(await peutConsulter(req, empId))) return res.status(403).json({ error: 'Accès refusé.' });
    const moi = await estMonBulletin(req, empId);
    if (moi && !aRole(req.user, 'manager', 'gerant', 'comptable') && !(await moisEstPaye(empId, req.params.month))) {
      return res.status(403).json({ error: "Ce mois n'est pas encore marqué payé." });
    }
    const version = aRole(req.user, 'manager', 'gerant', 'comptable') && req.query.version ? Number(req.query.version) : null;
    const { rows } = await pool.query(
      `SELECT p.*, e.full_name, COALESCE(e.job_title, u.role) AS role,
              m.business_name, m.ninea, m.rccm, m.address, m.bank_details, m.mobile_money_details, m.payment_terms
       FROM payslips p
       JOIN employees e ON e.id = p.user_id
       LEFT JOIN users u ON u.id = e.user_id
       JOIN merchants m ON m.id = p.merchant_id
       WHERE p.user_id = $1 AND p.month = $2 AND p.merchant_id = $3 ${FILTRE_VERSION}`,
      [empId, req.params.month, req.user.merchantId, version]
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
    if (!res.headersSent) repondre(res, err);
    else console.error(err);
  }
});

module.exports = router;
