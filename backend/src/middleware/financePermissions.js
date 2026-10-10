// middleware/financePermissions.js — le manager choisit, membre par membre, les pages de finance
// (Comptabilité, Fiscalité, Paie) qu'un comptable peut ouvrir. Le choix est stocké dans
// users.visible_modules avec les clés 'comptabilite', 'fiscalite' et 'paie'.
//  - visible_modules vide (NULL) : le comptable garde l'accès par défaut aux trois pages ;
//  - visible_modules renseigné : seules les pages cochées sont accessibles.
// Les autres rôles ne sont pas concernés ici : leurs règles habituelles (requireRole) continuent de s'appliquer.

const pool = require('../config/db');
const { aRole } = require('./roles');

const PAGES_FINANCE = ['comptabilite', 'fiscalite', 'paie'];

// Pages autorisées pour l'utilisateur : null = toutes (manager, ou rôle non concerné).
async function pagesFinanceAutorisees(user) {
  if (!user || aRole(user, 'manager') || !aRole(user, 'comptable')) return null;
  const { rows } = await pool.query('SELECT visible_modules FROM users WHERE id = $1 AND merchant_id = $2', [user.id, user.merchantId]);
  const choix = rows[0]?.visible_modules;
  return Array.isArray(choix) ? choix.filter((m) => PAGES_FINANCE.includes(m)) : null;
}

async function peutVoirPageFinance(user, page) {
  const pages = await pagesFinanceAutorisees(user);
  return pages === null || pages.includes(page);
}

// repliParChemin : { '/alert': { show: false } } renvoie ce JSON (200) au lieu d'un refus 403,
// pour ne pas casser le tableau de bord quand seule une alerte est demandée.
function requireFinancePage(page, repliParChemin = {}) {
  return async (req, res, next) => {
    try {
      if (await peutVoirPageFinance(req.user, page)) return next();
      if (Object.prototype.hasOwnProperty.call(repliParChemin, req.path)) return res.json(repliParChemin[req.path]);
      return res.status(403).json({ error: "Votre compte n'a pas accès à cette page. Demandez au manager de l'activer dans les permissions." });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

// Comptabilité : les chemins fiscaux demandent la page Fiscalité ; tout le reste demande Comptabilité
// ou Fiscalité (les déclarations s'appuient sur les écritures).
function requireComptaOuFiscalite(cheminsFiscaux) {
  return async (req, res, next) => {
    try {
      const fiscal = cheminsFiscaux.some((c) => req.path === c || req.path.startsWith(`${c}/`));
      const pages = await pagesFinanceAutorisees(req.user);
      const ok = pages === null || (fiscal ? pages.includes('fiscalite') : pages.includes('comptabilite') || pages.includes('fiscalite'));
      if (ok) return next();
      return res.status(403).json({ error: "Votre compte n'a pas accès à cette page. Demandez au manager de l'activer dans les permissions." });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

module.exports = { PAGES_FINANCE, pagesFinanceAutorisees, peutVoirPageFinance, requireFinancePage, requireComptaOuFiscalite };
