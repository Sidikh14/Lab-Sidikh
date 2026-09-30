const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { getMaintenance, reponseMaintenance } = require('./maintenance');

// Vérifie le token JWT et attache l'utilisateur (id, merchantId, role) à la requête.
// Toutes les routes protégées passent par ce middleware : c'est lui qui garantit
// qu'un commerçant ne peut jamais accéder aux données d'un autre.
//
// Les tokens n'expirent plus (session illimitée) : on revérifie donc à chaque
// requête que le compte et son commerçant sont toujours actifs, pour qu'un
// blocage effectué par un manager/owner coupe l'accès immédiatement au lieu
// d'attendre une expiration qui n'arrivera jamais.
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      `SELECT u.is_active, u.warehouse_id, m.is_active AS merchant_is_active, m.sector AS merchant_sector,
              COALESCE((SELECT array_agg(uw.warehouse_id) FROM user_warehouses uw WHERE uw.user_id = u.id), '{}') AS warehouse_ids
       FROM users u
       LEFT JOIN merchants m ON m.id = u.merchant_id
       WHERE u.id = $1`,
      [payload.sub]
    );
    const account = result.rows[0];

    if (!account || !account.is_active) {
      return res.status(401).json({ error: 'Compte désactivé.' });
    }
    if (payload.role !== 'owner' && account.merchant_is_active === false) {
      return res.status(403).json({ error: 'Ce commerce a été suspendu. Contactez le support.' });
    }

    // Maintenance par secteur (pilotée depuis le panel owner) : les comptes
    // du secteur concerné reçoivent un 503 "maintenance". L'owner n'a pas
    // de commerçant, donc n'est jamais bloqué.
    if (payload.role !== 'owner' && account.merchant_sector) {
      const maintenance = await getMaintenance(account.merchant_sector);
      if (maintenance.enabled) return reponseMaintenance(res, maintenance);
    }

    // Lieux d'affectation lus en base à chaque requête (et non dans le token,
    // qui n'expire jamais) : une réaffectation s'applique immédiatement.
    // warehouseId = lieu principal ; warehouseIds = tous les lieux (un gérant
    // peut en avoir plusieurs). Le manager n'a aucune affectation.
    const estManager = payload.role === 'manager';
    const principal = estManager ? null : (account.warehouse_id || payload.warehouseId || null);
    const ids = estManager ? [] : Array.from(new Set([...(account.warehouse_ids || []), ...(principal ? [principal] : [])]));

    req.user = {
      id: payload.sub,
      merchantId: payload.merchantId,
      role: payload.role,
      warehouseId: principal,
      warehouseIds: ids,
      sector: payload.sector || null,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

module.exports = { authenticate };
