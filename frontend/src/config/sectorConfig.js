// Un seul site, un affichage qui change selon le secteur du commerçant
// (user.sector, propagé depuis merchants.sector via le JWT). Toute
// différence visuelle/opérationnelle par secteur passe par ce fichier —
// pas de page ou de composant dupliqué par secteur.

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
  return SECTEURS[sector] || SECTEURS.grossiste;
}

const VARIABLES_THEME = ['--accent', '--accent-clair', '--accent-fonce', '--accent-transparent'];
const THEME_COLOR = '#0f2747'; // Marine : couleur du navigateur (<meta name="theme-color">)

// Charte v8 : l'identité visuelle est la même pour tous les secteurs. Cette fonction est
// conservée (AuthContext.jsx l'appelle déjà) mais ne colore plus rien par secteur : elle retire
// toute ancienne surcharge de couleur posée sur <html> et remet la couleur Marine du navigateur.
export function appliquerThemeSecteur() {
  const root = document.documentElement;
  VARIABLES_THEME.forEach((v) => root.style.removeProperty(v));
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', THEME_COLOR);
}
