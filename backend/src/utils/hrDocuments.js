// hrDocuments.js — modèles de documents RH (attestation, certificat, contrats), champs repris de
// la fiche employé, et mise en page PDF.
//
// ⚠️ Les modèles par défaut sont des points de départ, PAS des textes juridiquement validés :
// chaque commerçant peut les modifier, et chaque document porte la mention « à faire valider ».

const { dessinerEntete, dessinerPiedDePage, COULEURS } = require('./pdfHelpers');

const A_COMPLETER = '[à compléter]';

const TYPES_DOCUMENT = ['attestation_travail', 'certificat_travail', 'contrat_cdi', 'contrat_cdd'];

const CHAMPS = [
  { code: 'nom', label: "Nom de l'employé" },
  { code: 'poste', label: 'Poste' },
  { code: 'adresse_employe', label: "Adresse de l'employé" },
  { code: 'telephone_employe', label: "Téléphone de l'employé" },
  { code: 'date_embauche', label: "Date d'embauche" },
  { code: 'date_fin', label: 'Date de fin' },
  { code: 'type_contrat', label: 'Type de contrat' },
  { code: 'salaire_mensuel', label: 'Salaire mensuel de base (FCFA)' },
  { code: 'numero_ipres', label: 'N° IPRES' },
  { code: 'numero_css', label: 'N° CSS' },
  { code: 'entreprise', label: "Nom de l'entreprise" },
  { code: 'adresse_entreprise', label: "Adresse de l'entreprise" },
  { code: 'ninea', label: 'NINEA' },
  { code: 'rccm', label: 'RCCM' },
  { code: 'date_jour', label: "Date d'émission" },
  { code: 'lieu', label: 'Lieu de signature (à saisir)' },
  { code: 'duree_essai', label: "Période d'essai (à saisir)" },
  { code: 'duree_hebdomadaire', label: 'Durée hebdomadaire de travail (à saisir)' },
  { code: 'motif_cdd', label: 'Motif du CDD (à saisir)' },
];

const MODELES_PAR_DEFAUT = {
  attestation_travail: {
    title: 'Attestation de travail',
    body: `Je soussigné(e), représentant(e) de {{entreprise}}, dont le siège est situé à {{adresse_entreprise}} (NINEA : {{ninea}}), atteste que {{nom}} est employé(e) au sein de notre entreprise en qualité de {{poste}}, depuis le {{date_embauche}}, sous contrat de type {{type_contrat}}.

La présente attestation est délivrée à l'intéressé(e), à sa demande, pour servir et valoir ce que de droit.

Fait à {{lieu}}, le {{date_jour}}.`,
  },
  certificat_travail: {
    title: 'Certificat de travail',
    body: `Je soussigné(e), représentant(e) de {{entreprise}}, dont le siège est situé à {{adresse_entreprise}} (NINEA : {{ninea}}), certifie que {{nom}} a été employé(e) au sein de notre entreprise du {{date_embauche}} au {{date_fin}}, en qualité de {{poste}}.

L'intéressé(e) nous quitte libre de tout engagement.

Le présent certificat est délivré pour servir et valoir ce que de droit.

Fait à {{lieu}}, le {{date_jour}}.`,
  },
  contrat_cdi: {
    title: 'Contrat de travail à durée indéterminée',
    body: `Entre les soussignés :

{{entreprise}}, dont le siège est situé à {{adresse_entreprise}} (NINEA : {{ninea}}, RCCM : {{rccm}}), ci-après « l'employeur »,

et {{nom}}, demeurant à {{adresse_employe}}, ci-après « le salarié ».

Il a été convenu ce qui suit :

Article 1 — Engagement. Le salarié est engagé à compter du {{date_embauche}}, en qualité de {{poste}}, pour une durée indéterminée.

Article 2 — Période d'essai. Le contrat est assorti d'une période d'essai de {{duree_essai}}.

Article 3 — Durée du travail. La durée hebdomadaire de travail est de {{duree_hebdomadaire}}.

Article 4 — Rémunération. Le salarié perçoit un salaire mensuel de base de {{salaire_mensuel}} FCFA, payable mensuellement, sous réserve des retenues légales.

Article 5 — Obligations. Le salarié s'engage à exécuter ses fonctions avec loyauté et à respecter le règlement intérieur et les instructions de l'employeur.

Article 6 — Rupture. Chacune des parties peut mettre fin au contrat dans les conditions prévues par la législation du travail applicable.

Fait en deux exemplaires, à {{lieu}}, le {{date_jour}}.`,
  },
  contrat_cdd: {
    title: 'Contrat de travail à durée déterminée',
    body: `Entre les soussignés :

{{entreprise}}, dont le siège est situé à {{adresse_entreprise}} (NINEA : {{ninea}}, RCCM : {{rccm}}), ci-après « l'employeur »,

et {{nom}}, demeurant à {{adresse_employe}}, ci-après « le salarié ».

Il a été convenu ce qui suit :

Article 1 — Engagement. Le salarié est engagé en qualité de {{poste}}, pour une durée déterminée, du {{date_embauche}} au {{date_fin}}.

Article 2 — Motif. Le présent contrat est conclu pour le motif suivant : {{motif_cdd}}.

Article 3 — Période d'essai. Le contrat est assorti d'une période d'essai de {{duree_essai}}.

Article 4 — Durée du travail. La durée hebdomadaire de travail est de {{duree_hebdomadaire}}.

Article 5 — Rémunération. Le salarié perçoit un salaire mensuel de base de {{salaire_mensuel}} FCFA, payable mensuellement, sous réserve des retenues légales.

Article 6 — Terme. Le contrat prend fin à son terme, sauf renouvellement dans les conditions prévues par la législation du travail applicable.

Fait en deux exemplaires, à {{lieu}}, le {{date_jour}}.`,
  },
};

