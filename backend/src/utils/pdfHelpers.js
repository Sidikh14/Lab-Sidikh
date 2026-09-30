// Utilitaires partagés pour tous les PDF générés par l'application
// (bons de commande, catalogue produits, inventaire, relevés de caisse,
// journal d'activité…).
//
// Style : moderne et lisible — bande d'en-tête colorée, titres en gras,
// tableaux à en-tête teinté et lignes alternées, pastilles de statut
// colorées, filets très discrets. Une seule couleur d'accent (indigo) pour
// rester sobre à l'impression ; le texte reste noir/gris foncé pour un
// contraste maximal.
//
// L'API (noms, paramètres, valeurs de retour) est identique à l'ancienne
// version : les PDF existants gardent leur code et prennent le nouveau style.

const NOIR = '#1b1f2a';
const GRIS = '#586174';
const GRIS_CLAIR = '#8b93a5';
const TRAIT = '#e4e8f0';
const FOND_ALTERNE = '#f6f8fc';

const ACCENT = '#4f46e5';
const ACCENT_FONCE = '#312e81';
const ACCENT_CLAIR = '#eef0ff';
const TEXTE_SUR_BANDE = '#c7d2fe';

const DANGER = '#b91c1c';
const DANGER_CLAIR = '#fee2e2';
const AVERTISSEMENT = '#b45309';
const AVERTISSEMENT_CLAIR = '#fef3c7';
const SUCCES = '#15803d';
const SUCCES_CLAIR = '#dcfce7';

// Couleurs des pastilles de statut de stock (voir dessinerBadge).
const BADGES_STATUT = {
  Rupture: { texte: DANGER, fond: DANGER_CLAIR },
  Faible: { texte: AVERTISSEMENT, fond: AVERTISSEMENT_CLAIR },
  'En stock': { texte: SUCCES, fond: SUCCES_CLAIR },
};

// La police 'Titre' est utilisée par certains PDF (totaux, titres). On la
// mappe sur Helvetica-Bold : plus moderne qu'une serif, et plus aucun
// fichier de police externe à déployer (l'ancienne Newsreader.ttf n'est plus
// nécessaire).
function enregistrerPolices(doc) {
  doc.registerFont('Titre', 'Helvetica-Bold');
}

