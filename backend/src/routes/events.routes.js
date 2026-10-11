const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { normaliserRoles } = require('../middleware/roles');
const { subscribe, unsubscribe } = require('../utils/eventsBus');

const router = express.Router();

// ⚠️ Pas de router.use(authenticate) ici : l'API EventSource du navigateur
// ne permet pas d'envoyer d'en-tête Authorization personnalisé. Le token
// est donc passé en query string (?token=...) et vérifié à la main.
//
// CETTE VÉRIFICATION DOIT REFLÉTER EXACTEMENT CELLE DE middleware/auth.js
// (même secret, même forme du payload). Je n'ai pas ce fichier sous les
// yeux — à ajuster une fois fourni. Pour l'instant je suppose :
//   - process.env.JWT_SECRET comme secret
//   - un payload contenant { id, merchantId, role }
router.get('/', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).end();

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).end();
  }

  // Compte relu en base : un membre désactivé ne reçoit plus rien, et les rôles sont ceux d'aujourd'hui
  // (le jeton ne les met pas à jour après un changement de rôle).
  let roles;
  try {
    const { rows } = await pool.query('SELECT role, roles, is_active FROM users WHERE id = $1', [payload.sub]);
    if (!rows[0] || !rows[0].is_active) return res.status(401).end();
    roles = normaliserRoles(rows[0].roles, rows[0].role);
  } catch (err) {
    return res.status(500).end();
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  // L'identité (id + rôle du jeton) permet de cibler les alertes : chacun ne reçoit que les siennes.
  subscribe(payload.merchantId, res, { id: payload.sub, role: payload.role, roles });

  // Ping régulier pour garder la connexion ouverte à travers les proxys
  // (Render notamment) qui coupent une connexion HTTP restée silencieuse
  // trop longtemps.
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (err) {
      clearInterval(keepAlive);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe(payload.merchantId, res);
  });
});

module.exports = router;
