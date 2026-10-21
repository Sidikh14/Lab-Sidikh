// Rôles et droits d'accès.
//
// Une personne peut cumuler plusieurs rôles (ex. vendeur + caissier) : ils sont stockés dans users.roles (tableau de texte).
// users.role garde le « rôle principal » (le plus étendu), que tout l'ancien code continue de lire.
// Ordre de priorité : owner > manager > gérant > rôles cliniques médicaux > vendeur+caissier > caissier > vendeur > comptable.
// req.user.roles (rempli par authenticate) contient la liste complète ; requireRole l'utilise.
// Les droits fins sur les données médicales sont dans middleware/clinique.js, pas ici.

const ROLES_CLINIQUE = ['medecin', 'infirmier', 'sage_femme', 'laborantin', 'accueil'];
const ROLES_ATTRIBUABLES = ['gerant', 'vendeur', 'caissier', 'comptable', ...ROLES_CLINIQUE];

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
  if (s.has('medecin')) return 'medecin';
  if (s.has('sage_femme')) return 'sage_femme';
  if (s.has('infirmier')) return 'infirmier';
  if (s.has('laborantin')) return 'laborantin';
  if (s.has('accueil')) return 'accueil';
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

// ---------------------------------------------------------------------------
// Permissions fines par action, à l'intérieur d'un module déjà visible
// (users.visible_modules continue de décider si la page est accessible du
// tout ; ceci ne fait que retirer des actions précises à l'intérieur).
// Stockées dans users.action_permissions (JSONB) : { module: { action: false } }.
// Absence de clé = autorisé (même logique que visible_modules: null = accès complet).
// ---------------------------------------------------------------------------
const CATALOGUE_ACTIONS = {
  stock: {
    creer: 'Créer un produit',
    modifier: 'Modifier (prix, quantité)',
    supprimer: 'Supprimer un produit',
    transferer: 'Transférer entre boutiques',
    rupture: 'Autoriser une vente en rupture de stock',
    inventaire: 'Ajuster un inventaire',
  },
  ventes: {
    creer: 'Encaisser une vente',
    annuler: 'Annuler une commande',
    remise: 'Appliquer une remise',
    retour: 'Enregistrer un retour client',
    reservation: 'Créer une réservation (reliquat)',
  },
  clients: {
    creer: 'Créer un client',
    modifier: 'Modifier un client',
    supprimer: 'Supprimer un client',
    credit: 'Valider une vente à crédit',
    reglement: 'Enregistrer un règlement',
    releve: 'Envoyer un relevé de compte',
    export: 'Exporter les factures impayées',
  },
  fournisseurs: {
    creer: 'Créer un fournisseur',
    modifier: 'Modifier un fournisseur',
    supprimer: 'Supprimer un fournisseur',
    reglement: 'Enregistrer un paiement fournisseur',
  },
  achats: {
    creer: 'Créer une commande fournisseur',
    modifier: 'Modifier une commande fournisseur',
    annuler: 'Annuler une commande fournisseur',
    livrer: 'Réceptionner une commande fournisseur',
  },
  caisse: {
    entree: 'Enregistrer une entrée de caisse',
    sortie: 'Enregistrer une sortie de caisse',
    cloture: 'Clôturer la caisse',
    charge: 'Payer une charge depuis la caisse',
  },
  comptabilite: {
    saisir: 'Saisir une écriture comptable',
    cloture: "Clôturer l'exercice",
    rapprochement: 'Faire un rapprochement / lettrage',
    charge: 'Comptabiliser une charge',
  },
  fiscalite: {
    declarer: 'Enregistrer une déclaration',
    paiement: "Enregistrer un paiement d'impôt",
  },
  paie: {
    bulletin: 'Générer un bulletin de paie',
    payer: 'Payer un salaire',
    avance: 'Verser une avance sur salaire',
    document: 'Émettre un document RH (attestation, contrat)',
    parametres: 'Modifier les paramètres de paie (taux/barèmes)',
    envoi: 'Envoyer les bulletins par mail',
  },
  equipe: {
    creer: 'Ajouter un membre',
    modifier: 'Modifier un membre (rôles, infos)',
    supprimer: 'Désactiver un membre',
    permissions: 'Modifier les permissions d\'un membre',
    mot_de_passe: "Réinitialiser le mot de passe d'un membre",
  },
  entreprise: {
    modifier: "Modifier les informations de l'entreprise",
  },
  boutiques: {
    creer: 'Ajouter une boutique',
    modifier: 'Modifier une boutique',
    transferer: 'Transférer du stock entre boutiques',
  },
};

// Vrai si l'action est autorisée pour ce membre : seul le manager n'est jamais restreint par ce
// système (ces permissions fines servent à encadrer gérant/vendeur/caissier/comptable), et une
// action non explicitement désactivée reste autorisée par défaut.
function peutAgir(user, module, action) {
  if (aRole(user, 'manager')) return true;
  const valeur = user?.actionPermissions?.[module]?.[action];
  return valeur !== false;
}

// Restreint une action précise à l'intérieur d'un module déjà accessible.
// Usage : router.delete('/products/:id', authenticate, requireAction('stock', 'supprimer'), handler)
function requireAction(module, action) {
  return (req, res, next) => {
    if (!peutAgir(req.user, module, action)) {
      return res.status(403).json({
        error: "Vous n'avez pas les droits nécessaires pour cette action.",
      });
    }
    next();
  };
}

module.exports = {
  requireRole, aRole, normaliserRoles, rolePrincipal, ROLES_ATTRIBUABLES, ROLES_CLINIQUE,
  CATALOGUE_ACTIONS, peutAgir, requireAction,
};
