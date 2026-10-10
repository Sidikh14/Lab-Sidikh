// Utilitaires partagés pour tous les PDF générés par l'application
// (factures, bons de commande, catalogue produits, inventaire, relevés de caisse,
// journal d'activité, bulletins de paie…).
//
// Charte graphique Amaterasu v8 :
//  - polices Plus Jakarta Sans (titres) et Inter (texte, chiffres), fournies par les paquets
//    npm @fontsource/plus-jakarta-sans et @fontsource/inter (à installer côté backend) ;
//  - Marine pour le texte, les en-têtes de tableau et les bandeaux de total ; Soleil pour le filet
//    du titre et le montant sur fond Marine ; Brume pour les lignes alternées ; Ardoise pour
//    le texte secondaire ; noir uniquement pour les reçus thermiques ;
//  - emblème Amaterasu dessiné en vectoriel (aucune image à charger) ;
//  - pied de page « Édité avec Amaterasu » avec numéro de page « n / total ».
//
// Le code existant des PDF n'a pas besoin de changer : les noms de police 'Helvetica*' et
// 'Titre' qu'il utilise sont remplacés ici par Inter et Plus Jakarta Sans. Si les paquets de
// polices sont introuvables, repli automatique sur Helvetica (intégrée aux PDF).
//
// Réglages :
//  - TEXTE_GRAS    -> true : tous les textes en semi-gras ;
//  - ECHELLE_TEXTE -> taille de tous les textes (1 = taille d'origine).

const fs = require('fs');
const path = require('path');
const { COULEURS: C, FORMATS, TAILLES, MENTION_EDITEUR, mmEnPt } = require('./pdfTheme');

const MARINE = C.marine;
const SOLEIL = C.soleil;
const ARDOISE = C.ardoise;
const BRUME = C.brume;
const TRAIT = C.trait;
const BLANC = C.blanc;

const TEXTE_GRAS = false;
const ECHELLE_TEXTE = 1;

// ---------------------------------------------------------------------------
// Polices (paquets @fontsource)
// ---------------------------------------------------------------------------

// Recherche d'un fichier de police dans les dossiers node_modules visibles depuis ce module.
function trouverFichierPolice(paquet, base) {
  const dossiers = require.resolve.paths(paquet) || [];
  for (const dossier of dossiers) {
    for (const ext of ['woff', 'woff2']) {
      const fichier = path.join(dossier, paquet, 'files', `${base}.${ext}`);
      if (fs.existsSync(fichier)) return fichier;
    }
  }
  return null;
}

let policesCache; // résolu une seule fois par processus
function chercherPolices() {
  if (policesCache !== undefined) return policesCache;
  const inter = (poids, style = 'normal') => trouverFichierPolice('@fontsource/inter', `inter-latin-${poids}-${style}`);
  const jakarta = (poids) => trouverFichierPolice('@fontsource/plus-jakarta-sans', `plus-jakarta-sans-latin-${poids}-normal`);
  const regulier = inter(400);
  const semi = inter(600);
  const titre = jakarta(800);
  if (!regulier || !semi || !titre) {
    policesCache = null;
    return null;
  }
  policesCache = {
    'AM-Inter': regulier,
    'AM-Inter-Semi': semi,
    'AM-Inter-Italic': inter(400, 'italic') || regulier,
    'AM-Inter-SemiItalic': inter(600, 'italic') || semi,
    'AM-Jakarta-ExtraBold': titre,
    'AM-Jakarta-Bold': jakarta(700) || titre,
  };
  return policesCache;
}

