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

// Durée du hawl (année lunaire) en jours — ~354 jours (12 mois lunaires).
const DUREE_HAWL_JOURS = 354;

// Calcule, À L'INSTANT T, la valeur du stock + créances clients − dettes
// fournisseurs. Toujours recalculé en direct (rien n'est accumulé) : c'est
// la situation du cycle en cours qui évolue jour après jour tant qu'il
// n'est pas clos.
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
async function calculerValeursZakat(client, merchantId) {
  const stockResult = await client.query(
    `SELECT COALESCE(SUM(p.unit_price * ps.quantity_in_stock), 0) AS valeur
     FROM product_stock ps
     JOIN products p ON p.id = ps.product_id
     WHERE p.merchant_id = $1 AND p.is_active = TRUE`,
    [merchantId]
  );
  const valeurStock = Number(stockResult.rows[0].valeur);

  const creancesResult = await client.query(
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
    [merchantId]
  );
  const creancesClients = Number(creancesResult.rows[0].total);

  const dettesResult = await client.query(
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
    [merchantId]
  );
  const dettesFournisseurs = Number(dettesResult.rows[0].total);

  const base = Math.max(0, valeurStock + creancesClients - dettesFournisseurs);
  const montant = base * 0.025;

  return { valeurStock, creancesClients, dettesFournisseurs, base, montant };
}

// GET /zakat — cycle de 354 jours (hawl lunaire) :
// - Si aucun cycle n'est ouvert pour ce commerçant, en démarre un nouveau
//   aujourd'hui.
// - Si le cycle ouvert a dépassé 354 jours, il est figé (montants de
//   l'instant enregistrés comme solde final) et un nouveau cycle démarre
//   aussitôt à 0, à la date du jour.
// - Le calcul renvoyé est TOUJOURS celui du cycle actif après cette
//   vérification — en continu, jamais gelé tant que le cycle n'est pas clos.
router.get('/', async (req, res) => {
  if (!SECTEURS_ZAKAT.includes(req.user.sector)) {
    return res.status(403).json({ error: "La zakat n'est pas disponible pour ce secteur." });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let cycleResult = await client.query(
      `SELECT * FROM zakat_cycles WHERE merchant_id = $1 AND closed_at IS NULL FOR UPDATE`,
      [req.user.merchantId]
    );
    let cycle = cycleResult.rows[0];

    if (!cycle) {
      const cree = await client.query(
        `INSERT INTO zakat_cycles (merchant_id, cycle_start) VALUES ($1, CURRENT_DATE) RETURNING *`,
        [req.user.merchantId]
      );
      cycle = cree.rows[0];
    }

    let joursEcoules = Math.floor((Date.now() - new Date(cycle.cycle_start).getTime()) / 86400000);

    if (joursEcoules >= DUREE_HAWL_JOURS) {
      // Hawl complet : on fige le cycle avec les valeurs de l'instant, puis
      // on en ouvre un nouveau à 0 à partir d'aujourd'hui.
      const valeursCloture = await calculerValeursZakat(client, req.user.merchantId);
      await client.query(
        `UPDATE zakat_cycles
         SET closed_at = now(), valeur_stock = $1, creances_clients = $2, dettes_fournisseurs = $3, base = $4, montant = $5
         WHERE id = $6`,
        [valeursCloture.valeurStock, valeursCloture.creancesClients, valeursCloture.dettesFournisseurs, valeursCloture.base, valeursCloture.montant, cycle.id]
      );
      const nouveau = await client.query(
        `INSERT INTO zakat_cycles (merchant_id, cycle_start) VALUES ($1, CURRENT_DATE) RETURNING *`,
        [req.user.merchantId]
      );
      cycle = nouveau.rows[0];
      joursEcoules = 0;
    }

    const valeurs = await calculerValeursZakat(client, req.user.merchantId);

    const historiqueResult = await client.query(
      `SELECT cycle_start, closed_at, valeur_stock, creances_clients, dettes_fournisseurs, base, montant
       FROM zakat_cycles
       WHERE merchant_id = $1 AND closed_at IS NOT NULL
       ORDER BY closed_at DESC
       LIMIT 12`,
      [req.user.merchantId]
    );

    await client.query('COMMIT');

    res.json({
      ...valeurs,
      taux: 0.025,
      cycleStart: cycle.cycle_start,
      dureeHawlJours: DUREE_HAWL_JOURS,
      joursEcoules,
      joursRestants: Math.max(0, DUREE_HAWL_JOURS - joursEcoules),
      historique: historiqueResult.rows,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul de la zakat.' });
  } finally {
    client.release();
  }
});

module.exports = router;
