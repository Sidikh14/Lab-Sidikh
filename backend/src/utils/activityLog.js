const pool = require('../config/db');

// Enregistre un événement dans activity_log. N'échoue jamais bruyamment :
// une erreur de journalisation ne doit pas faire échouer l'action principale.
async function logActivity({ merchantId, userId, action, description }) {
  try {
    await pool.query(
      `INSERT INTO activity_log (merchant_id, user_id, action, description)
       VALUES ($1, $2, $3, $4)`,
      [merchantId, userId, action, description]
    );
  } catch (err) {
    console.error('Erreur de journalisation (non bloquante) :', err.message);
  }
}

module.exports = { logActivity };
