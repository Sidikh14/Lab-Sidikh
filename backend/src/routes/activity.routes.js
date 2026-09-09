const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Manager et gérant voient l'activité de toute l'équipe ; les autres rôles
// (vendeur, caissier) ne voient que leurs propres actions.
function estLimiteAuxSiennes(role) {
  return !['manager', 'gerant'].includes(role);
}

async function recupererActivite(req, dateDebut, dateFin) {
  const limite = estLimiteAuxSiennes(req.user.role);
  const params = limite
    ? [req.user.merchantId, dateDebut, dateFin, req.user.id]
    : [req.user.merchantId, dateDebut, dateFin];
  const filtreUtilisateur = (colonne) => (limite ? `AND ${colonne} = $4` : '');

  const ordersResult = await pool.query(
    `SELECT o.id, 'vente' AS type, o.total_amount AS montant, o.created_at,
            u.full_name AS user_name, c.full_name AS client_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.created_by
     LEFT JOIN clients c ON c.id = o.client_id
     WHERE o.merchant_id = $1 AND o.created_at >= $2 AND o.created_at < $3
     ${filtreUtilisateur('o.created_by')}
     ORDER BY o.created_at DESC LIMIT 300`,
    params
  );

  const encaissementsResult = await pool.query(
    `SELECT o.id, 'encaissement' AS type, o.total_amount AS montant, o.payment_method, o.validated_at AS created_at,
            u.full_name AS user_name, c.full_name AS client_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.validated_by
     LEFT JOIN clients c ON c.id = o.client_id
     WHERE o.merchant_id = $1 AND o.validated_at >= $2 AND o.validated_at < $3
     ${filtreUtilisateur('o.validated_by')}
     ORDER BY o.validated_at DESC LIMIT 300`,
    params
  );

  const livraisonsResult = await pool.query(
    `SELECT o.id, 'livraison' AS type, o.total_amount AS montant, o.delivered_at AS created_at,
            u.full_name AS user_name, c.full_name AS client_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.delivered_by
     LEFT JOIN clients c ON c.id = o.client_id
     WHERE o.merchant_id = $1 AND o.delivered_at >= $2 AND o.delivered_at < $3
     ${filtreUtilisateur('o.delivered_by')}
     ORDER BY o.delivered_at DESC LIMIT 300`,
    params
  );

  const stockResult = await pool.query(
    `SELECT sm.id, 'stock' AS type, sm.movement_type, sm.quantity, sm.created_at,
            u.full_name AS user_name, p.name AS product_name, s.name AS supplier_name
     FROM stock_movements sm
     LEFT JOIN users u ON u.id = sm.user_id
     LEFT JOIN products p ON p.id = sm.product_id
     LEFT JOIN suppliers s ON s.id = sm.supplier_id
     WHERE sm.merchant_id = $1 AND sm.created_at >= $2 AND sm.created_at < $3
     ${filtreUtilisateur('sm.user_id')}
     ORDER BY sm.created_at DESC LIMIT 300`,
    params
  );

  const journalResult = await pool.query(
    `SELECT al.id, 'journal' AS type, al.description, al.created_at, u.full_name AS user_name
     FROM activity_log al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.merchant_id = $1 AND al.created_at >= $2 AND al.created_at < $3
     ${filtreUtilisateur('al.user_id')}
     ORDER BY al.created_at DESC LIMIT 300`,
    params
  );

  return [
    ...ordersResult.rows,
    ...encaissementsResult.rows,
    ...livraisonsResult.rows,
    ...stockResult.rows,
    ...journalResult.rows,
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// GET /activity/today — utilisé par le tableau de bord (Pilotage)
router.get('/today', async (req, res) => {
  try {
    const debut = new Date();
    debut.setHours(0, 0, 0, 0);
    const fin = new Date(debut);
    fin.setDate(fin.getDate() + 1);

    const activite = await recupererActivite(req, debut.toISOString(), fin.toISOString());
    res.json(activite.slice(0, 30));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la récupération de l'activité." });
  }
});

// GET /activity/range?from=2026-01-01&to=2026-01-15
router.get('/range', async (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'Les dates "from" et "to" sont requises (AAAA-MM-JJ).' });
  }

  try {
    const debut = new Date(`${from}T00:00:00`);
    const fin = new Date(`${to}T00:00:00`);
    fin.setDate(fin.getDate() + 1);

    if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) {
      return res.status(400).json({ error: 'Format de date invalide.' });
    }

    const activite = await recupererActivite(req, debut.toISOString(), fin.toISOString());
    res.json(activite);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la récupération de l'activité." });
  }
});

module.exports = router;
