// Tests des documents RH. Lancer : node --test backend/src/utils/hrDocuments_test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TYPES, definitions, preparerDocument, valeursDocument, identiteAEnregistrer, nomFichierDocument, dureeMois, produirePdf,
} = require('./hrDocuments');

const CTX = {
  employe: {
    id: 'e1', full_name: 'Adama Hawa Baldé', job_title: 'Agent Santé et Sécurité au Travail',
    hire_date: '2023-03-21', end_date: null, contract_type: 'cdi', monthly_salary: '350000.00',
    civility: 'Mme', birth_date: new Date(1990, 4, 12), birth_place: 'Dakar', nationality: 'Sénégalaise',
    id_document: '1 234 5678 90123', address: 'Parcelles Assainies, Dakar',
  },
  boutique: {
    business_name: 'Syca Sénégal', address: '3 rue Béranger Féraud, Dakar', phone: '+221 33 000 00 00',
    email: 'contact@sycapay.sn', ninea: '0058759612V2', rccm: 'SNDKR 2016 B 7994', logo_data: null,
  },
  reglages: { signatory_name: 'Mouhamadou Diop', signatory_title: 'Président', signature_city: 'Dakar' },
};
const TYPES_LISTE = Object.keys(TYPES);

// Faux document pdfkit : enregistre le texte et simule le saut de page automatique.
class FauxPdf {
  constructor(options) {
    this.options = options;
    this.textes = [];
    this.pages = 1;
    this.x = 57;
    this.y = 57;
    this.page = { width: 595, height: 842, margins: { top: 57, bottom: 57, left: 57, right: 57 } };
    this.imageEchoue = false;
    this.termine = false;
  }
  pipe() { return this; }
  end() { this.termine = true; return this; }
  font() { return this; }
  fontSize() { return this; }
  fillColor() { return this; }
  strokeColor() { return this; }
  lineWidth() { return this; }
  moveTo() { return this; }
  lineTo() { return this; }
  stroke() { return this; }
  rect() { return this; }
  fill() { return this; }
  image() { if (this.imageEchoue) throw new Error('format inconnu'); return this; }
  addPage() { this.pages += 1; this.y = 57; return this; }
  bufferedPageRange() { return { start: 0, count: this.pages }; }
  switchToPage() { return this; }
  text(s) {
    this.textes.push(String(s));
    this.y += 14;
    if (this.y > 842 - this.page.margins.bottom) this.addPage();
    return this;
  }
  get tout() { return this.textes.join('').replace(/\u00A0/g, ' '); }
}

function pdfDe(type, brut = {}, ctx = CTX, { imageEchoue = false } = {}) {
  const v = valeursDocument(type, brut, ctx);
  let faux;
  class Constructeur extends FauxPdf {
    constructor(o) { super(o); faux = this; this.imageEchoue = imageEchoue; }
  }
  produirePdf(Constructeur, {}, type, v, ctx.boutique);
  return { doc: faux, v };
}

test('les 5 types sont définis avec les champs communs de signature', () => {
  assert.deepEqual(TYPES_LISTE.sort(), ['attestation_salaire', 'attestation_travail', 'certificat_travail', 'contrat_cdd', 'contrat_cdi']);
  TYPES_LISTE.forEach((t) => {
    const codes = definitions(t, CTX).map((d) => d.code);
    ['lieu', 'date_document', 'signataire_nom', 'signataire_fonction', 'nom'].forEach((c) => assert.ok(codes.includes(c), `${t} sans ${c}`));
  });
});

test('pré-remplissage depuis le dossier, la paie et la boutique', () => {
  const champs = Object.fromEntries(preparerDocument('contrat_cdi', CTX).fields.map((f) => [f.code, f.value]));
  assert.equal(champs.nom, 'Adama Hawa Baldé');
  assert.equal(champs.civilite, 'Mme');
  assert.equal(champs.date_naissance, '1990-05-12');
  assert.equal(champs.date_prise_fonction, '2023-03-21');
  assert.equal(champs.salaire_base, '350000');
  assert.equal(champs.lieu, 'Dakar');
  assert.equal(champs.signataire_nom, 'Mouhamadou Diop');
  assert.equal(champs.lieu_travail, '3 rue Béranger Féraud, Dakar');
});