const LABEL_CONTRAT = { cdi: 'CDI', cdd: 'CDD', stage: 'stage', apprentissage: 'apprentissage', journalier: 'journalier', autre: 'autre' };

function formatDateFr(date) {
  if (!date) return null;
  const iso = typeof date === 'string' ? date.slice(0, 10) : new Date(date).toISOString().slice(0, 10);
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

// Valeurs des champs : fiche employé + entreprise + saisies ponctuelles (lieu, essai, motif…).
// Toute valeur absente devient « [à compléter] » pour être repérée avant signature.
function construireChamps({ employe, entreprise, salaire, extra = {} }) {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const valeur = (v) => (v === null || v === undefined || String(v).trim() === '' ? A_COMPLETER : String(v).trim());
  return {
    nom: valeur(employe.full_name),
    poste: valeur(employe.job_title),
    adresse_employe: valeur(employe.address),
    telephone_employe: valeur(employe.phone),
    date_embauche: valeur(formatDateFr(employe.hire_date)),
    date_fin: valeur(formatDateFr(employe.end_date)),
    type_contrat: valeur(LABEL_CONTRAT[employe.contract_type] || employe.contract_type),
    salaire_mensuel: salaire ? Math.round(Number(salaire)).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ') : A_COMPLETER,
    numero_ipres: valeur(employe.ipres_number),
    numero_css: valeur(employe.css_number),
    entreprise: valeur(entreprise.business_name),
    adresse_entreprise: valeur(entreprise.address),
    ninea: valeur(entreprise.ninea),
    rccm: valeur(entreprise.rccm),
    date_jour: valeur(formatDateFr(extra.dateJour || aujourdhui)),
    lieu: valeur(extra.lieu),
    duree_essai: valeur(extra.dureeEssai),
    duree_hebdomadaire: valeur(extra.dureeHebdomadaire),
    motif_cdd: valeur(extra.motifCdd),
  };
}

function remplirModele(corps, champs) {
  return String(corps).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, code) => (code in champs ? champs[code] : A_COMPLETER));
}

// Dessine le document sur un PDFDocument.
function genererPdfDocument(doc, { titre, texte, entreprise }) {
  const merchant = {
    ninea: entreprise.ninea, rccm: entreprise.rccm, address: entreprise.address,
    bank_details: entreprise.bank_details, mobile_money_details: entreprise.mobile_money_details, payment_terms: entreprise.payment_terms,
  };
  let y = dessinerEntete(doc, { businessName: entreprise.business_name, titre, sousTitre: '', merchant });
  const xGauche = 50;
  const largeur = doc.page.width - 100;
  const bas = doc.page.height - 120;

  doc.font('Helvetica').fontSize(10.5).fillColor(COULEURS.encre || '#111');
  texte.split(/\n{2,}/).forEach((paragraphe) => {
    const hauteur = doc.heightOfString(paragraphe, { width: largeur, align: 'justify' });
    if (y + hauteur > bas) {
      doc.addPage();
      y = 60;
    }
    doc.font('Helvetica').fontSize(10.5).fillColor(COULEURS.encre || '#111').text(paragraphe, xGauche, y, { width: largeur, align: 'justify' });
    y += hauteur + 12;
  });

  if (y + 90 > bas) {
    doc.addPage();
    y = 60;
  }
  y += 16;
  doc.font('Helvetica').fontSize(9).fillColor(COULEURS.mutedClair || '#777');
  doc.text("Signature de l'employeur", xGauche, y, { width: largeur / 2 - 10, lineBreak: false });
  doc.text('Signature du salarié', xGauche + largeur / 2 + 10, y, { width: largeur / 2 - 10, lineBreak: false });

  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(COULEURS.mutedClair || '#777')
    .text("Modèle de document à faire valider par un professionnel du droit du travail avant tout usage officiel.", xGauche, doc.page.height - 78, { width: largeur, lineBreak: false });
  dessinerPiedDePage(doc, merchant);
}

module.exports = { TYPES_DOCUMENT, CHAMPS, MODELES_PAR_DEFAUT, construireChamps, remplirModele, genererPdfDocument, A_COMPLETER };
