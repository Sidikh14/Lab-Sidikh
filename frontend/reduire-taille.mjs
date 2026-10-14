// Réduit de 6 % la taille du texte, des icônes, des boutons, des champs et des espacements
// de tout le frontend (fichiers .css et .jsx du dossier src).
//
// Utilisation (depuis le dossier du frontend, après avoir fait un commit git) :
//   node reduire-taille.mjs              -> simulation : affiche ce qui serait modifié, ne change rien
//   node reduire-taille.mjs --appliquer  -> applique les modifications
//   node reduire-taille.mjs --appliquer --forcer --seulement src/components/Sidebar.jsx,src/pages/DashboardPage.jsx
//                                         -> ne traite que ces fichiers (remplacés après la réduction)
//
// Sécurités : refuse de tourner deux fois (fichier src/.reduction-taille), ne touche jamais
// aux règles @media (points de rupture), au CSS d'impression (@media print), ni aux bordures,
// ombres et arrondis.
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const FACTEUR = 0.94;
const SRC = process.argv.includes('--src') ? process.argv[process.argv.indexOf('--src') + 1] : 'src';
const APPLIQUER = process.argv.includes('--appliquer');
const MARQUEUR = join(SRC, '.reduction-taille');
// --seulement a,b : ne traite que ces fichiers (utile pour un fichier remplacé après la réduction)
const SEULEMENT = process.argv.includes('--seulement')
  ? process.argv[process.argv.indexOf('--seulement') + 1].split(',').map((f) => f.replace(/\\/g, '/'))
  : null;

if (!existsSync(SRC)) { console.error(`Dossier "${SRC}" introuvable : lancez la commande depuis le dossier du frontend.`); process.exit(1); }
if (APPLIQUER && existsSync(MARQUEUR) && !process.argv.includes('--forcer')) {
  console.error('La réduction a déjà été appliquée (fichier src/.reduction-taille). Rien n\'a été modifié.');
  process.exit(1);
}

// Taille réduite : 1 décimale pour les polices, entier pour le reste ; les petites valeurs (bordures, traits) restent.
const reduire = (valeur, police) => {
  const v = parseFloat(valeur);
  if (Math.abs(v) < 6) return valeur;
  // Police : 1 décimale, jamais en dessous de 10,5 px (lisibilité) ; le reste : entier.
  const r = police ? Math.max(10.5, Math.round(v * FACTEUR * 10) / 10) : Math.round(v * FACTEUR);
  return String(r);
};
const reduirePx = (texte, police) => texte.replace(/(-?\d+(?:\.\d+)?)px/g, (_, n) => `${reduire(n, police)}px`);

// ---- CSS (fichiers .css et texte CSS dans les gabarits des .jsx) ----
const PROPS_CSS = [
  'font-size', 'line-height',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'gap', 'row-gap', 'column-gap',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'top', 'right', 'bottom', 'left',
];
const RE_CSS = new RegExp(`(?<![\\w(-])(${PROPS_CSS.join('|')})(\\s*:\\s*)([^;}\\n'"\`]*?)(?=;|}|\\n|'|"|\`|$)`, 'g');

// Zones à ne jamais toucher : @media print { ... }
function zonesImpression(texte) {
  const zones = [];
  let i = 0;
  while ((i = texte.indexOf('@media print', i)) !== -1) {
    const debut = texte.indexOf('{', i);
    if (debut === -1) break;
    let niveau = 0; let fin = debut;
    for (; fin < texte.length; fin++) {
      if (texte[fin] === '{') niveau++;
      else if (texte[fin] === '}') { niveau--; if (niveau === 0) break; }
    }
    zones.push([i, fin]);
    i = fin;
  }
  return zones;
}

function transformerCss(texte, compteur) {
  const zones = zonesImpression(texte);
  return texte.replace(RE_CSS, (m, prop, sep, valeur, offset) => {
    if (zones.some(([a, b]) => offset >= a && offset <= b)) return m;
    if (!/px/.test(valeur)) return m;
    const neuf = reduirePx(valeur, prop === 'font-size' || prop === 'line-height');
    if (neuf !== valeur) compteur.css++;
    return `${prop}${sep}${neuf}`;
  });
}

