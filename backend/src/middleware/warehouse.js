const pool = require('../config/db');

// Lieux (boutiques et dépôts) auxquels le membre connecté est affecté.
// - manager : aucune affectation (il agit sur tous les lieux, en choisissant).
// - gérant : un ou plusieurs lieux (table user_warehouses).
// - autres rôles : un seul lieu.
// req.user.warehouseIds est rempli par middleware/auth.js à chaque requête ;
// req.user.warehouseId reste le lieu principal (users.warehouse_id).
function lieuxAffectes(req) {
  const ids = Array.isArray(req.user.warehouseIds) ? req.user.warehouseIds : [];
  if (ids.length > 0) return ids;
  return req.user.warehouseId ? [req.user.warehouseId] : [];
}

// Lieux ciblés par une lecture (liste, rapport) pour un non-manager : le lieu
// demandé s'il fait partie de ses affectations, sinon tous ses lieux.
function ciblesLieux(req, demande) {
  const permis = lieuxAffectes(req);
  return demande && permis.includes(demande) ? [demande] : permis;
}

// Détermine le lieu à utiliser pour une opération de stock/vente.
// - manager : doit choisir explicitement via providedId à chaque fois.
// - gérant/caissier/vendeur avec UN seul lieu : toujours ce lieu, tout
//   warehouseId envoyé par le client est ignoré.
// - gérant affecté à PLUSIEURS lieux : doit choisir un de ses lieux ; un lieu
//   hors de ses affectations est refusé.
// pourVente : refuse un dépôt (lieu de stockage uniquement, aucune vente).
async function resolveWarehouseId(req, dbClient, providedId, { pourVente = false } = {}) {
  const runner = dbClient || pool;

  if (req.user.role === 'manager') {
    if (!providedId) {
      throw { status: 400, message: 'La boutique est requise.' };
    }
    const result = await runner.query(
      `SELECT id, type FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [providedId, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      throw { status: 404, message: 'Boutique introuvable.' };
    }
    if (pourVente && result.rows[0].type === 'depot') {
      throw { status: 400, message: 'Un dépôt ne peut pas enregistrer de vente. Choisissez une boutique.' };
    }
    return providedId;
  }

  const permis = lieuxAffectes(req);
  if (permis.length === 0) {
    throw { status: 403, message: "Vous n'êtes assigné à aucune boutique." };
  }

  let cible;
  if (permis.length === 1) {
    cible = permis[0];
  } else {
    if (!providedId) {
      throw { status: 400, message: 'Le lieu est requis (vous êtes affecté à plusieurs lieux).' };
    }
    if (!permis.includes(providedId)) {
      throw { status: 403, message: "Ce lieu ne fait pas partie de vos affectations." };
    }
    cible = providedId;
  }

  if (pourVente || permis.length > 1) {
    const result = await runner.query(
      `SELECT type, is_active FROM warehouses WHERE id = $1 AND merchant_id = $2`,
      [cible, req.user.merchantId]
    );
    const lieu = result.rows[0];
    if (!lieu) throw { status: 404, message: 'Boutique introuvable.' };
    if (permis.length > 1 && !lieu.is_active) {
      throw { status: 403, message: 'Ce lieu est désactivé.' };
    }
    if (pourVente && lieu.type === 'depot') {
      throw { status: 403, message: "Ce lieu est un dépôt (stockage uniquement) : aucune vente n'y est possible." };
    }
  }
  return cible;
}

module.exports = { lieuxAffectes, ciblesLieux, resolveWarehouseId };
