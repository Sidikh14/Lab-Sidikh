const jwt = require('jsonwebtoken');
const pool = require('../config/db');

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
      `SELECT u.is_active, m.is_active AS merchant_is_active
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

    req.user = {
      id: payload.sub,
      merchantId: payload.merchantId,
      role: payload.role,
      warehouseId: payload.warehouseId || null,
      sector: payload.sector || null,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

module.exports = { authenticate };
