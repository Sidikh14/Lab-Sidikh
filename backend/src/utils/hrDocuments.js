// Documents RH d'Amaterasu : attestation de travail, certificat de travail, attestation de salaire,
// contrat CDI et contrat CDD. Texte des articles fixe (modèles validés), seuls les champs variables
// changent. Rien n'est conservé : le PDF est produit à la demande.
//
// Emplacement : backend/src/utils/hrDocuments.js
const {
  COULEURS, FORMATS, TAILLES, MENTION_EDITEUR, mmEnPt, formaterMontant, formaterDate, nomFichierPdf, metadonneesPdf,
} = require('./pdfTheme');

const TYPES = {
  attestation_travail: { label: 'Attestation de travail', titre: 'ATTESTATION DE TRAVAIL', court: 'Attestation-travail' },
  certificat_travail: { label: 'Certificat de travail', titre: 'CERTIFICAT DE TRAVAIL', court: 'Certificat-travail' },
  attestation_salaire: { label: 'Attestation de salaire', titre: 'ATTESTATION DE SALAIRE', court: 'Attestation-salaire' },
  contrat_cdi: { label: 'Contrat CDI', titre: 'CONTRAT DE TRAVAIL À DURÉE INDÉTERMINÉE', court: 'Contrat-CDI' },
  contrat_cdd: { label: 'Contrat CDD', titre: 'CONTRAT DE TRAVAIL À DURÉE DÉTERMINÉE', court: 'Contrat-CDD' },
};

const POINTS = '.'.repeat(18);
const DUREE_MAX_CDD = 24;
const CIVILITES = [{ value: 'M', label: 'Monsieur' }, { value: 'Mme', label: 'Madame' }];
const REGIMES = [{ value: 'cdi', label: 'CDI (durée indéterminée)' }, { value: 'cdd', label: 'CDD (durée déterminée)' }];

// Colonnes de la fiche employé qui peuvent être mises à jour depuis l'aperçu (case « enregistrer »).
const IDENTITE_COLONNES = {
  civilite: 'civility',
  date_naissance: 'birth_date',
  lieu_naissance: 'birth_place',
  nationalite: 'nationality',
  piece_identite: 'id_document',
  adresse: 'address',
};

function erreurDocument(message) {
  return Object.assign(new Error(message), { statut: 400 });
}

