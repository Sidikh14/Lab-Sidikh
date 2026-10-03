// Modules payants activés par l'owner de la plateforme, commerçant par commerçant.
// Usage : router.use(requireOwnerModule('paie')) après authenticate.
const pool = require('../config/db');

const COLONNES = {
  comptabilite: 'accounting_enabled',
  paie: 'payroll_enabled',
  fiscalite: 'fiscalite_enabled',
};

async function moduleActif(merchantId, nom) {
  const colonne = COLONNES[nom];
  if (!colonne) throw new Error(`Module inconnu : ${nom}`);
  const r = await pool.query(`SELECT ${colonne} AS actif FROM merchants WHERE id = $1`, [merchantId]);
  return r.rows[0]?.actif === true;
}

// `repliParDefaut` : réponse renvoyée (200) pour certaines routes de simple lecture quand le
// module est désactivé, par exemple { '/alert': { show: false, unpaid: [] } }, afin de ne pas
// faire échouer les écrans qui interrogent ces routes sans savoir si le module est actif.
function requireOwnerModule(nom, repliParDefaut = {}) {
  return async (req, res, next) => {
    try {
      if (await moduleActif(req.user.merchantId, nom)) return next();
      if (req.method === 'GET' && repliParDefaut[req.path] !== undefined) return res.json(repliParDefaut[req.path]);
      return res.status(403).json({ error: "Ce module n'est pas activé pour votre compte." });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

module.exports = { requireOwnerModule, moduleActif, COLONNES };
