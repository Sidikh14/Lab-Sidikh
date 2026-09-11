// Utilitaires partagés pour tous les PDF générés par l'application
// (bons de commande, catalogue produits, journal d'activité).

const COULEURS = {
  accent: '#5b4fe9',
  accentFonce: '#3f34b5',
  texteClair: '#ffffff',
  muted: '#6b7280',
  bordure: '#e5e7eb',
  fondAlterne: '#f7f8fa',
  encre: '#14151f',
};

// Formate un montant en FCFA avec un espace normal comme séparateur de
// milliers (PDFKit / la police Helvetica standard n'affiche pas correctement
// l'espace insécable utilisé par toLocaleString('fr-FR'), ce qui produit des
// caractères parasites du type "/" dans le PDF).
function formatMontant(valeur) {
  const entier = Math.round(Number(valeur) || 0);
  return String(Math.abs(entier))
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    .replace(/^/, entier < 0 ? '-' : '');
}

// Dessine un bandeau d'en-tête coloré en haut du document, avec le nom du
// commerce, le titre du document et un sous-titre facultatif.
// Retourne la position Y à partir de laquelle continuer le contenu.
function dessinerEntete(doc, { businessName, titre, sousTitre }) {
  const largeurPage = doc.page.width;

  doc.rect(0, 0, largeurPage, 96).fill(COULEURS.accent);

  doc.fillColor(COULEURS.texteClair);
  doc.fontSize(11).font('Helvetica').text(businessName || 'Commerce', 50, 28);
  doc.fontSize(19).font('Helvetica-Bold').text(titre, 50, 46);
  if (sousTitre) {
    doc.fontSize(9).font('Helvetica').fillColor('#e4e1fb').text(sousTitre, 50, 72);
  }

  doc.fillColor(COULEURS.encre).font('Helvetica');
  return 122;
}

// Dessine l'entête d'un tableau : fond léger + libellés en gris, avec les
// colonnes fournies ({ texte, x, largeur, aligner }).
function dessinerEnteteTableau(doc, y, colonnes) {
  const largeurPage = doc.page.width;
  doc.rect(50, y, largeurPage - 100, 22).fill(COULEURS.fondAlterne);
  doc.fillColor(COULEURS.muted).fontSize(8.5).font('Helvetica-Bold');
  colonnes.forEach((col) => {
    doc.text(col.texte.toUpperCase(), col.x, y + 7, { width: col.largeur, align: col.aligner || 'left' });
  });
  doc.fillColor(COULEURS.encre).font('Helvetica');
  return y + 22;
}

// Dessine une ligne de séparation fine sous le contenu courant.
function traitSeparateur(doc, y) {
  const largeurPage = doc.page.width;
  doc.moveTo(50, y).lineTo(largeurPage - 50, y).strokeColor(COULEURS.bordure).lineWidth(0.5).stroke();
}

module.exports = { COULEURS, formatMontant, dessinerEntete, dessinerEnteteTableau, traitSeparateur };
