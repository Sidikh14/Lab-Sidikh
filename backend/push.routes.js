// backend/src/routes/push.routes.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

router.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, merchant_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO NOTHING`,
    [req.user.id, req.user.merchantId, endpoint, keys.p256dh, keys.auth]
  );
  await pool.query(`UPDATE users SET alertes_push_actif = true WHERE id = $1`, [req.user.id]);
  res.sendStatus(204);
});

router.post('/unsubscribe', async (req, res) => {
  await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [req.body.endpoint, req.user.id]);
  res.sendStatus(204);
});

module.exports = router;
