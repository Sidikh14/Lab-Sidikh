// payrollReports.js — sortie des états de paie en PDF (tableau paginé) ou CSV (ouvrable dans Excel).
const PDFDocument = require('pdfkit');

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
  const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
  doc.pipe(res);
  const largeurUtile = doc.page.width - 72;
  const poidsTotal = colonnes.reduce((s, c) => s + (c.width || 1), 0);
  const largeurs = colonnes.map((c) => ((c.width || 1) / poidsTotal) * largeurUtile);

  function entete() {
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111').text(titre, 36, 36);
    doc.font('Helvetica').fontSize(9).fillColor('#555').text([entreprise, sousTitre].filter(Boolean).join(' — '), 36, 56);
    let x = 36;
    const y = 80;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#111');
    colonnes.forEach((c, i) => {
      doc.text(c.label, x + 2, y, { width: largeurs[i] - 4, align: c.money ? 'right' : 'left', lineBreak: false });
      x += largeurs[i];
    });
    doc.moveTo(36, y + 12).lineTo(36 + largeurUtile, y + 12).strokeColor('#999').lineWidth(0.5).stroke();
    return y + 18;
  }

  function ligne(l, y, gras) {
    let x = 36;
    doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor('#111');
    colonnes.forEach((c, i) => {
      const v = c.money ? (c.key in l ? montant(l[c.key]) : '') : (l[c.key] ?? '');
      doc.text(String(v), x + 2, y, { width: largeurs[i] - 4, align: c.money ? 'right' : 'left', lineBreak: false, ellipsis: true });
      x += largeurs[i];
    });
  }

  let y = entete();
  lignes.forEach((l) => {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = entete();
    }
    ligne(l, y, false);
    y += 14;
  });
  if (totaux) {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = entete();
    }
    doc.moveTo(36, y - 2).lineTo(36 + largeurUtile, y - 2).strokeColor('#999').lineWidth(0.5).stroke();
    ligne(totaux, y + 2, true);
  }
  doc.font('Helvetica').fontSize(7).fillColor('#888')
    .text('Document de gestion — taux, plafonds et majorations à faire valider par un professionnel avant tout usage officiel.', 36, doc.page.height - 30, { lineBreak: false });
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
    res.setHeader('Content-Disposition', `inline; filename="${etat.nomFichier}.pdf"`);
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
