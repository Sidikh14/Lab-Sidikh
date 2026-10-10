// Thème PDF Amaterasu — charte graphique v8 (annexe « Le thème PDF, pour les développeurs »).
// Aucune dépendance : des constantes et quelques fonctions, utilisables avec pdfkit.
//
// Emplacement : backend/src/utils/pdfTheme.js

const COULEURS = {
  marine: '#0F2747',
  azur: '#1F5FBF',
  soleil: '#F2A81D',
  ardoise: '#5A6678',
  brume: '#F4F6FA',
  trait: '#E2E8F0',
  blanc: '#FFFFFF',
  noir: '#000000',
  // Nuances et états de la charte
  azurClair: '#DCE8FA',
  soleilClair: '#FDEFC8',
  succes: '#157347',
  alerte: '#9C4A06',
  erreur: '#B42318',
};

// Conversion des millimètres en points PDF (1 pt = 1/72 pouce).
function mmEnPt(mm) {
  return (mm * 72) / 25.4;
}

const FORMATS = {
  a4: { largeur: mmEnPt(210), hauteur: mmEnPt(297) },
  marge: mmEnPt(20), // marges A4
  piedY: mmEnPt(12), // pied de page : à 12 mm du bord
  ticket: { largeur: mmEnPt(80), marge: mmEnPt(4) }, // reçu thermique
};

const TAILLES = {
  titreDocument: 22,
  titreSection: 12,
  texte: 10,
  tableau: 9.5,
  pied: 8,
  libelle: 7.5, // libellés en capitales
  total: 14,
  logoMin: mmEnPt(8), // emblème clair en en-tête : 8 mm de haut minimum
  logoPied: mmEnPt(3), // emblème du pied de page : 3 mm
};

const MENTION_EDITEUR = 'Édité avec Amaterasu';
const NBSP = '\u00A0';

// 118344 -> « 118 344 FCFA » (espaces insécables)
function formaterMontant(valeur, devise = 'FCFA') {
  const entier = Math.round(Number(valeur) || 0);
  const signe = entier < 0 ? '-' : '';
  const groupes = String(Math.abs(entier)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${signe}${groupes}${devise ? `${NBSP}${devise}` : ''}`;
}

// '2026-10-09' (ou une Date) -> « 09/10/2026 »
function formaterDate(valeur) {
  if (!valeur) return '';
  if (typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valeur)) {
    const [a, m, j] = valeur.slice(0, 10).split('-');
    return `${j}/${m}/${a}`;
  }
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// ('Facture', 'F-2026-0412') -> « Facture-F-2026-0412.pdf » (sans accents ni espaces)
function nomFichierPdf(type, numero) {
  const nettoyer = (t) => String(t ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${[type, numero].map(nettoyer).filter(Boolean).join('-')}.pdf`;
}

// À étaler dans le constructeur pdfkit : new PDFDocument({ size: 'A4', ...metadonneesPdf({...}) })
// Titre, auteur (le commerçant), créateur « Amaterasu », langue française.
function metadonneesPdf({ titre, commercant } = {}) {
  return {
    info: { Title: titre || '', Author: commercant || '', Creator: 'Amaterasu', Producer: 'Amaterasu' },
    lang: 'fr-FR',
  };
}

module.exports = { COULEURS, FORMATS, TAILLES, MENTION_EDITEUR, mmEnPt, formaterMontant, formaterDate, nomFichierPdf, metadonneesPdf };