function tablePolices(avecPolices) {
  if (avecPolices) {
    return {
      Helvetica: TEXTE_GRAS ? 'AM-Inter-Semi' : 'AM-Inter',
      'Helvetica-Bold': 'AM-Inter-Semi',
      'Helvetica-Oblique': TEXTE_GRAS ? 'AM-Inter-SemiItalic' : 'AM-Inter-Italic',
      'Helvetica-BoldOblique': 'AM-Inter-SemiItalic',
      Titre: 'AM-Jakarta-ExtraBold',
      'Titre-Bold': 'AM-Jakarta-Bold',
    };
  }
  return {
    Helvetica: TEXTE_GRAS ? 'Helvetica-Bold' : 'Helvetica',
    'Helvetica-Bold': 'Helvetica-Bold',
    'Helvetica-Oblique': TEXTE_GRAS ? 'Helvetica-BoldOblique' : 'Helvetica-Oblique',
    'Helvetica-BoldOblique': 'Helvetica-BoldOblique',
    Titre: 'Helvetica-Bold',
    'Titre-Bold': 'Helvetica-Bold',
  };
}

function enregistrerPolices(doc) {
  if (doc._styleCharte) return; // déjà appliqué à ce document
  doc._styleCharte = true;

  const fontOrigine = doc.font.bind(doc);
  const fontSizeOrigine = doc.fontSize.bind(doc);

  let avecPolices = false;
  const fichiers = chercherPolices();
  if (fichiers) {
    try {
      Object.entries(fichiers).forEach(([nom, fichier]) => doc.registerFont(nom, fichier));
      // Vérifie tout de suite que les fichiers se chargent (sinon repli sur Helvetica).
      Object.keys(fichiers).forEach((nom) => fontOrigine(nom));
      avecPolices = true;
    } catch (err) {
      console.error('Polices Amaterasu illisibles, repli sur Helvetica :', err.message);
    }
  }
  const POLICES = tablePolices(avecPolices);

  doc.font = (src, ...reste) => fontOrigine(POLICES[src] || src, ...reste);
  doc.fontSize = (taille) => fontSizeOrigine(taille * ECHELLE_TEXTE);

  doc.font('Helvetica');
}

