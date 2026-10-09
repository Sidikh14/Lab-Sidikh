// payrollCash.js — contrôles de caisse partagés par les avances et le paiement des salaires.
const { getSoldeActuel, LABEL_METHODE } = require('./cashBalance');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Modes qui passent par la caisse d'une boutique (le virement n'y passe pas).
const MODES_CAISSE = ['especes', 'wave', 'orange_money'];

function erreurMetier(statut, message) {
  return Object.assign(new Error(message), { statut });
}

// Boutique valide du commerçant (lance une erreur 400 sinon).
async function verifierBoutique(db, merchantId, warehouseId) {
  if (!UUID_RE.test(String(warehouseId || ''))) {
    throw erreurMetier(400, 'Choisissez la boutique dont la caisse effectue le paiement.');
  }
  const w = await db.query('SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2', [warehouseId, merchantId]);
  if (w.rows.length === 0) throw erreurMetier(400, 'Boutique introuvable.');
}

// Sortie de caisse : boutique valide + solde suffisant (jamais de caisse négative).
async function verifierCaisse(req, db, warehouseId, mode, montant) {
  await verifierBoutique(db, req.user.merchantId, warehouseId);
  const solde = await getSoldeActuel(req, warehouseId, mode);
  if (solde < montant) {
    throw erreurMetier(
      400,
      `Solde insuffisant sur ${LABEL_METHODE[mode] || mode} (solde actuel : ${Math.round(solde).toLocaleString('fr-FR')} FCFA, besoin : ${Math.round(montant).toLocaleString('fr-FR')} FCFA).`
    );
  }
}

module.exports = { UUID_RE, MODES_CAISSE, erreurMetier, verifierBoutique, verifierCaisse };
