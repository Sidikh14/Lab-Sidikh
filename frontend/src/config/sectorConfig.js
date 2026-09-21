// Un seul site, un affichage qui change selon le secteur du commerçant
// (user.sector, propagé depuis merchants.sector via le JWT). Toute
// différence visuelle/opérationnelle par secteur passe par ce fichier —
// pas de page ou de composant dupliqué par secteur.

export const SECTEURS = {
  grossiste: {
    label: 'Grossiste',
    theme: { accent: '#7c3aed', accentClair: '#ede9fe' }, // violet actuel, inchangé
    libelleProduit: 'Produit',
    champsProduitSup: [],
  },
  pharmacie: {
    label: 'Pharmacie',
    theme: { accent: '#059669', accentClair: '#d1fae5' }, // vert / blanc
    libelleProduit: 'Médicament',
    champsProduitSup: [
      { key: 'datePeremption', label: 'Date de péremption', type: 'date' },
      { key: 'numeroLot', label: 'Numéro de lot', type: 'text' },
    ],
  },
  electromenager: {
    label: 'Électroménager',
    theme: { accent: '#2563eb', accentClair: '#dbeafe' }, // bleu / blanc
    libelleProduit: 'Article',
    champsProduitSup: [
      { key: 'garantieMois', label: 'Garantie (mois)', type: 'number' },
      { key: 'numeroSerie', label: 'Numéro de série', type: 'text' },
    ],
  },
  textile: {
    label: 'Textile',
    theme: { accent: '#dc2626', accentClair: '#fee2e2' }, // rouge / blanc
    libelleProduit: 'Article',
    champsProduitSup: [
      { key: 'couleur', label: 'Couleur', type: 'text' },
      { key: 'metrage', label: 'Métrage (m)', type: 'number' },
    ],
  },
};

export function getSecteurConfig(sector) {
  return SECTEURS[sector] || SECTEURS.grossiste;
}

// À appeler une fois dans AuthContext.jsx (au chargement + à chaque login),
// avec le secteur de l'utilisateur connecté. Ne touche que les 2 variables
// CSS déjà utilisées partout dans l'app (--accent / --accent-clair) — donc
// aucune autre feuille de style à dupliquer par secteur. Met aussi à jour
// le meta "theme-color" (couleur de la barre système en PWA).
export function appliquerThemeSecteur(sector) {
  const config = getSecteurConfig(sector);
  const root = document.documentElement;
  root.style.setProperty('--accent', config.theme.accent);
  root.style.setProperty('--accent-clair', config.theme.accentClair);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', config.theme.accent);
}
