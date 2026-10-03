const { COMPTES, JOURNAUX } = require('../data/syscohadaPlan');

// Crée le plan comptable et les journaux d'un commerçant s'ils n'existent pas
// encore (sans jamais écraser ce qui existe déjà : ON CONFLICT DO NOTHING).
async function initialiserComptabilite(client, merchantId) {
  await client.query(
    `INSERT INTO accounting_accounts (merchant_id, code, label)
     SELECT $1, t.code, t.label FROM unnest($2::text[], $3::text[]) AS t(code, label)
     ON CONFLICT (merchant_id, code) DO NOTHING`,
    [merchantId, COMPTES.map((c) => c[0]), COMPTES.map((c) => c[1])]
  );
  await client.query(
    `INSERT INTO accounting_journals (merchant_id, code, label)
     SELECT $1, t.code, t.label FROM unnest($2::text[], $3::text[]) AS t(code, label)
     ON CONFLICT (merchant_id, code) DO NOTHING`,
    [merchantId, JOURNAUX.map((j) => j[0]), JOURNAUX.map((j) => j[1])]
  );
  await initialiserCharges(client, merchantId);
}

// Charges usuelles proposées d'office (ponctuelles, sans montant) pour que le
// caissier puisse payer une facture depuis la Caisse dès l'activation. Créées
// uniquement tant que le commerçant n'a déclaré aucune charge.
const CHARGES_USUELLES = [
  ['Loyer', '622'], ['Électricité / Eau', '605'], ['Téléphone et Internet', '628'], ['Assurance', '625'],
  ['Transport', '618'], ['Frais bancaires', '631'], ['Entretien et réparations', '624'],
  ['Publicité', '627'], ['Impôts et taxes', '641'],
];

async function initialiserCharges(client, merchantId) {
  await client.query(
    `INSERT INTO accounting_charges (merchant_id, label, account_id, payment_method)
     SELECT $1::uuid, t.label, a.id, 'especes'
     FROM unnest($2::text[], $3::text[]) AS t(label, code)
     JOIN accounting_accounts a ON a.merchant_id = $1::uuid AND a.code = t.code
     WHERE NOT EXISTS (SELECT 1 FROM accounting_charges WHERE merchant_id = $1::uuid)`,
    [merchantId, CHARGES_USUELLES.map((c) => c[0]), CHARGES_USUELLES.map((c) => c[1])]
  );
}

module.exports = { initialiserComptabilite, initialiserCharges };
