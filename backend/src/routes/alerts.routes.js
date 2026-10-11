// backend/src/routes/alerts.routes.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { verifierEcheances } = require('../services/echeances.service');

router.use(authenticate);
router.use(requireRole('manager', 'gerant', 'caissier', 'vendeur_caissier'));

// Chaque personne ne voit que les alertes qui lui sont destinées : celles adressées à son rôle, ou à elle
// personnellement (ex. la réponse à une demande de retour). Les anciennes alertes, sans destinataires
// enregistrés, restent visibles du manager et du gérant comme avant.
const VISIBLE = `(
  (destinataires_users IS NOT NULL AND $2::uuid = ANY(destinataires_users))
  OR (destinataires_users IS NULL AND COALESCE(destinataires_roles, ARRAY['manager','gerant']) && $3::text[])
)`;
const params = (req) => [req.user.merchantId, req.user.id, [req.user.role]];

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM alerts WHERE merchant_id = $1 AND ${VISIBLE} ORDER BY created_at DESC LIMIT 50`,
    params(req)
  );
  res.json(rows);
});

router.get('/unread-count', async (req, res) => {
  // Le manager et le gérant qui consultent l'application déclenchent aussi le contrôle des échéances
  // (lots bientôt périmés, déclarations fiscales) : au plus une fois par heure, sans bloquer la réponse.
  if (['manager', 'gerant'].includes(req.user.role)) {
    verifierEcheances(req.user.merchantId, req.user.sector).catch((err) => console.error('Erreur vérification échéances :', err));
  }
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM alerts WHERE merchant_id = $1 AND lu = false AND ${VISIBLE}`,
    params(req)
  );
  res.json(rows[0]);
});

router.patch('/:id/read', async (req, res) => {
  await pool.query(
    `UPDATE alerts SET lu = true WHERE id = $4 AND merchant_id = $1 AND ${VISIBLE}`,
    [...params(req), req.params.id]
  );
  res.sendStatus(204);
});

module.exports = router;

// À monter dans le fichier principal (app.js / index.js), comme les autres routers :
//   app.use('/push', require('./routes/push.routes'));
//   app.use('/alerts', require('./routes/alerts.routes'));
