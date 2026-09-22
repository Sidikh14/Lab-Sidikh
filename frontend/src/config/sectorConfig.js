// Un seul site, un affichage qui change selon le secteur du commerçant
// (user.sector, propagé depuis merchants.sector via le JWT). Toute
// différence visuelle/opérationnelle par secteur passe par ce fichier —
// pas de page ou de composant dupliqué par secteur.

export const SECTEURS = {
  grossiste: {
    label: 'Grossiste',
    // Pas de surcharge : on ne connaît pas les valeurs exactes définies
    // dans le CSS d'origine (--accent/--accent-clair/--accent-fonce), donc
    // plutôt que de deviner et risquer un léger décalage de couleur, le
    // secteur grossiste n'écrit aucune variable — l'app garde le thème
    // CSS par défaut, pixel pour pixel.
    theme: null,
    libelleProduit: 'Produit',
    libelleBoutique: 'Boutique',
    champsProduitSup: [],
  },
  pharmacie: {
    label: 'Pharmacie',
    theme: {
      accent: '#059669',
      accentClair: '#d1fae5',
      accentFonce: '#047857',
      accentTransparent: 'rgba(5, 150, 105, 0.18)', // même usage que le fond de lien actif en sidebar
    },
    libelleProduit: 'Médicament',
    libelleBoutique: 'Pharmacie',
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
    theme: {
      accent: '#2563eb',
      accentClair: '#dbeafe',
      accentFonce: '#1d4ed8',
      accentTransparent: 'rgba(37, 99, 235, 0.18)',
    },
    libelleProduit: 'Article',
    libelleBoutique: 'Boutique',
    champsProduitSup: [
      { key: 'garantieMois', label: 'Garantie (mois)', type: 'number' },
      { key: 'numeroSerie', label: 'Numéro de série', type: 'text' },
    ],
  },
  textile: {
    label: 'Textile',
    theme: {
      accent: '#dc2626',
      accentClair: '#fee2e2',
      accentFonce: '#b91c1c',
      accentTransparent: 'rgba(220, 38, 38, 0.18)',
    },
    libelleProduit: 'Article',
    libelleBoutique: 'Boutique',
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
const THEME_COLOR_ORIGINE = '#7c3aed'; // valeur d'origine du <meta name="theme-color"> dans index.html

// À appeler une fois dans AuthContext.jsx (au chargement + à chaque login/
// déconnexion), avec le secteur du commerçant connecté.
// - Secteur avec thème défini (pharmacie/electromenager/textile) : surcharge
//   --accent/--accent-clair/--accent-fonce/--accent-transparent, plus le
//   meta "theme-color" (couleur de la barre système en PWA).
// - Secteur sans thème (grossiste, ou déconnecté) : retire toute surcharge
//   précédente pour retomber exactement sur les valeurs définies dans le CSS.
export function appliquerThemeSecteur(sector) {
  const config = getSecteurConfig(sector);
  const root = document.documentElement;
  const metaTheme = document.querySelector('meta[name="theme-color"]');

  if (!config.theme) {
    VARIABLES_THEME.forEach((v) => root.style.removeProperty(v));
    if (metaTheme) metaTheme.setAttribute('content', THEME_COLOR_ORIGINE);
    return;
  }

  root.style.setProperty('--accent', config.theme.accent);
  root.style.setProperty('--accent-clair', config.theme.accentClair);
  root.style.setProperty('--accent-fonce', config.theme.accentFonce);
  root.style.setProperty('--accent-transparent', config.theme.accentTransparent);
  if (metaTheme) metaTheme.setAttribute('content', config.theme.accent);
}
