// Utilitaires partagés pour tous les PDF générés par l'application
// (bons de commande, catalogue produits, inventaire, relevés de caisse,
// journal d'activité…).
//
// Style moderne : police sans empattement, une couleur d'accent, en-tête
// avec barre d'accent, tableaux aérés.
//
// Police : si les fichiers Inter sont présents dans ./fonts
//   Inter-Regular.ttf, Inter-Bold.ttf, Inter-Italic.ttf, Inter-BoldItalic.ttf
// ils sont utilisés. Sinon, repli automatique sur Helvetica (intégrée aux PDF,
// aucun fichier à déployer). Le code existant n'a pas besoin de changer.
//
// Couleur d'accent : modifier ACCENT ci-dessous, ou passer
// merchant.accent_color (ex. '#0f766e') pour une couleur par commerçant.

const fs = require('fs');
const path = require('path');

const NOIR = '#111827';
const GRIS = '#4b5563';
const GRIS_CLAIR = '#9ca3af';
const TRAIT = '#e5e7eb';
const FOND_ALTERNE = '#f9fafb';

const ACCENT = '#4f46e5';

const ECHELLE_TEXTE = 1; // Helvetica/Inter : pas d'agrandissement nécessaire

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
  if (doc._styleModerne) return; // déjà appliqué à ce document
  doc._styleModerne = true;

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

// Couleur d'accent du commerçant si valide (#rgb ou #rrggbb), sinon défaut.
function couleurAccent(merchant) {
  const c = merchant && merchant.accent_color;
  return typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : ACCENT;
}

// Formate un montant avec un espace normal comme séparateur de milliers
// (nécessaire : la police standard des PDF n'affiche pas correctement
// l'espace insécable utilisé par toLocaleString('fr-FR')).
function formatMontant(valeur) {
  const entier = Math.round(Number(valeur) || 0);
  const signe = entier < 0 ? '-' : '';
  return signe + String(Math.abs(entier)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// En-tête moderne : barre d'accent verticale, nom du commerce en couleur
// d'accent (capitales espacées), titre du document en grand gras, sous-titre
// gris, informations légales (adresse/NINEA/RCCM) alignées à droite, filet
// fin en dessous.
// `merchant` est optionnel : { ninea, rccm, address, accent_color, ... } —
// permet aussi d'activer le pied de page automatique sur les pages suivantes.
// Retourne l'ordonnée à laquelle le contenu peut commencer.
function dessinerEntete(doc, { businessName, titre, sousTitre, merchant }) {
  enregistrerPolices(doc);
  const largeurPage = doc.page.width;
  const xTexte = 50;
  const accent = couleurAccent(merchant);
  doc._accent = accent;

  // Bandeau d'accent en haut de page
  doc.rect(0, 0, largeurPage, 6).fill(accent);

  doc.fillColor(accent).font('Helvetica-Bold').fontSize(9)
    .text((businessName || 'Commerce').toUpperCase(), xTexte, 40, { characterSpacing: 1.5 });

  doc.fillColor(NOIR).font('Titre').fontSize(22)
    .text(titre || '', xTexte, 58, { width: largeurPage - 100, height: 34, ellipsis: true });

  if (sousTitre) {
    doc.fillColor(GRIS).font('Helvetica').fontSize(9)
      .text(sousTitre, xTexte, 94, { width: largeurPage - 100, height: 16, ellipsis: true });
  }

  if (merchant && (merchant.ninea || merchant.rccm || merchant.address)) {
    const parts = [merchant.address, merchant.ninea && `NINEA ${merchant.ninea}`, merchant.rccm && `RCCM ${merchant.rccm}`].filter(Boolean);
    doc.fillColor(GRIS_CLAIR).font('Helvetica').fontSize(7.5)
      .text(parts.join('  ·  '), 50, 40, { width: largeurPage - 100, height: 12, align: 'right', ellipsis: true });
  }

  doc.moveTo(50, 122).lineTo(largeurPage - 50, 122).strokeColor(TRAIT).lineWidth(1).stroke();

  if (merchant) activerPiedDePageAuto(doc, merchant);

  doc.fillColor(NOIR).font('Helvetica');
  return 142;
}

// Pied de page : coordonnées bancaires / Mobile Money et conditions de
// règlement, centrées en bas de page, discrètes. N'affiche rien si aucune de
// ces informations n'a été renseignée par le commerçant.
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
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor(TRAIT).lineWidth(1).stroke();
  doc.fillColor(GRIS_CLAIR).font('Helvetica').fontSize(7.5)
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

// En-tête de tableau : bandeau gris très clair, libellés en capitales
// espacées, filet d'accent en dessous.
function dessinerEnteteTableau(doc, y, colonnes) {
  const largeurPage = doc.page.width;
  const accent = doc._accent || ACCENT;

  doc.rect(50, y - 6, largeurPage - 100, 24).fill(FOND_ALTERNE);
  doc.fillColor(GRIS).fontSize(8).font('Helvetica-Bold');
  colonnes.forEach((col) => {
    doc.text(col.texte.toUpperCase(), col.x, y, { width: col.largeur, align: col.aligner || 'left', characterSpacing: 0.6, lineBreak: false });
  });
  doc.moveTo(50, y + 18).lineTo(largeurPage - 50, y + 18).strokeColor(accent).lineWidth(1.25).stroke();
  doc.fillColor(NOIR).font('Helvetica');
  return y + 28;
}

function traitSeparateur(doc, y) {
  const largeurPage = doc.page.width;
  doc.moveTo(50, y).lineTo(largeurPage - 50, y).strokeColor(TRAIT).lineWidth(0.75).stroke();
}

module.exports = {
  COULEURS: { encre: NOIR, muted: GRIS, mutedClair: GRIS_CLAIR, bordure: TRAIT, fondAlterne: FOND_ALTERNE, accent: ACCENT },
  formatMontant,
  dessinerEntete,
  dessinerEnteteTableau,
  dessinerPiedDePage,
  traitSeparateur,
  enregistrerPolices,
};
