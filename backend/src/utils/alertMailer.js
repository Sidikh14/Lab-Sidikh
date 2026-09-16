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

module.exports = { sendAlertMail };
