const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireOwnerModule } = require('../middleware/ownerModules');
const { requireFinancePage } = require('../middleware/financePermissions');
const { logActivity } = require('../utils/activityLog');
const { broadcast } = require('../utils/eventsBus');
const { UUID_RE, MODES_CAISSE, erreurMetier, verifierBoutique, verifierCaisse } = require('../utils/payrollCash');

const router = express.Router();
router.use(authenticate);
// Module Paie : activé par l'owner commerçant par commerçant.
router.use(requireOwnerModule('paie'));
router.use(requireFinancePage('paie'));

// Manager et comptable : saisies de paie (absences, heures, avances) et liste. Manager seul : données
// personnelles de la fiche (adresse, numéros, contrat), création, archivage.
const GESTION = requireRole('manager', 'comptable');
const MANAGER = requireRole('manager');

const MODES_PAIEMENT = ['especes', 'wave', 'orange_money', 'virement'];
const TYPES_CONTRAT = ['cdi', 'cdd', 'stage', 'apprentissage', 'journalier', 'autre'];
const TYPES_ABSENCE = { non_payee: false, payee: true, maladie: false, conge: true };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MOIS_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function repondre(res, err) {
  if (err.statut) return res.status(err.statut).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'Cet élément existe déjà.' });
  console.error(err);
  return res.status(500).json({ error: 'Erreur serveur' });
}

function texte(valeur, max = 200) {
  const s = String(valeur ?? '').trim();
  return s ? s.slice(0, max) : null;
}

function dateValide(valeur, obligatoire = false) {
  if (valeur === undefined || valeur === null || valeur === '') {
    if (obligatoire) throw erreurMetier(400, 'Date obligatoire.');
    return null;
  }
  const s = String(valeur).slice(0, 10);
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) throw erreurMetier(400, `Date invalide : ${valeur}`);
  return s;
}

function moisDeDate(date) {
  return date.slice(0, 7);
}