// Formate un montant avec un espace normal comme séparateur de milliers
// (nécessaire : la police standard des PDF n'affiche pas correctement
// l'espace insécable utilisé par toLocaleString('fr-FR')).
function formatMontant(valeur) {
  const entier = Math.round(Number(valeur) || 0);
  const signe = entier < 0 ? '-' : '';
  return signe + String(Math.abs(entier)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// En-tête : bande colorée pleine largeur avec le nom du commerce (petites
// capitales), le titre du document en grand et blanc, et une ligne de
// sous-titre. Une ligne discrète d'informations légales (adresse / NINEA /
// RCCM) s'affiche sous la bande si elle a été renseignée.
// `merchant` est optionnel : { ninea, rccm, address, ... } — permet aussi
// d'activer le pied de page automatique sur les pages suivantes (voir
// activerPiedDePageAuto).
// Retourne l'ordonnée à laquelle le contenu peut commencer.
function dessinerEntete(doc, { businessName, titre, sousTitre, merchant }) {
  enregistrerPolices(doc);
  const largeurPage = doc.page.width;
  const xTexte = 50;
  const largeurTexte = largeurPage - 100;

  doc.rect(0, 0, largeurPage, 112).fill(ACCENT_FONCE);
  doc.rect(0, 112, largeurPage, 3).fill(ACCENT);

  doc.fillColor(TEXTE_SUR_BANDE).font('Helvetica-Bold').fontSize(8)
    .text((businessName || 'Commerce').toUpperCase(), xTexte, 30, {
      width: largeurTexte, height: 11, ellipsis: true, characterSpacing: 1.2,
    });

  doc.fillColor('#ffffff').font('Titre').fontSize(24)
    .text(titre || '', xTexte, 46, { width: largeurTexte, height: 30, ellipsis: true });

  if (sousTitre) {
    doc.fillColor(TEXTE_SUR_BANDE).font('Helvetica').fontSize(9)
      .text(sousTitre, xTexte, 82, { width: largeurTexte, height: 24, ellipsis: true });
  }

  let yContenu = 138;
  if (merchant && (merchant.ninea || merchant.rccm || merchant.address)) {
    const parts = [merchant.address, merchant.ninea && `NINEA ${merchant.ninea}`, merchant.rccm && `RCCM ${merchant.rccm}`].filter(Boolean);
    doc.fillColor(GRIS_CLAIR).font('Helvetica').fontSize(7.5)
      .text(parts.join(' · '), xTexte, 124, { width: largeurTexte, height: 10, ellipsis: true });
    yContenu = 148;
  }

  if (merchant) activerPiedDePageAuto(doc, merchant);

  doc.fillColor(NOIR).font('Helvetica');
  return yContenu;
}

// Pied de page professionnel : coordonnées bancaires / Mobile Money et
// conditions de règlement, centrées en bas de page, discrètes. N'affiche
// rien si aucune de ces informations n'a été renseignée par le commerçant.
// Le caller doit l'appeler une dernière fois juste avant doc.end() — voir
// activerPiedDePageAuto pour les pages suivantes.
function dessinerPiedDePage(doc, merchant) {
  if (!merchant) return;
  const lignes = [
    merchant.bank_details && `Coordonnées bancaires : ${merchant.bank_details}`,
    merchant.mobile_money_details && `Mobile Money : ${merchant.mobile_money_details}`,
    merchant.payment_terms,
  ].filter(Boolean);
  if (lignes.length === 0) return;

  const y = doc.page.height - 60;
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor(TRAIT).lineWidth(0.75).stroke();
  doc.fillColor(GRIS_CLAIR).font('Helvetica').fontSize(7.5)
    // `height` + `ellipsis` empêchent pdfkit de faire déborder ce texte sur
    // une nouvelle page si les coordonnées bancaires/Mobile Money/conditions
    // de règlement sont trop longues pour tenir sur une ligne à cet endroit
    // (juste avant le bas de page) — un débordement ici déclenchait un
    // addPage() automatique, qui redéclenchait ce même pied de page via
    // pageAdded, qui débordait à nouveau, etc. : boucle infinie jusqu'au
    // RangeError "Maximum call stack size exceeded".
    .text(lignes.join('  ·  '), 50, y + 8, { width: doc.page.width - 100, height: 30, align: 'center', ellipsis: true });
  doc.fillColor(NOIR).font('Helvetica');
}

// Redessine automatiquement le pied de page sur chaque nouvelle page
// (déclenché par doc.addPage()) — évite d'avoir à l'appeler manuellement à
// chaque saut de page dans le code appelant.
// Protégé contre la récursion : si dessinerPiedDePage() lui-même causait un
// nouvel addPage() (débordement de texte notamment), le handler ci-dessous
// ne se redéclenche pas en cascade.
function activerPiedDePageAuto(doc, merchant) {
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

// En-tête de tableau : bandeau arrondi teinté, libellés en petites capitales
// gras de la couleur d'accent. Retourne l'ordonnée de la première ligne.
function dessinerEnteteTableau(doc, y, colonnes) {
  const largeurPage = doc.page.width;
  doc.roundedRect(50, y - 4, largeurPage - 100, 22, 4).fill(ACCENT_CLAIR);
  doc.fillColor(ACCENT_FONCE).font('Helvetica-Bold').fontSize(7.5);
  colonnes.forEach((col) => {
    doc.text(col.texte.toUpperCase(), col.x, y + 3, {
      width: col.largeur, align: col.aligner || 'left', characterSpacing: 0.6, lineBreak: false,
    });
  });
  doc.fillColor(NOIR).font('Helvetica');
  return y + 26;
}

// Filet de séparation très discret entre deux blocs.
function traitSeparateur(doc, y) {
  const largeurPage = doc.page.width;
  doc.moveTo(50, y).lineTo(largeurPage - 50, y).strokeColor(TRAIT).lineWidth(0.6).stroke();
}

// Pastille colorée (statut de stock, etc.) : texte centré sur fond arrondi.
// `couleurs` = { texte, fond } (voir BADGES_STATUT).
function dessinerBadge(doc, { x, y, texte, largeur = 50, couleurs }) {
  const c = couleurs || { texte: GRIS, fond: FOND_ALTERNE };
  doc.roundedRect(x, y, largeur, 13, 6.5).fill(c.fond);
  doc.fillColor(c.texte).font('Helvetica-Bold').fontSize(7)
    .text(texte, x, y + 3.5, { width: largeur, align: 'center', lineBreak: false });
  doc.fillColor(NOIR).font('Helvetica');
}

// Bandeau de total mis en valeur (fond teinté arrondi). Dessine seulement le
// fond : le caller écrit ensuite ses libellés/valeurs par-dessus.
function dessinerBandeTotal(doc, y, hauteur = 28) {
  doc.roundedRect(50, y, doc.page.width - 100, hauteur, 5).fill(ACCENT_CLAIR);
  doc.fillColor(ACCENT_FONCE).font('Helvetica-Bold');
}

module.exports = {
  COULEURS: {
    encre: NOIR,
    muted: GRIS,
    mutedClair: GRIS_CLAIR,
    bordure: TRAIT,
    fondAlterne: FOND_ALTERNE,
    accent: ACCENT,
    accentFonce: ACCENT_FONCE,
    accentClair: ACCENT_CLAIR,
    danger: DANGER,
    succes: SUCCES,
    avertissement: AVERTISSEMENT,
  },
  BADGES_STATUT,
  formatMontant,
  dessinerEntete,
  dessinerEnteteTableau,
  dessinerPiedDePage,
  dessinerBadge,
  dessinerBandeTotal,
  traitSeparateur,
  enregistrerPolices,
};
