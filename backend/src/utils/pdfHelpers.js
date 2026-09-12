// Utilitaires partagés pour tous les PDF générés par l'application
// (bons de commande, catalogue produits, journal d'activité).
// Choix délibéré : aucune couleur, uniquement du noir/gris — une mise en
// page éditoriale, sobre, avec une police de titre distinctive (Newsreader).

const path = require('path');

const NOIR = '#111111';
const GRIS = '#6b6b6b';
const GRIS_CLAIR = '#a3a3a3';
const TRAIT = '#d9d9d9';

const POLICE_TITRE = path.join(__dirname, '..', 'assets', 'fonts', 'Newsreader.ttf');

function enregistrerPolices(doc) {
  doc.registerFont('Titre', POLICE_TITRE);
}

// Formate un montant avec un espace normal comme séparateur de milliers
// (nécessaire : la police standard des PDF n'affiche pas correctement
// l'espace insécable utilisé par toLocaleString('fr-FR')).
function formatMontant(valeur) {
  const entier = Math.round(Number(valeur) || 0);
  const signe = entier < 0 ? '-' : '';
  return signe + String(Math.abs(entier)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// En-tête sobre : nom du commerce en petites capitales grises, titre du
// document en grand, en police éditoriale, un filet fin en dessous.
function dessinerEntete(doc, { businessName, titre, sousTitre }) {
  enregistrerPolices(doc);
  const largeurPage = doc.page.width;

  doc.fillColor(GRIS).font('Helvetica').fontSize(9)
    .text((businessName || 'Commerce').toUpperCase(), 50, 50, { characterSpacing: 1 });

  doc.fillColor(NOIR).font('Titre').fontSize(26).text(titre, 50, 66);

  if (sousTitre) {
    doc.fillColor(GRIS_CLAIR).font('Helvetica').fontSize(9).text(sousTitre, 50, 98);
  }

  doc.moveTo(50, 122).lineTo(largeurPage - 50, 122).strokeColor(TRAIT).lineWidth(0.75).stroke();

  doc.fillColor(NOIR).font('Helvetica');
  return 142;
}

// En-tête de tableau : simple filet, libellés en petites capitales grises.
function dessinerEnteteTableau(doc, y, colonnes) {
  const largeurPage = doc.page.width;
  doc.fillColor(GRIS).fontSize(8).font('Helvetica');
  colonnes.forEach((col) => {
    doc.text(col.texte.toUpperCase(), col.x, y, { width: col.largeur, align: col.aligner || 'left', characterSpacing: 0.5 });
  });
  doc.moveTo(50, y + 16).lineTo(largeurPage - 50, y + 16).strokeColor(TRAIT).lineWidth(0.75).stroke();
  doc.fillColor(NOIR).font('Helvetica');
  return y + 24;
}

function traitSeparateur(doc, y) {
  const largeurPage = doc.page.width;
  doc.moveTo(50, y).lineTo(largeurPage - 50, y).strokeColor(TRAIT).lineWidth(0.75).stroke();
}

module.exports = {
  COULEURS: { encre: NOIR, muted: GRIS, mutedClair: GRIS_CLAIR, bordure: TRAIT, fondAlterne: '#f6f6f6' },
  formatMontant,
  dessinerEntete,
  dessinerEnteteTableau,
  traitSeparateur,
  enregistrerPolices,
};
