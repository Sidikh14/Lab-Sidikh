const pool = require('../config/db');

// Modules activables par l'owner, commerçant par commerçant.
// nom du module -> colonne booléenne de la table merchants.
const COLONNES = { comptabilite: 'accounting_enabled' };

// À placer APRÈS authenticate : refuse (403) si le module n'a pas été activé
// pour le commerçant du compte connecté.
function requireModule(nom) {
  const colonne = COLONNES[nom];
  return async (req, res, next) => {
    try {
      if (!colonne || !req.user?.merchantId) {
        return res.status(403).json({ error: "Ce module n'est pas disponible.", code: 'module_disabled' });
      }
      const result = await pool.query(`SELECT ${colonne} AS actif FROM merchants WHERE id = $1`, [req.user.merchantId]);
      if (result.rows[0]?.actif === true) return next();
      return res.status(403).json({ error: "Ce module n'est pas activé pour votre compte.", code: 'module_disabled' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erreur interne du serveur.' });
    }
  };
}

module.exports = { requireModule };
