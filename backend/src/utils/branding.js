// Palette de charte personnalisée d'un commerçant (backend). Emplacement : backend/src/utils/branding.js
// ---- Calcul de la palette à partir de UNE couleur principale (charte personnalisée d'un commerçant) ----
// Même code côté backend (utils/branding.js) et frontend (config/branding.js) : ne le modifier qu'aux deux endroits.
// Principe : la couleur du client remplace le Marine (barre latérale, titres, en-têtes de tableau). Elle est
// assombrie si besoin pour rester lisible (texte blanc dessus, contraste de 7:1). L'accent (boutons, liens) est
// déduit de la même teinte, avec 4,8:1 de contraste minimum pour un texte blanc. Le Soleil reste la signature.

const BLANC = [255, 255, 255];
const SOLEIL = '#F2A81D';
const SOLEIL_CLAIR = '#FDEFC8';
const COULEUR_PAR_DEFAUT = '#0F2747'; // Marine d'Amaterasu

function hexVersRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbVersHex(rgb) {
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function luminance(rgb) {
  const f = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contraste(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbVersHsl([r, g, b]) {
  const rr = r / 255; const gg = g / 255; const bb = b / 255;
  const max = Math.max(rr, gg, bb); const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === rr) h = ((gg - bb) / d) % 6;
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

function hslVersRgb(h, s, l) {
  const ss = s / 100; const ll = l / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0; let g = 0; let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function hslHex(h, s, l) {
  return rgbVersHex(hslVersRgb(h, s, l));
}

// Retourne null si la couleur n'est pas un code #RRGGBB valide.
function palettePourCouleur(couleur) {
  const rgb = hexVersRgb(couleur);
  if (!rgb) return null;
  const couleurSaisie = rgbVersHex(rgb);
  const [h, s, l] = rgbVersHsl(rgb);

  // Couleur principale : assombrie jusqu'à 7:1 de contraste avec le blanc.
  let lp = l;
  while (lp > 8 && contraste(hslVersRgb(h, s, lp), BLANC) < 7) lp -= 1;
  const principale = hslHex(h, s, lp);

  // Accent (boutons, liens) : même teinte, au moins 4,8:1 avec un texte blanc.
  const sa = s < 12 ? s : Math.min(85, Math.max(s, 45));
  let la = 52;
  while (la > 20 && contraste(hslVersRgb(h, sa, la), BLANC) < 4.8) la -= 1;
  const accent = hslHex(h, sa, la);
  const accentFonce = hslHex(h, sa, Math.max(la - 10, 12));
  const accentClair = hslHex(h, Math.min(sa, 70), 94);

  // Montant d'un bandeau de total : Soleil si lisible sur la couleur principale, sinon blanc.
  const montantBandeau = contraste(hexVersRgb(SOLEIL), hexVersRgb(principale)) >= 4.5 ? SOLEIL : '#FFFFFF';

  return {
    couleur: couleurSaisie,
    principale,
    accent,
    accentFonce,
    accentClair,
    soleil: SOLEIL,
    soleilClair: SOLEIL_CLAIR,
    montantBandeau,
    ajustee: principale !== couleurSaisie,
    contrasteBlanc: Math.round(contraste(hexVersRgb(principale), BLANC) * 10) / 10,
  };
}

module.exports = { palettePourCouleur, COULEUR_PAR_DEFAUT, SOLEIL, SOLEIL_CLAIR };
