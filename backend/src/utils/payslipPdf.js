// utils/payslipPdf.js — mise en page PDF du bulletin de paie (extraite de payroll.routes.js
// pour être réutilisée par l'envoi par e-mail et l'impression groupée).
const PDFDocument = require('pdfkit');
const {
  LABEL_TYPE_RETENUE,
} = require('./payrollDeductions');
const {
  dessinerEntete,
  dessinerEnteteTableau,
  dessinerPiedDePage,
  formatMontant,
  COULEURS,
} = require('./pdfHelpers');

function nomMois(moisStr) {
  const NOMS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const [annee, mois] = moisStr.split('-');
  return `${NOMS[Number(mois) - 1]} ${annee}`;
}

function genererBulletinPDF(doc, bulletin) {
  const merchant = {
    ninea: bulletin.ninea,
    rccm: bulletin.rccm,
    address: bulletin.address,
    bank_details: bulletin.bank_details,
    mobile_money_details: bulletin.mobile_money_details,
    payment_terms: bulletin.payment_terms,
  };
  const largeurPage = doc.page.width;
  const xGauche = 50;
  const xDroite = largeurPage - 50;
  const largeurUtile = xDroite - xGauche;
  const HAUTEUR_LIGNE = 22;
  const xMontant = xDroite - 190;
  const FOND_CARTE = '#F3F4F6';
  const FILET = '#E5E7EB';
  const FOND_NET = '#EEF2F7';

  let y = dessinerEntete(doc, {
    businessName: bulletin.business_name,
    titre: 'Bulletin de paie',
    sousTitre: `${nomMois(bulletin.month)}${bulletin.number ? ` — N° ${bulletin.number}` : ''}${Number(bulletin.version) > 1 ? ' (rectificatif)' : ''}`,
    merchant,
  });

  // --- Carte d'identité du salarié ---
  const hauteurBloc = 54;
  doc.roundedRect(xGauche, y, largeurUtile, hauteurBloc, 5).fill(FOND_CARTE);
  const colonnes = [
    { x: xGauche + 16, largeur: largeurUtile * 0.36, titre: 'Salarié', valeur: bulletin.full_name, police: 'Helvetica-Bold', taille: 11.5 },
    { x: xGauche + largeurUtile * 0.38, largeur: largeurUtile * 0.22, titre: 'Poste', valeur: libelleRole(bulletin.role), police: 'Helvetica', taille: 10.5 },
    { x: xGauche + largeurUtile * 0.62, largeur: largeurUtile * 0.18, titre: 'Période', valeur: nomMois(bulletin.month), police: 'Helvetica', taille: 10.5 },
    { x: xGauche + largeurUtile * 0.82, largeur: largeurUtile * 0.17, titre: 'Parts fiscales', valeur: String(Number(bulletin.parts_fiscales) || 1), police: 'Helvetica', taille: 10.5 },
  ];
  colonnes.forEach((c) => {
    doc.fillColor(COULEURS.mutedClair).font('Helvetica').fontSize(7).text(c.titre.toUpperCase(), c.x, y + 12, { characterSpacing: 0.6, width: c.largeur, lineBreak: false });
    doc.fillColor(COULEURS.encre).font(c.police).fontSize(c.taille).text(c.valeur, c.x, y + 26, { width: c.largeur - 6, lineBreak: false, ellipsis: true });
  });
  y += hauteurBloc + 24;

  let indexLigne = 0;
  function ligne(label, montant, { indent = false, negatif = false } = {}) {
    if (indexLigne % 2 === 1) doc.rect(xGauche, y - 5, largeurUtile, HAUTEUR_LIGNE).fill(COULEURS.fondAlterne);
    doc.font('Helvetica').fontSize(10).fillColor(COULEURS.encre);
    doc.text(label, xGauche + 10 + (indent ? 14 : 0), y, { width: xMontant - xGauche - 24, lineBreak: false, ellipsis: true });
    doc.text(`${negatif ? '- ' : ''}${formatMontant(montant)}`, xMontant, y, { width: 180, align: 'right', lineBreak: false });
    y += HAUTEUR_LIGNE;
    indexLigne += 1;
  }

  function totalLigne(label, montant) {
    y += 1;
    doc.rect(xGauche, y - 5, largeurUtile, HAUTEUR_LIGNE + 2).fill(FOND_CARTE);
    doc.moveTo(xGauche, y - 5).lineTo(xDroite, y - 5).strokeColor(COULEURS.encre).lineWidth(0.8).stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COULEURS.encre);
    doc.text(label, xGauche + 10, y, { width: xMontant - xGauche - 24, lineBreak: false });
    doc.text(formatMontant(montant), xMontant, y, { width: 180, align: 'right', lineBreak: false });
    y += HAUTEUR_LIGNE + 14;
  }

  const retenuesDetail = Array.isArray(bulletin.deductions_detail) ? bulletin.deductions_detail : [];
  const SUR_BRUT = ['absence', 'prorata'];
  const absencesDetail = retenuesDetail.filter((d) => SUR_BRUT.includes(d.type));
  const autresRetenues = retenuesDetail.filter((d) => !SUR_BRUT.includes(d.type));
  const salaireBrut = Number(bulletin.base_salary) + Number(bulletin.bonuses_total || 0);

  // --- GAINS ---
  y = dessinerEnteteTableau(doc, y, [
    { texte: 'Gains', x: xGauche + 10, largeur: 300 },
    { texte: 'Montant (FCFA)', x: xMontant, largeur: 180, aligner: 'right' },
  ]);
  ligne('Salaire de base', bulletin.base_salary);
  (bulletin.bonuses_detail || []).forEach((b) => ligne(b.kind === 'overtime' ? b.label : `Prime — ${b.label}`, b.amount, { indent: true }));
  totalLigne('Salaire brut', salaireBrut);

  // --- RETENUES ---
  indexLigne = 0;
  y = dessinerEnteteTableau(doc, y, [
    { texte: 'Retenues', x: xGauche + 10, largeur: 300 },
    { texte: 'Montant (FCFA)', x: xMontant, largeur: 180, aligner: 'right' },
  ]);
  absencesDetail.forEach((d) => ligne(d.type === 'absence' ? `Absence — ${d.label}` : d.label, d.amount, { negatif: true }));
  if (Number(bulletin.ipres_salarial) > 0) ligne('IPRES (retraite)', bulletin.ipres_salarial, { negatif: true });
  if (Number(bulletin.css_salarial) > 0) ligne('CSS', bulletin.css_salarial, { negatif: true });
  ligne('Impôt sur le revenu (IRPP)', bulletin.irpp, { negatif: true });
  ligne('TRIMF', bulletin.trimf, { negatif: true });
  // Avances, prêts et autres retenues : déduits du net, après impôts.
  autresRetenues.forEach((d) => {
    const prefixe = LABEL_TYPE_RETENUE[d.type] || 'Retenue';
    ligne(d.label && d.label !== prefixe ? `${prefixe} — ${d.label}` : prefixe, d.amount, { negatif: true });
  });
  totalLigne('Total des retenues', salaireBrut - Number(bulletin.net_a_payer));

  // Information de calcul : base de l'IRPP (brut moins absences et cotisations).
  doc.fillColor(COULEURS.mutedClair).font('Helvetica').fontSize(8)
    .text(`Revenu imposable (base de calcul de l'IRPP) : ${formatMontant(bulletin.revenu_imposable)} FCFA`, xGauche + 10, y - 8, { width: largeurUtile - 20, lineBreak: false });
  y += 18;

  // --- NET À PAYER : bandeau clair avec barre d'accent ---
  const hauteurNet = 52;
  doc.roundedRect(xGauche, y, largeurUtile, hauteurNet, 5).fill(FOND_NET);
  doc.rect(xGauche, y, 5, hauteurNet).fill(COULEURS.accent);
  doc.fillColor(COULEURS.muted).font('Helvetica').fontSize(8)
    .text('NET À PAYER', xGauche + 24, y + 12, { characterSpacing: 0.8, lineBreak: false });
  doc.fillColor(COULEURS.encre).font('Helvetica').fontSize(9)
    .text(nomMois(bulletin.month), xGauche + 24, y + 28, { lineBreak: false });
  doc.fillColor(COULEURS.accent).font('Helvetica-Bold').fontSize(20)
    .text(`${formatMontant(bulletin.net_a_payer)} FCFA`, xGauche, y + 15, { width: largeurUtile - 22, align: 'right', lineBreak: false });
  y += hauteurNet + 28;

  // --- Charges patronales : informatif ---
  doc.fillColor(COULEURS.mutedClair).font('Helvetica').fontSize(7.5)
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
    doc.roundedRect(x, y, largeurCase, 42, 4).lineWidth(0.6).strokeColor(FILET).stroke();
    doc.fillColor(COULEURS.mutedClair).font('Helvetica').fontSize(7).text(label.toUpperCase(), x + 10, y + 9, { width: largeurCase - 16, characterSpacing: 0.4, lineBreak: false });
    doc.fillColor(COULEURS.encre).font(label === 'Coût total employeur' ? 'Helvetica-Bold' : 'Helvetica').fontSize(10)
      .text(`${formatMontant(montant)} FCFA`, x + 10, y + 23, { width: largeurCase - 16, lineBreak: false });
  });

  dessinerPiedDePage(doc, merchant);
}

function libelleRole(role) {
  const LABELS = { gerant: 'Gérant', vendeur: 'Vendeur', caissier: 'Caissier', vendeur_caissier: 'Vendeur / Caissier', manager: 'Manager' };
  return LABELS[role] || role;
}


// Bulletin complet en mémoire (pièce jointe d'e-mail).
function bulletinEnBuffer(bulletin) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
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
