// backend/src/services/echeances.service.js
// Alertes déclenchées par le temps (et non par une action) : lots bientôt périmés (pharmacie) et
// échéances fiscales / retenues sur salaires. Lancé en arrière-plan quand un manager ou un gérant
// utilise l'application, au plus une fois par heure et par commerçant ; chaque alerte n'est créée
// qu'une fois par période (pas de doublon à chaque passage).

const pool = require('../config/db');
const { creerAlerte } = require('./alerts.service');

const SEUIL_PEREMPTION_JOURS = 30; // même seuil que le blocage de vente à l'approche de la péremption
const INTERVALLE_MS = 60 * 60 * 1000;
const dernierPassage = new Map();

async function alertesDejaCreees(merchantId, type, interval) {
  const { rows } = await pool.query(
    `SELECT reference_id, titre, message FROM alerts
     WHERE merchant_id = $1 AND type = $2 AND created_at > now() - $3::interval`,
    [merchantId, type, interval]
  );
  return rows;
}

async function verifierLotsPerimes(merchantId) {
  const { rows: lots } = await pool.query(
    `SELECT p.id AS product_id, p.name, MIN(l.expiry_date) AS premiere_peremption, SUM(l.quantity) AS quantite
     FROM product_lots l
     JOIN products p ON p.id = l.product_id
     WHERE l.merchant_id = $1 AND l.quantity > 0
       AND l.expiry_date >= CURRENT_DATE AND l.expiry_date <= CURRENT_DATE + $2::int
     GROUP BY p.id, p.name`,
    [merchantId, SEUIL_PEREMPTION_JOURS]
  );
  if (lots.length === 0) return;

  const deja = new Set((await alertesDejaCreees(merchantId, 'lot_peremption', '7 days')).map((a) => String(a.reference_id)));
  for (const lot of lots) {
    if (deja.has(String(lot.product_id))) continue;
    const date = new Date(lot.premiere_peremption).toLocaleDateString('fr-FR');
    await creerAlerte({
      merchantId,
      type: 'lot_peremption',
      titre: 'Lot bientôt périmé',
      message: `${lot.name} : ${Math.round(Number(lot.quantite))} unité(s) périment d'ici le ${date} (moins de ${SEUIL_PEREMPTION_JOURS} jours).`,
      referenceId: lot.product_id,
      roles: ['manager', 'gerant'],
    });
  }
}

async function verifierEcheancesFiscales(merchantId) {
  // Chargé ici pour éviter une dépendance circulaire au démarrage.
  const accounting = require('../routes/accounting.routes');
  const { alertes } = await accounting.alertesFiscalesPour(merchantId);
  if (!alertes || alertes.length === 0) return;

  const TITRES = { proche: 'Échéance fiscale proche', urgent: 'Échéance fiscale urgente', retard: 'Échéance fiscale dépassée' };
  const FENETRES = { proche: '7 days', urgent: '1 day', retard: '1 day' };

  for (const a of alertes) {
    const titre = TITRES[a.statut];
    const debutMessage = `${a.label} — ${a.periode}`;
    const deja = await alertesDejaCreees(merchantId, 'echeance_fiscale', FENETRES[a.statut]);
    if (deja.some((x) => x.titre === titre && String(x.message).startsWith(debutMessage))) continue;

    const limite = new Date(a.limite).toLocaleDateString('fr-FR');
    const suffixe = a.joursRestants < 0
      ? `échéance dépassée depuis ${-a.joursRestants} jour(s) (${limite}).`
      : `à déposer avant le ${limite} (dans ${a.joursRestants} jour(s)).`;
    await creerAlerte({
      merchantId,
      type: 'echeance_fiscale',
      titre,
      message: `${debutMessage} : ${suffixe}`,
      roles: ['manager', 'gerant'],
    });
  }
}

async function verifierEcheances(merchantId, sector) {
  if (!merchantId) return;
  const maintenant = Date.now();
  if (maintenant - (dernierPassage.get(merchantId) || 0) < INTERVALLE_MS) return;
  dernierPassage.set(merchantId, maintenant);

  if (sector === 'pharmacie') {
    await verifierLotsPerimes(merchantId).catch((err) => console.error('Erreur alerte lot_peremption :', err));
  }
  await verifierEcheancesFiscales(merchantId).catch((err) => console.error('Erreur alerte echeance_fiscale :', err));
}

module.exports = { verifierEcheances };
