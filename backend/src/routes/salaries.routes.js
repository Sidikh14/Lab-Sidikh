const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { broadcast } = require('../utils/eventsBus');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('manager'));

const MOYENS_PAIEMENT = ['especes', 'wave', 'orange_money', 'virement'];
const LABEL_METHODE = { especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', virement: 'Virement' };

function moisActuel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function moisSuivant(moisStr) {
  const [annee, mois] = moisStr.split('-').map(Number);
  const d = new Date(annee, mois, 1); // mois est déjà 1-indexé => donne le mois suivant
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Mois le plus avancé accessible : le mois en cours tant qu'il n'est pas
// entièrement soldé, sinon le mois suivant (jamais plus loin).
async function calculerMoisMax(merchantId) {
  const month = moisActuel();
  const { rows } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE sp.id IS NULL) AS impayes
     FROM users u
     JOIN employee_salaries es ON es.user_id = u.id
     LEFT JOIN salary_payments sp ON sp.user_id = u.id AND sp.month = $2
     WHERE u.merchant_id = $1 AND u.is_active = true`,
    [merchantId, month]
  );
  const toutPaye = Number(rows[0].impayes) === 0;
  return toutPaye ? moisSuivant(month) : month;
}

// GET /salaries/max-month - mois le plus avancé accessible (bloque l'accès au mois
// suivant tant que le mois en cours n'est pas entièrement soldé)
router.get('/max-month', async (req, res) => {
  try {
    const maxMonth = await calculerMoisMax(req.user.merchantId);
    res.json({ maxMonth });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /salaries - liste des employés + salaire configuré + statut du mois en cours
// + statut du bulletin de paie du mois (net_a_payer si généré) : permet au front
// de verrouiller le paiement sur le montant du bulletin sans appel supplémentaire.
router.get('/', async (req, res) => {
  try {
    const month = req.query.month || moisActuel();
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name AS name, u.role,
              es.monthly_salary, es.payment_method, es.parts_fiscales,
              sp.amount AS paid_amount, sp.payment_method AS paid_method, sp.paid_at,
              p.net_a_payer AS payslip_net, p.generated_at AS payslip_generated_at
       FROM users u
       LEFT JOIN employee_salaries es ON es.user_id = u.id
       LEFT JOIN salary_payments sp ON sp.user_id = u.id AND sp.month = $2
       LEFT JOIN payslips p ON p.user_id = u.id AND p.month = $2
       WHERE u.merchant_id = $1 AND u.is_active = true AND u.role != 'manager' AND u.role != 'owner'
       ORDER BY u.full_name`,
      [req.user.merchantId, month]
    );
    res.json({ month, employees: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /salaries/:userId - configurer le salaire d'un employé (+ nombre de parts
// fiscales, utilisé par le quotient familial dans le calcul de l'IRPP)
router.put('/:userId', async (req, res) => {
  try {
    const { monthlySalary, paymentMethod, partsFiscales } = req.body;
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
    await pool.query(
      `INSERT INTO employee_salaries (user_id, monthly_salary, payment_method, parts_fiscales)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET monthly_salary = $2, payment_method = $3, parts_fiscales = $4, updated_at = now()`,
      [req.params.userId, monthlySalary, paymentMethod, parts]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /salaries/:userId/pay - marquer comme payé pour un mois donné.
// Le montant N'EST PLUS libre : s'il existe un bulletin de paie généré pour ce
// mois, le montant versé est verrouillé sur son net_a_payer (le corps de la
// requête ne peut pas le modifier) — évite de payer un montant différent de
// celui calculé/imprimé sur le bulletin remis à l'employé.
router.post('/:userId/pay', async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;
    const { month, paymentMethod } = req.body;
    const targetMonth = month || moisActuel();

    if (!MOYENS_PAIEMENT.includes(paymentMethod)) {
      return res.status(400).json({ error: 'Méthode de paiement invalide' });
    }

    const maxMonth = await calculerMoisMax(req.user.merchantId);
    if (targetMonth > maxMonth) {
      return res.status(400).json({ error: `Vous devez d'abord solder le mois en cours avant d'accéder à ${targetMonth}.` });
    }

    const bulletin = await client.query(
      `SELECT net_a_payer FROM payslips WHERE user_id = $1 AND month = $2`,
      [userId, targetMonth]
    );
    if (bulletin.rows.length === 0) {
      return res.status(400).json({ error: "Génère d'abord le bulletin de paie de ce mois avant de marquer le paiement." });
    }
    const amount = Number(bulletin.rows[0].net_a_payer);

    await client.query('BEGIN');

    const employee = await client.query('SELECT full_name AS name FROM users WHERE id = $1', [userId]);
    if (employee.rows.length === 0) throw new Error('Employé introuvable');
    const employeeName = employee.rows[0].name;

    await client.query(
      `INSERT INTO salary_payments (user_id, month, amount, payment_method, paid_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, month) DO UPDATE
         SET amount = $3, payment_method = $4, paid_by = $5, paid_at = now()`,
      [userId, targetMonth, amount, paymentMethod, req.user.id]
    );

    // Débit caisse seulement si espèces / wave / orange money (pas pour virement)
    if (paymentMethod !== 'virement') {
      await client.query(
        `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          req.user.merchantId,
          req.user.id,
          paymentMethod,
          amount,
          `Salaire ${employeeName} - ${targetMonth}`,
          new Date().toISOString().slice(0, 10),
        ]
      );
    }

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
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// GET /salaries/alert - employés non payés ce mois, actif seulement entre le 1er et le 5
router.get('/alert', async (req, res) => {
  try {
    const day = new Date().getDate();
    if (day < 1 || day > 5) return res.json({ show: false, unpaid: [] });

    const month = moisActuel();
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name AS name
       FROM users u
       JOIN employee_salaries es ON es.user_id = u.id
       LEFT JOIN salary_payments sp ON sp.user_id = u.id AND sp.month = $2
       WHERE u.merchant_id = $1 AND u.is_active = true AND sp.id IS NULL`,
      [req.user.merchantId, month]
    );
    res.json({ show: rows.length > 0, unpaid: rows, month });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
