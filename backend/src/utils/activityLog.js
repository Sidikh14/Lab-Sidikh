const pool = require('../config/db');
const { broadcast } = require('./eventsBus');

// Enregistre un événement dans activity_log. N'échoue jamais bruyamment :
// une erreur de journalisation ne doit pas faire échouer l'action principale.
//
// Diffuse aussi l'activité en temps réel (SSE) à tous les clients connectés
// du même commerçant — c'est le point central qui couvre automatiquement
// encaissements, annulations, retours vendeur, stock, clôture de caisse,
// etc. sans avoir à ajouter un broadcast dans chaque route une par une.
async function logActivity({ merchantId, userId, action, description }) {
  try {
    const result = await pool.query(
      `INSERT INTO activity_log (merchant_id, user_id, action, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [merchantId, userId, action, description]
    );
    broadcast(merchantId, 'activity:created', result.rows[0]);
  } catch (err) {
    console.error('Erreur de journalisation (non bloquante) :', err.message);
  }
}

module.exports = { logActivity };