test('type inconnu et valeurs hors liste refusés', () => {
  assert.throws(() => preparerDocument('lettre', CTX), /inconnu/);
  assert.throws(() => valeursDocument('attestation_travail', { civilite: 'X' }, CTX), /Choix invalide/);
  assert.throws(() => valeursDocument('contrat_cdi', { salaire_base: 'abc' }, CTX), /Montant invalide/);
  assert.throws(() => valeursDocument('contrat_cdi', { date_prise_fonction: '31/02/2026' }, CTX), /Date invalide/);
  assert.throws(() => valeursDocument('contrat_cdi', { nom: '  ' }, CTX), /obligatoire/);
});

test('les champs inconnus sont ignorés et les montants nettoyés', () => {
  const v = valeursDocument('contrat_cdi', { salaire_base: '350 000,6', __proto__x: 'a', evil: '<b>', transport: '26000' }, CTX);
  assert.equal(v.salaire_base, '350001');
  assert.equal(v.transport, '26000');
  assert.equal(v.evil, undefined);
});

test('durée du CDD : arrondi au mois supérieur et plafond de 24 mois', () => {
  assert.equal(dureeMois('2026-01-01', '2026-12-31'), 12);
  assert.equal(dureeMois('2026-01-15', '2026-07-14'), 6);
  assert.equal(dureeMois('2026-01-01', '2026-03-20'), 3);
  assert.equal(dureeMois('2026-01-31', '2026-02-28'), 1);
  assert.equal(dureeMois('2026-05-01', '2026-04-01'), null);
  const base = { motif: 'Surcroît d’activité', date_debut: '2026-01-01' };
  assert.doesNotThrow(() => valeursDocument('contrat_cdd', { ...base, date_fin: '2027-12-31' }, CTX));
  assert.throws(() => valeursDocument('contrat_cdd', { ...base, date_fin: '2028-01-02' }, CTX), /24 mois/);
  assert.throws(() => valeursDocument('contrat_cdd', { ...base, date_fin: '2025-12-31' }, CTX), /avant son début/);
  assert.throws(() => valeursDocument('contrat_cdd', { date_debut: '2026-01-01', date_fin: '2026-06-30' }, CTX), /motif/);
});

test('attestation de travail : texte, accord au féminin et mention éditeur', () => {
  const { doc } = pdfDe('attestation_travail');
  const t = doc.tout;
  assert.match(t, /Madame Adama Hawa Baldé/);
  assert.match(t, /est employée au sein de notre entreprise en qualité de Agent Santé et Sécurité au Travail depuis le 21\/03\/2023, sous contrat à durée indéterminée \(CDI\)\./);
  assert.match(t, /Fait à Dakar, le \d{2}\/\d{2}\/\d{4}\./);
  assert.match(t, /Mouhamadou Diop/);
  assert.match(t, /Édité avec Amaterasu/);
  assert.equal(doc.termine, true);
  assert.equal(doc.options.size, 'A4');
  assert.equal(doc.options.lang, 'fr-FR');
});

test('accords : masculin, féminin et civilité non renseignée', () => {
  const masc = pdfDe('attestation_travail', { civilite: 'M' }).doc.tout;
  assert.match(masc, /Monsieur Adama Hawa Baldé est employé au sein/);
  const neutre = pdfDe('attestation_travail', { civilite: '' }).doc.tout;
  assert.match(neutre, /Madame\/Monsieur Adama Hawa Baldé est employé\(e\) au sein/);
});