// ---------------------------------------------------------------------------
// Dates et durées
// ---------------------------------------------------------------------------
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateValide(s) {
  if (!ISO_RE.test(String(s || ''))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Date SQL (Date ou chaîne) -> 'AAAA-MM-JJ'
function versIso(valeur) {
  if (!valeur) return '';
  if (valeur instanceof Date) {
    if (Number.isNaN(valeur.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${valeur.getFullYear()}-${p(valeur.getMonth() + 1)}-${p(valeur.getDate())}`;
  }
  const s = String(valeur).slice(0, 10);
  return dateValide(s) ? s : '';
}

function aujourdhui() {
  return versIso(new Date());
}

// Durée en mois d'un CDD, arrondie au mois supérieur (le dernier jour est inclus).
function dureeMois(debut, fin) {
  if (!dateValide(debut) || !dateValide(fin) || fin < debut) return null;
  const [y1, m1, d1] = debut.split('-').map(Number);
  const [yf, mf, df] = fin.split('-').map(Number);
  const finExclue = new Date(Date.UTC(yf, mf - 1, df + 1));
  const y2 = finExclue.getUTCFullYear();
  const m2 = finExclue.getUTCMonth() + 1;
  const d2 = finExclue.getUTCDate();
  let mois = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) mois -= 1;
  const ancre = new Date(Date.UTC(y1, m1 - 1 + mois, d1));
  return Math.max(1, mois + (finExclue.getTime() > ancre.getTime() ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Définition des champs (source unique : l'interface construit le formulaire à partir d'elle)
// ---------------------------------------------------------------------------
const G_EMPLOYE = 'Employé';
const G_POSTE = 'Poste';
const G_CONTRAT = 'Contrat';
const G_REMU = 'Rémunération';
const G_SIGN = 'Signature';

function champ(code, label, type, groupe, valeur, extra = {}) {
  return { code, label, type, groupe, value: valeur ?? '', ...extra };
}

function definitions(type, ctx = {}) {
  if (!TYPES[type]) throw erreurDocument('Type de document inconnu.');
  const e = ctx.employe || {};
  const r = ctx.reglages || {};
  const b = ctx.boutique || {};
  const regimeEmploye = ['cdi', 'cdd'].includes(e.contract_type) ? e.contract_type : '';

  const F = {
    civilite: champ('civilite', 'Civilité', 'select', G_EMPLOYE, ['M', 'Mme'].includes(e.civility) ? e.civility : '', { options: CIVILITES }),
    nom: champ('nom', 'Nom et prénom', 'text', G_EMPLOYE, e.full_name, { requis: true }),
    date_naissance: champ('date_naissance', 'Date de naissance', 'date', G_EMPLOYE, versIso(e.birth_date)),
    lieu_naissance: champ('lieu_naissance', 'Lieu de naissance', 'text', G_EMPLOYE, e.birth_place),
    nationalite: champ('nationalite', 'Nationalité', 'text', G_EMPLOYE, e.nationality),
    piece_identite: champ('piece_identite', 'N° CNI ou passeport', 'text', G_EMPLOYE, e.id_document),
    adresse: champ('adresse', 'Adresse du domicile', 'text', G_EMPLOYE, e.address),
    poste: champ('poste', 'Poste occupé', 'text', G_POSTE, e.job_title),
    date_embauche: champ('date_embauche', "Date d'embauche", 'date', G_POSTE, versIso(e.hire_date)),
    type_contrat: champ('type_contrat', 'Type de contrat', 'select', G_POSTE, regimeEmploye, { options: REGIMES, aide: 'Laisser vide pour ne pas le mentionner.' }),
    fonctions: champ('fonctions', 'Description des fonctions (facultatif)', 'textarea', G_POSTE, ''),
    categorie: champ('categorie', 'Catégorie', 'text', G_CONTRAT, '', { aide: 'Ex. 8e catégorie, cadre' }),
    convention: champ('convention', 'Convention collective applicable', 'text', G_CONTRAT, '', { aide: 'Ex. Commerce, BTP, Banque' }),
    missions: champ('missions', 'Missions principales', 'textarea', G_CONTRAT, '', { aide: 'Une mission par ligne.' }),
    date_prise_fonction: champ('date_prise_fonction', 'Date de prise de fonction', 'date', G_CONTRAT, versIso(e.hire_date)),
    date_debut: champ('date_debut', 'Début du contrat', 'date', G_CONTRAT, versIso(e.hire_date)),
    date_fin: champ(
      'date_fin',
      type === 'certificat_travail' ? "Date de fin d'emploi" : 'Fin du contrat',
      'date',
      type === 'certificat_travail' ? G_POSTE : G_CONTRAT,
      versIso(e.end_date),
    ),
    motif: champ('motif', 'Motif du CDD', 'textarea', G_CONTRAT, '', { aide: 'Surcroît d’activité, remplacement temporaire, projet spécifique…', requis: true }),
    essai: champ('essai', "Période d'essai", 'text', G_CONTRAT, '', { aide: 'Ex. 3 mois' }),
    lieu_travail: champ('lieu_travail', 'Lieu de travail', 'text', G_CONTRAT, b.address),
    salaire_base: champ('salaire_base', 'Salaire de base mensuel brut (FCFA)', 'amount', G_REMU, e.monthly_salary != null ? String(Math.round(Number(e.monthly_salary))) : ''),
    sursalaire: champ('sursalaire', 'Sursalaire (FCFA)', 'amount', G_REMU, ''),
    transport: champ('transport', 'Indemnité de transport (FCFA)', 'amount', G_REMU, ''),
    autres: champ('autres', 'Autres primes et avantages', 'text', G_REMU, ''),
    primes: champ('primes', 'Primes et indemnités mensuelles (FCFA)', 'amount', G_REMU, '', { aide: 'Facultatif : ajoutées au salaire de base dans l’attestation.' }),
    lieu: champ('lieu', 'Lieu de signature', 'text', G_SIGN, r.signature_city),
    date_document: champ('date_document', 'Date du document', 'date', G_SIGN, aujourdhui()),
    signataire_nom: champ('signataire_nom', 'Nom du signataire', 'text', G_SIGN, r.signatory_name),
    signataire_fonction: champ('signataire_fonction', 'Fonction du signataire', 'text', G_SIGN, r.signatory_title),
  };

  const SIGNATURE = ['lieu', 'date_document', 'signataire_nom', 'signataire_fonction'];
  const IDENTITE = ['civilite', 'nom', 'date_naissance', 'lieu_naissance', 'nationalite', 'piece_identite', 'adresse'];
  const REMU_CONTRAT = ['salaire_base', 'sursalaire', 'transport', 'autres'];
  const PAR_TYPE = {
    attestation_travail: ['civilite', 'nom', 'poste', 'date_embauche', 'type_contrat', 'fonctions', ...SIGNATURE],
    certificat_travail: ['civilite', 'nom', 'date_naissance', 'lieu_naissance', 'adresse', 'poste', 'date_embauche', 'date_fin', ...SIGNATURE],
    attestation_salaire: ['civilite', 'nom', 'poste', 'date_embauche', 'type_contrat', 'salaire_base', 'primes', ...SIGNATURE],
    contrat_cdi: [...IDENTITE, 'poste', 'categorie', 'convention', 'missions', 'date_prise_fonction', 'essai', 'lieu_travail', ...REMU_CONTRAT, ...SIGNATURE],
    contrat_cdd: [...IDENTITE, 'motif', 'poste', 'categorie', 'convention', 'missions', 'date_debut', 'date_fin', 'essai', 'lieu_travail', ...REMU_CONTRAT, ...SIGNATURE],
  };
  return PAR_TYPE[type].map((code) => F[code]);
}

function preparerDocument(type, ctx) {
  return { type, label: TYPES[type]?.label, fields: definitions(type, ctx) };
}

// ---------------------------------------------------------------------------
// Nettoyage et validation des valeurs envoyées par l'aperçu
// ---------------------------------------------------------------------------
function nettoyerValeur(def, brut) {
  const texte = brut === null || brut === undefined ? '' : String(brut);
  switch (def.type) {
    case 'textarea':
      return texte.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n').slice(0, 1500);
    case 'date': {
      const s = texte.trim();
      if (!s) return '';
      if (!dateValide(s)) throw erreurDocument(`Date invalide pour « ${def.label} ».`);
      return s;
    }
    case 'amount': {
      const s = texte.replace(/[\s\u00A0]/g, '').replace(',', '.');
      if (!s) return '';
      if (!/^\d{1,12}(\.\d+)?$/.test(s)) throw erreurDocument(`Montant invalide pour « ${def.label} ».`);
      return String(Math.round(Number(s)));
    }
    case 'select': {
      const s = texte.trim();
      if (s && !def.options.some((o) => o.value === s)) throw erreurDocument(`Choix invalide pour « ${def.label} ».`);
      return s;
    }
    default:
      return texte.replace(/\s+/g, ' ').trim().slice(0, 200);
  }
}

// Valeurs finales : proposées par le dossier, remplacées par ce que l'aperçu envoie.
function valeursDocument(type, brut, ctx) {
  const defs = definitions(type, ctx);
  const envoye = brut && typeof brut === 'object' ? brut : {};
  const v = {};
  defs.forEach((d) => {
    v[d.code] = nettoyerValeur(d, Object.prototype.hasOwnProperty.call(envoye, d.code) ? envoye[d.code] : d.value);
  });
  if (!v.nom) throw erreurDocument("Le nom de l'employé est obligatoire.");
  if (type === 'contrat_cdd') {
    if (!v.motif) throw erreurDocument('Le motif du CDD est obligatoire.');
    if (v.date_debut && v.date_fin) {
      const mois = dureeMois(v.date_debut, v.date_fin);
      if (mois === null) throw erreurDocument('La fin du contrat ne peut pas être avant son début.');
      if (mois > DUREE_MAX_CDD) throw erreurDocument(`Un CDD ne peut pas dépasser ${DUREE_MAX_CDD} mois (durée saisie : ${mois} mois).`);
    }
  }
  if (type === 'certificat_travail' && v.date_embauche && v.date_fin && v.date_fin < v.date_embauche) {
    throw erreurDocument("La date de fin d'emploi ne peut pas être avant la date d'embauche.");
  }
  return v;
}

// Colonnes de la fiche employé à mettre à jour (uniquement celles présentes dans ce document).
function identiteAEnregistrer(v) {
  const maj = {};
  Object.entries(IDENTITE_COLONNES).forEach(([code, colonne]) => {
    if (Object.prototype.hasOwnProperty.call(v, code)) maj[colonne] = v[code] || null;
  });
  return maj;
}

function nomFichierDocument(type, nom) {
  return nomFichierPdf(TYPES[type].court, nom);
}

// ---------------------------------------------------------------------------
// Texte des documents (modèles fixes). {{code}} = valeur en gras, [[code]] = texte simple.
// ---------------------------------------------------------------------------
const PARTIES = () => [
  { gras: "ENTRE LES SOUSSIGNÉS :" },
  { gras: "1. L'EMPLOYEUR :" },
  { lignes: [
    'Raison sociale : {{entreprise}}',
    'Siège social : {{adresse_entreprise}}',
    'NINEA / RCCM : {{ninea}} / {{rccm}}',
    'Représenté par : {{signataire_nom}}, en qualité de {{signataire_fonction}}',
  ] },
  { p: "D'une part," },
  { gras: '2. LE TRAVAILLEUR :' },
  { lignes: [
    'Nom et prénom : {{civ_nom}}',
    'Date et lieu de naissance : {{date_naissance}} à {{lieu_naissance}}',
    'Nationalité : {{nationalite}}',
    'N° CNI / Passeport : {{piece_identite}}',
    'Adresse domicile : {{adresse}}',
  ] },
  { p: "D'autre part." },
  { p: 'Il a été convenu et arrêté ce qui suit :' },
];

const CONTRAT_CDI = [
  { h: 'ARTICLE 1 : ENGAGEMENT ET PRISE DE FONCTION' },
  { p: `L'Employeur engage le Travailleur sous le régime du Contrat de Travail à Durée Indéterminée (CDI), conformément aux dispositions de la Loi n° 97-17 portant Code du Travail de la République du Sénégal. Le présent contrat prend effet à compter du {{date_prise_fonction}}.` },
  { h: 'ARTICLE 2 : FONCTIONS ET QUALIFICATION' },
  { p: `Le Travailleur est engagé en qualité de {{poste}}, correspondant à la catégorie {{categorie}} de la Convention Collective Nationale Interprofessionnelle (CCNI) ou de la convention sectorielle applicable ({{convention}}).` },
  { p: 'Les principales missions et responsabilités du Travailleur comprennent notamment :' },
  { missions: true },
  { h: "ARTICLE 3 : PÉRIODE D'ESSAI" },
  { p: `Le présent contrat ne devient définitif qu'à l'issue d'une période d'essai de {{essai}}, renouvelable une fois conformément à la Convention Collective applicable. Durant cette période, chacune des parties pourra rompre le contrat sans indemnité ni préavis selon la réglementation en vigueur.` },
  { h: 'ARTICLE 4 : LIEU DE TRAVAIL ET MOBILITÉ' },
  { p: `Le lieu de travail est fixé à {{lieu_travail}}. Selon les nécessités de service, le Travailleur pourra être amené à effectuer des déplacements professionnels ou à être affecté dans toute autre implantation de l'entreprise au Sénégal.` },
  { h: 'ARTICLE 5 : RÉMUNÉRATION ET AVANTAGES' },
  { p: "En contrepartie de l'exécution de ses fonctions, le Travailleur percevra une rémunération mensuelle brute sous la forme suivante :" },
  { lignes: ['Salaire de base : {{salaire_base}}', 'Sursalaire : {{sursalaire}}', 'Indemnité de transport : {{transport}}', 'Autres primes / avantages : {{autres}}'] },
  { p: 'La rémunération est versée mensuellement. Les cotisations sociales (IPRES, Caisse de Sécurité Sociale) et retenues fiscales (Impôt sur le Revenu) sont prélevées à la source selon les barèmes légaux en vigueur.' },
  { h: 'ARTICLE 6 : DURÉE DU TRAVAIL ET HORAIRES' },
  { p: "La durée du travail est fixée conformément à la législation sénégalaise à 40 heures hebdomadaires (173,33 heures mensuelles). Les horaires de travail sont établis selon l'organisation générale et le règlement intérieur de l'entreprise." },
  { h: 'ARTICLE 7 : CONGÉS PAYÉS ET COUVERTURE SOCIALE' },
  { p: "Le Travailleur acquiert droit aux congés payés au taux de 2,4 jours ouvrables par mois de travail effectif. L'Employeur assure l'affiliation du Travailleur aux organismes de prévoyance et de santé obligatoires (IPRES, Caisse de Sécurité Sociale, IPM)." },
  { h: 'ARTICLE 8 : OBLIGATIONS PROFESSIONNELLES ET CONFIDENTIALITÉ' },
  { p: "Le Travailleur s'engage à consacrer l'intégralité de son activité professionnelle au service de l'entreprise et à observer une stricte confidentialité concernant les secrets professionnels, savoir-faire et informations stratégiques de l'entreprise." },
  { h: 'ARTICLE 9 : RUPTURE DU CONTRAT ET PRÉAVIS' },
  { p: "Chacune des parties peut mettre fin au présent contrat à durée indéterminée sous réserve du respect d'un préavis écrit (ou indemnité compensatrice), conformément à l'article L.49 du Code du Travail et à la CCNI, en tenant compte du statut et de l'ancienneté du Travailleur." },
  { h: 'ARTICLE 10 : ÉLECTION DE DOMICILE ET DÉPÔT' },
  { p: "Le présent contrat sera déposé auprès de l'Inspection du Travail et de la Sécurité Sociale du ressort. Pour toute contestation, élection de domicile est faite aux adresses respectives des parties mentionnées en tête du document." },
  { p: "Fait à {{lieu}}, le {{date_document}}, en 3 exemplaires originaux (un pour l'Employeur, un pour le Travailleur, et un pour l'Inspection du Travail)." },
  { signatures: 'double' },
];

const CONTRAT_CDD = [
  { h: 'ARTICLE 1 : ENGAGEMENT ET MOTIF DU CONTRAT' },
  { p: "L'Employeur engage le Travailleur sous le régime du Contrat de Travail à Durée Déterminée (CDD), conformément aux dispositions du Code du Travail de la République du Sénégal. Le présent contrat est conclu pour le motif suivant : {{motif}}." },
  { h: 'ARTICLE 2 : FONCTIONS ET QUALIFICATION' },
  { p: `Le Travailleur est engagé en qualité de {{poste}}, à la catégorie {{categorie}} de la Convention Collective Nationale Interprofessionnelle (CCNI) ou de la convention sectorielle applicable ({{convention}}).` },
  { p: 'Les principales missions du Travailleur consisteront notamment à :' },
  { missions: true },
  { h: 'ARTICLE 3 : LIEU DE TRAVAIL' },
  { p: "Le lieu de travail est fixé à {{lieu_travail}}. L'Employeur se réserve le droit d'affecter le Travailleur dans tout autre établissement de l'entreprise situé sur le territoire sénégalais en fonction des nécessités du service." },
  { h: "ARTICLE 4 : DURÉE DU CONTRAT ET PÉRIODE D'ESSAI" },
  { p: 'Le présent contrat prend effet à compter du {{date_debut}} pour s\'achever le {{date_fin}}, pour une durée totale de {{duree_mois}} mois.' },
  { p: "Une période d'essai de {{essai}} est prévue. Durant cette période, chacune des parties pourra rompre librement le contrat sans préavis ni indemnité, conformément à la réglementation en vigueur." },
  { h: 'ARTICLE 5 : RÉMUNÉRATION ET AVANTAGES' },
  { p: 'En contrepartie de ses services, le Travailleur percevra une rémunération mensuelle brute composée comme suit :' },
  { lignes: ['Salaire de base : {{salaire_base}}', 'Sursalaire : {{sursalaire}}', 'Prime de transport : {{transport}}', 'Autres indemnités / primes : {{autres}}'] },
  { p: 'Cette rémunération sera payée à la fin de chaque mois, sous déduction des cotisations sociales (IPRES, Caisse de Sécurité Sociale) et fiscales (Impôt sur le Revenu) obligatoires retenues à la source.' },
  { h: 'ARTICLE 6 : HORAIRES ET DURÉE DU TRAVAIL' },
  { p: "Le Travailleur est soumis à la durée légale du travail fixée à 40 heures par semaine (ou 173,33 heures par mois). Les horaires de travail sont définis par le règlement intérieur de l'entreprise." },
  { h: 'ARTICLE 7 : CONGÉS PAYÉS ET PROTECTION SOCIALE' },
  { p: "Le Travailleur bénéficie des congés payés calculés au taux de 2,4 jours ouvrables par mois de service effectif, conformément au Code du Travail. L'Employeur affiliera le Travailleur dès son embauche aux organismes sociaux obligatoires au Sénégal (IPRES, CSS, IPM)." },
  { h: 'ARTICLE 8 : OBLIGATION DE RÉSERVE ET DE CONFIDENTIALITÉ' },
  { p: "Le Travailleur s'engage à observer une entière confidentialité sur l'ensemble des informations, procédés, documents ou secrets d'affaires dont il pourrait avoir connaissance dans l'exercice de ses fonctions." },
  { h: 'ARTICLE 9 : RUPTURE DU CONTRAT' },
  { p: "Conformément à l'article L.42 du Code du Travail du Sénégal, le contrat à durée déterminée ne peut prendre fin avant l'échéance du terme qu'en cas de faute lourde, d'accord commun écrit des parties, ou de force majeure." },
  { h: 'ARTICLE 10 : ENREGISTREMENT ET ÉLECTION DE DOMICILE' },
  { p: "Le présent contrat sera soumis à la formalité du dépôt auprès de l'Inspection du Travail et de la Sécurité Sociale du ressort. Pour l'exécution des présentes, les parties font élection de domicile à leurs adresses respectives indiquées ci-dessus." },
  { p: 'Fait à {{lieu}}, le {{date_document}}, en 3 exemplaires originaux (dont un pour chaque partie et un pour l\'Inspection du Travail).' },
  { signatures: 'double' },
];

function blocsDocument(type, v) {
  switch (type) {
    case 'attestation_travail':
      return [
        { p: 'Je soussigné, {{signataire_nom}}, {{signataire_fonction}} de {{entreprise}}, certifie que {{civ_nom}} est employé[[acc]] au sein de notre entreprise en qualité de {{poste}} depuis le {{date_embauche}}[[regime]].' },
        ...(v.fonctions ? [{ p: '[[fonctions]]' }] : []),
        { p: "Cette attestation est délivrée à la demande de l'intéressé[[acc]] pour servir et valoir ce que de droit." },
        { p: 'Fait à {{lieu}}, le {{date_document}}.' },
        { signatures: 'simple' },
      ];
    case 'certificat_travail':
      return [
        { p: '{{lieu}}, le {{date_document}}', align: 'right' },
        { p: 'Je soussigné, {{signataire_nom}}, {{signataire_fonction}} de la société {{entreprise}}, sise à {{adresse_entreprise}}, Tél. : {{telephone}}' },
        { gras: 'Certifie que :' },
        { lignes: [
          '{{civ_nom}} ;',
          '[[Ne]] le {{date_naissance}} à {{lieu_naissance}} ;',
          'Demeurant à : {{adresse}} ;',
          'A été employé[[acc]] au sein de la société {{entreprise}} du {{date_embauche}} au {{date_fin}} ;',
          'En qualité de : {{poste}}.',
        ] },
        { p: 'En foi de quoi le présent certificat lui est délivré pour servir et valoir ce que de droit.' },
        { signatures: 'simple' },
      ];
    case 'attestation_salaire':
      return [
        { p: 'Je soussigné, {{signataire_nom}}, {{signataire_fonction}} de {{entreprise}}, certifie que {{civ_nom}} est employé[[acc]] au sein de notre entreprise en qualité de {{poste}} depuis le {{date_embauche}}[[regime]].' },
        { p: "À ce jour, l'intéressé[[acc]] perçoit un salaire de base mensuel brut de {{salaire_base}}." },
        ...(v.primes ? [{ p: "L'intéressé[[acc]] perçoit en outre des primes et indemnités mensuelles de {{primes}}, soit une rémunération mensuelle brute totale de {{total}}." }] : []),
        { p: "La présente attestation est délivrée à l'intéressé[[acc]], à sa demande, pour servir et valoir ce que de droit." },
        { p: 'Fait à {{lieu}}, le {{date_document}}.' },
        { signatures: 'simple' },
      ];
    case 'contrat_cdi':
      return [...PARTIES(), ...CONTRAT_CDI];
    default:
      return [...PARTIES(), ...CONTRAT_CDD];
  }
}

// Valeurs affichables (gras) et textes dérivés (accords, régime, total).
function contexteTexte(type, v, boutique) {
  const b = boutique || {};
  const defs = {};
  definitions(type).forEach((d) => { defs[d.code] = d; });
  const civ = v.civilite === 'Mme' ? 'Madame' : v.civilite === 'M' ? 'Monsieur' : 'Madame/Monsieur';
  const acc = v.civilite === 'Mme' ? 'e' : v.civilite === 'M' ? '' : '(e)';
  const ne = v.civilite === 'Mme' ? 'née' : v.civilite === 'M' ? 'né' : 'né(e)';
  const regime = v.type_contrat === 'cdi' ? ', sous contrat à durée indéterminée (CDI)'
    : v.type_contrat === 'cdd' ? ', sous contrat à durée déterminée (CDD)' : '';
  const base = Number(v.salaire_base) || 0;
  const primes = Number(v.primes) || 0;
  const mois = dureeMois(v.date_debut, v.date_fin);

  const gras = {
    entreprise: b.business_name || '',
    adresse_entreprise: b.address || '',
    telephone: b.phone || '',
    ninea: b.ninea || '',
    rccm: b.rccm || '',
    civ_nom: `${civ} ${v.nom || ''}`.trim(),
    total: base || primes ? formaterMontant(base + primes) : '',
    duree_mois: mois ? String(mois) : '',
  };
  const simple = { acc, ne, Ne: ne.charAt(0).toUpperCase() + ne.slice(1), regime, fonctions: v.fonctions || '' };

  function affiche(code) {
    if (Object.prototype.hasOwnProperty.call(gras, code)) return gras[code] || POINTS;
    const d = defs[code];
    const val = v[code];
    if (!d || !val) return POINTS;
    if (d.type === 'date') return formaterDate(val);
    if (d.type === 'amount') return formaterMontant(val);
    return val;
  }
  return { affiche, simple };
}

function segments(modele, ctx) {
  const parts = [];
  String(modele).split(/(\{\{\w+\}\}|\[\[\w+\]\])/).forEach((tok) => {
    if (!tok) return;
    let m = /^\{\{(\w+)\}\}$/.exec(tok);
    if (m) { parts.push({ t: ctx.affiche(m[1]), b: true }); return; }
    m = /^\[\[(\w+)\]\]$/.exec(tok);
    if (m) { parts.push({ t: ctx.simple[m[1]] ?? '', b: false }); return; }
    parts.push({ t: tok, b: false });
  });
  return parts.filter((p) => p.t !== '');
}

// ---------------------------------------------------------------------------
// Dessin du PDF (pdfkit, charte v8)
// ---------------------------------------------------------------------------
function logoBuffer(logoData) {
  if (!logoData || typeof logoData !== 'string') return null;
  const m = /^data:image\/(?:png|jpe?g);base64,(.+)$/i.exec(logoData.trim());
  const b64 = m ? m[1] : /^[A-Za-z0-9+/=\s]+$/.test(logoData) ? logoData : null;
  if (!b64) return null;
  try { return Buffer.from(b64, 'base64'); } catch { return null; }
}

function assurerEspace(doc, hauteur) {
  if (doc.y + hauteur > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function entete(doc, b, m, largeur) {
  const hLogo = mmEnPt(16);
  let logoOk = false;
  const logo = logoBuffer(b.logo_data);
  if (logo) {
    try { doc.image(logo, m, m, { fit: [mmEnPt(38), hLogo] }); logoOk = true; } catch { logoOk = false; }
  }
  const xd = m + largeur * 0.4;
  const wd = largeur * 0.6;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COULEURS.marine).text(b.business_name || '', xd, m, { width: wd, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(COULEURS.ardoise);
  [
    b.address,
    [b.phone, b.email].filter(Boolean).join('  |  '),
    [b.ninea && `NINEA : ${b.ninea}`, b.rccm && `RCCM : ${b.rccm}`].filter(Boolean).join('  |  '),
  ].filter(Boolean).forEach((l) => doc.text(l, xd, doc.y, { width: wd, align: 'right' }));
  const bas = Math.max(doc.y, logoOk ? m + hLogo : 0) + 8;
  doc.moveTo(m, bas).lineTo(m + largeur, bas).lineWidth(0.75).strokeColor(COULEURS.trait).stroke();
  doc.x = m;
  doc.y = bas + mmEnPt(9);
}

function titreDocument(doc, texte, sousTitre, m, largeur) {
  doc.font('Helvetica-Bold').fontSize(TAILLES.titreDocument - 4).fillColor(COULEURS.marine).text(texte, m, doc.y, { width: largeur, align: 'center' });
  if (sousTitre) {
    doc.font('Helvetica').fontSize(TAILLES.pied + 0.5).fillColor(COULEURS.ardoise).text(sousTitre, m, doc.y + 3, { width: largeur, align: 'center' });
  }
  const y = doc.y + 6;
  const w = mmEnPt(24);
  doc.rect(m + (largeur - w) / 2, y, w, 2.5).fill(COULEURS.soleil);
  doc.x = m;
  doc.y = y + mmEnPt(8);
}

function ecrire(doc, segs, { m, largeur, align = 'left', indent = 0, gap = 6 }) {
  if (segs.length === 0) return;
  doc.fontSize(TAILLES.texte + 0.5).fillColor(COULEURS.noir);
  doc.x = m + indent;
  const opts = { width: largeur - indent, align, lineGap: 2.5 };
  segs.forEach((s, i) => {
    doc.font(s.b ? 'Helvetica-Bold' : 'Helvetica').text(s.t, { ...opts, continued: i < segs.length - 1 });
  });
  doc.x = m;
  doc.y += gap;
}

function signatures(doc, genre, v, m, largeur) {
  assurerEspace(doc, mmEnPt(48));
  doc.y += 10;
  const y0 = doc.y;
  const nom = v.signataire_nom || POINTS;
  const fonction = v.signataire_fonction || POINTS;
  doc.fontSize(TAILLES.texte + 0.5).fillColor(COULEURS.noir);
  if (genre === 'simple') {
    const x = m + largeur / 2;
    const w = largeur / 2;
    doc.font('Helvetica-Bold').text(nom, x, y0, { width: w, align: 'right' });
    doc.font('Helvetica').text(fonction, x, doc.y + 1, { width: w, align: 'right' });
    doc.fillColor(COULEURS.ardoise).fontSize(TAILLES.pied + 0.5).text('Signature et cachet', x, doc.y + 4, { width: w, align: 'right' });
  } else {
    const w = largeur / 2 - 10;
    doc.font('Helvetica-Bold').text("Pour l'Employeur", m, y0, { width: w });
    doc.font('Helvetica').text(`${nom}, ${fonction}`, m, doc.y + 1, { width: w });
    doc.fillColor(COULEURS.ardoise).fontSize(TAILLES.pied + 0.5).text('Signature et cachet de la société', m, doc.y + 4, { width: w });
    doc.text('« Lu et approuvé »', m, doc.y + 2, { width: w });
    const yg = doc.y;
    doc.fontSize(TAILLES.texte + 0.5).fillColor(COULEURS.noir);
    const xd = m + largeur / 2 + 10;
    doc.font('Helvetica-Bold').text('Le Travailleur', xd, y0, { width: w });
    doc.fillColor(COULEURS.ardoise).font('Helvetica').fontSize(TAILLES.pied + 0.5)
      .text('Signature précédée de la mention manuscrite', xd, doc.y + 1, { width: w });
    doc.text('« Lu et approuvé »', xd, doc.y + 2, { width: w });
    doc.y = Math.max(doc.y, yg);
  }
  doc.x = m;
}

function pied(doc, boutique) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i += 1) {
    doc.switchToPage(start + i);
    const m = FORMATS.marge;
    const largeur = FORMATS.a4.largeur - 2 * m;
    const y = FORMATS.a4.hauteur - FORMATS.piedY - TAILLES.pied;
    const bas = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(TAILLES.pied).fillColor(COULEURS.ardoise);
    const gauche = [boutique.business_name, count > 1 ? `Page ${i + 1} sur ${count}` : ''].filter(Boolean).join('  |  ');
    doc.text(gauche, m, y, { width: largeur / 2, align: 'left', lineBreak: false });
    doc.text(MENTION_EDITEUR, m + largeur / 2, y, { width: largeur / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bas;
  }
}

function dessiner(doc, type, v, boutique) {
  const m = FORMATS.marge;
  const largeur = FORMATS.a4.largeur - 2 * m;
  const ctx = contexteTexte(type, v, boutique);
  const contrat = type.startsWith('contrat');
  const mise = { m, largeur };

  entete(doc, boutique, m, largeur);
  titreDocument(doc, TYPES[type].titre, contrat ? 'Conforme au Code du Travail du Sénégal (Loi n° 97-17)' : '', m, largeur);

  blocsDocument(type, v).forEach((bloc) => {
    if (bloc.h) {
      assurerEspace(doc, 60);
      doc.y += 4;
      ecrire(doc, [{ t: bloc.h, b: true }], { ...mise, gap: 3 });
    } else if (bloc.gras) {
      ecrire(doc, [{ t: bloc.gras, b: true }], { ...mise, gap: 4 });
    } else if (bloc.p) {
      ecrire(doc, segments(bloc.p, ctx), { ...mise, align: bloc.align || (contrat ? 'justify' : 'left'), gap: contrat ? 5 : 9 });
    } else if (bloc.lignes) {
      bloc.lignes.forEach((l) => ecrire(doc, segments(l, ctx), { ...mise, indent: 12, gap: 3 }));
      doc.y += 3;
    } else if (bloc.missions) {
      const lignes = v.missions ? v.missions.split('\n') : [POINTS.repeat(3), POINTS.repeat(3), POINTS.repeat(3)];
      lignes.forEach((l) => ecrire(doc, [{ t: `-  ${l}`, b: false }], { ...mise, indent: 12, gap: 3 }));
      doc.y += 3;
    } else if (bloc.signatures) {
      signatures(doc, bloc.signatures, v, m, largeur);
    }
  });
  pied(doc, boutique);
}

// Crée le PDF et l'écrit dans `sortie` (réponse HTTP, flux de fichier…).
function produirePdf(PDFDocument, sortie, type, v, boutique) {
  const b = boutique || {};
  const doc = new PDFDocument({
    size: 'A4',
    margin: FORMATS.marge,
    bufferPages: true,
    ...metadonneesPdf({ titre: TYPES[type].label, commercant: b.business_name }),
  });
  doc.pipe(sortie);
  dessiner(doc, type, v, b);
  doc.end();
  return doc;
}

module.exports = {
  TYPES,
  IDENTITE_COLONNES,
  definitions,
  preparerDocument,
  valeursDocument,
  identiteAEnregistrer,
  nomFichierDocument,
  dureeMois,
  produirePdf,
};