function moisSuivant(mois) {
  const [a, m] = mois.split('-').map(Number);
  const d = new Date(Date.UTC(a, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function chargerEmploye(db, merchantId, id) {
  if (!UUID_RE.test(String(id))) throw erreurMetier(404, 'Employé introuvable.');
  const { rows } = await db.query('SELECT * FROM employees WHERE id = $1 AND merchant_id = $2', [id, merchantId]);
  if (rows.length === 0) throw erreurMetier(404, 'Employé introuvable.');
  return rows[0];
}

// Un mois déjà payé est verrouillé : on n'y ajoute ni ne retire d'absence ou d'heures supplémentaires.
async function verifierMoisNonPaye(db, empId, mois) {
  const { rows } = await db.query('SELECT 1 FROM salary_payments WHERE user_id = $1 AND month = $2', [empId, mois]);
  if (rows.length > 0) throw erreurMetier(409, `Le mois ${mois} est déjà payé pour cet employé : il ne peut plus être modifié.`);
}

const COLONNES_FICHE = `e.id, e.full_name, e.phone, e.email, e.address, e.job_title, e.contract_type, e.ipres_number, e.css_number,
  e.warehouse_id, e.status, e.user_id,
  to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date, to_char(e.end_date, 'YYYY-MM-DD') AS end_date,
  to_char(e.archived_at, 'YYYY-MM-DD') AS archived_at`;

function lireFiche(body) {
  const contrat = body.contractType ? String(body.contractType).toLowerCase() : null;
  if (contrat && !TYPES_CONTRAT.includes(contrat)) throw erreurMetier(400, 'Type de contrat inconnu.');
  const fiche = {
    full_name: texte(body.fullName, 150),
    phone: texte(body.phone, 40),
    email: texte(body.email, 150),
    address: texte(body.address, 250),
    job_title: texte(body.jobTitle, 100),
    contract_type: contrat,
    ipres_number: texte(body.ipresNumber, 40),
    css_number: texte(body.cssNumber, 40),
    hire_date: dateValide(body.hireDate),
    end_date: dateValide(body.endDate),
  };
  if (fiche.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fiche.email)) throw erreurMetier(400, 'Adresse e-mail invalide.');
  if (fiche.hire_date && fiche.end_date && fiche.end_date < fiche.hire_date) {
    throw erreurMetier(400, "La date de fin précède la date d'embauche.");
  }
  return fiche;
}

// ---------------------------------------------------------------------------
// Listes transversales (déclarées avant /:id)
// ---------------------------------------------------------------------------

// GET /employees?status=actif|archive|tous
router.get('/', GESTION, async (req, res) => {
  try {
    const statut = ['actif', 'archive'].includes(req.query.status) ? req.query.status : null;
    const { rows } = await pool.query(
      `SELECT e.id, e.full_name, e.job_title, e.contract_type, e.email, e.phone, e.status, e.warehouse_id, e.user_id,
              to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date, to_char(e.end_date, 'YYYY-MM-DD') AS end_date,
              es.monthly_salary, es.payment_method, (e.user_id IS NOT NULL) AS has_account
       FROM employees e LEFT JOIN employee_salaries es ON es.user_id = e.id
       WHERE e.merchant_id = $1 AND ($2::text IS NULL OR e.status = $2)
       ORDER BY (e.status = 'actif') DESC, e.full_name`,
      [req.user.merchantId, statut]
    );
    res.json(rows);
  } catch (err) {
    repondre(res, err);
  }
});

// POST /employees — fiche d'un employé sans compte (salaire optionnel).
router.post('/', MANAGER, async (req, res) => {
  const client = await pool.connect();
  try {
    const fiche = lireFiche(req.body);
    if (!fiche.full_name) throw erreurMetier(400, "Le nom de l'employé est obligatoire.");
    let warehouseId = null;
    if (req.body.warehouseId) {
      await verifierBoutique(client, req.user.merchantId, req.body.warehouseId);
      warehouseId = req.body.warehouseId;
    }
    const salaire = req.body.monthlySalary !== undefined && req.body.monthlySalary !== '' ? Number(req.body.monthlySalary) : null;
    if (salaire !== null && !(salaire > 0)) throw erreurMetier(400, 'Salaire invalide.');
    const methode = req.body.paymentMethod || 'especes';
    if (!MODES_PAIEMENT.includes(methode)) throw erreurMetier(400, 'Méthode de paiement invalide.');

    await client.query('BEGIN');
    const cree = await client.query(
      `INSERT INTO employees (merchant_id, full_name, phone, email, address, job_title, contract_type, ipres_number, css_number, hire_date, end_date, warehouse_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [req.user.merchantId, fiche.full_name, fiche.phone, fiche.email, fiche.address, fiche.job_title, fiche.contract_type,
        fiche.ipres_number, fiche.css_number, fiche.hire_date, fiche.end_date, warehouseId]
    );
    const id = cree.rows[0].id;
    if (salaire !== null) {
      await client.query(
        `INSERT INTO employee_salaries (user_id, monthly_salary, payment_method, parts_fiscales, recurring_bonuses, ipres_enabled, css_enabled)
         VALUES ($1, $2, $3, $4, '[]'::jsonb, false, false)`,
        [id, salaire, methode, Math.max(1, Number(req.body.partsFiscales) || 1)]
      );
      await client.query(
        'INSERT INTO employee_salary_history (employee_id, monthly_salary, effective_from, note, created_by) VALUES ($1, $2, $3, $4, $5)',
        [id, salaire, fiche.hire_date || new Date().toISOString().slice(0, 10), 'Salaire initial', req.user.id]
      );
    }
    await client.query('COMMIT');

    await logActivity({ merchantId: req.user.merchantId, userId: req.user.id, action: 'employee_created', description: `a créé la fiche employé de ${fiche.full_name}` });
    res.status(201).json({ id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondre(res, err);
  } finally {
    client.release();
  }
});

// POST /employees/from-user/:userId — crée à la demande la fiche d'un utilisateur existant (id de la fiche = id du compte).
router.post('/from-user/:userId', MANAGER, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!UUID_RE.test(userId)) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const existante = await pool.query('SELECT id FROM employees WHERE id = $1 OR user_id = $1', [userId]);
    if (existante.rows.length > 0) return res.json({ id: existante.rows[0].id, created: false });
    const u = await pool.query(
      'SELECT id, full_name, warehouse_id, is_active FROM users WHERE id = $1 AND merchant_id = $2',
      [userId, req.user.merchantId]
    );
    if (u.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    await pool.query(
      `INSERT INTO employees (id, merchant_id, user_id, full_name, warehouse_id, status) VALUES ($1, $2, $1, $3, $4, $5)`,
      [userId, req.user.merchantId, u.rows[0].full_name, u.rows[0].warehouse_id, u.rows[0].is_active ? 'actif' : 'archive']
    );
    res.status(201).json({ id: userId, created: true });
  } catch (err) {
    repondre(res, err);
  }
});

// GET /employees/advances?status=en_cours|solde — toutes les avances et prêts.
router.get('/advances', GESTION, async (req, res) => {
  try {
    const statut = ['en_cours', 'solde'].includes(req.query.status) ? req.query.status : null;
    const { rows } = await pool.query(
      `SELECT a.id, a.employee_id, e.full_name, a.kind, a.amount, to_char(a.advance_date, 'YYYY-MM-DD') AS advance_date, a.repay_mode,
              a.installments, a.monthly_amount, a.start_month, a.balance, a.status, a.payment_method, a.note
       FROM employee_advances a JOIN employees e ON e.id = a.employee_id
       WHERE a.merchant_id = $1 AND ($2::text IS NULL OR a.status = $2)
       ORDER BY (a.status = 'en_cours') DESC, a.advance_date DESC`,
      [req.user.merchantId, statut]
    );
    res.json(rows);
  } catch (err) {
    repondre(res, err);
  }
});

// GET /employees/absences?month=AAAA-MM — absences du mois (toutes si pas de mois).
router.get('/absences', GESTION, async (req, res) => {
  try {
    const mois = req.query.month && MOIS_RE.test(req.query.month) ? req.query.month : null;
    const { rows } = await pool.query(
      `SELECT a.id, a.employee_id, e.full_name, to_char(a.start_date, 'YYYY-MM-DD') AS start_date, to_char(a.end_date, 'YYYY-MM-DD') AS end_date,
              a.absence_type, a.days, a.is_paid, a.note
       FROM employee_absences a JOIN employees e ON e.id = a.employee_id
       WHERE a.merchant_id = $1 AND ($2::text IS NULL OR to_char(a.start_date, 'YYYY-MM') = $2)
       ORDER BY a.start_date DESC`,
      [req.user.merchantId, mois]
    );
    res.json(rows);
  } catch (err) {
    repondre(res, err);
  }
});

// GET /employees/overtime?month=AAAA-MM
router.get('/overtime', GESTION, async (req, res) => {
  try {
    const mois = req.query.month && MOIS_RE.test(req.query.month) ? req.query.month : null;
    const { rows } = await pool.query(
      `SELECT o.id, o.employee_id, e.full_name, to_char(o.work_date, 'YYYY-MM-DD') AS work_date, o.hours, o.category, o.note
       FROM employee_overtime o JOIN employees e ON e.id = o.employee_id
       WHERE o.merchant_id = $1 AND ($2::text IS NULL OR to_char(o.work_date, 'YYYY-MM') = $2)
       ORDER BY o.work_date DESC`,
      [req.user.merchantId, mois]
    );
    res.json(rows);
  } catch (err) {
    repondre(res, err);
  }
});

// DELETE /employees/absences/:absenceId
router.delete('/absences/:absenceId', GESTION, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.absenceId)) return res.status(404).json({ error: 'Absence introuvable.' });
    const { rows } = await pool.query(
      `SELECT employee_id, to_char(start_date, 'YYYY-MM') AS mois FROM employee_absences WHERE id = $1 AND merchant_id = $2`,
      [req.params.absenceId, req.user.merchantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Absence introuvable.' });
    await verifierMoisNonPaye(pool, rows[0].employee_id, rows[0].mois);
    await pool.query('DELETE FROM employee_absences WHERE id = $1', [req.params.absenceId]);
    res.json({ success: true });
  } catch (err) {
    repondre(res, err);
  }
});

// DELETE /employees/overtime/:rowId
router.delete('/overtime/:rowId', GESTION, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.rowId)) return res.status(404).json({ error: 'Saisie introuvable.' });
    const { rows } = await pool.query(
      `SELECT employee_id, to_char(work_date, 'YYYY-MM') AS mois FROM employee_overtime WHERE id = $1 AND merchant_id = $2`,
      [req.params.rowId, req.user.merchantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Saisie introuvable.' });
    await verifierMoisNonPaye(pool, rows[0].employee_id, rows[0].mois);
    await pool.query('DELETE FROM employee_overtime WHERE id = $1', [req.params.rowId]);
    res.json({ success: true });
  } catch (err) {
    repondre(res, err);
  }
});

// ---------------------------------------------------------------------------
// Fiche d'un employé
// ---------------------------------------------------------------------------

// GET /employees/:id — fiche complète (manager).
router.get('/:id', MANAGER, async (req, res) => {
  try {
    await chargerEmploye(pool, req.user.merchantId, req.params.id);
    const { rows } = await pool.query(
      `SELECT ${COLONNES_FICHE}, es.monthly_salary, es.payment_method, es.parts_fiscales, es.ipres_enabled, es.css_enabled
       FROM employees e LEFT JOIN employee_salaries es ON es.user_id = e.id WHERE e.id = $1`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    repondre(res, err);
  }
});

// PUT /employees/:id — met à jour la fiche (manager). userId lie ou délie un compte.
router.put('/:id', MANAGER, async (req, res) => {
  try {
    await chargerEmploye(pool, req.user.merchantId, req.params.id);
    const fiche = lireFiche(req.body);
    if (!fiche.full_name) throw erreurMetier(400, "Le nom de l'employé est obligatoire.");
    let warehouseId = null;
    if (req.body.warehouseId) {
      await verifierBoutique(pool, req.user.merchantId, req.body.warehouseId);
      warehouseId = req.body.warehouseId;
    }
    let userId;
    if (req.body.userId !== undefined) {
      userId = req.body.userId || null;
      if (userId) {
        const u = await pool.query('SELECT id FROM users WHERE id = $1 AND merchant_id = $2', [userId, req.user.merchantId]);
        if (u.rows.length === 0) throw erreurMetier(400, 'Compte utilisateur introuvable.');
        const deja = await pool.query('SELECT id FROM employees WHERE user_id = $1 AND id <> $2', [userId, req.params.id]);
        if (deja.rows.length > 0) throw erreurMetier(409, 'Ce compte est déjà lié à un autre employé.');
      }
    }
    await pool.query(
      `UPDATE employees SET full_name = $2, phone = $3, email = $4, address = $5, job_title = $6, contract_type = $7,
         ipres_number = $8, css_number = $9, hire_date = $10, end_date = $11, warehouse_id = $12,
         user_id = CASE WHEN $13::boolean THEN $14::uuid ELSE user_id END, updated_at = now()
       WHERE id = $1`,
      [req.params.id, fiche.full_name, fiche.phone, fiche.email, fiche.address, fiche.job_title, fiche.contract_type,
        fiche.ipres_number, fiche.css_number, fiche.hire_date, fiche.end_date, warehouseId,
        req.body.userId !== undefined, userId || null]
    );
    res.json({ success: true });
  } catch (err) {
    repondre(res, err);
  }
});

// POST /employees/:id/archive — l'historique de paie reste intact.
router.post('/:id/archive', MANAGER, async (req, res) => {
  try {
    const e = await chargerEmploye(pool, req.user.merchantId, req.params.id);
    const fin = dateValide(req.body.endDate);
    await pool.query(
      `UPDATE employees SET status = 'archive', archived_at = now(), end_date = COALESCE($2::date, end_date, CURRENT_DATE), updated_at = now() WHERE id = $1`,
      [req.params.id, fin]
    );
    await logActivity({ merchantId: req.user.merchantId, userId: req.user.id, action: 'employee_archived', description: `a archivé la fiche employé de ${e.full_name}` });
    res.json({ success: true });
  } catch (err) {
    repondre(res, err);
  }
});

// POST /employees/:id/restore
router.post('/:id/restore', MANAGER, async (req, res) => {
  try {
    const e = await chargerEmploye(pool, req.user.merchantId, req.params.id);
    await pool.query(`UPDATE employees SET status = 'actif', archived_at = NULL, end_date = NULL, updated_at = now() WHERE id = $1`, [req.params.id]);
    await logActivity({ merchantId: req.user.merchantId, userId: req.user.id, action: 'employee_restored', description: `a réactivé la fiche employé de ${e.full_name}` });
    res.json({ success: true });
  } catch (err) {
    repondre(res, err);
  }
});

// ---------------------------------------------------------------------------
// Absences et heures supplémentaires
// ---------------------------------------------------------------------------

// POST /employees/:id/absences { startDate, endDate?, type, days, note? }
router.post('/:id/absences', GESTION, async (req, res) => {
  try {
    const e = await chargerEmploye(pool, req.user.merchantId, req.params.id);
    const type = String(req.body.type || 'non_payee');
    if (!(type in TYPES_ABSENCE)) throw erreurMetier(400, "Type d'absence inconnu.");
    const debut = dateValide(req.body.startDate, true);
    const fin = dateValide(req.body.endDate);
    if (fin && fin < debut) throw erreurMetier(400, 'La date de fin précède la date de début.');
    const jours = Number(req.body.days);
    if (!(jours > 0 && jours <= 366)) throw erreurMetier(400, "Nombre de jours invalide.");
    if (fin && moisDeDate(fin) !== moisDeDate(debut)) {
      throw erreurMetier(400, "Une absence à cheval sur deux mois doit être saisie en deux lignes, une par mois.");
    }
    await verifierMoisNonPaye(pool, e.id, moisDeDate(debut));
    // La paie est « payée » pour une absence payée ou un congé ; maladie et non payée retiennent le salaire.
    const { rows } = await pool.query(
      `INSERT INTO employee_absences (merchant_id, employee_id, start_date, end_date, absence_type, days, is_paid, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [req.user.merchantId, e.id, debut, fin, type, jours, TYPES_ABSENCE[type], texte(req.body.note, 250), req.user.id]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    repondre(res, err);
  }
});

// POST /employees/:id/overtime { date, hours, category, note? }
router.post('/:id/overtime', GESTION, async (req, res) => {
  try {
    const e = await chargerEmploye(pool, req.user.merchantId, req.params.id);
    const date = dateValide(req.body.date, true);
    const heures = Number(req.body.hours);
    if (!(heures > 0 && heures <= 24)) throw erreurMetier(400, "Nombre d'heures invalide.");
    const categorie = texte(req.body.category, 40);
    if (!categorie) throw erreurMetier(400, 'Choisissez la catégorie de majoration.');
    const reglages = await pool.query('SELECT overtime_rates FROM payroll_settings WHERE merchant_id = $1', [req.user.merchantId]);
    const taux = Array.isArray(reglages.rows[0]?.overtime_rates) ? reglages.rows[0].overtime_rates : [];
    if (!taux.some((t) => t.code === categorie)) {
      throw erreurMetier(400, "Cette catégorie n'existe pas : configurez les majorations dans les réglages de paie.");
    }
    await verifierMoisNonPaye(pool, e.id, moisDeDate(date));
    const { rows } = await pool.query(
      `INSERT INTO employee_overtime (merchant_id, employee_id, work_date, hours, category, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.user.merchantId, e.id, date, heures, categorie, texte(req.body.note, 250), req.user.id]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    repondre(res, err);
  }
});

// ---------------------------------------------------------------------------
// Avances et prêts
// ---------------------------------------------------------------------------

// POST /employees/:id/advances
// { amount, advanceDate, kind: avance|pret, repayMode: unique|echelonne|libre, installments?, monthlyAmount?,
//   startMonth?, paymentMethod, warehouseId?, note? }
// La sortie de caisse est enregistrée dans la même transaction (boutique obligatoire hors virement).
router.post('/:id/advances', GESTION, async (req, res) => {
  const client = await pool.connect();
  try {
    const e = await chargerEmploye(client, req.user.merchantId, req.params.id);
    if (e.status !== 'actif') throw erreurMetier(400, 'Cet employé est archivé.');
    const montant = Math.round(Number(req.body.amount) * 100) / 100;
    if (!(montant > 0)) throw erreurMetier(400, 'Montant invalide.');
    const date = dateValide(req.body.advanceDate, true);
    const genre = req.body.kind === 'pret' ? 'pret' : 'avance';
    const mode = String(req.body.repayMode || 'unique');
    if (!['unique', 'echelonne', 'libre'].includes(mode)) throw erreurMetier(400, 'Mode de remboursement inconnu.');
    const methode = String(req.body.paymentMethod || '');
    if (!MODES_PAIEMENT.includes(methode)) throw erreurMetier(400, 'Méthode de paiement invalide.');

    let mensualite;
    let nbEcheances = null;
    if (mode === 'unique') {
      mensualite = montant;
    } else if (mode === 'echelonne') {
      nbEcheances = Math.floor(Number(req.body.installments));
      if (!(nbEcheances >= 2 && nbEcheances <= 60)) throw erreurMetier(400, "Nombre d'échéances invalide (2 à 60).");
      mensualite = Math.ceil(montant / nbEcheances);
    } else {
      mensualite = Math.round(Number(req.body.monthlyAmount) * 100) / 100;
      if (!(mensualite > 0 && mensualite <= montant)) throw erreurMetier(400, 'Montant mensuel invalide.');
    }
    const premierMois = req.body.startMonth || moisSuivant(moisDeDate(date));
    if (!MOIS_RE.test(premierMois)) throw erreurMetier(400, 'Mois de première retenue invalide.');

    let warehouseId = null;
    if (MODES_CAISSE.includes(methode)) {
      warehouseId = req.body.warehouseId;
      await verifierCaisse(req, client, warehouseId, methode, montant);
    }

    await client.query('BEGIN');
    let depenseId = null;
    if (MODES_CAISSE.includes(methode)) {
      const d = await client.query(
        `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date, movement_type, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6::date, 'sortie', $7) RETURNING id`,
        [req.user.merchantId, req.user.id, methode, montant, `Avance sur salaire — ${e.full_name}`, date, warehouseId]
      );
      depenseId = d.rows[0].id;
    }
    const cree = await client.query(
      `INSERT INTO employee_advances (merchant_id, employee_id, kind, amount, advance_date, repay_mode, installments, monthly_amount,
         start_month, balance, status, payment_method, warehouse_id, cash_expense_id, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $4, 'en_cours', $10, $11, $12, $13, $14) RETURNING id`,
      [req.user.merchantId, e.id, genre, montant, date, mode, nbEcheances, mensualite, premierMois, methode, warehouseId, depenseId,
        texte(req.body.note, 250), req.user.id]
    );
    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'employee_advance',
      description: `a versé ${genre === 'pret' ? 'un prêt' : 'une avance'} de ${Math.round(montant).toLocaleString('fr-FR')} FCFA à ${e.full_name}`,
    });
    broadcast(req.user.merchantId, 'activity:created', {});
    res.status(201).json({ id: cree.rows[0].id, monthlyAmount: mensualite, startMonth: premierMois });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondre(res, err);
  } finally {
    client.release();
  }
});

// GET /employees/:id/advances — avances d'un employé avec leurs remboursements.
router.get('/:id/advances', GESTION, async (req, res) => {
  try {
    await chargerEmploye(pool, req.user.merchantId, req.params.id);
    const { rows } = await pool.query(
      `SELECT a.id, a.kind, a.amount, to_char(a.advance_date, 'YYYY-MM-DD') AS advance_date, a.repay_mode, a.installments,
              a.monthly_amount, a.start_month, a.balance, a.status,
              COALESCE((SELECT json_agg(json_build_object('month', r.month, 'amount', r.amount) ORDER BY r.month)
                        FROM employee_advance_repayments r LEFT JOIN payslips p ON p.id = r.payslip_id
                        WHERE r.advance_id = a.id AND (p.id IS NULL OR p.status <> 'remplace')), '[]'::json) AS repayments
       FROM employee_advances a WHERE a.employee_id = $1 ORDER BY a.advance_date DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    repondre(res, err);
  }
});

// ---------------------------------------------------------------------------
// Historique des salaires de base
// ---------------------------------------------------------------------------

router.get('/:id/salary-history', MANAGER, async (req, res) => {
  try {
    await chargerEmploye(pool, req.user.merchantId, req.params.id);
    const { rows } = await pool.query(
      `SELECT id, monthly_salary, to_char(effective_from, 'YYYY-MM-DD') AS effective_from, note
       FROM employee_salary_history WHERE employee_id = $1 ORDER BY effective_from DESC, created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    repondre(res, err);
  }
});

// POST /employees/:id/salary-history { monthlySalary, effectiveFrom, note? }
// Les bulletins utilisent le salaire en vigueur au mois concerné (historique) ; si la date d'effet
// est déjà atteinte, le salaire affiché sur la fiche est aussi mis à jour.
router.post('/:id/salary-history', MANAGER, async (req, res) => {
  const client = await pool.connect();
  try {
    const e = await chargerEmploye(client, req.user.merchantId, req.params.id);
    const salaire = Number(req.body.monthlySalary);
    if (!(salaire > 0)) throw erreurMetier(400, 'Montant invalide.');
    const effet = dateValide(req.body.effectiveFrom, true);
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO employee_salary_history (employee_id, monthly_salary, effective_from, note, created_by) VALUES ($1, $2, $3, $4, $5)',
      [e.id, salaire, effet, texte(req.body.note, 250), req.user.id]
    );
    await synchroniserSalaire(client, e.id);
    await client.query('COMMIT');
    res.status(201).json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondre(res, err);
  } finally {
    client.release();
  }
});

// Aligne le salaire configuré sur la ligne d'historique la plus récente dont la date d'effet est atteinte.
async function synchroniserSalaire(db, empId) {
  await db.query(
    `UPDATE employee_salaries es SET monthly_salary = h.monthly_salary, updated_at = now()
     FROM (SELECT monthly_salary FROM employee_salary_history
           WHERE employee_id = $1 AND effective_from <= CURRENT_DATE ORDER BY effective_from DESC, created_at DESC LIMIT 1) h
     WHERE es.user_id = $1 AND es.monthly_salary <> h.monthly_salary`,
    [empId]
  );
}

module.exports = router;
