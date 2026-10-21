// backend/src/utils/alertMailer.js
// Volontairement séparé de l'ancien utils/mailer.js (relances client, abandonné)
// pour ne pas raviver le bug du require cassé rencontré lors d'un déploiement précédent.

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendAlertMail({ to, subject, text }) {
  await transporter.sendMail({
    from: process.env.ALERT_EMAIL_FROM || '"Amaterasu Alertes" <alertes@amaterasu.app>',
    to,
    subject,
    text,
  });
}

// Utilisé pour les envois avec pièce jointe (ex. bulletins de paie en PDF).
// L'adresse technique d'envoi reste celle du serveur SMTP (ALERT_EMAIL_FROM) — un compte
// sur Render n'est pas autorisé à usurper le domaine mail du commerçant. En revanche, le nom
// affiché reprend le nom de l'entreprise (fromName) et replyTo redirige les réponses du
// salarié vers le mail renseigné par l'entreprise dans sa page Entreprise, pour que l'échange
// se passe bien avec l'entreprise et non avec Amaterasu.
async function sendMailWithAttachments({ to, subject, text, attachments, fromName, replyTo }) {
  await transporter.sendMail({
    from: fromName
      ? `"${fromName}" <${process.env.ALERT_EMAIL_FROM_ADDRESS || process.env.SMTP_USER}>`
      : process.env.ALERT_EMAIL_FROM || '"Amaterasu Alertes" <alertes@amaterasu.app>',
    to,
    subject,
    text,
    attachments,
    ...(replyTo ? { replyTo } : {}),
  });
}

module.exports = { sendAlertMail, sendMailWithAttachments };
