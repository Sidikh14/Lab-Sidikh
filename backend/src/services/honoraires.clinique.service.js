// Honoraires à reverser aux praticiens (dossier H6).
//
// À appeler depuis le code d'ENCAISSEMENT d'une vente (orders), juste après le passage de la vente
// en statut encaissé, et dans la MÊME transaction que cet encaissement. Ainsi une vente encaissée
// produit toujours ses écritures d'honoraires, et une vente annulée n'en produit jamais.
//
//   const { enregistrerHonorairesCommande } = require('../services/honoraires.clinique.service');
//   await enregistrerHonorairesCommande(dbClient, merchantId, orderId);
//
// Idempotent : une ligne de vente ne donne jamais deux écritures (contrainte UNIQUE sur order_item_id).

// Calcul pur, sans base de données : testable seul.
function calculerHonoraire(reglage, ligne) {
  if (!reglage || reglage.mode === 'salaire') return 0;
  const valeur = Number(reglage.valeur) || 0;
  if (reglage.mode === 'pourcentage') {
    return Math.round((Number(ligne.line_total) || 0) * valeur) / 100;
  }
  if (reglage.mode === 'montant_par_acte') {
    return Math.round((Number(ligne.quantity) || 0) * valeur);
  }
  return 0;
}

async function enregistrerHonorairesCommande(dbClient, merchantId, orderId) {
  const lignes = await dbClient.query(
    `SELECT oi.id AS order_item_id, oi.praticien_id, oi.line_total, oi.quantity
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.order_id = $1 AND o.merchant_id = $2
       AND oi.praticien_id IS NOT NULL`,
    [orderId, merchantId]
  );
  if (lignes.rows.length === 0) return 0;

  const praticiens = [...new Set(lignes.rows.map((l) => l.praticien_id))];
  const reglagesResult = await dbClient.query(
    `SELECT practitioner_id, mode, valeur FROM practitioner_fee_settings
     WHERE merchant_id = $1 AND practitioner_id = ANY($2::uuid[])`,
    [merchantId, praticiens]
  );
  const reglages = new Map(reglagesResult.rows.map((r) => [r.practitioner_id, r]));

  let crees = 0;
  for (const ligne of lignes.rows) {
    const reglage = reglages.get(ligne.praticien_id);
    const montant = calculerHonoraire(reglage, ligne);
    if (!reglage || reglage.mode === 'salaire' || montant <= 0) continue;

    const res = await dbClient.query(
      `INSERT INTO practitioner_fee_entries
         (merchant_id, practitioner_id, order_id, order_item_id, base_montant, montant, mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (order_item_id) DO NOTHING`,
      [merchantId, ligne.praticien_id, orderId, ligne.order_item_id, Number(ligne.line_total) || 0, montant, reglage.mode]
    );
    crees += res.rowCount;
  }
  return crees;
}

module.exports = { enregistrerHonorairesCommande, calculerHonoraire };
