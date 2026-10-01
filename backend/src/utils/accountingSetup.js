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
}

module.exports = { initialiserComptabilite };
