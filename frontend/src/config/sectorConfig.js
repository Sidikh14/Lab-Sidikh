// Un seul site, un affichage qui change selon le secteur du commerçant
// (user.sector, propagé depuis merchants.sector via le JWT). Toute
// différence visuelle/opérationnelle par secteur passe par ce fichier —
// pas de page ou de composant dupliqué par secteur.

// Vocabulaire commun, utilisé quand un secteur ne le redéfinit pas.
const VOCABULAIRE_PAR_DEFAUT = {
  libelleEquipe: 'Équipe',
  libelleVendeur: 'Vendeur',
  libelleStock: null, // null = « <libelleProduit>s » (ex. Produits)
};

// Secteurs proposés à l'inscription. Le secteur textile n'y figure plus (aucun commerçant concerné).
export const SECTEURS = {
  grossiste: {
    label: 'Grossiste',
    // Charte v8 : un seul thème (Marine/Azur/Soleil) pour tous les secteurs.
    theme: null,
    libelleProduit: 'Produit',
    libelleBoutique: 'Boutique',
    libelleClient: 'Client',
    champsProduitSup: [],
  },
  pharmacie: {
    label: 'Pharmacie',
    theme: null,
    libelleProduit: 'Médicament',
    libelleBoutique: 'Pharmacie',
    libelleClient: 'Patient',
    // Pas de champsProduitSup pour la péremption/lot ici : depuis l'ajout
    // du suivi par lot (product_lots, FEFO), la date de péremption et le
    // numéro de lot se saisissent PAR LOT à chaque entrée de stock (modale
    // "Entrée de stock"), pas une seule fois sur la fiche produit — un
    // médicament a plusieurs lots avec des péremptions différentes dans le
    // temps.
    champsProduitSup: [],
  },
  electromenager: {
    label: 'Électroménager',
    theme: null,
    libelleProduit: 'Article',
    libelleBoutique: 'Boutique',
    libelleClient: 'Client',
    champsProduitSup: [
      { key: 'garantieMois', label: 'Garantie (mois)', type: 'number' },
      { key: 'numeroSerie', label: 'Numéro de série', type: 'text' },
    ],
  },
  restauration: {
    label: 'Restauration',
    theme: null,
    libelleProduit: 'Plat',
    libelleBoutique: 'Restaurant',
    libelleClient: 'Client',
    libelleStock: 'Carte',
    libelleEquipe: 'Brigade',
    libelleVendeur: 'Serveur',
    champsProduitSup: [],
  },
};

// Secteurs retirés de l'inscription mais encore présents en base : leurs commerces gardent
// un affichage correct. Textile : aucun commerçant à migrer, la valeur reste en base.
export const SECTEURS_RELIQUAT = {
  textile: {
    label: 'Textile',
    theme: null,
    libelleProduit: 'Article',
    libelleBoutique: 'Boutique',
    libelleClient: 'Client',
    champsProduitSup: [
      { key: 'couleur', label: 'Couleur', type: 'text' },
      { key: 'metrage', label: 'Métrage (m)', type: 'number' },
    ],
  },
};

export function getSecteurConfig(sector) {
  const config = SECTEURS[sector] || SECTEURS_RELIQUAT[sector] || SECTEURS.grossiste;
  return { ...VOCABULAIRE_PAR_DEFAUT, ...config };
}

const THEME_COLOR = '#0f2747'; // Marine : couleur du navigateur (<meta name="theme-color">)

// Charte v8 : l'identité visuelle ne dépend plus du secteur. Cette fonction est conservée
// (AuthContext.jsx l'appelle déjà) : elle remet seulement la couleur Marine du navigateur, sauf si une charte
// personnalisée de commerçant est appliquée (config/branding.js pose alors --marine sur la page).
export function appliquerThemeSecteur() {
  if (document.documentElement.style.getPropertyValue('--marine')) return;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', THEME_COLOR);
}
