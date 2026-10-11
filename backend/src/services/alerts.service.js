// backend/src/services/alerts.service.js
// Point central : enregistre l'alerte en base, la diffuse en SSE (bannière in-app),
// puis l'envoie sur les canaux (push / e-mail) activés par chaque manager/gérant.

const pool = require('../config/db');
const webpush = require('web-push');
const { sendAlertMail } = require('../utils/alertMailer');
const { broadcastCible } = require('../utils/eventsBus');
const { normaliserRoles } = require('../middleware/roles');

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:alerts@amaterasu.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function creerAlerte({ merchantId, type, titre, message, montant = null, referenceId = null, roles = ['manager', 'gerant'], userIds = null }) {
  const { rows } = await pool.query(
    `INSERT INTO alerts (merchant_id, type, titre, message, montant, reference_id, destinataires_roles, destinataires_users)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    // Qui peut voir l'alerte : des personnes précises (userIds) ou, à défaut, des rôles.
    [merchantId, type, titre, message, montant, referenceId, userIds ? null : roles, userIds || null]
  );
  const alerte = rows[0];

  // Bannière SSE, envoyée seulement aux personnes concernées par l'alerte.
  broadcastCible(merchantId, 'alert:new', alerte, { roles, userIds });

  // userIds cible des personnes précises (ex : le vendeur qui a créé la
  // commande), indépendamment de leur rôle. Sans userIds, on retombe sur le
  // ciblage par rôle habituel.
  const { rows: destinataires } = userIds
    ? await pool.query(
        `SELECT id, email, alertes_push_actif, alertes_email_actif
         FROM users
         WHERE merchant_id = $1 AND id = ANY($2) AND is_active = true`,
        [merchantId, userIds]
      )
    : await pool.query(
        `SELECT id, email, role, roles, alertes_push_actif, alertes_email_actif
         FROM users
         WHERE merchant_id = $1 AND is_active = true`,
        [merchantId]
      ).then((r) => ({
        // Une personne peut cumuler plusieurs rôles (ex. vendeur + caissier) : elle est concernée dès que
        // l'un d'eux figure dans la liste visée.
        rows: r.rows.filter((u) => normaliserRoles(u.roles, u.role).some((x) => roles.includes(x))),
      }));

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
