const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../services/activity.service'); // adapter au nom réel de ton service
const { broadcast } = require('../sse'); // adapter au nom réel de ton module SSE

router.use(requireAuth, requireRole('manager'));

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// GET /salaries - liste des employés + salaire configuré + statut du mois en cours
router.get('/', async (req, res) => {
  try {
    const month = req.query.month || currentMonth();
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.role,
              es.monthly_salary, es.payment_method,
              sp.amount AS paid_amount, sp.payment_method AS paid_method, sp.paid_at
       FROM users u
       LEFT JOIN employee_salaries es ON es.user_id = u.id
       LEFT JOIN salary_payments sp ON sp.user_id = u.id AND sp.month = $2
       WHERE u.merchant_id = $1 AND u.is_active = true AND u.role != 'manager' AND u.role != 'owner'
       ORDER BY u.name`,
      [req.user.merchantId, month]
    );
    res.json({ month, employees: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /salaries/:userId - configurer le salaire d'un employé
router.put('/:userId', async (req, res) => {
  try {
    const { monthlySalary, paymentMethod } = req.body;
    if (!monthlySalary || monthlySalary <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
    }
    if (!['espece', 'virement', 'wave', 'orange_money'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'Méthode de paiement invalide' });
    }
    await pool.query(
      `INSERT INTO employee_salaries (user_id, monthly_salary, payment_method)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET monthly_salary = $2, payment_method = $3, updated_at = now()`,
      [req.params.userId, monthlySalary, paymentMethod]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /salaries/:userId/pay - marquer comme payé pour un mois donné
router.post('/:userId/pay', async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;
    const { month, amount, paymentMethod } = req.body;
    const targetMonth = month || currentMonth();

    if (!amount || amount <= 0) return res.status(400).json({ error: 'Montant invalide' });
    if (!['espece', 'virement', 'wave', 'orange_money'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'Méthode de paiement invalide' });
    }

    await client.query('BEGIN');

    const employee = await client.query('SELECT name FROM users WHERE id = $1', [userId]);
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
        `INSERT INTO cash_expenses (merchant_id, amount, payment_method, description, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          req.user.merchantId,
          amount,
          paymentMethod,
          `Salaire ${employeeName} - ${targetMonth}`,
          req.user.id,
        ]
      );
    }

    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      type: 'salary_payment',
      description: `Salaire versé à ${employeeName} (${targetMonth}) - ${amount} FCFA via ${paymentMethod}`,
    });

    broadcast(req.user.merchantId, 'activity:created', {});

    res.json({ success: true });
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

    const month = currentMonth();
    const { rows } = await pool.query(
      `SELECT u.id, u.name
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
