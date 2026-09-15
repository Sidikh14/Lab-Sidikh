// backend/src/routes/alerts.routes.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

router.use(authenticate);

router.get('/', requireRole('manager', 'gerant'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM alerts WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.merchantId]
  );
  res.json(rows);
});

router.get('/unread-count', requireRole('manager', 'gerant'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM alerts WHERE merchant_id = $1 AND lu = false`,
    [req.user.merchantId]
  );
  res.json(rows[0]);
});

router.patch('/:id/read', requireRole('manager', 'gerant'), async (req, res) => {
  await pool.query(`UPDATE alerts SET lu = true WHERE id = $1 AND merchant_id = $2`, [req.params.id, req.user.merchantId]);
  res.sendStatus(204);
});

module.exports = router;

// À monter dans le fichier principal (app.js / index.js), comme les autres routers :
//   app.use('/push', require('./routes/push.routes'));
//   app.use('/alerts', require('./routes/alerts.routes'));
