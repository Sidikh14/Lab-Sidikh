// utils/payslipPdf.js — mise en page PDF du bulletin de paie (extraite de payroll.routes.js
// pour être réutilisée par l'envoi par e-mail et l'impression groupée).
const PDFDocument = require('pdfkit');
const {
  LABEL_TYPE_RETENUE,
} = require('./payrollDeductions');
const {
  dessinerEntete,
  dessinerEnteteTableau,
  dessinerBandeauTotal,
  marquerDebutDocument,
  formatMontant,
  COULEURS,
} = require('./pdfHelpers');
const { FORMATS, TAILLES, metadonneesPdf } = require('./pdfTheme');

function nomMois(moisStr) {
  const NOMS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const [annee, mois] = moisStr.split('-');
  return `${NOMS[Number(mois) - 1]} ${annee}`;
}

function genererBulletinPDF(doc, bulletin) {
  // Charte Amaterasu v8 : A4 portrait, marges de 20 mm, tableau à en-tête Marine, bandeau « Net à payer »
  // (montant en Soleil), mention « Document confidentiel » en pied de page. Chaque bulletin porte sa propre
  // numérotation (« 1 / 1 »), y compris dans une impression groupée.
  marquerDebutDocument(doc);

  const M = FORMATS.marge;
  const largeurPage = doc.page.width;
  const xGauche = M;
  const xDroite = largeurPage - M;
  const largeurUtile = xDroite - xGauche;
  const HAUTEUR_LIGNE = 22;
  // Colonnes du tableau : Rubrique | Gains | Retenues
  const largeurMontant = 92;
  const xRetenues = xDroite - 8 - largeurMontant;
  const xGains = xRetenues - 10 - largeurMontant;
  const largeurRubrique = xGains - xGauche - 18;
  const COLONNES = [
    { texte: 'Rubrique', x: xGauche + 8, largeur: largeurRubrique },
    { texte: 'Gains', x: xGains, largeur: largeurMontant, aligner: 'right' },
    { texte: 'Retenues', x: xRetenues, largeur: largeurMontant, aligner: 'right' },
  ];

  const libelle = (texte, x, yy, w) => doc.font('Helvetica-Bold').fontSize(TAILLES.libelle).fillColor(COULEURS.muted)
    .text(texte, x, yy, { width: w, characterSpacing: 0.6, lineBreak: false });

  // Les coordonnées de paiement n'ont pas leur place sur un bulletin : seul l'employeur est identifié.
  const entetePage = () => dessinerEntete(doc, {
    businessName: bulletin.business_name,
    titre: 'Bulletin de paie',
    sousTitre: `Période : ${nomMois(bulletin.month)}${bulletin.number ? `  ·  N° ${bulletin.number}` : ''}${Number(bulletin.version) > 1 ? ' (rectificatif)' : ''}`,
    marge: M,
    mentionPied: 'Document confidentiel',
  });
  let y = entetePage() + 10;

  // --- Employeur (gauche) et salarié (droite) ---
  const largeurCol = (largeurUtile - 28) / 2;
  const xG = xGauche;
  const xD = xGauche + largeurCol + 28;
  libelle('EMPLOYEUR', xG, y, largeurCol);
  libelle('SALARIÉ', xD, y, largeurCol);
  let yG = y + 13;
  let yD = y + 13;
  doc.font('Helvetica-Bold').fontSize(TAILLES.texte + 1).fillColor(COULEURS.encre)
    .text(bulletin.business_name || 'Employeur', xG, yG, { width: largeurCol, lineBreak: false, ellipsis: true });
  yG += 16;
  doc.font('Helvetica').fontSize(TAILLES.texte).fillColor(COULEURS.encre);
  [bulletin.address, bulletin.ninea && `NINEA ${bulletin.ninea}`, bulletin.rccm && `RCCM ${bulletin.rccm}`]
    .filter(Boolean)
    .forEach((ligne) => { doc.text(ligne, xG, yG, { width: largeurCol, lineBreak: false, ellipsis: true }); yG += 14; });

  doc.font('Helvetica-Bold').fontSize(TAILLES.texte + 1).fillColor(COULEURS.encre)
    .text(bulletin.full_name, xD, yD, { width: largeurCol, lineBreak: false, ellipsis: true });
  yD += 16;
  doc.font('Helvetica').fontSize(TAILLES.texte).fillColor(COULEURS.encre);
  [libelleRole(bulletin.role), `Parts fiscales : ${Number(bulletin.parts_fiscales) || 1}`]
    .filter(Boolean)
    .forEach((ligne) => { doc.text(ligne, xD, yD, { width: largeurCol, lineBreak: false, ellipsis: true }); yD += 14; });

  y = Math.max(yG, yD) + 18;

  const limiteBas = () => doc.page.height - 120;
  const nouvellePage = () => {
    doc.addPage(); // page de suite du même bulletin : même numérotation « n / total »
    y = entetePage() + 18;
    y = dessinerEnteteTableau(doc, y, COLONNES, M);
  };

  let indexLigne = 0;
  // Une rubrique : libellé, puis le montant dans la colonne Gains ou Retenues.
  function rubrique(label, montant, { colonne = 'gains', indent = false } = {}) {
    if (y + HAUTEUR_LIGNE > limiteBas()) nouvellePage();
    if (indexLigne % 2 === 1) doc.rect(xGauche, y - 6, largeurUtile, HAUTEUR_LIGNE).fill(COULEURS.fondAlterne);
    doc.font('Helvetica').fontSize(TAILLES.tableau).fillColor(COULEURS.encre);
    doc.text(label, COLONNES[0].x + (indent ? 14 : 0), y, { width: largeurRubrique - (indent ? 14 : 0), lineBreak: false, ellipsis: true });
    if (colonne === 'gains') {
      doc.text(formatMontant(montant), xGains, y, { width: largeurMontant, align: 'right', lineBreak: false });
      doc.fillColor(COULEURS.muted).text('—', xRetenues, y, { width: largeurMontant, align: 'right', lineBreak: false });
    } else {
      doc.fillColor(COULEURS.muted).text('—', xGains, y, { width: largeurMontant, align: 'right', lineBreak: false });
      doc.fillColor(COULEURS.encre).text(formatMontant(montant), xRetenues, y, { width: largeurMontant, align: 'right', lineBreak: false });
    }
    y += HAUTEUR_LIGNE;
    indexLigne += 1;
  }

  const retenuesDetail = Array.isArray(bulletin.deductions_detail) ? bulletin.deductions_detail : [];
  const SUR_BRUT = ['absence', 'prorata'];
  const absencesDetail = retenuesDetail.filter((d) => SUR_BRUT.includes(d.type));
  const autresRetenues = retenuesDetail.filter((d) => !SUR_BRUT.includes(d.type));
  const salaireBrut = Number(bulletin.base_salary) + Number(bulletin.bonuses_total || 0);
  const totalRetenues = salaireBrut - Number(bulletin.net_a_payer);

  y += 2;
  y = dessinerEnteteTableau(doc, y, COLONNES, M);

  // --- Gains ---
  rubrique('Salaire de base', bulletin.base_salary);
  (bulletin.bonuses_detail || []).forEach((b) => rubrique(b.kind === 'overtime' ? b.label : `Prime — ${b.label}`, b.amount, { indent: true }));

  // --- Retenues ---
  absencesDetail.forEach((d) => rubrique(d.type === 'absence' ? `Absence — ${d.label}` : d.label, d.amount, { colonne: 'retenues' }));
  if (Number(bulletin.ipres_salarial) > 0) rubrique('IPRES (retraite)', bulletin.ipres_salarial, { colonne: 'retenues' });
  if (Number(bulletin.css_salarial) > 0) rubrique('CSS', bulletin.css_salarial, { colonne: 'retenues' });
  rubrique('Impôt sur le revenu (IRPP)', bulletin.irpp, { colonne: 'retenues' });
  rubrique('TRIMF', bulletin.trimf, { colonne: 'retenues' });
  // Avances, prêts et autres retenues : déduits du net, après impôts.
  autresRetenues.forEach((d) => {
    const prefixe = LABEL_TYPE_RETENUE[d.type] || 'Retenue';
    rubrique(d.label && d.label !== prefixe ? `${prefixe} — ${d.label}` : prefixe, d.amount, { colonne: 'retenues' });
  });

  // --- Totaux ---
  if (y + HAUTEUR_LIGNE + 190 > doc.page.height - 70) nouvellePage();
  doc.rect(xGauche, y - 6, largeurUtile, HAUTEUR_LIGNE + 2).fill(COULEURS.azurClair);
  doc.moveTo(xGauche, y - 6).lineTo(xDroite, y - 6).strokeColor(COULEURS.encre).lineWidth(0.8).stroke();
  doc.font('Helvetica-Bold').fontSize(TAILLES.tableau).fillColor(COULEURS.encre);
  doc.text('Totaux', COLONNES[0].x, y, { width: largeurRubrique, lineBreak: false });
  doc.text(formatMontant(salaireBrut), xGains, y, { width: largeurMontant, align: 'right', lineBreak: false });
  doc.text(formatMontant(totalRetenues), xRetenues, y, { width: largeurMontant, align: 'right', lineBreak: false });
  y += HAUTEUR_LIGNE + 10;

  // Information de calcul : base de l'IRPP (brut moins absences et cotisations).
  doc.fillColor(COULEURS.muted).font('Helvetica').fontSize(8)
    .text(`Revenu imposable (base de calcul de l'IRPP) : ${formatMontant(bulletin.revenu_imposable)} FCFA  ·  Montants en FCFA`, xGauche + 8, y, { width: largeurUtile - 16, lineBreak: false });
  y += 22;

  // --- Net à payer : bandeau Marine, montant en Soleil ---
  y = dessinerBandeauTotal(doc, {
    x: xGauche, y, largeur: largeurUtile, label: `Net à payer — ${nomMois(bulletin.month)}`,
    texteMontant: `${formatMontant(bulletin.net_a_payer)} FCFA`, hauteur: 40,
  }) + 26;

  // --- Charges patronales : informatif ---
  doc.fillColor(COULEURS.muted).font('Helvetica-Bold').fontSize(TAILLES.libelle)
    .text('CHARGES PATRONALES — INFORMATIF, NON DÉDUITES DU NET', xGauche, y, { characterSpacing: 0.6, lineBreak: false });
  y += 14;
  const charges = [
    ['IPRES patronal', bulletin.ipres_patronal],
    ['CSS patronal', bulletin.css_patronal],
    ['CFCE', bulletin.cfce],
    ['Coût total employeur', bulletin.cout_total_employeur],
  ].filter(([label, montant]) => !['IPRES patronal', 'CSS patronal'].includes(label) || Number(montant) > 0);
  const ecart = 8;
  const largeurCase = (largeurUtile - ecart * (charges.length - 1)) / charges.length;
  charges.forEach(([label, montant], i) => {
    const x = xGauche + i * (largeurCase + ecart);
    doc.roundedRect(x, y, largeurCase, 42, 4).lineWidth(0.6).strokeColor(COULEURS.bordure).stroke();
    doc.fillColor(COULEURS.muted).font('Helvetica').fontSize(7).text(label.toUpperCase(), x + 10, y + 9, { width: largeurCase - 16, characterSpacing: 0.4, lineBreak: false });
    doc.fillColor(COULEURS.encre).font(label === 'Coût total employeur' ? 'Helvetica-Bold' : 'Helvetica').fontSize(10)
      .text(`${formatMontant(montant)} FCFA`, x + 10, y + 23, { width: largeurCase - 16, lineBreak: false });
  });

  // Le pied de page « Document confidentiel — Édité avec Amaterasu · n / total » est ajouté à la fin du document.
}

function libelleRole(role) {
  const LABELS = { gerant: 'Gérant', vendeur: 'Vendeur', caissier: 'Caissier', vendeur_caissier: 'Vendeur / Caissier', manager: 'Manager' };
  return LABELS[role] || role;
}


// Bulletin complet en mémoire (pièce jointe d'e-mail).
function bulletinEnBuffer(bulletin) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
      ...metadonneesPdf({ titre: `Bulletin de paie ${nomMois(bulletin.month)}`, commercant: bulletin.business_name }),
    });
    const morceaux = [];
    doc.on('data', (m) => morceaux.push(m));
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    doc.on('error', reject);
    genererBulletinPDF(doc, bulletin);
    doc.end();
  });
}

// Plusieurs bulletins dans un seul PDF (impression groupée).
function genererBulletinsGroupes(doc, bulletins) {
  bulletins.forEach((b, i) => {
    if (i > 0) doc.addPage();
    genererBulletinPDF(doc, b);
  });
}

module.exports = { genererBulletinPDF, bulletinEnBuffer, genererBulletinsGroupes, nomMois, libelleRole };
