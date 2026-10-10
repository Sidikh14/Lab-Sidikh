// Charte personnalisée d'un commerçant, côté PDF : un petit intercepteur lit le commerçant de la requête
// (jeton JWT) et met sa palette à disposition de pdfHelpers.js pendant toute la durée de la requête,
// y compris après les `await` (AsyncLocalStorage). Ainsi tous les PDF — même ceux dont le code n'est pas
// modifié — prennent automatiquement les couleurs du commerçant quand l'owner a activé sa charte.
//
// Emplacement : backend/src/utils/brandingContext.js
// Branchement : app.use(brandingContext) dans app.js, avant les routes.

const { AsyncLocalStorage } = require('async_hooks');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { palettePourCouleur } = require('./branding');

const stockage = new AsyncLocalStorage();
const DUREE_CACHE_MS = 60 * 1000;
const cache = new Map(); // merchantId -> { palette, expire }

// Lecture avec to_jsonb : ne plante pas si la migration n'est pas encore exécutée.
async function lirePalette(merchantId) {
  const memoire = cache.get(merchantId);
  if (memoire && memoire.expire > Date.now()) return memoire.palette;

  let palette = null;
  try {
    const result = await pool.query(
      `SELECT COALESCE((to_jsonb(m)->>'brand_enabled')::boolean, false) AS enabled,
              to_jsonb(m)->>'brand_color' AS color
       FROM merchants m WHERE m.id = $1`,
      [merchantId]
    );
    const ligne = result.rows[0];
    if (ligne && ligne.enabled && ligne.color) palette = palettePourCouleur(ligne.color);
  } catch (err) {
    console.error('Charte du commerçant non lue :', err.message);
  }
  cache.set(merchantId, { palette, expire: Date.now() + DUREE_CACHE_MS });
  return palette;
}

// À appeler quand l'owner modifie la charte d'un commerçant : effet immédiat, sans attendre le cache.
function invaliderPalette(merchantId) {
  cache.delete(String(merchantId));
  cache.delete(merchantId);
}

function brandingContext(req, res, next) {
  const entete = req.headers.authorization || '';
  if (!entete.startsWith('Bearer ')) return next();
  let contenu;
  try {
    contenu = jwt.verify(entete.slice(7), process.env.JWT_SECRET);
  } catch {
    return next(); // jeton absent ou invalide : l'authentification des routes s'en occupe
  }
  if (!contenu || !contenu.merchantId) return next(); // compte owner : pas de charte
  lirePalette(contenu.merchantId).then(
    (palette) => (palette ? stockage.run({ palette }, next) : next()),
    () => next()
  );
}

// Palette du commerçant de la requête en cours (null = charte Amaterasu par défaut).
function paletteCourante() {
  const contexte = stockage.getStore();
  return contexte ? contexte.palette : null;
}

// Pour des tâches hors requête (envois planifiés…) ou des tests.
function avecPalette(palette, fonction) {
  return stockage.run({ palette }, fonction);
}

module.exports = { brandingContext, paletteCourante, invaliderPalette, avecPalette };
