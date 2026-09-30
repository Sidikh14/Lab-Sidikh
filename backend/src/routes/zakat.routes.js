const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('manager', 'gerant'));

// Secteurs pour lesquels la zakat sur les biens de commerce (zakat al-tijara)
// s'applique dans l'appli — à garder synchronisé si d'autres secteurs
// doivent l'avoir un jour.
const SECTEURS_ZAKAT = ['grossiste', 'electromenager'];

// GET /zakat — calcule la zakat sur les biens de commerce :
//   2,5 % × (valeur du stock + créances clients − dettes fournisseurs)
//
// - Valeur du stock : prix de vente × quantité en stock, TOUTES boutiques du
//   commerçant confondues — même convention que la carte "Valeur du stock"
//   du tableau de bord (qui elle ne calcule que sur une boutique).
// - Créances clients : ventes à crédit non soldées. Une créance négative
//   pour un client (trop payé) est ramenée à 0 — elle ne doit pas réduire
//   la base d'un autre client.
// - Dettes fournisseurs : achats à crédit non réglés, même règle de clamp.
// - La base (stock + créances − dettes) est elle-même ramenée à 0 si les
//   dettes dépassent le reste — la zakat n'est jamais négative.
router.get('/', async (req, res) => {
  if (!SECTEURS_ZAKAT.includes(req.user.sector)) {
    return res.status(403).json({ error: "La zakat n'est pas disponible pour ce secteur." });
  }
  try {
    const stockResult = await pool.query(
      `SELECT COALESCE(SUM(p.unit_price * ps.quantity_in_stock), 0) AS valeur
       FROM product_stock ps
       JOIN products p ON p.id = ps.product_id
       WHERE p.merchant_id = $1 AND p.is_active = TRUE`,
      [req.user.merchantId]
    );
    const valeurStock = Number(stockResult.rows[0].valeur);

    const creancesResult = await pool.query(
      `SELECT COALESCE(SUM(GREATEST(0, COALESCE(credit.total, 0) - COALESCE(paiements.total, 0))), 0) AS total
       FROM clients c
       LEFT JOIN (
         SELECT client_id, SUM(total_amount) AS total
         FROM orders
         WHERE merchant_id = $1 AND payment_method = 'a_credit' AND status != 'annulee'
         GROUP BY client_id
       ) credit ON credit.client_id = c.id
       LEFT JOIN (
         SELECT client_id, SUM(amount) AS total
         FROM credit_payments
         WHERE merchant_id = $1
         GROUP BY client_id
       ) paiements ON paiements.client_id = c.id
       WHERE c.merchant_id = $1`,
      [req.user.merchantId]
    );
    const creancesClients = Number(creancesResult.rows[0].total);

    const dettesResult = await pool.query(
      `SELECT COALESCE(SUM(GREATEST(0, COALESCE(entrees.total, 0) - COALESCE(paiements.total, 0))), 0) AS total
       FROM suppliers s
       LEFT JOIN (
         SELECT supplier_id, SUM(total_cost) AS total
         FROM stock_movements
         WHERE merchant_id = $1 AND movement_type = 'entree' AND payment_method = 'a_credit'
         GROUP BY supplier_id
       ) entrees ON entrees.supplier_id = s.id
       LEFT JOIN (
         SELECT supplier_id, SUM(amount) AS total
         FROM supplier_payments
         WHERE merchant_id = $1
         GROUP BY supplier_id
       ) paiements ON paiements.supplier_id = s.id
       WHERE s.merchant_id = $1 AND s.is_active = TRUE`,
      [req.user.merchantId]
    );
    const dettesFournisseurs = Number(dettesResult.rows[0].total);

    const base = Math.max(0, valeurStock + creancesClients - dettesFournisseurs);
    const montant = base * 0.025;

    res.json({
      valeurStock,
      creancesClients,
      dettesFournisseurs,
      base,
      montant,
      taux: 0.025,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul de la zakat.' });
  }
});

module.exports = router;
