const pool = require('../config/db');

// Numéro de commande lisible (même format que orders_routes.js : CMD-2026-0001).
function numeroCommande(order) {
  const annee = new Date(order.created_at).getFullYear();
  return `CMD-${annee}-${String(order.order_seq).padStart(4, '0')}`;
}

// Détail facture par facture des ventes à crédit d'un client : montant, déjà réglé, reste à payer et statut
// (payee / partielle / impayee).
//
// Un règlement est rattaché à UNE facture (credit_payments.order_id). Les anciens règlements, enregistrés avant
// ce choix (order_id vide), restent répartis de la plus ancienne facture à la plus récente (FIFO), sur ce qu'il
// reste à payer une fois les règlements rattachés déduits. Un règlement rattaché à une facture qui n'existe plus
// (annulée, plus à crédit) retourne dans cette réserve : le client a bien payé cette somme.
async function calculerDetailCreances(merchantId, clientId) {
  const [ventesResult, paiementsResult] = await Promise.all([
    pool.query(
      `SELECT id, order_seq, total_amount, created_at, credit_due_date
       FROM orders
       WHERE client_id = $1 AND merchant_id = $2 AND payment_method = 'a_credit' AND status != 'annulee'
       ORDER BY created_at, id`,
      [clientId, merchantId]
    ),
    pool.query(
      `SELECT order_id, COALESCE(SUM(amount), 0) AS total
       FROM credit_payments
       WHERE client_id = $1 AND merchant_id = $2
       GROUP BY order_id`,
      [clientId, merchantId]
    ),
  ]);

  const idsFactures = new Set(ventesResult.rows.map((v) => v.id));
  const rattaches = new Map();
  let reserve = 0;
  paiementsResult.rows.forEach((p) => {
    const total = Number(p.total);
    if (p.order_id && idsFactures.has(p.order_id)) rattaches.set(p.order_id, total);
    else reserve += total;
  });

  return ventesResult.rows.map((vente) => {
    const montant = Number(vente.total_amount);
    let avance = Math.min(rattaches.get(vente.id) || 0, montant);
    // Un rattachement au-delà du montant (ne devrait pas arriver) retombe dans la réserve.
    reserve += Math.max(0, (rattaches.get(vente.id) || 0) - montant);
    const restant = montant - avance;
    const depuisReserve = Math.min(Math.max(reserve, 0), restant);
    reserve -= depuisReserve;
    avance += depuisReserve;
    const reste = montant - avance;
    return {
      id: vente.id,
      order_seq: vente.order_seq,
      order_number: numeroCommande(vente),
      created_at: vente.created_at,
      credit_due_date: vente.credit_due_date,
      montant,
      avance,
      reste,
      statut: reste <= 0 ? 'payee' : avance > 0 ? 'partielle' : 'impayee',
    };
  });
}

module.exports = { calculerDetailCreances, numeroCommande };
