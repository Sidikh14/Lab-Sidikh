const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireOwnerModule } = require('../middleware/ownerModules');
const { logActivity } = require('../utils/activityLog');
const { broadcast } = require('../utils/eventsBus');
const { MODES_CAISSE, UUID_RE, erreurMetier, verifierCaisse, verifierBoutique } = require('../utils/payrollCash');
const { genererCsv } = require('../utils/payrollReports');

const router = express.Router();
router.use(authenticate);
// Manager et comptable (le comptable gère la paie ; il peut aussi cumuler d'autres rôles).
router.use(requireRole('manager', 'comptable'));
// Module Paie : activé par l'owner commerçant par commerçant. Sans accès, le rappel de salaire
// (/alert) répond simplement « rien à afficher » pour ne pas casser le tableau de bord.
router.use(requireOwnerModule('paie', { '/alert': { show: false, unpaid: [] } }));

const MOYENS_PAIEMENT = ['especes', 'wave', 'orange_money', 'virement'];
const LABEL_METHODE = { especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', virement: 'Virement' };
const MOIS_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function repondre(res, err) {
  if (err.statut) return res.status(err.statut).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: 'Erreur serveur' });
}

function moisActuel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function moisSuivant(moisStr) {
  const [annee, mois] = moisStr.split('-').map(Number);
  const d = new Date(annee, mois, 1); // mois est déjà 1-indexé => donne le mois suivant
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function moisPrecedent(moisStr) {
  const [annee, mois] = moisStr.split('-').map(Number);
  const d = new Date(annee, mois - 2, 1); // mois est 1-indexé => mois - 2 donne le mois précédent
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Rappel de salaire : paie en fin de mois, pas au début.
//  - à partir du 26 : rappel de payer le mois EN COURS ;
//  - du 1er au 5 : rappel de ce qui reste impayé du mois PRÉCÉDENT ;
//  - entre les deux : aucun rappel.
const JOUR_DEBUT_RAPPEL = 26;
const JOUR_FIN_RAPPEL_RETARD = 5;

// Employés actifs, avec salaire configuré, en poste (même partiellement) sur le mois $2.
const SQL_EMPLOYES_DU_MOIS = `
  FROM employees e
  JOIN employee_salaries es ON es.user_id = e.id
  WHERE e.merchant_id = $1 AND e.status = 'actif'
    AND (e.hire_date IS NULL OR e.hire_date <= (to_date($2::text || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date)
    AND (e.end_date IS NULL OR e.end_date >= to_date($2::text || '-01', 'YYYY-MM-DD'))`;

// Mois le plus avancé accessible : le mois en cours tant qu'il n'est pas
// entièrement soldé, sinon le mois suivant (jamais plus loin).
async function calculerMoisMax(merchantId) {
  const month = moisActuel();
  const { rows } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM salary_payments sp WHERE sp.user_id = e.id AND sp.month = $2)) AS impayes
     ${SQL_EMPLOYES_DU_MOIS}`,
    [merchantId, month]
  );
  const toutPaye = Number(rows[0].impayes) === 0;
  return toutPaye ? moisSuivant(month) : month;
}

// Un utilisateur actif (hors manager/owner) sans fiche employé en reçoit une à la demande :
// l'id de la fiche est celui du compte, donc rien ne change pour la paie existante.
async function creerFichesManquantes(merchantId) {
  await pool.query(
    `INSERT INTO employees (id, merchant_id, user_id, full_name, warehouse_id, status)
     SELECT u.id, u.merchant_id, u.id, u.full_name, u.warehouse_id, 'actif'
     FROM users u
     WHERE u.merchant_id = $1 AND u.is_active = true AND u.role NOT IN ('manager', 'owner')
       AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = u.id OR e.user_id = u.id)
     ON CONFLICT DO NOTHING`,
    [merchantId]
  );
}

// GET /salaries/max-month
router.get('/max-month', async (req, res) => {
  try {
    res.json({ maxMonth: await calculerMoisMax(req.user.merchantId) });
  } catch (err) {
    repondre(res, err);
  }
});

// GET /salaries - employés (avec ou sans compte) + salaire configuré + statut du mois
// + bulletin courant (net_a_payer, numéro, version) : permet au front de verrouiller
// le paiement sur le montant du bulletin sans appel supplémentaire.
router.get('/', async (req, res) => {
  try {
    const month = MOIS_RE.test(req.query.month || '') ? req.query.month : moisActuel();
    await creerFichesManquantes(req.user.merchantId);
    const { rows } = await pool.query(
      `SELECT e.id, e.full_name AS name, COALESCE(e.job_title, u.role::text) AS role, e.status, (e.user_id IS NOT NULL) AS has_account,
              (COALESCE(e.email, '') <> '') AS has_email, to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date, to_char(e.end_date, 'YYYY-MM-DD') AS end_date,
              es.monthly_salary, es.payment_method, es.parts_fiscales, es.recurring_bonuses,
              COALESCE(es.ipres_enabled, false) AS ipres_enabled, COALESCE(es.css_enabled, false) AS css_enabled,
              sp.amount AS paid_amount, sp.payment_method AS paid_method, sp.paid_at,
              p.net_a_payer AS payslip_net, p.generated_at AS payslip_generated_at, p.number AS payslip_number,
              p.version AS payslip_version, p.sent_at AS payslip_sent_at
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN employee_salaries es ON es.user_id = e.id
       LEFT JOIN salary_payments sp ON sp.user_id = e.id AND sp.month = $2
       LEFT JOIN payslips p ON p.user_id = e.id AND p.month = $2 AND p.status <> 'remplace'
       WHERE e.merchant_id = $1
         AND (u.id IS NULL OR u.role NOT IN ('manager', 'owner'))
         AND (e.status = 'actif' OR p.id IS NOT NULL OR sp.id IS NOT NULL)
         AND (p.id IS NOT NULL OR sp.id IS NOT NULL
              OR ((e.hire_date IS NULL OR e.hire_date <= (to_date($2::text || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date)
                  AND (e.end_date IS NULL OR e.end_date >= to_date($2::text || '-01', 'YYYY-MM-DD'))))
       ORDER BY e.full_name`,
      [req.user.merchantId, month]
    );
    res.json({ month, employees: rows });
  } catch (err) {
    repondre(res, err);
  }
});

// GET /salaries/export?month=&group=virement|mobile|especes|tous — CSV pour la banque ou le mobile money.
router.get('/export', async (req, res) => {
  try {
    const month = MOIS_RE.test(req.query.month || '') ? req.query.month : moisActuel();
    const groupes = {
      virement: ['virement'], mobile: ['wave', 'orange_money'], especes: ['especes'], tous: MOYENS_PAIEMENT,
    };
    const modes = groupes[req.query.group] || groupes.tous;
    const { rows } = await pool.query(
      `SELECT p.number, e.full_name, e.phone, COALESCE(sp.payment_method, es.payment_method, 'especes') AS mode,
              COALESCE(sp.amount, p.net_a_payer) AS montant, (sp.id IS NOT NULL) AS paye
       FROM payslips p
       JOIN employees e ON e.id = p.user_id
       LEFT JOIN employee_salaries es ON es.user_id = e.id
       LEFT JOIN salary_payments sp ON sp.user_id = p.user_id AND sp.month = p.month
       WHERE p.merchant_id = $1 AND p.month = $2 AND p.status <> 'remplace'
       ORDER BY e.full_name`,
      [req.user.merchantId, month]
    );
    const lignes = rows
      .filter((r) => modes.includes(r.mode))
      .map((r) => ({ reference: r.number, nom: r.full_name, telephone: r.phone || '', mode: LABEL_METHODE[r.mode] || r.mode, montant: Number(r.montant), statut: r.paye ? 'Payé' : 'À payer' }));
    const total = lignes.reduce((s, l) => s + l.montant, 0);
    const csv = genererCsv({
      colonnes: [
        { key: 'reference', label: 'Référence bulletin' }, { key: 'nom', label: 'Employé' }, { key: 'telephone', label: 'Téléphone' },
        { key: 'mode', label: 'Mode de paiement' }, { key: 'montant', label: 'Montant net (FCFA)', money: true }, { key: 'statut', label: 'Statut' },
      ],
      lignes, totaux: { nom: 'TOTAL', montant: total },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="paiements-${req.query.group || 'tous'}-${month}.csv"`);
    res.send(csv);
  } catch (err) {
    repondre(res, err);
  }
});

