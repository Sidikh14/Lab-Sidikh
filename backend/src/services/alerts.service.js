// backend/src/services/alerts.service.js
// Point central : enregistre l'alerte en base, la diffuse en SSE (bannière in-app),
// puis l'envoie sur les canaux (push / e-mail) activés par chaque manager/gérant.

const pool = require('../config/db');
const webpush = require('web-push');
const { sendAlertMail } = require('../utils/alertMailer');
const { broadcast } = require('../utils/eventsBus');

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:alerts@amaterasu.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function creerAlerte({ merchantId, type, titre, message, montant = null, referenceId = null, roles = ['manager', 'gerant'] }) {
  const { rows } = await pool.query(
    `INSERT INTO alerts (merchant_id, type, titre, message, montant, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [merchantId, type, titre, message, montant, referenceId]
  );
  const alerte = rows[0];

  broadcast(merchantId, 'alert:new', alerte); // bannière SSE, réutilise l'infra existante

  const { rows: destinataires } = await pool.query(
    `SELECT id, email, alertes_push_actif, alertes_email_actif
     FROM users
     WHERE merchant_id = $1 AND role::text = ANY($2) AND is_active = true`,
    [merchantId, roles]
  );

  await Promise.all(destinataires.map(async (u) => {
    if (u.alertes_push_actif) await envoyerPush(u.id, titre, message);
    if (u.alertes_email_actif) await sendAlertMail({ to: u.email, subject: titre, text: message });
  }));

  return alerte;
}

async function envoyerPush(userId, titre, message) {
  const { rows: abonnements } = await pool.query(`SELECT * FROM push_subscriptions WHERE user_id = $1`, [userId]);
  const payload = JSON.stringify({ title: titre, body: message });

  await Promise.all(abonnements.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id]); // abonnement expiré/révoqué
      }
    }
  }));
}

async function getSeuilVenteElevee(merchantId) {
  const { rows } = await pool.query(`SELECT seuil_vente_elevee FROM alert_settings WHERE merchant_id = $1`, [merchantId]);
  return rows[0]?.seuil_vente_elevee ?? 500000;
}

// full_name : [À CONFIRMER] — déduit de la convention déjà utilisée pour les
// clients (c.full_name AS client_name dans orders_routes.js). auth.js ne met
// que { id, merchantId, role } dans req.user, donc le nom doit être récupéré
// séparément pour les messages d'alerte.
async function getNomUtilisateur(userId) {
  const { rows } = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [userId]);
  return rows[0]?.full_name || null;
}

module.exports = { creerAlerte, getSeuilVenteElevee, getNomUtilisateur };
