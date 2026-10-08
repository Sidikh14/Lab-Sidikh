// Tests des rôles multiples et du rôle comptable.
// Lancer : node --test tests/roles.test.js   (depuis le dossier backend)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function trouver(regex) {
  const aVisiter = [path.join(__dirname, '..')];
  while (aVisiter.length) {
    const dossier = aVisiter.shift();
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
      if (e.isFile() && regex.test(e.name) && /middleware|routes/i.test(dossier)) return path.join(dossier, e.name);
      if (e.isDirectory() && !['node_modules', '.git', 'tests', 'dist', 'build'].includes(e.name)) aVisiter.push(path.join(dossier, e.name));
    }
  }
  throw new Error(`Fichier introuvable : ${regex}`);
}
const R = require(trouver(/^roles\.js$/));

test('normaliserRoles : « vendeur_caissier » devient vendeur + caissier, sans doublon', () => {
  assert.deepEqual(R.normaliserRoles(['vendeur_caissier']), ['vendeur', 'caissier']);
  assert.deepEqual(R.normaliserRoles(['vendeur', 'vendeur_caissier']), ['vendeur', 'caissier']);
  assert.deepEqual(R.normaliserRoles(null, 'caissier'), ['caissier']);
  assert.deepEqual(R.normaliserRoles([], null), []);
});

test('rolePrincipal : le plus étendu l\'emporte, vendeur + caissier = ancien vendeur_caissier', () => {
  assert.equal(R.rolePrincipal(['vendeur', 'caissier']), 'vendeur_caissier');
  assert.equal(R.rolePrincipal(['caissier', 'vendeur']), 'vendeur_caissier');
  assert.equal(R.rolePrincipal(['comptable', 'gerant']), 'gerant');
  assert.equal(R.rolePrincipal(['comptable', 'caissier']), 'caissier');
  assert.equal(R.rolePrincipal(['comptable']), 'comptable');
  assert.equal(R.rolePrincipal(['manager']), 'manager');
  assert.equal(R.rolePrincipal(['owner']), 'owner');
});

test('aRole : cherche dans tous les rôles et dans le rôle principal', () => {
  const u = { role: 'vendeur_caissier', roles: ['vendeur', 'caissier'] };
  assert.equal(R.aRole(u, 'caissier'), true);
  assert.equal(R.aRole(u, 'vendeur_caissier'), true); // ancien code
  assert.equal(R.aRole(u, 'comptable', 'gerant'), false);
  assert.equal(R.aRole({ role: 'gerant', roles: ['gerant', 'comptable'] }, 'comptable'), true);
  assert.equal(R.aRole(null, 'manager'), false);
  assert.equal(R.aRole({ role: 'manager' }, 'manager'), true); // sans liste : le rôle seul suffit
});

function appeler(garde, user) {
  const res = { code: null, status(c) { this.code = c; return this; }, json() { return this; } };
  let suite = false;
  garde({ user }, res, () => { suite = true; });
  return { suite, code: res.code };
}

test('requireRole : le comptable passe sur les routes comptables, pas sur celles du manager', () => {
  const comptable = { role: 'comptable', roles: ['comptable'] };
  assert.equal(appeler(R.requireRole('manager', 'comptable'), comptable).suite, true);
  assert.equal(appeler(R.requireRole('manager', 'gerant'), comptable).code, 403);
});

test('requireRole : un vendeur + caissier passe sur les routes vendeur ET caissier', () => {
  const u = { role: 'vendeur_caissier', roles: ['vendeur', 'caissier'] };
  assert.equal(appeler(R.requireRole('vendeur'), u).suite, true);
  assert.equal(appeler(R.requireRole('caissier'), u).suite, true);
  assert.equal(appeler(R.requireRole('gerant'), u).code, 403);
  assert.equal(appeler(R.requireRole('manager'), undefined).code, 403);
});

// ---------- Routes de l'équipe (faux routeur, fausse base) ----------
function chargerEquipe(baseFausse) {
  const chemin = trouver(/^users[._]routes?\.js$/);
  const src = fs.readFileSync(chemin, 'utf8');
  const routes = {};
  const routeur = {
    use() {},
    ...Object.fromEntries(['get', 'post', 'patch', 'delete'].map((m) => [m, (p, ...h) => { routes[`${m.toUpperCase()} ${p}`] = h[h.length - 1]; }])),
  };
  const faux = {
    express: { Router: () => routeur },
    bcryptjs: { hash: async () => 'hash' },
    '../config/db': { query: (...a) => baseFausse(...a) },
    '../middleware/auth': { authenticate: () => {} },
    '../middleware/roles': R,
    '../utils/activityLog': { logActivity: async () => {} },
  };
  const m = { exports: {} };
  new Function('require', 'module', 'exports', src)((n) => faux[n], m, m.exports);
  return routes;
}
function reponse() {
  return { code: 200, status(c) { this.code = c; return this; }, json(b) { this.corps = b; return this; } };
}
const MANAGER = { id: 'mgr', role: 'manager', roles: ['manager'], merchantId: 'm1' };
const baseEquipe = ({ lieuType = 'boutique', plafond = 10, total = 1 } = {}) => async (sql) => {
  if (sql.includes('FROM warehouses')) return { rows: lieuType ? [{ id: 'w1', type: lieuType }] : [] };
  if (sql.includes('max_team_members')) return { rows: [{ max_team_members: plafond }] };
  if (sql.includes('COUNT(*)')) return { rows: [{ total }] };
  if (sql.includes('INSERT INTO users')) return { rows: [{ id: 'u1' }], insertParams: true };
  return { rows: [] };
};
async function creer(corps, options) {
  let insertion = null;
  const base = baseEquipe(options);
  const routes = chargerEquipe(async (sql, params) => {
    if (sql.includes('INSERT INTO users')) insertion = params;
    return base(sql, params);
  });
  const res = reponse();
  await routes['POST /']({ user: MANAGER, body: { fullName: 'A B', email: 'a@b.sn', password: 'secret1', ...corps } }, res);
  return { res, insertion };
}