// PUT /salaries/:userId - configurer le salaire d'un employé (+ nombre de parts
// fiscales, utilisé par le quotient familial dans le calcul de l'IRPP).
// Un changement de montant est ajouté à l'historique des salaires (effet immédiat).
router.put('/:userId', async (req, res) => {
  const client = await pool.connect();
  try {
    const { monthlySalary, paymentMethod, partsFiscales, recurringBonuses, ipresEnabled, cssEnabled } = req.body;
    if (!monthlySalary || monthlySalary <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
    }
    if (!MOYENS_PAIEMENT.includes(paymentMethod)) {
      return res.status(400).json({ error: 'Méthode de paiement invalide' });
    }
    const parts = partsFiscales ? Number(partsFiscales) : 1;
    if (parts < 1) {
      return res.status(400).json({ error: 'Le nombre de parts fiscales doit être au moins 1.' });
    }
    if (!UUID_RE.test(req.params.userId)) return res.status(404).json({ error: 'Employé introuvable.' });
    const emp = await client.query('SELECT id FROM employees WHERE id = $1 AND merchant_id = $2', [req.params.userId, req.user.merchantId]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Employé introuvable.' });

    // Primes/indemnités récurrentes : reprises automatiquement à chaque nouveau bulletin
    const primes = (Array.isArray(recurringBonuses) ? recurringBonuses : [])
      .map((b) => ({ label: String(b.label || '').trim().slice(0, 120), amount: Number(b.amount) }))
      .filter((b) => b.label && Number.isFinite(b.amount) && b.amount !== 0);

    await client.query('BEGIN');
    const avant = await client.query('SELECT monthly_salary FROM employee_salaries WHERE user_id = $1', [req.params.userId]);
    await client.query(
      `INSERT INTO employee_salaries (user_id, monthly_salary, payment_method, parts_fiscales, recurring_bonuses, ipres_enabled, css_enabled)
       VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::boolean, false), COALESCE($7::boolean, false))
       ON CONFLICT (user_id) DO UPDATE SET monthly_salary = $2, payment_method = $3, parts_fiscales = $4, recurring_bonuses = $5::jsonb,
         ipres_enabled = COALESCE($6::boolean, employee_salaries.ipres_enabled),
         css_enabled = COALESCE($7::boolean, employee_salaries.css_enabled), updated_at = now()`,
      [req.params.userId, monthlySalary, paymentMethod, parts, JSON.stringify(primes),
        typeof ipresEnabled === 'boolean' ? ipresEnabled : null, typeof cssEnabled === 'boolean' ? cssEnabled : null]
    );
    if (avant.rows.length === 0 || Number(avant.rows[0].monthly_salary) !== Number(monthlySalary)) {
      await client.query(
        `INSERT INTO employee_salary_history (employee_id, monthly_salary, effective_from, note, created_by)
         VALUES ($1, $2, CURRENT_DATE, $3, $4)`,
        [req.params.userId, monthlySalary, avant.rows.length === 0 ? 'Salaire initial' : 'Modification du salaire', req.user.id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondre(res, err);
  } finally {
    client.release();
  }
});

// Enregistre le paiement d'un employé (dans une transaction ouverte par l'appelant).
// Retourne le montant payé. Le montant est TOUJOURS celui du bulletin courant (net_a_payer).
async function enregistrerPaiement(client, { req, empId, nom, month, mode, warehouseId, batchId = null, montant }) {
  let depenseId = null;
  // Débit caisse seulement si espèces / wave / orange money (pas pour virement)
  if (MODES_CAISSE.includes(mode)) {
    const d = await client.query(
      `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date, movement_type, warehouse_id)
       VALUES ($1, $2, $3, $4, $5, $6::date, 'sortie', $7) RETURNING id`,
      [req.user.merchantId, req.user.id, mode, montant, `Salaire ${nom} - ${month}`, new Date().toISOString().slice(0, 10), warehouseId]
    );
    depenseId = d.rows[0].id;
  }
  await client.query(
    `INSERT INTO salary_payments (user_id, month, amount, payment_method, paid_by, merchant_id, cash_expense_id, warehouse_id, batch_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [empId, month, montant, mode, req.user.id, req.user.merchantId, depenseId, warehouseId, batchId]
  );
}

async function verifierMoisPayable(merchantId, month) {
  if (!MOIS_RE.test(month || '')) throw erreurMetier(400, 'Mois invalide (AAAA-MM).');
  const maxMonth = await calculerMoisMax(merchantId);
  if (month > maxMonth) {
    throw erreurMetier(400, `Vous devez d'abord solder le mois en cours avant d'accéder à ${month}.`);
  }
}

// POST /salaries/:userId/pay - marquer comme payé pour un mois donné.
// Le montant N'EST PLUS libre : il est verrouillé sur le net_a_payer du bulletin courant.
// Si une boutique est connue (corps de la requête, sinon boutique de la fiche) le solde de sa caisse
// est vérifié : jamais de caisse négative.
router.post('/:userId/pay', async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;
    const { month, paymentMethod } = req.body;
    const targetMonth = month || moisActuel();
    if (!UUID_RE.test(userId)) return res.status(404).json({ error: 'Employé introuvable.' });
    if (!MOYENS_PAIEMENT.includes(paymentMethod)) {
      return res.status(400).json({ error: 'Méthode de paiement invalide' });
    }
    await verifierMoisPayable(req.user.merchantId, targetMonth);

    const employee = await client.query('SELECT full_name AS name, warehouse_id FROM employees WHERE id = $1 AND merchant_id = $2', [userId, req.user.merchantId]);
    if (employee.rows.length === 0) return res.status(404).json({ error: 'Employé introuvable.' });
    const employeeName = employee.rows[0].name;

    const bulletin = await client.query(
      `SELECT net_a_payer FROM payslips WHERE user_id = $1 AND month = $2 AND status <> 'remplace'`,
      [userId, targetMonth]
    );
    if (bulletin.rows.length === 0) {
      return res.status(400).json({ error: "Génère d'abord le bulletin de paie de ce mois avant de marquer le paiement." });
    }
    const amount = Number(bulletin.rows[0].net_a_payer);

    let warehouseId = req.body.warehouseId || employee.rows[0].warehouse_id || null;
    if (warehouseId && !UUID_RE.test(String(warehouseId))) warehouseId = null;

    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`salpay:${req.user.merchantId}:${targetMonth}`]);
    const deja = await client.query('SELECT 1 FROM salary_payments WHERE user_id = $1 AND month = $2', [userId, targetMonth]);
    if (deja.rows.length > 0) throw erreurMetier(409, 'Ce mois est déjà payé pour cet employé.');

    if (MODES_CAISSE.includes(paymentMethod) && warehouseId) {
      await verifierCaisse(req, client, warehouseId, paymentMethod, amount);
    }
    await enregistrerPaiement(client, { req, empId: userId, nom: employeeName, month: targetMonth, mode: paymentMethod, warehouseId, montant: amount });
    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'salary_payment',
      description: `a versé le salaire de ${employeeName} (${targetMonth}) - ${Math.round(Number(amount)).toLocaleString('fr-FR')} FCFA via ${LABEL_METHODE[paymentMethod]}`,
    });
    broadcast(req.user.merchantId, 'activity:created', {});
    res.json({ success: true, amount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondre(res, err);
  } finally {
    client.release();
  }
});

// POST /salaries/pay-all { month, warehouseId } — « Payer tout » : paie chaque employé dont le bulletin est
// généré et non encore payé, selon le mode de paiement de sa fiche. Les sorties de caisse sont prises sur la caisse
// de la boutique choisie ; le solde de chaque moyen de paiement est vérifié AVANT toute écriture.
router.post('/pay-all', async (req, res) => {
  const client = await pool.connect();
  try {
    const month = req.body.month || moisActuel();
    await verifierMoisPayable(req.user.merchantId, month);
    await verifierBoutique(client, req.user.merchantId, req.body.warehouseId);
    const warehouseId = req.body.warehouseId;

    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`salpay:${req.user.merchantId}:${month}`]);

    const { rows: aPayer } = await client.query(
      `SELECT e.id, e.full_name, COALESCE(es.payment_method, 'especes') AS mode, p.net_a_payer
       FROM employees e
       JOIN payslips p ON p.user_id = e.id AND p.month = $2 AND p.status <> 'remplace'
       LEFT JOIN employee_salaries es ON es.user_id = e.id
       WHERE e.merchant_id = $1 AND NOT EXISTS (SELECT 1 FROM salary_payments sp WHERE sp.user_id = e.id AND sp.month = $2)
       ORDER BY e.full_name`,
      [req.user.merchantId, month]
    );
    const sansBulletin = await client.query(
      `SELECT e.full_name ${SQL_EMPLOYES_DU_MOIS}
         AND NOT EXISTS (SELECT 1 FROM payslips p WHERE p.user_id = e.id AND p.month = $2 AND p.status <> 'remplace')
         AND NOT EXISTS (SELECT 1 FROM salary_payments sp WHERE sp.user_id = e.id AND sp.month = $2)
       ORDER BY e.full_name`,
      [req.user.merchantId, month]
    );
    if (aPayer.length === 0) {
      throw erreurMetier(400, sansBulletin.rows.length > 0
        ? "Aucun bulletin à payer : générez d'abord les bulletins du mois."
        : 'Tous les employés sont déjà payés pour ce mois.');
    }

    // Contrôle de caisse par moyen de paiement, sur la somme à sortir.
    const parMode = {};
    aPayer.forEach((r) => {
      if (MODES_CAISSE.includes(r.mode)) parMode[r.mode] = (parMode[r.mode] || 0) + Number(r.net_a_payer);
    });
    for (const [mode, somme] of Object.entries(parMode)) {
      await verifierCaisse(req, client, warehouseId, mode, somme);
    }

    const total = aPayer.reduce((s, r) => s + Number(r.net_a_payer), 0);
    const lot = await client.query(
      `INSERT INTO salary_payment_batches (merchant_id, month, warehouse_id, total, employees_count, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.merchantId, month, warehouseId, total, aPayer.length, req.user.id]
    );
    for (const r of aPayer) {
      await enregistrerPaiement(client, {
        req, empId: r.id, nom: r.full_name, month, mode: r.mode, warehouseId, batchId: lot.rows[0].id, montant: Number(r.net_a_payer),
      });
    }
    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'salary_payment_batch',
      description: `a payé les salaires de ${month} en une fois : ${aPayer.length} employé(s), ${Math.round(total).toLocaleString('fr-FR')} FCFA`,
    });
    broadcast(req.user.merchantId, 'activity:created', {});
    res.json({
      success: true, batchId: lot.rows[0].id, total,
      paid: aPayer.map((r) => ({ id: r.id, name: r.full_name, method: r.mode, amount: Number(r.net_a_payer) })),
      withoutPayslip: sansBulletin.rows.map((r) => r.full_name),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondre(res, err);
  } finally {
    client.release();
  }
});

// GET /salaries/alert - employés non payés pour le mois concerné par le rappel
// (voir JOUR_DEBUT_RAPPEL / JOUR_FIN_RAPPEL_RETARD) ; `month` indique ce mois.
router.get('/alert', async (req, res) => {
  try {
    const day = new Date().getDate();
    let month;
    if (day >= JOUR_DEBUT_RAPPEL) {
      month = moisActuel();
    } else if (day <= JOUR_FIN_RAPPEL_RETARD) {
      month = moisPrecedent(moisActuel());
    } else {
      return res.json({ show: false, unpaid: [] });
    }

    const { rows } = await pool.query(
      `SELECT e.id, e.full_name AS name ${SQL_EMPLOYES_DU_MOIS}
         AND NOT EXISTS (SELECT 1 FROM salary_payments sp WHERE sp.user_id = e.id AND sp.month = $2)
       ORDER BY e.full_name`,
      [req.user.merchantId, month]
    );
    res.json({ show: rows.length > 0, unpaid: rows, month });
  } catch (err) {
    repondre(res, err);
  }
});

module.exports = router;
