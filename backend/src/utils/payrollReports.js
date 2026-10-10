// payrollReports.js — sortie des états de paie en PDF (tableau paginé) ou CSV (ouvrable dans Excel).
const PDFDocument = require('pdfkit');
const { COULEURS, enregistrerPolices, activerPiedCharte, dessinerMarqueAmaterasu } = require('./pdfHelpers');
const { mmEnPt, metadonneesPdf, nomFichierPdf } = require('./pdfTheme');

function montant(n) {
  return Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ');
}

function csvCellule(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// colonnes : [{ key, label, money?: bool, width?: nombre relatif }]
// lignes : tableaux d'objets ; totaux : objet (même clés) ou null.
function genererCsv({ colonnes, lignes, totaux }) {
  const sortie = [colonnes.map((c) => csvCellule(c.label)).join(';')];
  const valeur = (c, l) => (c.money ? Math.round(Number(l[c.key]) || 0) : l[c.key]);
  lignes.forEach((l) => sortie.push(colonnes.map((c) => csvCellule(valeur(c, l))).join(';')));
  if (totaux) sortie.push(colonnes.map((c) => csvCellule(c.key in totaux ? valeur(c, totaux) : '')).join(';'));
  return `\uFEFF${sortie.join('\r\n')}\r\n`;
}

function genererPdf(res, { titre, sousTitre, entreprise, colonnes, lignes, totaux }) {
  // Charte Amaterasu v8 : emblème et titre avec filet Soleil, en-tête de tableau Marine, lignes alternées
  // Brume, ligne de totaux sur fond Azur clair, pied « Édité avec Amaterasu · n / total ».
  // Le tableau est large (jusqu'à 16 colonnes) : l'état reste en paysage avec des marges de 36 pt.
  const MARGE = 36;
  const doc = new PDFDocument({
    margin: MARGE,
    size: 'A4',
    layout: 'landscape',
    ...metadonneesPdf({ titre, commercant: entreprise }),
  });
  doc.pipe(res);
  enregistrerPolices(doc);
  activerPiedCharte(doc, {
    marge: MARGE,
    mentionPied: 'Document de gestion — taux, plafonds et majorations à faire valider par un professionnel avant tout usage officiel.',
  });

  const largeurUtile = doc.page.width - 2 * MARGE;
  const poidsTotal = colonnes.reduce((s, c) => s + (c.width || 1), 0);
  const largeurs = colonnes.map((c) => ((c.width || 1) / poidsTotal) * largeurUtile);
  const limiteBas = () => doc.page.height - 72;

  function entete() {
    dessinerMarqueAmaterasu(doc, MARGE, 22);
    doc.font('Titre').fontSize(16).fillColor(COULEURS.encre).text(entreprise || '', MARGE, 38, { width: largeurUtile, lineBreak: false, ellipsis: true });
    doc.font('Titre-Bold').fontSize(12).fillColor(COULEURS.encre).text(titre, MARGE, 60, { width: largeurUtile, lineBreak: false, ellipsis: true });
    doc.rect(MARGE, 78, mmEnPt(12), 2.2).fill(COULEURS.soleil);
    doc.font('Helvetica').fontSize(9).fillColor(COULEURS.muted)
      .text(sousTitre || '', MARGE, 86, { width: largeurUtile, lineBreak: false, ellipsis: true });
    // En-tête du tableau : bandeau Marine, libellés blancs.
    const y = 108;
    doc.rect(MARGE, y - 6, largeurUtile, 20).fill(COULEURS.marine);
    let x = MARGE;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COULEURS.blanc);
    colonnes.forEach((c, i) => {
      doc.text(c.label, x + 2, y, { width: largeurs[i] - 4, align: c.money ? 'right' : 'left', lineBreak: false, ellipsis: true });
      x += largeurs[i];
    });
    return y + 20;
  }

  function ligne(l, y, gras) {
    let x = MARGE;
    doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(COULEURS.encre);
    colonnes.forEach((c, i) => {
      const v = c.money ? (c.key in l ? montant(l[c.key]) : '') : (l[c.key] ?? '');
      doc.text(String(v), x + 2, y, { width: largeurs[i] - 4, align: c.money ? 'right' : 'left', lineBreak: false, ellipsis: true });
      x += largeurs[i];
    });
  }

  let y = entete();
  lignes.forEach((l, index) => {
    if (y > limiteBas()) {
      doc.addPage();
      y = entete();
    }
    if (index % 2 === 1) doc.rect(MARGE, y - 4, largeurUtile, 14).fill(COULEURS.fondAlterne);
    ligne(l, y, false);
    y += 14;
  });
  if (totaux) {
    if (y > limiteBas()) {
      doc.addPage();
      y = entete();
    }
    doc.rect(MARGE, y - 4, largeurUtile, 16).fill(COULEURS.azurClair);
    doc.moveTo(MARGE, y - 4).lineTo(MARGE + largeurUtile, y - 4).strokeColor(COULEURS.encre).lineWidth(0.8).stroke();
    ligne(totaux, y, true);
  }
  // Le pied de page (avertissement, « Édité avec Amaterasu », n / total) est ajouté par pdfHelpers à la fin.
  doc.end();
}

// format : 'pdf' | 'csv' ; sinon renvoie le JSON.
function envoyerEtat(res, format, etat) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${etat.nomFichier}.csv"`);
    return res.send(genererCsv(etat));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nomFichierPdf(etat.nomFichier, '')}"`);
    return genererPdf(res, etat);
  }
  return res.json({ titre: etat.titre, sousTitre: etat.sousTitre, colonnes: etat.colonnes, lignes: etat.lignes, totaux: etat.totaux });
}

function sommer(lignes, cles) {
  const t = {};
  cles.forEach((k) => { t[k] = lignes.reduce((s, l) => s + (Number(l[k]) || 0), 0); });
  return t;
}

module.exports = { envoyerEtat, genererCsv, sommer, montant };
