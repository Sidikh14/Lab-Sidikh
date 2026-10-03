const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /modules/access — modules activés par l'owner pour ce commerçant (menu latéral).
router.get('/access', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT accounting_enabled, payroll_enabled, fiscalite_enabled FROM merchants WHERE id = $1`,
      [req.user.merchantId]
    );
    const m = r.rows[0] || {};
    res.json({
      accounting: m.accounting_enabled === true,
      payroll: m.payroll_enabled === true,
      fiscalite: m.fiscalite_enabled === true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