test('certificat de travail : période et lignes du modèle', () => {
  const { doc } = pdfDe('certificat_travail', { date_fin: '2026-10-15' });
  const t = doc.tout;
  assert.match(t, /du 21\/03\/2023 au 15\/10\/2026 ;/);
  assert.match(t, /Née le 12\/05\/1990 à Dakar ;/);
  assert.match(t, /Demeurant à : Parcelles Assainies, Dakar ;/);
  assert.match(t, /En foi de quoi le présent certificat/);
  assert.throws(() => valeursDocument('certificat_travail', { date_fin: '2023-01-01' }, CTX), /avant la date d'embauche/);
});

test('champ vide : des points de suite sont imprimés pour écrire à la main', () => {
  const { doc } = pdfDe('certificat_travail');
  assert.match(doc.tout, /au \.{10,} ;/);
});

test('attestation de salaire : total avec primes', () => {
  const sans = pdfDe('attestation_salaire').doc.tout;
  assert.match(sans, /salaire de base mensuel brut de 350 000 FCFA\./);
  assert.doesNotMatch(sans, /rémunération mensuelle brute totale/);
  const avec = pdfDe('attestation_salaire', { primes: '50000' }).doc.tout;
  assert.match(avec, /primes et indemnités mensuelles de 50 000 FCFA, soit une rémunération mensuelle brute totale de 400 000 FCFA\./);
});

test('contrat CDI : 10 articles fixes, valeurs insérées, pagination', () => {
  const { doc } = pdfDe('contrat_cdi', { categorie: '8e catégorie', missions: 'Contrôler les EPI\nAnimer les causeries sécurité', essai: '3 mois', transport: '26000' });
  const t = doc.tout;
  for (let n = 1; n <= 10; n += 1) assert.match(t, new RegExp(`ARTICLE ${n} :`));
  assert.match(t, /Loi n° 97-17/);
  assert.match(t, /prend effet à compter du 21\/03\/2023\./);
  assert.match(t, /catégorie 8e catégorie de la Convention/);
  assert.match(t, /-  Contrôler les EPI/);
  assert.match(t, /période d'essai de 3 mois, renouvelable une fois/);
  assert.match(t, /Salaire de base : 350 000 FCFA/);
  assert.match(t, /Indemnité de transport : 26 000 FCFA/);
  assert.match(t, /article L\.49/);
  assert.match(t, /Pour l'Employeur/);
  assert.match(t, /Le Travailleur/);
  assert.match(t, /Page 1 sur \d+/);
  assert.match(t, /NINEA \/ RCCM : 0058759612V2 \/ SNDKR 2016 B 7994/);
});

test('contrat CDD : motif, durée calculée et article L.42', () => {
  const { doc } = pdfDe('contrat_cdd', { motif: 'Remplacement temporaire', date_debut: '2026-11-01', date_fin: '2027-04-30' });
  const t = doc.tout;
  for (let n = 1; n <= 10; n += 1) assert.match(t, new RegExp(`ARTICLE ${n} :`));
  assert.match(t, /motif suivant : Remplacement temporaire\./);
  assert.match(t, /à compter du 01\/11\/2026 pour s'achever le 30\/04\/2027, pour une durée totale de 6 mois\./);
  assert.match(t, /article L\.42/);
});

test('logo illisible : le document est quand même produit', () => {
  const ctx = { ...CTX, boutique: { ...CTX.boutique, logo_data: 'data:image/png;base64,AAAA' } };
  const { doc } = pdfDe('attestation_travail', {}, ctx, { imageEchoue: true });
  assert.equal(doc.termine, true);
});

test('identité enregistrable dans le dossier : colonnes connues seulement', () => {
  const v = valeursDocument('contrat_cdi', { nationalite: 'Sénégalaise', piece_identite: '' }, CTX);
  const maj = identiteAEnregistrer(v);
  assert.deepEqual(Object.keys(maj).sort(), ['address', 'birth_date', 'birth_place', 'civility', 'id_document', 'nationality']);
  assert.equal(maj.nationality, 'Sénégalaise');
  assert.equal(maj.id_document, null);
  const att = identiteAEnregistrer(valeursDocument('attestation_travail', {}, CTX));
  assert.deepEqual(Object.keys(att), ['civility']);
});

test('nom de fichier sans accents ni espaces', () => {
  assert.equal(nomFichierDocument('contrat_cdi', 'Adama Hawa Baldé'), 'Contrat-CDI-Adama-Hawa-Balde.pdf');
});
