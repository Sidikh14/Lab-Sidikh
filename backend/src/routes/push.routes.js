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
  // Un même appareil ne peut avoir qu'un seul abonnement push actif (un seul
  // endpoint). Si un autre compte l'avait déjà activé sur ce même téléphone
  // (ex : test avec plusieurs comptes sur le même appareil, ou tablette
  // partagée entre plusieurs caissiers), on réassigne l'abonnement au
  // compte qui vient de cliquer plutôt que de l'ignorer silencieusement —
  // sinon l'ancien titulaire reste seul à recevoir les notifications
  // destinées au nouveau compte.
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, merchant_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       merchant_id = EXCLUDED.merchant_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth`,
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
