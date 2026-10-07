// Tests des écritures comptables (TVA sur charges, BRS, précompte de TVA).
// Lancer : node --test tests/        (depuis le dossier qui contient accounting_routes.js)
// Aucune base de données : le fichier de routes est chargé avec des modules factices
// et un faux client SQL qui renvoie les lignes voulues.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function charger() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'accounting_routes.js'), 'utf8')
    + '\nglobalThis.__T = { lireFacturesCharges, lireReglementsCharges, lireCaisse, lireVentes, retenueBrs, ligne };';
  const routeur = new Proxy({}, { get: () => () => {} });
  const faux = {
    express: Object.assign(() => ({}), { Router: () => routeur, raw: () => () => {}, json: () => () => {}, urlencoded: () => () => {} }),
    pdfkit: function PDFDocument() {},
  };
  const req = (nom) => faux[nom] || new Proxy({}, { get: () => () => {} });
  const module_ = { exports: {} };
  new Function('require', 'module', 'exports', src)(req, module_, module_.exports);
  return globalThis.__T;
}
const T = charger();

const clientAvec = (rows) => ({ query: async () => ({ rows }) });
const somme = (lignes, cle) => Math.round(lignes.reduce((t, l) => t + l[cle], 0) * 100) / 100;
const equilibre = (e) => assert.equal(somme(e.lignes, 'debit'), somme(e.lignes, 'credit'), `écriture déséquilibrée : ${JSON.stringify(e.lignes)}`);
const montantSur = (e, compte, cle) => somme(e.lignes.filter((l) => l.compte === compte), cle);

test('retenueBrs : 5 % arrondi au franc', () => {
  assert.equal(T.retenueBrs(100000), 5000);
  assert.equal(T.retenueBrs(84746), 4237); // 4237,3
  assert.equal(T.retenueBrs(0), 0);
});

test('facture de charge avec TVA : charge HT + 445 = fournisseur TTC', async () => {
  const [e] = await T.lireFacturesCharges(clientAvec([{ id: '1', nature_account: '605', label: 'Électricité', amount: '118000', tva: '18000', d: '2026-10-01' }]), 'm', '2026-01-01');
  equilibre(e);
  assert.equal(montantSur(e, '605', 'debit'), 100000);
  assert.equal(montantSur(e, '445', 'debit'), 18000);
  assert.equal(montantSur(e, '401', 'credit'), 118000);
});

test('facture de charge sans TVA : écriture et signature inchangées', async () => {
  const [e] = await T.lireFacturesCharges(clientAvec([{ id: '1', nature_account: '605', label: 'Eau', amount: '50000', tva: '0', d: '2026-10-01' }]), 'm', '2026-01-01');
  equilibre(e);
  assert.equal(e.lignes.length, 2);
  assert.equal(e.sig, '50000|605|2026-10-01|Eau|t1');
});

test('règlement avec retenue : trésorerie nette + 4478', async () => {
  const [e] = await T.lireReglementsCharges(clientAvec([{ id: '1', label: 'Loyer', amount: '200000', retenue: '10000', paid_method: 'virement', d: '2026-10-05' }]), 'm', '2026-01-01');
  equilibre(e);
  assert.equal(montantSur(e, '401', 'debit'), 200000);
  assert.equal(montantSur(e, '4478', 'credit'), 10000);
  assert.equal(somme(e.lignes.filter((l) => !['401', '4478'].includes(l.compte)), 'credit'), 190000);
});

test('règlement sans retenue (ancienne facture) : signature inchangée', async () => {
  const [e] = await T.lireReglementsCharges(clientAvec([{ id: '1', label: 'Loyer', amount: '200000', retenue: '0', paid_method: 'virement', d: '2026-10-05' }]), 'm', '2026-01-01');
  equilibre(e);
  assert.equal(e.lignes.length, 2);
  assert.equal(e.sig, '200000|virement|2026-10-05|Loyer|t1');
});

const ctx = { avertissements: [], tiers: { obtenir: async () => '411001' } };
const sortie = (extra) => ({ id: '1', movement_type: 'sortie', payment_method: 'especes', amount: '95000', reason: 'Loyer octobre', charge_account: '622', tva: '0', retenue: '0', d: '2026-10-05', ...extra });

test('sortie de caisse avec retenue : charge brute, caisse nette, 4478', async () => {
  const [e] = await T.lireCaisse(clientAvec([sortie({ retenue: '5000' })]), 'm', '2026-01-01', ctx);
  equilibre(e);
  assert.equal(montantSur(e, '622', 'debit'), 100000);
  assert.equal(montantSur(e, '4478', 'credit'), 5000);
  assert.equal(somme(e.lignes.filter((l) => l.compte !== '622' && l.compte !== '4478'), 'credit'), 95000);
});

test('sortie de caisse avec TVA et retenue : tout reste équilibré', async () => {
  // brut TTC 118000 dont TVA 18000 -> base HT 100000 -> retenue 5000 -> caisse 113000
  const [e] = await T.lireCaisse(clientAvec([sortie({ amount: '113000', tva: '18000', retenue: '5000' })]), 'm', '2026-01-01', ctx);
  equilibre(e);
  assert.equal(montantSur(e, '622', 'debit'), 100000);
  assert.equal(montantSur(e, '445', 'debit'), 18000);
  assert.equal(montantSur(e, '4478', 'credit'), 5000);
});

test('sortie de caisse sans retenue : signature inchangée', async () => {
  const [e] = await T.lireCaisse(clientAvec([sortie({ amount: '50000' })]), 'm', '2026-01-01', ctx);
  equilibre(e);
  assert.equal(e.sig, '50000|sortie|especes|Loyer octobre|2026-10-05|t3|622');
});

const vente = (extra) => ({ id: 'v1', order_seq: 7, client_id: 'c1', insurer_id: null, pm: 'especes', total: '118000', tva: '18000', precompte: '0', d: '2026-10-03', cogs: '0', differe: '0', copay: '0', copay_pm: null, ...extra });

test('vente avec précompte : la part précomptée va en 445, pas en caisse', async () => {
  const [e] = await T.lireVentes(clientAvec([vente({ precompte: '9000' })]), 'm', '2026-01-01', ctx);
  equilibre(e);
  assert.equal(montantSur(e, '445', 'debit'), 9000);
  assert.equal(montantSur(e, '701', 'credit'), 100000);
  assert.equal(montantSur(e, '443', 'credit'), 18000);
  const tresorerie = e.lignes.find((l) => l.debit > 0 && l.compte !== '445');
  assert.equal(tresorerie.debit, 109000);
});

test('vente à crédit avec précompte : le client doit le net', async () => {
  const [e] = await T.lireVentes(clientAvec([vente({ pm: 'a_credit', precompte: '9000' })]), 'm', '2026-01-01', ctx);
  equilibre(e);
  assert.equal(montantSur(e, '411001', 'debit'), 109000);
});

test('vente sans précompte : écriture et signature inchangées', async () => {
  const [e] = await T.lireVentes(clientAvec([vente()]), 'm', '2026-01-01', ctx);
  equilibre(e);
  assert.equal(montantSur(e, '445', 'debit'), 0);
  assert.ok(!e.sig.includes('|p'));
});

test('précompte supérieur à la TVA : plafonné à la TVA', async () => {
  const [e] = await T.lireVentes(clientAvec([vente({ precompte: '50000' })]), 'm', '2026-01-01', ctx);
  equilibre(e);
  assert.equal(montantSur(e, '445', 'debit'), 18000);
});
