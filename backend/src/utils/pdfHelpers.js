// Utilitaires partagés pour tous les PDF générés par l'application
// (bons de commande, catalogue produits, inventaire, relevés de caisse,
// journal d'activité…).
//
// Style : sobre, sans aucune couleur (noir et gris uniquement), en Times New
// Roman. Les polices Times standard des PDF (Times-Roman / Times-Bold…) sont
// l'équivalent exact de Times New Roman (mêmes métriques) et n'exigent aucun
// fichier de police à déployer.
//
// Changement de police et de taille pour TOUS les PDF, sans toucher à leur
// code : à la première utilisation d'un document, enregistrerPolices()
//   - remplace les noms de police Helvetica* (utilisés partout dans le code
//     existant) et 'Titre' par leur équivalent Times ;
//   - agrandit toutes les tailles de texte de ECHELLE_TEXTE (Times est plus
//     petit et plus étroit qu'Helvetica à taille égale).
// Pour ajuster la taille des textes, modifier uniquement ECHELLE_TEXTE.

const NOIR = '#111111';
const GRIS = '#555555';
const GRIS_CLAIR = '#8a8a8a';
const TRAIT = '#d4d4d4';
const FOND_ALTERNE = '#f3f3f3';

const ECHELLE_TEXTE = 1.12;

const POLICES = {
  Helvetica: 'Times-Roman',
  'Helvetica-Bold': 'Times-Bold',
  'Helvetica-Oblique': 'Times-Italic',
  'Helvetica-BoldOblique': 'Times-BoldItalic',
  Titre: 'Times-Bold',
};

function enregistrerPolices(doc) {
  if (doc._styleTimes) return; // déjà appliqué à ce document
  doc._styleTimes = true;

  const fontOrigine = doc.font.bind(doc);
  const fontSizeOrigine = doc.fontSize.bind(doc);
  doc.font = (src, ...reste) => fontOrigine(POLICES[src] || src, ...reste);
  doc.fontSize = (taille) => fontSizeOrigine(taille * ECHELLE_TEXTE);

  doc.font('Times-Roman');
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
// document en grand gras, une ligne discrète d'informations légales
// (NINEA/RCCM/adresse) alignée à droite si elle a été renseignée, un filet
// fin en dessous.
// `merchant` est optionnel : { ninea, rccm, address, ... } — permet aussi
// d'activer le pied de page automatique sur les pages suivantes (voir
// activerPiedDePageAuto).
// Retourne l'ordonnée à laquelle le contenu peut commencer.
function dessinerEntete(doc, { businessName, titre, sousTitre, merchant }) {
  enregistrerPolices(doc);
  const largeurPage = doc.page.width;
  const xTexte = 50;

  doc.fillColor(GRIS).font('Helvetica').fontSize(9)
    .text((businessName || 'Commerce').toUpperCase(), xTexte, 46, { characterSpacing: 1 });

  doc.fillColor(NOIR).font('Titre').fontSize(24)
    .text(titre || '', xTexte, 62, { width: largeurPage - 100, height: 34, ellipsis: true });

  if (sousTitre) {
    doc.fillColor(GRIS).font('Helvetica').fontSize(9)
      .text(sousTitre, xTexte, 98, { width: largeurPage - 100, height: 16, ellipsis: true });
  }

  if (merchant && (merchant.ninea || merchant.rccm || merchant.address)) {
    const parts = [merchant.address, merchant.ninea && `NINEA ${merchant.ninea}`, merchant.rccm && `RCCM ${merchant.rccm}`].filter(Boolean);
    doc.fillColor(GRIS_CLAIR).font('Helvetica').fontSize(7.5)
      .text(parts.join(' · '), 50, 46, { width: largeurPage - 100, height: 12, align: 'right', ellipsis: true });
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
    // `height` + `ellipsis` empêchent pdfkit de faire déborder ce texte sur
    // une nouvelle page si les coordonnées bancaires/Mobile Money/conditions
    // de règlement sont trop longues pour tenir sur une ligne à cet endroit
    // (juste avant le bas de page) — un débordement ici déclenchait un
    // addPage() automatique, qui redéclenchait ce même pied de page via
    // pageAdded, qui débordait à nouveau, etc. : boucle infinie jusqu'au
    // RangeError "Maximum call stack size exceeded".
    .text(lignes.join('  ·  '), 50, y + 8, { width: doc.page.width - 100, height: 30, align: 'center', ellipsis: true });
  doc.fillColor(NOIR).font('Helvetica');
}

// Redessine automatiquement le pied de page sur chaque nouvelle page
// (déclenché par doc.addPage()) — évite d'avoir à l'appeler manuellement à
// chaque saut de page dans le code appelant.
// Protégé contre la récursion : si dessinerPiedDePage() lui-même causait un
// nouvel addPage() (débordement de texte notamment), le handler ci-dessous
// ne se redéclenche pas en cascade.
function activerPiedDePageAuto(doc, merchant) {
  let enCours = false;
  doc.on('pageAdded', () => {
    if (enCours) return;
    enCours = true;
    try {
      dessinerPiedDePage(doc, merchant);
    } finally {
      enCours = false;
    }
  });
}

// En-tête de tableau : simple filet, libellés en petites capitales grises.
function dessinerEnteteTableau(doc, y, colonnes) {
  const largeurPage = doc.page.width;
  doc.fillColor(GRIS).fontSize(8).font('Helvetica');
  colonnes.forEach((col) => {
    doc.text(col.texte.toUpperCase(), col.x, y, { width: col.largeur, align: col.aligner || 'left', characterSpacing: 0.5, lineBreak: false });
  });
  doc.moveTo(50, y + 17).lineTo(largeurPage - 50, y + 17).strokeColor(TRAIT).lineWidth(0.75).stroke();
  doc.fillColor(NOIR).font('Helvetica');
  return y + 26;
}

function traitSeparateur(doc, y) {
  const largeurPage = doc.page.width;
  doc.moveTo(50, y).lineTo(largeurPage - 50, y).strokeColor(TRAIT).lineWidth(0.75).stroke();
}

module.exports = {
  COULEURS: { encre: NOIR, muted: GRIS, mutedClair: GRIS_CLAIR, bordure: TRAIT, fondAlterne: FOND_ALTERNE },
  formatMontant,
  dessinerEntete,
  dessinerEnteteTableau,
  dessinerPiedDePage,
  traitSeparateur,
  enregistrerPolices,
};
