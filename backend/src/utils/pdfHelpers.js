// Utilitaires partagés pour tous les PDF générés par l'application
// (bons de commande, catalogue produits, inventaire, relevés de caisse,
// journal d'activité, bulletins de paie…).
//
// Style : NOIR ET BLANC uniquement, contrastes forts, textes francs.
//  - en-tête : bandeau noir plein, titre blanc en gras (très visible dès le
//    premier regard) ;
//  - tableaux : en-tête noir à texte blanc, lignes alternées en gris très clair ;
//  - textes en noir pur, libellés en gris foncé (jamais de gris pâle).
//
// Changements de réglage sans toucher aux PDF :
//  - ENTETE_BANDEAU = false  -> en-tête sans aplat noir (économise l'encre) ;
//  - ECHELLE_TEXTE           -> taille de tous les textes (1 = taille d'origine).
//
// Police : si les fichiers Inter sont présents dans ./fonts
//   Inter-Regular.ttf, Inter-Bold.ttf, Inter-Italic.ttf, Inter-BoldItalic.ttf
// ils sont utilisés. Sinon, repli sur Helvetica (intégrée aux PDF).
// Le code existant des PDF n'a pas besoin de changer : les noms de police
// 'Helvetica*' et 'Titre' qu'il utilise sont remplacés ici.

const fs = require('fs');
const path = require('path');

const NOIR = '#000000';
const GRIS = '#333333'; // libellés, texte secondaire (foncé : reste bien lisible)
const GRIS_CLAIR = '#555555'; // légendes, informations légales
const TRAIT = '#999999'; // filets de séparation
const FOND_ALTERNE = '#eeeeee'; // lignes alternées des tableaux
const BLANC = '#ffffff';
const GRIS_SUR_NOIR = '#d4d4d4'; // texte secondaire sur le bandeau noir

const ENTETE_BANDEAU = true;
const ECHELLE_TEXTE = 1.05;

const DOSSIER_POLICES = path.join(__dirname, 'fonts');
const FICHIERS_INTER = {
  Inter: 'Inter-Regular.ttf',
  'Inter-Bold': 'Inter-Bold.ttf',
  'Inter-Italic': 'Inter-Italic.ttf',
  'Inter-BoldItalic': 'Inter-BoldItalic.ttf',
};

function interDisponible() {
  return Object.values(FICHIERS_INTER).every((f) => fs.existsSync(path.join(DOSSIER_POLICES, f)));
}

function tablePolices(avecInter) {
  if (avecInter) {
    return {
      Helvetica: 'Inter',
      'Helvetica-Bold': 'Inter-Bold',
      'Helvetica-Oblique': 'Inter-Italic',
      'Helvetica-BoldOblique': 'Inter-BoldItalic',
      Titre: 'Inter-Bold',
    };
  }
  return {
    Helvetica: 'Helvetica',
    'Helvetica-Bold': 'Helvetica-Bold',
    'Helvetica-Oblique': 'Helvetica-Oblique',
    'Helvetica-BoldOblique': 'Helvetica-BoldOblique',
    Titre: 'Helvetica-Bold',
  };
}

function enregistrerPolices(doc) {
  if (doc._styleNoirBlanc) return; // déjà appliqué à ce document
  doc._styleNoirBlanc = true;

  const avecInter = interDisponible();
  if (avecInter) {
    Object.entries(FICHIERS_INTER).forEach(([nom, fichier]) => {
      doc.registerFont(nom, path.join(DOSSIER_POLICES, fichier));
    });
  }
  const POLICES = tablePolices(avecInter);

  const fontOrigine = doc.font.bind(doc);
  const fontSizeOrigine = doc.fontSize.bind(doc);
  doc.font = (src, ...reste) => fontOrigine(POLICES[src] || src, ...reste);
  doc.fontSize = (taille) => fontSizeOrigine(taille * ECHELLE_TEXTE);

  doc.font('Helvetica');
}

