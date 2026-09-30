const pool = require('../config/db');

// État de maintenance par secteur, gardé en mémoire 10 s pour ne pas
// interroger la base à chaque requête authentifiée.
const TTL_MS = 10000;
let cache = { at: 0, map: new Map() };

async function getMaintenance(sector) {
  if (!sector) return { enabled: false };

  if (Date.now() - cache.at > TTL_MS) {
    try {
      const result = await pool.query(
        'SELECT sector, is_enabled, message, return_at FROM maintenance_secteurs'
      );
      cache = { at: Date.now(), map: new Map(result.rows.map((r) => [r.sector, r])) };
    } catch (err) {
      // Table absente ou base indisponible : on ne bloque jamais tout le monde.
      console.error('Lecture maintenance_secteurs impossible :', err.message);
      cache = { at: Date.now(), map: new Map() };
    }
  }

  const row = cache.map.get(sector);
  if (!row || !row.is_enabled) return { enabled: false };
  return { enabled: true, sector, message: row.message, returnAt: row.return_at };
}

function invalidateMaintenanceCache() {
  cache.at = 0;
}

function reponseMaintenance(res, etat) {
  return res.status(503).json({
    error: 'Mise à jour en cours. Le logiciel sera de nouveau disponible très bientôt.',
    code: 'maintenance',
    sector: etat.sector,
    message: etat.message || null,
    returnAt: etat.returnAt || null,
  });
}

module.exports = { getMaintenance, invalidateMaintenanceCache, reponseMaintenance };