test('équipe : vendeur + caissier cochés -> rôle principal vendeur_caissier, deux rôles enregistrés', async () => {
  const { res, insertion } = await creer({ roles: ['vendeur', 'caissier'], warehouseId: 'w1' });
  assert.equal(res.code, 201);
  assert.equal(insertion[4], 'vendeur_caissier');
  assert.deepEqual(insertion[5], ['vendeur', 'caissier']);
});

test('équipe : l\'ancien rôle vendeur_caissier reste accepté', async () => {
  const { res, insertion } = await creer({ role: 'vendeur_caissier', warehouseId: 'w1' });
  assert.equal(res.code, 201);
  assert.deepEqual(insertion[5], ['vendeur', 'caissier']);
});

test('équipe : un comptable seul peut être créé sans boutique', async () => {
  const { res, insertion } = await creer({ roles: ['comptable'] });
  assert.equal(res.code, 201);
  assert.equal(insertion[4], 'comptable');
  assert.equal(insertion[6], null);
});

test('équipe : vendeur sans boutique refusé, comptable + caissier sans boutique refusé', async () => {
  assert.equal((await creer({ roles: ['vendeur'] })).res.code, 400);
  assert.equal((await creer({ roles: ['comptable', 'caissier'] })).res.code, 400);
});

test('équipe : rôle de vente dans un dépôt refusé, gérant accepté', async () => {
  assert.equal((await creer({ roles: ['caissier'], warehouseId: 'w1' }, { lieuType: 'depot' })).res.code, 400);
  assert.equal((await creer({ roles: ['gerant', 'comptable'], warehouseId: 'w1' }, { lieuType: 'depot' })).res.code, 201);
});

test('équipe : impossible d\'attribuer manager ou owner, rôle inconnu refusé, liste vide refusée', async () => {
  assert.equal((await creer({ roles: ['manager'], warehouseId: 'w1' })).res.code, 403);
  assert.equal((await creer({ roles: ['owner'], warehouseId: 'w1' })).res.code, 403);
  assert.equal((await creer({ roles: ['admin'], warehouseId: 'w1' })).res.code, 400);
  assert.equal((await creer({ roles: [], warehouseId: 'w1' })).res.code, 400);
});

test('équipe : le plafond de comptes s\'applique toujours', async () => {
  assert.equal((await creer({ roles: ['comptable'] }, { plafond: 3, total: 3 })).res.code, 403);
});

async function changerRoles(corps, membre) {
  let maj = null;
  const routes = chargerEquipe(async (sql, params) => {
    if (sql.includes('FROM users u LEFT JOIN warehouses')) return { rows: membre ? [membre] : [] };
    if (sql.includes('UPDATE users SET role')) { maj = params; return { rows: [{ id: 'u1', full_name: 'A B', role: params[0], roles: params[1] }] }; }
    return { rows: [] };
  });
  const res = reponse();
  await routes['PATCH /:id/role']({ user: MANAGER, params: { id: 'u1' }, body: corps }, res);
  return { res, maj };
}

test('changement de rôles : plusieurs rôles enregistrés et permissions réinitialisées', async () => {
  const { res, maj } = await changerRoles({ roles: ['caissier', 'vendeur'] }, { warehouse_id: 'w1', lieu_type: 'boutique' });
  assert.equal(res.code, 200);
  assert.equal(maj[0], 'vendeur_caissier');
  assert.deepEqual(maj[1], ['caissier', 'vendeur']);
});

test('changement de rôles : membre sans boutique + rôle de vente refusé ; comptable seul accepté', async () => {
  assert.equal((await changerRoles({ roles: ['vendeur'] }, { warehouse_id: null, lieu_type: null })).res.code, 400);
  assert.equal((await changerRoles({ roles: ['comptable'] }, { warehouse_id: null, lieu_type: null })).res.code, 200);
});

test('changement de rôles : membre dans un dépôt + rôle de vente refusé', async () => {
  assert.equal((await changerRoles({ roles: ['caissier'] }, { warehouse_id: 'w1', lieu_type: 'depot' })).res.code, 400);
});