// Formate un montant avec un espace normal comme séparateur de milliers.
function formatMontant(valeur) {
  const entier = Math.round(Number(valeur) || 0);
  const signe = entier < 0 ? '-' : '';
  return signe + String(Math.abs(entier)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// ---------------------------------------------------------------------------
// Emblème Amaterasu (soleil à 8 rayons dans un anneau), dessiné en vectoriel.
// Coordonnées reprises de amaterasu-emblem.svg (grille 240 × 240) ; true = facette claire.
// ---------------------------------------------------------------------------
const EMBLEME = [
  [[[120.0,100.0],[135.0,74.8],[120.0,40.0],[105.0,74.8]], false],
  [[[112.3,101.5],[115.1,85.9],[100.1,72.0],[99.4,92.4]], true],
  [[[105.9,105.9],[98.6,77.4],[63.4,63.4],[77.4,98.6]], false],
  [[[101.5,112.3],[92.4,99.4],[72.0,100.1],[85.9,115.1]], true],
  [[[100.0,120.0],[74.8,105.0],[40.0,120.0],[74.8,135.0]], false],
  [[[101.5,127.7],[85.9,124.9],[72.0,139.9],[92.4,140.6]], true],
  [[[105.9,134.1],[77.4,141.4],[63.4,176.6],[98.6,162.6]], false],
  [[[112.3,138.5],[99.4,147.6],[100.1,168.0],[115.1,154.1]], true],
  [[[120.0,140.0],[105.0,165.2],[120.0,200.0],[135.0,165.2]], false],
  [[[127.7,138.5],[124.9,154.1],[139.9,168.0],[140.6,147.6]], true],
  [[[134.1,134.1],[141.4,162.6],[176.6,176.6],[162.6,141.4]], false],
  [[[138.5,127.7],[147.6,140.6],[168.0,139.9],[154.1,124.9]], true],
  [[[140.0,120.0],[165.2,135.0],[200.0,120.0],[165.2,105.0]], false],
  [[[138.5,112.3],[154.1,115.1],[168.0,100.1],[147.6,99.4]], true],
  [[[134.1,105.9],[162.6,98.6],[176.6,63.4],[141.4,77.4]], false],
  [[[127.7,101.5],[140.6,92.4],[139.9,72.0],[124.9,85.9]], true],
];

// variante : 'clair' (fond clair : Marine + Soleil) · 'sombre' (fond Marine : Soleil) · 'noir' (reçus thermiques)
function dessinerEmblem(doc, x, y, taille, variante = 'clair') {
  const teintes = {
    clair: { anneau: MARINE, rayon: MARINE, facette: SOLEIL, centre: SOLEIL },
    sombre: { anneau: SOLEIL, rayon: SOLEIL, facette: C.soleilClair, centre: SOLEIL },
    noir: { anneau: '#000000', rayon: '#000000', facette: '#FFFFFF', centre: '#000000' },
  }[variante] || {};
  const s = taille / 240;
  doc.save();
  doc.lineWidth(6 * s).strokeColor(teintes.anneau).circle(x + 120 * s, y + 120 * s, 100 * s).stroke();
  EMBLEME.forEach(([points, facette]) => {
    doc.polygon(...points.map(([px, py]) => [x + px * s, y + py * s])).fill(facette ? teintes.facette : teintes.rayon);
  });
  doc.circle(x + 120 * s, y + 120 * s, 11 * s).fill(teintes.centre);
  doc.restore();
}

// Logo propre au commerçant (colonne « logo » de merchants, image PNG/JPEG en base64) : lu sans
// supposer le nom exact de la colonne, à partir de to_jsonb(m) AS merchant_json dans la requête.
function lireLogoCommercant(merchantJson) {
  try {
    const objet = typeof merchantJson === 'string' ? JSON.parse(merchantJson) : merchantJson;
    if (!objet) return null;
    for (const [cle, valeur] of Object.entries(objet)) {
      if (!/logo/i.test(cle) || typeof valeur !== 'string') continue;
      const m = /^data:image\/(png|jpe?g);base64,(.+)$/is.exec(valeur.trim());
      if (m) return Buffer.from(m[2], 'base64');
    }
  } catch (err) {
    console.error('Logo commerçant illisible :', err.message);
  }
  return null;
}

// Dessine le logo du commerçant dans la boîte donnée ; un logo corrompu n'empêche jamais le PDF.
function dessinerLogoCommercant(doc, logo, x, y, largeurMax, hauteurMax) {
  if (!logo) return false;
  try {
    doc.image(logo, x, y, { fit: [largeurMax, hauteurMax] });
    return true;
  } catch (err) {
    console.error('Logo commerçant ignoré :', err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// En-tête, pied de page, tableaux
// ---------------------------------------------------------------------------

// Repère discret de la marque : petit emblème + « AMATERASU » en petites capitales (Ardoise).
function dessinerMarqueAmaterasu(doc, x, y) {
  const taille = 11;
  dessinerEmblem(doc, x, y, taille, 'clair');
  doc.fillColor(ARDOISE).font('Helvetica-Bold').fontSize(6.5)
    .text('AMATERASU', x + taille + 5, y + 2.2, { characterSpacing: 1.2, lineBreak: false });
}

// En-tête : nom du commerce (et son logo) en grand à gauche, avec un petit repère Amaterasu au-dessus ;
// titre du document à droite (Plus Jakarta Sans ExtraBold 22 pt, souligné d'un filet Soleil de 12 mm) ;
// informations légales du commerce sous son nom. Retourne l'ordonnée à laquelle le contenu peut commencer (toujours 122).
// `marge` : marge gauche/droite du document (50 pt par défaut, mmEnPt(20) pour les gabarits A4 de la charte).
// `mentionPied` : texte à gauche du pied de page à la place des coordonnées (ex. « Document confidentiel »).
// `logo` : logo du commerçant (Buffer PNG/JPEG), affiché à gauche du nom du commerce.
function dessinerEntete(doc, { businessName, titre, sousTitre, merchant, marge = 50, mentionPied, logo }) {
  enregistrerPolices(doc);
  const largeurPage = doc.page.width;
  const droite = largeurPage - marge;
  const largeurUtile = droite - marge;

  // Repère discret de la marque Amaterasu (petit emblème + nom), tout en haut à gauche.
  dessinerMarqueAmaterasu(doc, marge, 24);

  // Logo du commerçant (s'il existe) et nom du commerce : l'identité du commerce domine l'en-tête.
  const hautBloc = 36;
  let xNom = marge;
  if (logo) {
    try {
      const image = doc.openImage(logo);
      const echelle = Math.min(hautBloc / image.height, 90 / image.width);
      const largeurLogo = image.width * echelle;
      const hauteurLogo = image.height * echelle;
      doc.image(image, marge, 40 + (hautBloc - hauteurLogo) / 2, { width: largeurLogo, height: hauteurLogo });
      xNom = marge + largeurLogo + 12;
    } catch (err) {
      console.error('Logo commerçant ignoré :', err.message);
    }
  }
  const nomCommerce = businessName || 'Commerce';
  const largeurNom = marge + largeurUtile * 0.5 - xNom;
  let tailleNom = 18;
  doc.font('Titre');
  while (tailleNom > 11) {
    doc.fontSize(tailleNom);
    if (doc.widthOfString(nomCommerce) <= largeurNom) break;
    tailleNom -= 1;
  }
  doc.fillColor(MARINE).font('Titre').fontSize(tailleNom)
    .text(nomCommerce, xNom, 40 + (hautBloc - tailleNom * 1.2) / 2, { width: largeurNom, lineBreak: false, ellipsis: true });

  // Informations légales du commerce, sous son nom.
  if (merchant && (merchant.ninea || merchant.rccm || merchant.address)) {
    const parts = [merchant.address, merchant.ninea && `NINEA ${merchant.ninea}`, merchant.rccm && `RCCM ${merchant.rccm}`].filter(Boolean);
    doc.fillColor(ARDOISE).font('Helvetica').fontSize(TAILLES.libelle)
      .text(parts.join('  ·  '), marge, 82, { width: largeurUtile * 0.5, height: 10, lineBreak: false, ellipsis: true });
  }

  // Titre du document, aligné à droite ; réduit si trop long pour tenir dans la moitié droite.
  const largeurTitre = largeurUtile * 0.58;
  let tailleTitre = TAILLES.titreDocument;
  doc.font('Titre');
  while (tailleTitre > 13) {
    doc.fontSize(tailleTitre);
    if (doc.widthOfString(titre || '') <= largeurTitre) break;
    tailleTitre -= 1;
  }
  doc.fillColor(MARINE).font('Titre').fontSize(tailleTitre)
    .text(titre || '', droite - largeurTitre, 38, { width: largeurTitre, align: 'right', lineBreak: false, ellipsis: true });

  // Filet Soleil de 12 mm sous le titre.
  const largeurFilet = mmEnPt(12);
  doc.rect(droite - largeurFilet, 67, largeurFilet, 2.2).fill(SOLEIL);

  if (sousTitre) {
    doc.fillColor(ARDOISE).font('Helvetica').fontSize(8.5)
      .text(sousTitre, droite - largeurTitre, 75, { width: largeurTitre, height: 12, align: 'right', lineBreak: false, ellipsis: true });
  }

  doc.moveTo(marge, 102).lineTo(droite, 102).strokeColor(TRAIT).lineWidth(0.8).stroke();

  activerPiedCharte(doc, { marge, merchant, businessName, mentionPied });
  if (merchant) activerPiedDePageAuto(doc, merchant);

  doc.fillColor(MARINE).font('Helvetica');
  return 122;
}

// Pied de page de la charte : coordonnées de l'émetteur (Ardoise 8 pt) à gauche, emblème (3 mm)
// + « Édité avec Amaterasu » + « n / total » à droite, à 12 mm du bord de la page. Dessiné sur
// toutes les pages juste avant doc.end() (les pages sont gardées en mémoire pour connaître le total).
function dessinerLignePied(doc, numero, total, { marge, coordonnees }) {
  const largeurPage = doc.page.width;
  const droite = largeurPage - marge;
  const y = doc.page.height - FORMATS.piedY - TAILLES.pied;
  // Le pied s'écrit dans la marge basse : on l'annule le temps de l'écrire, sinon pdfkit ajoute une page.
  const margeBasse = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  doc.moveTo(marge, y - 7).lineTo(droite, y - 7).strokeColor(TRAIT).lineWidth(0.6).stroke();

  const droiteTexte = `${MENTION_EDITEUR}  ·  ${numero} / ${total}`;
  doc.font('Helvetica').fontSize(TAILLES.pied);
  const largeurDroite = doc.widthOfString(droiteTexte);
  doc.fillColor(ARDOISE).text(droiteTexte, droite - largeurDroite, y, { lineBreak: false });
  dessinerEmblem(doc, droite - largeurDroite - TAILLES.logoPied - 4, y - 0.5, TAILLES.logoPied, 'clair');

  if (coordonnees) {
    doc.fillColor(ARDOISE).font('Helvetica').fontSize(TAILLES.pied)
      .text(coordonnees, marge, y, { width: droite - marge - largeurDroite - TAILLES.logoPied - 16, height: 10, lineBreak: false, ellipsis: true });
  }
  doc.page.margins.bottom = margeBasse;
}

// Plusieurs documents dans un même PDF (ex. impression groupée de bulletins) : chaque document
// appelle marquerDebutDocument(doc) à sa première page, et son pied de page affiche « 1 / n »
// pour lui seul, au lieu d'une numérotation continue sur tout le fichier.
function marquerDebutDocument(doc) {
  const { start, count } = doc.bufferedPageRange();
  if (!doc._debutsDocuments) doc._debutsDocuments = [];
  doc._debutsDocuments.push(start + count - 1);
}

function activerPiedCharte(doc, { marge, merchant, businessName, mentionPied }) {
  if (doc._piedCharte) return;
  doc._piedCharte = true;
  const coordonnees = mentionPied || [businessName, merchant && merchant.address].filter(Boolean).join('  ·  ');

  // Les pages restent en mémoire jusqu'à doc.end(), pour écrire « n / total » sur chacune.
  doc.options.bufferPages = true;
  const finOrigine = doc.end.bind(doc);
  doc.end = (...args) => {
    try {
      const { start, count } = doc.bufferedPageRange();
      const debuts = (doc._debutsDocuments && doc._debutsDocuments.length ? doc._debutsDocuments : [start]).slice().sort((x, y) => x - y);
      for (let i = 0; i < count; i += 1) {
        const index = start + i;
        const debut = [...debuts].reverse().find((d) => d <= index) ?? start;
        const suivant = debuts.find((d) => d > index);
        const fin = suivant === undefined ? start + count : suivant;
        doc.switchToPage(index);
        dessinerLignePied(doc, index - debut + 1, fin - debut, { marge, coordonnees });
      }
    } catch (err) {
      console.error('Pied de page Amaterasu non dessiné :', err.message);
    }
    return finOrigine(...args);
  };
}

// Pied de page : coordonnées bancaires / Mobile Money et conditions de règlement, centrées en
// bas de page, au-dessus du pied de la charte. N'affiche rien si aucune de ces informations
// n'a été renseignée par le commerçant.
function dessinerPiedDePage(doc, merchant) {
  if (!merchant) return;
  const lignes = [
    merchant.bank_details && `Coordonnées bancaires : ${merchant.bank_details}`,
    merchant.mobile_money_details && `Mobile Money : ${merchant.mobile_money_details}`,
    merchant.payment_terms,
  ].filter(Boolean);
  if (lignes.length === 0) return;

  const y = doc.page.height - 78;
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor(TRAIT).lineWidth(0.6).stroke();
  doc.fillColor(ARDOISE).font('Helvetica').fontSize(8.5)
    // `height` + `ellipsis` empêchent pdfkit de faire déborder ce texte sur une nouvelle page
    // (ce qui redéclencherait ce pied de page : boucle infinie jusqu'au RangeError).
    .text(lignes.join('  ·  '), 50, y + 8, { width: doc.page.width - 100, height: 30, align: 'center', ellipsis: true });
  doc.fillColor(MARINE).font('Helvetica');
}

// Redessine automatiquement le pied de page (coordonnées de paiement) sur chaque nouvelle page.
function activerPiedDePageAuto(doc, merchant) {
  if (doc._piedAuto) return;
  doc._piedAuto = true;
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

// En-tête de tableau : bandeau Marine, libellés blancs en capitales.
// `marge` : marge gauche/droite du tableau (50 pt par défaut, comme les rapports existants).
function dessinerEnteteTableau(doc, y, colonnes, marge = 50) {
  doc.rect(marge, y - 7, doc.page.width - 2 * marge, 24).fill(MARINE);
  doc.fillColor(BLANC).fontSize(TAILLES.libelle).font('Helvetica-Bold');
  colonnes.forEach((col) => {
    doc.text(col.texte.toUpperCase(), col.x, y, { width: col.largeur, align: col.aligner || 'left', characterSpacing: 0.4, lineBreak: false });
  });
  doc.fillColor(MARINE).font('Helvetica');
  return y + 28;
}

// Bandeau de total : fond Marine, libellé blanc, montant en Soleil (le seul cas où le Soleil sert de texte).
function dessinerBandeauTotal(doc, { x, y, largeur, label, texteMontant, hauteur = 30 }) {
  doc.rect(x, y, largeur, hauteur).fill(MARINE);
  doc.fillColor(BLANC).font('Helvetica-Bold').fontSize(TAILLES.libelle + 1)
    .text(String(label).toUpperCase(), x + 14, y + (hauteur - 9) / 2, { width: largeur * 0.45, characterSpacing: 0.6, lineBreak: false });
  doc.fillColor(SOLEIL).font('Titre').fontSize(TAILLES.total)
    .text(texteMontant, x + largeur * 0.4, y + (hauteur - TAILLES.total) / 2 - 0.5, { width: largeur * 0.6 - 14, align: 'right', lineBreak: false });
  doc.fillColor(MARINE).font('Helvetica');
  return y + hauteur;
}

function traitSeparateur(doc, y) {
  const largeurPage = doc.page.width;
  doc.moveTo(50, y).lineTo(largeurPage - 50, y).strokeColor(TRAIT).lineWidth(1).stroke();
}

// Séparateur en pointillés (reçus thermiques).
function traitPointille(doc, x1, x2, y, couleur = '#000000') {
  doc.save();
  doc.moveTo(x1, y).lineTo(x2, y).dash(1.5, { space: 1.5 }).lineWidth(0.6).strokeColor(couleur).stroke();
  doc.undash();
  doc.restore();
}

module.exports = {
  COULEURS: {
    encre: MARINE, muted: ARDOISE, mutedClair: ARDOISE, bordure: TRAIT, fondAlterne: BRUME, fondEntete: C.azurClair, accent: MARINE,
    marine: MARINE, soleil: SOLEIL, azur: C.azur, azurClair: C.azurClair, soleilClair: C.soleilClair, brume: BRUME, blanc: BLANC, noir: '#000000',
    brique: C.erreur, succes: C.succes, alerte: C.alerte,
  },
  formatMontant,
  dessinerEntete,
  dessinerEnteteTableau,
  dessinerBandeauTotal,
  dessinerPiedDePage,
  dessinerLignePied,
  activerPiedCharte,
  marquerDebutDocument,
  dessinerEmblem,
  dessinerMarqueAmaterasu,
  lireLogoCommercant,
  dessinerLogoCommercant,
  traitSeparateur,
  traitPointille,
  enregistrerPolices,
};
