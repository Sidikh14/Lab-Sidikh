// Mise en page commune des états PDF de la comptabilité et des déclarations fiscales.
// Principe : sobre et lisible. Le gras est réservé au titre, aux en-têtes de colonnes, aux
// titres de sections et aux lignes de total ; tout le reste est en texte normal.

// Charte graphique Amaterasu v8 : texte Marine, en-têtes de tableau Marine, lignes alternées Brume,
// totaux sur fond Azur clair, filet Soleil sous le titre, emblème Amaterasu.
const { COULEURS: CH, mmEnPt, MENTION_EDITEUR, TAILLES } = require('./pdfTheme');
const { enregistrerPolices, dessinerEmblem } = require('./pdfHelpers');

const NOIR = CH.marine; // texte
const GRIS = CH.ardoise; // texte secondaire
const FILET = CH.trait;
const FOND_ENTETE = CH.marine; // en-tête de tableau
const FOND_TOTAL = CH.azurClair; // lignes de total
const FOND_ALTERNE = CH.brume;
const ACCENT = CH.marine; // titres de section
const SOLEIL = CH.soleil;

function dessinerEtatPdf(doc, { entreprise, titre, periode, sections }, nettoyer) {
  const gauche = doc.page.margins.left;
  const largeur = doc.page.width - gauche - doc.page.margins.right;
  const bas = () => doc.page.height - doc.page.margins.bottom - 24;

  enregistrerPolices(doc);

  // ----- En-tête du document : emblème + nom de la marque, puis titre avec filet Soleil -----
  const yEmbleme = doc.y;
  const tailleEmbleme = Math.max(TAILLES.logoMin, 24);
  dessinerEmblem(doc, gauche, yEmbleme, tailleEmbleme, 'clair');
  doc.font('Titre').fontSize(12).fillColor(NOIR)
    .text('Amaterasu', gauche + tailleEmbleme + 8, yEmbleme + 6, { lineBreak: false });
  doc.y = yEmbleme + tailleEmbleme + 12;
  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text(nettoyer(entreprise).toUpperCase(), gauche, doc.y, { width: largeur, characterSpacing: 0.5 });
  doc.moveDown(0.35);
  doc.font('Titre').fontSize(18).fillColor(NOIR).text(nettoyer(titre), gauche, doc.y, { width: largeur });
  if (periode) {
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(nettoyer(periode), gauche, doc.y, { width: largeur });
  }
  doc.moveDown(0.6);
  const yFiletTitre = doc.y;
  doc.rect(gauche, yFiletTitre, mmEnPt(12), 2.2).fill(SOLEIL);
  doc.y = yFiletTitre + 16;

  // ----- Sections -----
  for (const sec of sections) {
    const cellules = (l) => (Array.isArray(l) ? l : l?.cells || []);

    // Paragraphe d'information (texte réglementaire) : texte simple, sans tableau.
    if (sec.texte === true) {
      const t = nettoyer(cellules(sec.lignes[0])[0]);
      doc.font('Helvetica').fontSize(8.5).fillColor(GRIS);
      const h = doc.heightOfString(t, { width: largeur, align: 'justify' });
      if (doc.y + h > bas()) doc.addPage();
      doc.text(t, gauche, doc.y, { width: largeur, align: 'justify' });
      doc.y += 14;
      continue;
    }

    const n = sec.colonnes.length;
    // Fiche d'identification : colonnes paires = libellés (petits, gris), impaires = valeurs.
    const paires = sec.paires === true && n === 4;

    let largeurs;
    if (paires) {
      largeurs = [0.2, 0.3, 0.2, 0.3].map((p) => p * largeur);
    } else {
      const poids = sec.colonnes.map((c, i) => {
        const longueur = Math.max(String(c.label || '').length, ...sec.lignes.slice(0, 300).map((l) => nettoyer(cellules(l)[i]).length));
        return Math.min(Math.max(longueur, 6), c.align === 'right' ? 16 : 44);
      });
      const total = poids.reduce((a, b) => a + b, 0);
      largeurs = poids.map((w) => (w / total) * largeur);
    }
    const x = (i) => gauche + largeurs.slice(0, i).reduce((a, b) => a + b, 0);
    const alignement = (c) => (c.align === 'right' ? 'right' : 'left');

    const dessinerEntete = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(7.5);
      // Fiche d'identification : l'intitulé s'étale sur toute la largeur.
      const largeurEntete = (i) => (paires ? (i === 0 ? largeur : 0) : largeurs[i]);
      const h = Math.max(...sec.colonnes.map((c, i) => (largeurEntete(i) > 10 ? doc.heightOfString(nettoyer(c.label), { width: largeurEntete(i) - 10 }) : 0))) + 10;
      doc.rect(gauche, y, largeur, h).fill(FOND_ENTETE);
      doc.fillColor(CH.blanc);
      sec.colonnes.forEach((c, i) => {
        if (largeurEntete(i) <= 10) return;
        doc.text(nettoyer(c.label), x(i) + 5, y + 5, { width: largeurEntete(i) - 10, align: alignement(c) });
      });
      doc.y = y + h;
    };

    if (doc.y + 60 > bas()) doc.addPage();
    if (sec.titre) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text(nettoyer(sec.titre), gauche, doc.y, { width: largeur });
      doc.y += 5;
    }
    // La fiche d'identification a son propre titre en en-tête de colonne.
    if (!paires || sec.colonnes.some((c) => c.label)) dessinerEntete();

    sec.lignes.forEach((ligne, index) => {
      const fort = !Array.isArray(ligne) && ligne?.fort === true;
      const cells = cellules(ligne);
      const police = (i) => (fort ? 'Helvetica-Bold' : 'Helvetica');
      const taille = (i) => (paires && i % 2 === 0 ? 7 : 8.5);
      const texte = (i) => (paires && i % 2 === 0 ? nettoyer(cells[i]).toUpperCase() : nettoyer(cells[i]));

      const h = Math.max(...sec.colonnes.map((c, i) => {
        doc.font(police(i)).fontSize(taille(i));
        return doc.heightOfString(texte(i), { width: largeurs[i] - 10 });
      })) + 9;

      if (doc.y + h > bas()) {
        doc.addPage();
        if (!paires) dessinerEntete();
      }
      const y = doc.y;
      if (fort) doc.rect(gauche, y, largeur, h).fill(FOND_TOTAL);
      else if (!paires && index % 2 === 1) doc.rect(gauche, y, largeur, h).fill(FOND_ALTERNE);

      sec.colonnes.forEach((c, i) => {
        const libelle = paires && i % 2 === 0;
        doc.font(police(i)).fontSize(taille(i)).fillColor(libelle ? GRIS : NOIR);
        doc.text(texte(i), x(i) + 5, y + 4.5, { width: largeurs[i] - 10, align: alignement(c) });
      });

      doc.moveTo(gauche, y + h).lineTo(gauche + largeur, y + h)
        .lineWidth(fort ? 0.8 : 0.4).strokeColor(fort ? NOIR : FILET).stroke();
      doc.y = y + h;
    });
    doc.y += 14;
  }
}