// Formate un montant avec un espace normal comme séparateur de milliers
// (nécessaire : la police standard des PDF n'affiche pas correctement
// l'espace insécable utilisé par toLocaleString('fr-FR')).
function formatMontant(valeur) {
  const entier = Math.round(Number(valeur) || 0);
  const signe = entier < 0 ? '-' : '';
  return signe + String(Math.abs(entier)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// En-tête : nom du commerce en petites capitales, titre du document en grand
// gras, sous-titre, informations légales (adresse/NINEA/RCCM) à droite.
// `merchant` est optionnel : { ninea, rccm, address, ... } — permet aussi
// d'activer le pied de page automatique sur les pages suivantes.
// Retourne l'ordonnée à laquelle le contenu peut commencer (toujours 142).
function dessinerEntete(doc, { businessName, titre, sousTitre, merchant }) {
  enregistrerPolices(doc);
  const largeurPage = doc.page.width;
  const xTexte = 50;

  const couleurNom = ENTETE_BANDEAU ? BLANC : NOIR;
  const couleurTitre = ENTETE_BANDEAU ? BLANC : NOIR;
  const couleurSousTitre = ENTETE_BANDEAU ? GRIS_SUR_NOIR : GRIS;
  const couleurLegal = ENTETE_BANDEAU ? GRIS_SUR_NOIR : GRIS;

  if (ENTETE_BANDEAU) {
    doc.rect(0, 0, largeurPage, 116).fill(NOIR);
  }

  doc.fillColor(couleurNom).font('Helvetica-Bold').fontSize(9)
    .text((businessName || 'Commerce').toUpperCase(), xTexte, 38, { characterSpacing: 1.5, width: largeurPage * 0.5, lineBreak: false });

  doc.fillColor(couleurTitre).font('Titre').fontSize(26)
    .text(titre || '', xTexte, 56, { width: largeurPage - 100, height: 36, ellipsis: true });

  if (sousTitre) {
    doc.fillColor(couleurSousTitre).font('Helvetica').fontSize(10)
      .text(sousTitre, xTexte, 92, { width: largeurPage - 100, height: 16, ellipsis: true });
  }

  if (merchant && (merchant.ninea || merchant.rccm || merchant.address)) {
    const parts = [merchant.address, merchant.ninea && `NINEA ${merchant.ninea}`, merchant.rccm && `RCCM ${merchant.rccm}`].filter(Boolean);
    doc.fillColor(couleurLegal).font('Helvetica').fontSize(8)
      .text(parts.join('  ·  '), largeurPage * 0.45, 38, { width: largeurPage * 0.55 - 50, height: 12, align: 'right', ellipsis: true });
  }

  if (!ENTETE_BANDEAU) {
    doc.moveTo(50, 122).lineTo(largeurPage - 50, 122).strokeColor(NOIR).lineWidth(2).stroke();
  }

  if (merchant) activerPiedDePageAuto(doc, merchant);

  doc.fillColor(NOIR).font('Helvetica');
  return 142;
}

// Pied de page : coordonnées bancaires / Mobile Money et conditions de
// règlement, centrées en bas de page. N'affiche rien si aucune de ces
// informations n'a été renseignée par le commerçant.
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
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor(NOIR).lineWidth(1.25).stroke();
  doc.fillColor(GRIS).font('Helvetica').fontSize(8)
    // `height` + `ellipsis` empêchent pdfkit de faire déborder ce texte sur
    // une nouvelle page (ce qui déclencherait un addPage() automatique, donc
    // à nouveau ce pied de page : boucle infinie jusqu'au RangeError
    // "Maximum call stack size exceeded").
    .text(lignes.join('  ·  '), 50, y + 8, { width: doc.page.width - 100, height: 30, align: 'center', ellipsis: true });
  doc.fillColor(NOIR).font('Helvetica');
}

// Redessine automatiquement le pied de page sur chaque nouvelle page
// (déclenché par doc.addPage()). Protégé contre la récursion.
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

// En-tête de tableau : bandeau noir, libellés blancs en gras et en capitales.
function dessinerEnteteTableau(doc, y, colonnes) {
  const largeurPage = doc.page.width;
  doc.rect(50, y - 7, largeurPage - 100, 24).fill(NOIR);
  doc.fillColor(BLANC).fontSize(8).font('Helvetica-Bold');
  colonnes.forEach((col) => {
    doc.text(col.texte.toUpperCase(), col.x, y, { width: col.largeur, align: col.aligner || 'left', characterSpacing: 0.6, lineBreak: false });
  });
  doc.fillColor(NOIR).font('Helvetica');
  return y + 28;
}

function traitSeparateur(doc, y) {
  const largeurPage = doc.page.width;
  doc.moveTo(50, y).lineTo(largeurPage - 50, y).strokeColor(TRAIT).lineWidth(0.75).stroke();
}

module.exports = {
  COULEURS: { encre: NOIR, muted: GRIS, mutedClair: GRIS_CLAIR, bordure: TRAIT, fondAlterne: FOND_ALTERNE, accent: NOIR },
  formatMontant,
  dessinerEntete,
  dessinerEnteteTableau,
  dessinerPiedDePage,
  traitSeparateur,
  enregistrerPolices,
};
