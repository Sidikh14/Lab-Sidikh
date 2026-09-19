// backend/src/utils/cashBalance.js
// Extrait de cash.routes.js pour être réutilisable ailleurs (ex :
// products.routes.js, qui doit vérifier le solde disponible AVANT
// d'autoriser un achat de stock au comptant sur une caisse donnée).
// Ne rien dupliquer/réécrire ce calcul ailleurs : toujours importer d'ici,
// pour que /cash/balances et toute autre vérification de solde restent
// strictement cohérents entre eux.

const pool = require('../config/db');

const MOYENS_PAIEMENT = ['especes', 'wave', 'orange_money', 'cheque'];
const LABEL_METHODE = { especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', cheque: 'Chèque', virement: 'Virement' };

// Calcule, pour chaque moyen de paiement, les entrées et sorties d'argent
// survenues entre deux bornes (timestamps ISO). Utilisé pour la clôture du
// jour comme pour un relevé sur une période plus large, ou pour vérifier
// un solde disponible avant une dépense.
async function calculerMouvements(req, debutISO, finISO, warehouseId) {
  const debutDate = debutISO.slice(0, 10);
  const finDate = finISO.slice(0, 10);
  const paramsTs = [req.user.merchantId, debutISO, finISO, warehouseId];
  const paramsDate = [req.user.merchantId, debutDate, finDate, warehouseId];

  const encaissementsResult = await pool.query(
    `SELECT payment_method, COALESCE(SUM(total_amount), 0) AS total
     FROM orders
     WHERE merchant_id = $1 AND validated_at >= $2 AND validated_at < $3 AND payment_method != 'a_credit'
       AND warehouse_id = $4
     GROUP BY payment_method`,
    paramsTs
  );

  const reglementsCreditResult = await pool.query(
    `SELECT payment_method, COALESCE(SUM(amount), 0) AS total
     FROM credit_payments
     WHERE merchant_id = $1 AND created_at >= $2 AND created_at < $3 AND warehouse_id = $4
     GROUP BY payment_method`,
    paramsTs
  );

  const achatsStockResult = await pool.query(
    `SELECT cash_method AS payment_method, COALESCE(SUM(total_cost), 0) AS total
     FROM stock_movements
     WHERE merchant_id = $1 AND created_at >= $2 AND created_at < $3
       AND movement_type = 'entree' AND payment_method = 'comptant' AND warehouse_id = $4
     GROUP BY cash_method`,
    paramsTs
  );

  const reglementsFournisseurResult = await pool.query(
    `SELECT payment_method, COALESCE(SUM(amount), 0) AS total
     FROM supplier_payments
     WHERE merchant_id = $1 AND paid_at >= $2 AND paid_at < $3 AND warehouse_id = $4
     GROUP BY payment_method`,
    paramsTs
  );

  const sortiesResult = await pool.query(
    `SELECT payment_method, COALESCE(SUM(amount), 0) AS total
     FROM cash_expenses
     WHERE merchant_id = $1 AND expense_date >= $2 AND expense_date < $3 AND movement_type = 'sortie' AND warehouse_id = $4
     GROUP BY payment_method`,
    paramsDate
  );

  const entreesManuellesResult = await pool.query(
    `SELECT payment_method, COALESCE(SUM(amount), 0) AS total
     FROM cash_expenses
     WHERE merchant_id = $1 AND expense_date >= $2 AND expense_date < $3 AND movement_type = 'entree' AND warehouse_id = $4
     GROUP BY payment_method`,
    paramsDate
  );

  const parMethode = {};
  MOYENS_PAIEMENT.forEach((m) => {
    parMethode[m] = { encaissements: 0, reglementsCredit: 0, achatsStock: 0, reglementsFournisseur: 0, sorties: 0, entreesManuelles: 0 };
  });

  encaissementsResult.rows.forEach((r) => { if (parMethode[r.payment_method]) parMethode[r.payment_method].encaissements = Number(r.total); });
  reglementsCreditResult.rows.forEach((r) => { if (parMethode[r.payment_method]) parMethode[r.payment_method].reglementsCredit = Number(r.total); });
  achatsStockResult.rows.forEach((r) => { if (r.payment_method && parMethode[r.payment_method]) parMethode[r.payment_method].achatsStock = Number(r.total); });
  reglementsFournisseurResult.rows.forEach((r) => { if (parMethode[r.payment_method]) parMethode[r.payment_method].reglementsFournisseur = Number(r.total); });
  sortiesResult.rows.forEach((r) => { if (parMethode[r.payment_method]) parMethode[r.payment_method].sorties = Number(r.total); });
  entreesManuellesResult.rows.forEach((r) => { if (parMethode[r.payment_method]) parMethode[r.payment_method].entreesManuelles = Number(r.total); });

  MOYENS_PAIEMENT.forEach((m) => {
    const d = parMethode[m];
    d.entrees = d.encaissements + d.reglementsCredit + d.entreesManuelles;
    d.sortiesTotal = d.achatsStock + d.reglementsFournisseur + d.sorties;
    d.theoretical = d.entrees - d.sortiesTotal;
  });

  return parMethode;
}

// Solde théorique actuel (depuis le début de l'activité) pour UNE caisse
// donnée, dans une boutique donnée. Utilisé pour valider une dépense avant
// de l'enregistrer (ex : achat de stock au comptant).
async function getSoldeActuel(req, warehouseId, method) {
  const debut = new Date(0).toISOString();
  const finDate = new Date();
  finDate.setDate(finDate.getDate() + 1);
  const fin = finDate.toISOString();
  const mouvements = await calculerMouvements(req, debut, fin, warehouseId);
  return mouvements[method]?.theoretical ?? 0;
}

module.exports = { MOYENS_PAIEMENT, LABEL_METHODE, calculerMouvements, getSoldeActuel };
