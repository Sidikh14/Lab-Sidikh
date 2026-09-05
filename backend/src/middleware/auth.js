const jwt = require('jsonwebtoken');

// Vérifie le token JWT et attache l'utilisateur (id, merchantId, role) à la requête.
// Toutes les routes protégées passent par ce middleware : c'est lui qui garantit
// qu'un commerçant ne peut jamais accéder aux données d'un autre.
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: payload.sub,
      merchantId: payload.merchantId,
      role: payload.role,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

module.exports = { authenticate };
