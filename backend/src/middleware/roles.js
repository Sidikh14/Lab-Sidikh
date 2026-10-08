// Rôles et droits d'accès.
//
// Une personne peut cumuler plusieurs rôles (ex. vendeur + caissier) : ils sont stockés dans users.roles.
// users.role garde le « rôle principal » (le plus étendu), que tout l'ancien code continue de lire :
// manager > gérant > vendeur+caissier (ancien « vendeur_caissier ») > caissier > vendeur > comptable.
// req.user.roles (rempli par authenticate) contient la liste complète ; requireRole l'utilise.

const ROLES_ATTRIBUABLES = ['gerant', 'vendeur', 'caissier', 'comptable'];

// Aplatit les rôles reçus : l'ancien rôle « vendeur_caissier » devient vendeur + caissier, sans doublon.
function normaliserRoles(roles, roleUnique) {
  const brut = Array.isArray(roles) && roles.length > 0 ? roles : roleUnique ? [roleUnique] : [];
  const sortie = [];
  for (const r of brut) {
    for (const x of r === 'vendeur_caissier' ? ['vendeur', 'caissier'] : [r]) {
      if (typeof x === 'string' && x && !sortie.includes(x)) sortie.push(x);
    }
  }
  return sortie;
}

// Rôle principal, au format historique (une seule valeur).
function rolePrincipal(roles) {
  const s = new Set(roles);
  if (s.has('owner')) return 'owner';
  if (s.has('manager')) return 'manager';
  if (s.has('gerant')) return 'gerant';
  if (s.has('vendeur') && s.has('caissier')) return 'vendeur_caissier';
  if (s.has('caissier')) return 'caissier';
  if (s.has('vendeur')) return 'vendeur';
  if (s.has('comptable')) return 'comptable';
  return roles[0] || null;
}

// Vrai si la personne a au moins un des rôles demandés (parmi tous ses rôles et son rôle principal).
function aRole(user, ...autorises) {
  if (!user) return false;
  const possedes = new Set([...(Array.isArray(user.roles) ? user.roles : []), user.role].filter(Boolean));
  return autorises.some((r) => possedes.has(r));
}

// Restreint l'accès à une route à une liste de rôles autorisés.
// Usage : router.delete('/products/:id', authenticate, requireRole('manager', 'gerant'), handler)
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!aRole(req.user, ...allowedRoles)) {
      return res.status(403).json({
        error: "Vous n'avez pas les droits nécessaires pour cette action.",
      });
    }
    next();
  };
}

module.exports = { requireRole, aRole, normaliserRoles, rolePrincipal, ROLES_ATTRIBUABLES };
