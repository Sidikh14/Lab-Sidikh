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

const TAILLE_LOGO = 40; // hauteur en points

// En-tête sobre : logo (si fourni) à gauche, nom du commerce en petites
// capitales grises, titre du document en grand, en police éditoriale, une
// ligne discrète d'informations légales (NINEA/RCCM/adresse) alignée à
// droite si elle a été renseignée, un filet fin en dessous.
// `merchant` est optionnel : { logo_data, ninea, rccm, address, ... } —
// permet aussi d'activer le pied de page automatique sur les pages
// suivantes (voir activerPiedDePageAuto).
function dessinerEntete(doc, { businessName, titre, sousTitre, merchant }) {
  enregistrerPolices(doc);
  const largeurPage = doc.page.width;
  let xTexte = 50;

  if (merchant?.logo_data) {
    try {
      // pdfkit reconstruit mal certaines chaînes data URI passées telles
      // quelles selon la version installée (déjà rencontré : ça peut
      // provoquer un RangeError "Maximum call stack size exceeded" lors de
      // la finalisation du PDF). On décode donc nous-mêmes en Buffer, plus
      // fiable quelle que soit la version de pdfkit.
      const matchDataUri = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(merchant.logo_data);
      const bufferLogo = matchDataUri
        ? Buffer.from(matchDataUri[2], 'base64')
        : Buffer.from(merchant.logo_data, 'base64');
      doc.image(bufferLogo, 50, 45, { height: TAILLE_LOGO });
      xTexte = 50 + TAILLE_LOGO + 14;
    } catch (err) {
      // Logo corrompu ou format non supporté par pdfkit : on continue sans
      // bloquer la génération du PDF pour autant.
    }
  }

  doc.fillColor(GRIS).font('Helvetica').fontSize(9)
    .text((businessName || 'Commerce').toUpperCase(), xTexte, 50, { characterSpacing: 1 });

  doc.fillColor(NOIR).font('Titre').fontSize(26).text(titre, xTexte, 66);

  if (sousTitre) {
    doc.fillColor(GRIS_CLAIR).font('Helvetica').fontSize(9).text(sousTitre, xTexte, 98);
  }

  if (merchant && (merchant.ninea || merchant.rccm || merchant.address)) {
    const parts = [merchant.address, merchant.ninea && `NINEA ${merchant.ninea}`, merchant.rccm && `RCCM ${merchant.rccm}`].filter(Boolean);
    doc.fillColor(GRIS_CLAIR).font('Helvetica').fontSize(7.5)
      .text(parts.join(' · '), 50, 50, { width: largeurPage - 100, align: 'right' });
  }

  doc.moveTo(50, 122).lineTo(largeurPage - 50, 122).strokeColor(TRAIT).lineWidth(0.75).stroke();

  if (merchant) activerPiedDePageAuto(doc, merchant);

  doc.fillColor(NOIR).font('Helvetica');
  return 142;
}

// Pied de page professionnel : coordonnées bancaires / Mobile Money et
// conditions de règlement, centrées en bas de page, discrètes. N'affiche
// rien si aucune de ces informations n'a été renseignée par le commerçant.
// Le caller doit l'appeler une dernière fois juste avant doc.end() — voir
// activerPiedDePageAuto pour les pages suivantes.
function dessinerPiedDePage(doc, merchant) {
  if (!merchant) return;
  const lignes = [
    merchant.bank_details && `Coordonnées bancaires : ${merchant.bank_details}`,
    merchant.mobile_money_details && `Mobile Money : ${merchant.mobile_money_details}`,
    merchant.payment_terms,
  ].filter(Boolean);
  if (lignes.length === 0) return;

  const y = doc.page.height - 60;
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor(TRAIT).lineWidth(0.75).stroke();
  doc.fillColor(GRIS_CLAIR).font('Helvetica').fontSize(7.5)
    .text(lignes.join('  ·  '), 50, y + 8, { width: doc.page.width - 100, align: 'center' });
  doc.fillColor(NOIR).font('Helvetica');
}

// Redessine automatiquement le pied de page sur chaque nouvelle page
// (déclenché par doc.addPage()) — évite d'avoir à l'appeler manuellement à
// chaque saut de page dans le code appelant.
function activerPiedDePageAuto(doc, merchant) {
  doc.on('pageAdded', () => dessinerPiedDePage(doc, merchant));
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
  dessinerPiedDePage,
  traitSeparateur,
  enregistrerPolices,
};