// ---- JSX : styles en ligne et icônes SVG ----
const PROPS_JS = ['fontSize', 'gap', 'rowGap', 'columnGap', 'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'];
// fontSize: 13   |   padding: '10px 14px'   |   gap: 8
const RE_JS_NOMBRE = new RegExp(`\\b(${PROPS_JS.join('|')})(\\s*:\\s*)(-?\\d+(?:\\.\\d+)?)(?![\\d.]|\\s*[*+/%-]|px|em|%)`, 'g');
const RE_JS_TEXTE = new RegExp(`\\b(${PROPS_JS.join('|')})(\\s*:\\s*)(['"])([^'"\\n]*px[^'"\\n]*)\\3`, 'g');

function transformerJs(texte, compteur) {
  let sortie = texte.replace(RE_JS_NOMBRE, (m, prop, sep, n) => {
    const neuf = reduire(n, prop === 'fontSize');
    if (neuf !== n) compteur.js++;
    return `${prop}${sep}${neuf}`;
  });
  sortie = sortie.replace(RE_JS_TEXTE, (m, prop, sep, q, valeur) => {
    const neuf = reduirePx(valeur, prop === 'fontSize');
    if (neuf !== valeur) compteur.js++;
    return `${prop}${sep}${q}${neuf}${q}`;
  });
  // Icônes SVG : width="18" height="18" (carrés de 12 à 32 px) -> réduits
  sortie = sortie.replace(/<svg\b[^>]*?>/g, (balise) => {
    const w = balise.match(/\bwidth="(\d+)"/);
    const h = balise.match(/\bheight="(\d+)"/);
    if (!w || !h || w[1] !== h[1]) return balise;
    const n = Number(w[1]);
    if (n < 10 || n > 32) return balise;
    const neuf = String(Math.round(n * FACTEUR));
    if (neuf === w[1]) return balise;
    compteur.svg++;
    return balise.replace(/\bwidth="\d+"/, `width="${neuf}"`).replace(/\bheight="\d+"/, `height="${neuf}"`);
  });
  return sortie;
}

// ---- Parcours ----
function* fichiers(dossier) {
  for (const nom of readdirSync(dossier)) {
    if (nom === 'node_modules' || nom.startsWith('.')) continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) yield* fichiers(chemin);
    else if (['.css', '.jsx'].includes(extname(nom))) yield chemin;
  }
}

const total = { css: 0, js: 0, svg: 0, fichiers: 0 };
for (const chemin of fichiers(SRC)) {
  if (SEULEMENT && !SEULEMENT.includes(chemin.replace(/\\/g, '/'))) continue;
  const original = readFileSync(chemin, 'utf8');
  const compteur = { css: 0, js: 0, svg: 0 };
  let neuf = transformerCss(original, compteur);
  if (extname(chemin) === '.jsx') neuf = transformerJs(neuf, compteur);
  const n = compteur.css + compteur.js + compteur.svg;
  if (n === 0 || neuf === original) continue;
  total.css += compteur.css; total.js += compteur.js; total.svg += compteur.svg; total.fichiers++;
  console.log(`${relative('.', chemin)} : ${compteur.css} règle(s) CSS, ${compteur.js} style(s) en ligne, ${compteur.svg} icône(s)`);
  if (APPLIQUER) writeFileSync(chemin, neuf, 'utf8');
}
console.log(`\n${total.fichiers} fichier(s), ${total.css} règle(s) CSS, ${total.js} style(s) en ligne, ${total.svg} icône(s) ${APPLIQUER ? 'modifiés.' : 'seraient modifiés (simulation : ajoutez --appliquer pour appliquer).'}`);
if (APPLIQUER && !SEULEMENT) writeFileSync(MARQUEUR, `Réduction de ${Math.round((1 - FACTEUR) * 100)} % appliquée le ${new Date().toISOString()}\n`, 'utf8');