// Pied de page : date d'édition à gauche, numéro de page à droite. À appeler une fois le contenu écrit
// (le document doit avoir été créé avec bufferPages: true).
function dessinerPiedsDePage(doc) {
  enregistrerPolices(doc);
  const gauche = doc.page.margins.left;
  const largeur = doc.page.width - gauche - doc.page.margins.right;
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(pages.start + i);
    // Le pied de page s'écrit dans la marge basse : on l'annule le temps de l'écrire,
    // sinon pdfkit ajoute une page blanche après chaque page.
    const margeBasse = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const piedY = doc.page.height - margeBasse + 4;
    doc.moveTo(gauche, piedY - 6).lineTo(gauche + largeur, piedY - 6).lineWidth(0.4).strokeColor(FILET).stroke();
    doc.font('Helvetica').fontSize(TAILLES.pied).fillColor(GRIS);
    const tailleLogo = TAILLES.logoPied;
    dessinerEmblem(doc, gauche, piedY - 0.5, tailleLogo, 'clair');
    doc.text(`${MENTION_EDITEUR}  ·  le ${new Date().toLocaleDateString('fr-FR')}`, gauche + tailleLogo + 4, piedY, { width: largeur / 2, align: 'left', lineBreak: false });
    doc.text(`Page ${i + 1} / ${pages.count}`, gauche, piedY, { width: largeur, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margeBasse;
  }
}

module.exports = { dessinerEtatPdf, dessinerPiedsDePage };
