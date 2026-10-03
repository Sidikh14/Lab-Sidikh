const express = require('express');
const PDFDocument = require('pdfkit');
const { getSoldeActuel, LABEL_METHODE } = require('../utils/cashBalance');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireModule } = require('../middleware/modules');
const { requireOwnerModule } = require('../middleware/ownerModules');
const { logActivity } = require('../utils/activityLog');
const { initialiserComptabilite } = require('../utils/accountingSetup');

const router = express.Router();
router.use(authenticate);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const arrondi = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dateOk = (d) => typeof d === 'string' && DATE_RE.test(d) && !Number.isNaN(Date.parse(d));
const aujourdhui = () => new Date().toISOString().slice(0, 10);

// GET /accounting/access — le frontend s'en sert pour afficher (ou non) le
// module dans le menu. Répond toujours 200 ; { enabled: false } si le module
// n'est pas activé par l'owner ou si le compte n'est pas manager.
router.get('/access', async (req, res) => {
  try {
    if (req.user.role !== 'manager' || !req.user.merchantId) return res.json({ enabled: false });
    const result = await pool.query('SELECT accounting_enabled FROM merchants WHERE id = $1', [req.user.merchantId]);
    res.json({ enabled: result.rows[0]?.accounting_enabled === true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la vérification de l'accès." });
  }
});

// ---------- Charges payées depuis la page Caisse ----------
// La nature d'une charge (loyer, électricité, internet…) se choisit dans le
// formulaire « Nouvelle sortie de caisse » de la page Caisse. La sortie est
// enregistrée par /cash/expenses ; la synchro comptable l'impute au bon compte.
// Sans module activé : { enabled: false } et le champ n'apparaît pas.

const ROLES_CAISSE = ['manager', 'gerant', 'caissier', 'vendeur_caissier'];
const MODES_CAISSE = ['especes', 'wave', 'orange_money'];

function accesCaisse(req, res, next) {
  if (!ROLES_CAISSE.includes(req.user.role) || !req.user.merchantId) {
    return res.status(403).json({ error: 'Accès refusé.' });
  }
  next();
}

// Natures de charges proposées dans le formulaire de sortie de caisse
// (nom affiché, compte SYSCOHADA de classe 6).
const NATURES_CHARGES = [
  ['Loyer', '622'],
  ['Électricité / Eau', '605'],
  ['Téléphone et Internet', '628'],
  ['Assurance', '625'],
  ['Honoraires / Comptabilité', '632'],
  ['Entretien et réparations', '624'],
  ['Livraison', '612'],
  ['Transport', '618'],
  ['Frais bancaires', '631'],
  ['Publicité', '627'],
  ['Impôts et taxes', '641'],
  ['Autre charge', '658'],
];

router.get('/caisse/natures', accesCaisse, async (req, res) => {
  try {
    const m = await pool.query('SELECT accounting_enabled FROM merchants WHERE id = $1', [req.user.merchantId]);
    if (m.rows[0]?.accounting_enabled !== true) return res.json({ enabled: false, natures: [] });
    const comptes = await pool.query(
      `SELECT code FROM accounting_accounts WHERE merchant_id = $1 AND is_active = true AND code = ANY($2::text[])`,
      [req.user.merchantId, NATURES_CHARGES.map((n) => n[1])]
    );
    const presents = new Set(comptes.rows.map((r) => r.code));
    res.json({
      enabled: true,
      natures: NATURES_CHARGES.filter((n) => presents.has(n[1])).map(([label, code]) => ({ label, code })),
    });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors du chargement des natures de charges.');
  }
});


// Sortie de caisse d'un paiement : boutique valide + solde suffisant (jamais de caisse négative).
async function verifierCaisse(req, client, merchantId, warehouseId, mode, montant) {
  if (!UUID_RE.test(String(warehouseId || ''))) {
    throw erreurMetier(400, 'Choisissez la boutique dont la caisse effectue le paiement (page Caisse).');
  }
  const w = await client.query(`SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2`, [warehouseId, merchantId]);
  if (w.rows.length === 0) throw erreurMetier(400, 'Boutique introuvable.');
  const solde = await getSoldeActuel(req, warehouseId, mode);
  if (solde < montant) {
    throw erreurMetier(400, `Solde insuffisant sur ${LABEL_METHODE[mode] || mode} (solde actuel : ${Math.round(solde).toLocaleString('fr-FR')} FCFA, paiement : ${Math.round(montant).toLocaleString('fr-FR')} FCFA).`);
  }
}

// Tout le reste : manager uniquement ET module activé par l'owner.
router.use(requireRole('manager'));
router.use(requireModule('comptabilite'));
// Impôts, cotisations et paiements à l'État : module Fiscalité (activé séparément par l'owner).
router.use(['/state-dues', '/state-payments', '/tax-settings'], requireOwnerModule('fiscalite'));

// Les consultations (journal, grand livre, balance, résultat, bilan) lancent
// d'abord la synchronisation automatique (au plus une fois toutes les 30 s) :
// rien n'est à saisir ni à actualiser à la main.
router.use(['/entries', '/ledger', '/general-ledger', '/trial-balance', '/income-statement', '/balance-sheet', '/state-dues', '/closing-preview', '/fiscal-years'], async (req, res, next) => {
  if (req.method === 'GET') await assurerSynchro(req.user.merchantId, req.user.id);
  next();
});

// ---------- Plan comptable ----------

router.get('/accounts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, code, label, is_active FROM accounting_accounts WHERE merchant_id = $1 ORDER BY code`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du plan comptable.' });
  }
});

router.post('/accounts', async (req, res) => {
  const code = String(req.body.code || '').trim();
  const label = String(req.body.label || '').trim().slice(0, 200);
  if (!/^[1-8][0-9]{1,9}$/.test(code)) {
    return res.status(400).json({ error: 'Le code doit contenir 2 à 10 chiffres et commencer par une classe de 1 à 8.' });
  }
  if (!label) return res.status(400).json({ error: "L'intitulé du compte est requis." });
  try {
    const result = await pool.query(
      `INSERT INTO accounting_accounts (merchant_id, code, label) VALUES ($1, $2, $3) RETURNING id, code, label, is_active`,
      [req.user.merchantId, code, label]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce numéro de compte existe déjà.' });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du compte.' });
  }
});

// Le numéro d'un compte ne change jamais (il est référencé par les écritures) ;
// on peut renommer ou désactiver.
router.patch('/accounts/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Compte introuvable.' });
  const label = req.body.label === undefined ? null : String(req.body.label).trim().slice(0, 200);
  const isActive = typeof req.body.isActive === 'boolean' ? req.body.isActive : null;
  if (label === '') return res.status(400).json({ error: "L'intitulé ne peut pas être vide." });
  try {
    const result = await pool.query(
      `UPDATE accounting_accounts SET label = COALESCE($3, label), is_active = COALESCE($4, is_active)
       WHERE id = $1 AND merchant_id = $2 RETURNING id, code, label, is_active`,
      [req.params.id, req.user.merchantId, label, isActive]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du compte.' });
  }
});

router.get('/journals', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, code, label FROM accounting_journals WHERE merchant_id = $1 ORDER BY code`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des journaux.' });
  }
});

// ---------- Écritures ----------

router.get('/entries', async (req, res) => {
  const { from, to, journalId } = req.query;
  if ((from && !dateOk(from)) || (to && !dateOk(to))) return res.status(400).json({ error: 'Dates invalides.' });
  if (journalId && !UUID_RE.test(journalId)) return res.status(400).json({ error: 'Journal invalide.' });
  const limite = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
  try {
    const result = await pool.query(
      `SELECT e.id, e.entry_number, to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.reference, e.label, e.source_type, j.code AS journal_code,
              json_agg(json_build_object('accountCode', a.code, 'accountLabel', a.label,
                                         'debit', l.debit, 'credit', l.credit, 'label', l.label)
                       ORDER BY l.debit DESC, a.code) AS lines
       FROM accounting_entries e
       JOIN accounting_journals j ON j.id = e.journal_id
       JOIN accounting_lines l ON l.entry_id = e.id
       JOIN accounting_accounts a ON a.id = l.account_id
       WHERE e.merchant_id = $1
         AND ($2::date IS NULL OR e.entry_date >= $2::date)
         AND ($3::date IS NULL OR e.entry_date <= $3::date)
         AND ($4::uuid IS NULL OR e.journal_id = $4::uuid)
       GROUP BY e.id, j.code
       ORDER BY e.entry_date DESC, e.entry_number DESC
       LIMIT $5`,
      [req.user.merchantId, from || null, to || null, journalId || null, limite]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des écritures.' });
  }
});

// POST /accounting/entries — écriture en partie double : total débit = total
// crédit, au moins deux lignes, chaque ligne au débit OU au crédit.
router.post('/entries', async (req, res) => {
  const { journalId, entryDate, reference, label, lines } = req.body;
  const libelle = String(label || '').trim().slice(0, 300);
  if (!UUID_RE.test(String(journalId || ''))) return res.status(400).json({ error: 'Journal requis.' });
  if (!dateOk(entryDate)) return res.status(400).json({ error: "La date de l'écriture est invalide." });
  if (!libelle) return res.status(400).json({ error: 'Le libellé est requis.' });
  if (!Array.isArray(lines) || lines.length < 2) {
    return res.status(400).json({ error: 'Une écriture comporte au moins deux lignes.' });
  }
  try {
    await verifierExerciceOuvert(pool, req.user.merchantId, entryDate);
  } catch (err) {
    return repondreErreur(res, err, "Erreur lors de la vérification de l'exercice.");
  }

  const propres = [];
  for (const l of lines) {
    const debit = arrondi(l.debit || 0);
    const credit = arrondi(l.credit || 0);
    if (!UUID_RE.test(String(l.accountId || ''))) return res.status(400).json({ error: 'Chaque ligne doit avoir un compte.' });
    if (!(debit >= 0) || !(credit >= 0) || (debit > 0) === (credit > 0)) {
      return res.status(400).json({ error: 'Chaque ligne doit avoir un montant au débit OU au crédit.' });
    }
    propres.push({ accountId: l.accountId, debit, credit, label: l.label ? String(l.label).trim().slice(0, 200) : null });
  }
  const totalDebit = arrondi(propres.reduce((s, l) => s + l.debit, 0));
  const totalCredit = arrondi(propres.reduce((s, l) => s + l.credit, 0));
  if (totalDebit !== totalCredit) {
    return res.status(400).json({ error: `Écriture déséquilibrée : débit ${totalDebit}, crédit ${totalCredit}.` });
  }

  const merchantId = req.user.merchantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const journal = await client.query(`SELECT id FROM accounting_journals WHERE id = $1 AND merchant_id = $2`, [journalId, merchantId]);
    if (journal.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Journal introuvable.' });
    }
    const idsComptes = [...new Set(propres.map((l) => l.accountId))];
    const comptes = await client.query(
      `SELECT id FROM accounting_accounts WHERE merchant_id = $1 AND is_active = true AND id = ANY($2::uuid[])`,
      [merchantId, idsComptes]
    );
    if (comptes.rows.length !== idsComptes.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Un des comptes est introuvable ou désactivé.' });
    }

    // Numérotation continue par commerçant, protégée contre deux saisies simultanées.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`acc:${merchantId}`]);
    const num = await client.query(
      `SELECT COALESCE(MAX(entry_number), 0) + 1 AS n FROM accounting_entries WHERE merchant_id = $1`,
      [merchantId]
    );
    const numero = Number(num.rows[0].n);

    const entree = await client.query(
      `INSERT INTO accounting_entries (merchant_id, journal_id, entry_number, entry_date, reference, label, created_by)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7) RETURNING id`,
      [merchantId, journalId, numero, entryDate, reference ? String(reference).trim().slice(0, 80) : null, libelle, req.user.id]
    );
    for (const l of propres) {
      await client.query(
        `INSERT INTO accounting_lines (entry_id, merchant_id, account_id, debit, credit, label) VALUES ($1, $2, $3, $4, $5, $6)`,
        [entree.rows[0].id, merchantId, l.accountId, l.debit, l.credit, l.label]
      );
    }
    await client.query('COMMIT');

    await logActivity({
      merchantId,
      userId: req.user.id,
      action: 'accounting_entry',
      description: `a enregistré l'écriture comptable n°${numero} (${libelle})`,
    });
    res.status(201).json({ id: entree.rows[0].id, entryNumber: numero });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement de l'écriture." });
  } finally {
    client.release();
  }
});

// Seules les écritures saisies à la main se suppriment ; celles qui viendront
// d'une génération automatique devront être corrigées par contre-passation.
router.delete('/entries/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Écriture introuvable.' });
  try {
    const cible = await pool.query(
      `SELECT to_char(entry_date, 'YYYY-MM-DD') AS d FROM accounting_entries WHERE id = $1 AND merchant_id = $2 AND source_type = 'manuel'`,
      [req.params.id, req.user.merchantId]
    );
    if (cible.rows.length > 0) await verifierExerciceOuvert(pool, req.user.merchantId, cible.rows[0].d);
    const result = await pool.query(
      `DELETE FROM accounting_entries WHERE id = $1 AND merchant_id = $2 AND source_type = 'manuel'
       RETURNING entry_number, label`,
      [req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Écriture introuvable ou non supprimable.' });
    }
    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'accounting_entry_deleted',
      description: `a supprimé l'écriture comptable n°${result.rows[0].entry_number} (${result.rows[0].label})`,
    });
    res.json({ message: 'Écriture supprimée.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la suppression de l'écriture." });
  }
});

// ---------- Outils communs (comptes de trésorerie, verrous, erreurs) ----------

// Compte crédité selon le mode de paiement (créés avec le plan comptable) :
// caisse, Wave, Orange Money, banque, ou fournisseurs si "à payer plus tard".
const COMPTE_PAR_MODE = { especes: '571', wave: '5211', orange_money: '5212', virement: '521', a_payer: '401' };
const JOURNAL_PAR_MODE = { especes: 'CA', wave: 'BQ', orange_money: 'BQ', virement: 'BQ', a_payer: 'AC' };
const MOIS_RE = /^\d{4}-\d{2}$/;

function erreurMetier(statut, message) {
  return Object.assign(new Error(message), { statut });
}
async function verrouiller(client, merchantId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`acc:${merchantId}`]);
}

function repondreErreur(res, err, defaut) {
  if (err.statut) return res.status(err.statut).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: defaut });
}

// ---------- Paiements à l'État (TVA, retenues sur salaires, cotisations, IS) ----------
// Solde la dette fiscale ou sociale : débit du compte dû (443, 447, 431, 432,
// 442, 441), crédit de la trésorerie. Si le paiement sort d'une caisse (espèces,
// Wave, Orange Money), la sortie de caisse est créée en même temps.

const DETTES_ETAT = {
  tva:      { code: '443', label: 'TVA',                       nomCompte: 'État, TVA facturée' },
  retenues: { code: '447', label: 'IR et TRIMF sur salaires',  nomCompte: 'État, impôts retenus sur salaires' },
  css:      { code: '431', label: 'Cotisations CSS',           nomCompte: 'Sécurité sociale' },
  ipres:    { code: '432', label: 'Cotisations IPRES',         nomCompte: 'Caisse de retraite' },
  cfce:     { code: '442', label: 'CFCE',                      nomCompte: 'État, impôts et taxes' },
  is:       { code: '441', label: 'Impôt sur les résultats',   nomCompte: 'État, impôts sur les bénéfices' },
};
const MODES_ETAT = ['especes', 'wave', 'orange_money', 'virement'];
const NOM_TRESORERIE = { '571': 'Caisse', '5211': 'Wave', '5212': 'Orange Money', '521': 'Banque' };
const MOTIF_ETAT = 'Paiement État — ';

async function assurerCompte(client, merchantId, code, label) {
  const r = await client.query(`SELECT id FROM accounting_accounts WHERE merchant_id = $1 AND code = $2`, [merchantId, code]);
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await client.query(
    `INSERT INTO accounting_accounts (merchant_id, code, label) VALUES ($1, $2, $3)
     ON CONFLICT (merchant_id, code) DO UPDATE SET label = accounting_accounts.label RETURNING id`,
    [merchantId, code, label]
  );
  return ins.rows[0].id;
}

// ---------- Périodicité : impôts par mois, cotisations au choix du manager ----------
// Les impôts (TVA, IR/TRIMF, CFCE) se déclarent chaque mois. Les cotisations sociales
// (CSS, IPRES) suivent la périodicité choisie par le manager : mensuelle, trimestrielle
// ou semestrielle. Une période s'écrit AAAA-MM, AAAA-T1..T4 ou AAAA-S1..S2.

const FREQUENCES = ['monthly', 'quarterly', 'semiannual'];
const IMPOTS_MENSUELS = ['tva', 'retenues', 'cfce'];
const COTISATIONS_ETAT = ['css', 'ipres'];
const PERIODE_ETAT_RE = /^\d{4}-(0[1-9]|1[0-2]|T[1-4]|S[1-2])$/;
const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function moisDePeriode(cle) {
  const [annee, reste] = cle.split('-');
  const deux = (n) => String(n).padStart(2, '0');
  if (/^\d{2}$/.test(reste)) return [cle];
  if (reste[0] === 'T') {
    const t = Number(reste[1]);
    return [0, 1, 2].map((i) => `${annee}-${deux((t - 1) * 3 + 1 + i)}`);
  }
  const sem = Number(reste[1]);
  return [0, 1, 2, 3, 4, 5].map((i) => `${annee}-${deux((sem - 1) * 6 + 1 + i)}`);
}

function cleDepuisMois(mois, frequence) {
  const [annee, m] = mois.split('-');
  const n = Number(m);
  if (frequence === 'monthly') return mois;
  if (frequence === 'quarterly') return `${annee}-T${Math.ceil(n / 3)}`;
  return `${annee}-S${n <= 6 ? 1 : 2}`;
}

function libellePeriode(cle) {
  const [annee, reste] = cle.split('-');
  if (/^\d{2}$/.test(reste)) return `${NOMS_MOIS[Number(reste) - 1]} ${annee}`;
  if (reste[0] === 'T') return `${reste[1] === '1' ? '1er' : `${reste[1]}e`} trimestre ${annee}`;
  return `${reste[1] === '1' ? '1er' : '2e'} semestre ${annee}`;
}

// Périodes récentes (24 derniers mois regroupés selon la périodicité), de la plus récente à la plus ancienne.
function periodesRecentes(frequence, jour, nbMois = 24) {
  let [annee, mois] = jour.slice(0, 7).split('-').map(Number);
  const moisCourant = `${annee}-${String(mois).padStart(2, '0')}`;
  const cles = [];
  for (let i = 0; i < nbMois; i += 1) {
    const m = `${annee}-${String(mois).padStart(2, '0')}`;
    const cle = cleDepuisMois(m, frequence);
    if (!cles.includes(cle)) cles.push(cle);
    mois -= 1;
    if (mois === 0) { mois = 12; annee -= 1; }
  }
  return cles.map((cle) => ({ key: cle, label: libellePeriode(cle), months: moisDePeriode(cle), enCours: moisDePeriode(cle).includes(moisCourant) }));
}

// TVA mois par mois avec report du crédit de TVA : quand la TVA déductible dépasse la
// TVA facturée, l'excédent est un crédit qui vient en déduction des mois suivants.
// collectee / deductible : { 'AAAA-MM': montant }. Renvoie { 'AAAA-MM': {...} } pour chaque
// mois, du premier mouvement jusqu'au mois `jusqua`.
function chaineTva(collectee, deductible, jusqua) {
  const mois = [...new Set([...Object.keys(collectee), ...Object.keys(deductible)])].sort();
  const sortie = {};
  if (mois.length === 0) return sortie;
  let [annee, m] = mois[0].split('-').map(Number);
  let credit = 0;
  for (;;) {
    const cle = `${annee}-${String(m).padStart(2, '0')}`;
    if (cle > jusqua) break;
    const facturee = arrondi(collectee[cle] || 0);
    const deduc = arrondi(deductible[cle] || 0);
    const net = arrondi(facturee - deduc);
    const creditReporte = credit;
    let utilise = 0;
    let du = 0;
    if (net >= 0) {
      utilise = Math.min(credit, net);
      du = arrondi(net - utilise);
      credit = arrondi(credit - utilise);
    } else {
      credit = arrondi(credit - net);
    }
    sortie[cle] = {
      collectee: facturee, deductible: deduc, creditReporte, creditUtilise: utilise,
      creditAReporter: net < 0 ? arrondi(-net) : 0, creditDisponible: credit, du,
    };
    m += 1;
    if (m === 13) { m = 1; annee += 1; }
  }
  return sortie;
}

async function lireFrequenceCotisations(db, merchantId) {
  const r = await db.query(`SELECT contributions_frequency FROM accounting_tax_settings WHERE merchant_id = $1`, [merchantId]);
  return r.rows[0]?.contributions_frequency || 'monthly';
}

router.get('/tax-settings', async (req, res) => {
  try {
    res.json({ contributionsFrequency: await lireFrequenceCotisations(pool, req.user.merchantId) });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la lecture des paramètres.');
  }
});

router.put('/tax-settings', async (req, res) => {
  const { contributionsFrequency } = req.body;
  if (!FREQUENCES.includes(contributionsFrequency)) {
    return res.status(400).json({ error: 'Périodicité invalide (mensuelle, trimestrielle ou semestrielle).' });
  }
  try {
    await pool.query(
      `INSERT INTO accounting_tax_settings (merchant_id, contributions_frequency, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (merchant_id) DO UPDATE SET contributions_frequency = EXCLUDED.contributions_frequency, updated_at = now()`,
      [req.user.merchantId, contributionsFrequency]
    );
    await logActivity({
      merchantId: req.user.merchantId, userId: req.user.id, action: 'accounting_tax_settings',
      description: `a choisi la périodicité des cotisations : ${{ monthly: 'mensuelle', quarterly: 'trimestrielle', semiannual: 'semestrielle' }[contributionsFrequency]}`,
    });
    res.json({ contributionsFrequency });
  } catch (err) {
    repondreErreur(res, err, "Erreur lors de l'enregistrement des paramètres.");
  }
});

// GET /accounting/state-dues — ce qui est dû à l'État et aux organismes sociaux :
// par période (impôts : mois ; cotisations : périodicité du manager) et en cumul.
router.get('/state-dues', async (req, res) => {
  const date = req.query.date || aujourdhui();
  if (!dateOk(date)) return res.status(400).json({ error: 'Date invalide.' });
  try {
    const merchantId = req.user.merchantId;
    const frequence = await lireFrequenceCotisations(pool, merchantId);
    const rows = await agreger(merchantId, null, date);
    const solde = (code, sens) => {
      const r = rows.find((x) => x.code === code);
      return r ? arrondi(sens === 'credit' ? r.credit - r.debit : r.debit - r.credit) : 0;
    };
    const dettes = Object.entries(DETTES_ETAT).map(([type, d]) => {
      if (type === 'tva') {
        const collectee = solde('443', 'credit');
        const deductible = solde('445', 'debit');
        return { type, code: d.code, label: 'TVA nette à reverser', du: arrondi(collectee - deductible), collectee, deductible };
      }
      return { type, code: d.code, label: d.label, du: solde(d.code, 'credit') };
    });

    // Montants à payer par mois (hors paiements déjà faits à l'État).
    const mouvements = await pool.query(
      `SELECT to_char(e.entry_date, 'YYYY-MM') AS m, a.code, COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
       FROM accounting_lines l JOIN accounting_entries e ON e.id = l.entry_id JOIN accounting_accounts a ON a.id = l.account_id
       WHERE l.merchant_id = $1 AND a.code IN ('443', '445', '447', '442', '431', '432')
         AND e.entry_date <= $2::date AND e.source_type <> 'paiement_etat'
       GROUP BY 1, 2`,
      [merchantId, date]
    );
    const acc = { collectee: {}, deductible: {}, retenues: {}, cfce: {}, css: {}, ipres: {} };
    const ajouter = (famille, m, v) => { acc[famille][m] = arrondi((acc[famille][m] || 0) + v); };
    for (const r of mouvements.rows) {
      const d = Number(r.d);
      const c = Number(r.c);
      if (r.code === '443') ajouter('collectee', r.m, c - d);
      else if (r.code === '445') ajouter('deductible', r.m, d - c);
      else if (r.code === '447') ajouter('retenues', r.m, c - d);
      else if (r.code === '442') ajouter('cfce', r.m, c - d);
      else if (r.code === '431') ajouter('css', r.m, c - d);
      else if (r.code === '432') ajouter('ipres', r.m, c - d);
    }

    // Paiements déjà faits, rattachés à la période affichée.
    const paiements = await pool.query(
      `SELECT kind, period, COALESCE(SUM(amount), 0) AS montant FROM accounting_state_payments
       WHERE merchant_id = $1 AND cancelled = false AND period IS NOT NULL AND kind <> 'is' GROUP BY kind, period`,
      [merchantId]
    );
    const payes = {};
    for (const p of paiements.rows) {
      const freq = COTISATIONS_ETAT.includes(p.kind) ? frequence : 'monthly';
      const cle = cleDepuisMois(moisDePeriode(p.period)[0], freq);
      payes[p.kind] = payes[p.kind] || {};
      payes[p.kind][cle] = arrondi((payes[p.kind][cle] || 0) + Number(p.montant));
    }

    const tvaParMois = chaineTva(acc.collectee, acc.deductible, date.slice(0, 7));
    const somme = (famille, mois) => arrondi(mois.reduce((t, m) => t + (acc[famille][m] || 0), 0));
    const construire = (types, freq) => periodesRecentes(freq, date).map((p) => ({
      key: p.key, label: p.label, enCours: p.enCours,
      lignes: types.map((type) => {
        const paye = payes[type]?.[p.key] || 0;
        if (type === 'tva') {
          const t = tvaParMois[p.months[0]] || { collectee: 0, deductible: 0, creditReporte: 0, creditUtilise: 0, creditAReporter: 0, creditDisponible: 0, du: 0 };
          return { type, label: 'TVA', du: t.du, paye, reste: arrondi(t.du - paye), ...t };
        }
        const du = somme(type, p.months);
        return { type, label: DETTES_ETAT[type].label, du, paye, reste: arrondi(du - paye) };
      }),
    }));

    res.json({
      date, frequency: frequence, dettes,
      impots: construire(IMPOTS_MENSUELS, 'monthly'),
      cotisations: construire(COTISATIONS_ETAT, frequence),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul des dettes envers l\'État.' });
  }
});

router.get('/state-payments', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.kind, p.period, p.amount, p.offset_amount, p.payment_method, p.payment_date, p.note, p.cancelled, p.created_at,
              e.entry_number, u.full_name AS paid_by_name
       FROM accounting_state_payments p
       LEFT JOIN accounting_entries e ON e.id = p.entry_id
       LEFT JOIN users u ON u.id = p.paid_by
       WHERE p.merchant_id = $1
       ORDER BY p.payment_date DESC, p.created_at DESC
       LIMIT 200`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des paiements.' });
  }
});

router.post('/state-payments', async (req, res) => {
  const { type, paymentMethod, paymentDate, period: periodeSaisie, note, warehouseId } = req.body;
  const period = type === 'is' ? null : periodeSaisie;
  const dette = DETTES_ETAT[type];
  const montant = arrondi(req.body.amount);
  const date = paymentDate || aujourdhui();
  if (!dette) return res.status(400).json({ error: 'Type de paiement invalide.' });
  if (!(montant > 0)) return res.status(400).json({ error: 'Le montant doit être positif.' });
  if (!MODES_ETAT.includes(paymentMethod)) return res.status(400).json({ error: 'Mode de paiement invalide.' });
  if (!dateOk(date) || date > aujourdhui()) return res.status(400).json({ error: 'Date de paiement invalide.' });
  if (dette && type !== 'is' && !(IMPOTS_MENSUELS.includes(type) ? MOIS_RE.test(period || '') : PERIODE_ETAT_RE.test(period || ''))) {
    return res.status(400).json({ error: 'Choisissez la période concernée par ce paiement.' });
  }
  const commentaire = note ? String(note).trim().slice(0, 200) : null;
  const merchantId = req.user.merchantId;
  const enCaisse = paymentMethod !== 'virement';
  if (enCaisse && !UUID_RE.test(String(warehouseId || ''))) {
    return res.status(400).json({ error: 'Choisissez la boutique dont la caisse effectue le paiement.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    await verifierExerciceOuvert(client, merchantId, date);
    let boutique = null;
    if (enCaisse) {
      const w = await client.query(`SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2`, [warehouseId, merchantId]);
      if (w.rows.length === 0) throw erreurMetier(400, 'Boutique introuvable.');
      await verifierCaisse(req, client, merchantId, warehouseId, paymentMethod, montant);
      boutique = warehouseId;
    }
    const codeTreso = COMPTE_PAR_MODE[paymentMethod];
    const compteDette = await assurerCompte(client, merchantId, dette.code, dette.nomCompte);
    const compteTreso = await assurerCompte(client, merchantId, codeTreso, NOM_TRESORERIE[codeTreso]);
    const journal = await client.query(
      `SELECT id FROM accounting_journals WHERE merchant_id = $1 AND code = $2`,
      [merchantId, JOURNAL_PAR_MODE[paymentMethod]]
    );
    if (journal.rows.length === 0) throw erreurMetier(400, `Le journal ${JOURNAL_PAR_MODE[paymentMethod]} est introuvable dans votre plan comptable.`);

    const libelle = `Paiement ${dette.label}${period ? ` — ${libellePeriode(period)}` : ''}`;
    // TVA : la TVA déductible (445) se compense avec la TVA facturée (443). Le
    // montant versé est le net ; la compensation est calculée automatiquement.
    let compensation = 0;
    if (type === 'tva') {
      // La TVA déductible du mois (et le crédit reporté des mois précédents) se compense avec la TVA facturée.
      const mvt = await client.query(
        `SELECT to_char(e.entry_date, 'YYYY-MM') AS m, a.code, COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
         FROM accounting_lines l JOIN accounting_entries e ON e.id = l.entry_id JOIN accounting_accounts a ON a.id = l.account_id
         WHERE l.merchant_id = $1 AND a.code IN ('443', '445') AND e.entry_date <= $2::date
           AND e.source_type <> 'paiement_etat' GROUP BY 1, 2`,
        [merchantId, date]
      );
      const facturee = {};
      const deduc = {};
      for (const r of mvt.rows) {
        if (r.code === '443') facturee[r.m] = arrondi((facturee[r.m] || 0) + Number(r.c) - Number(r.d));
        else deduc[r.m] = arrondi((deduc[r.m] || 0) + Number(r.d) - Number(r.c));
      }
      const mois = chaineTva(facturee, deduc, period)[period] || { collectee: 0, deductible: 0, creditUtilise: 0 };
      const deja = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS net, COALESCE(SUM(offset_amount), 0) AS comp FROM accounting_state_payments
         WHERE merchant_id = $1 AND kind = 'tva' AND period = $2 AND cancelled = false`,
        [merchantId, period]
      );
      const restant443 = arrondi(mois.collectee - Number(deja.rows[0].net) - Number(deja.rows[0].comp));
      const compensable = Math.max(0, arrondi(Math.max(0, mois.deductible) + mois.creditUtilise - Number(deja.rows[0].comp)));
      // On ne peut pas créditer 445 au-delà de son solde débiteur.
      const solde445 = await client.query(
        `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS solde FROM accounting_lines l
         JOIN accounting_entries e ON e.id = l.entry_id JOIN accounting_accounts a ON a.id = l.account_id
         WHERE l.merchant_id = $1 AND a.code = '445' AND e.entry_date <= $2::date`,
        [merchantId, date]
      );
      compensation = Math.min(compensable, Math.max(0, arrondi(restant443 - montant)), Math.max(0, arrondi(Number(solde445.rows[0].solde))));
    }
    const compteTvaDeductible = compensation > 0
      ? await assurerCompte(client, merchantId, '445', 'État, TVA récupérable sur achats')
      : null;
    let depenseId = null;
    if (enCaisse) {
      const d = await client.query(
        `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7) RETURNING id`,
        [merchantId, req.user.id, paymentMethod, montant, `${MOTIF_ETAT}${dette.label}${period ? ` ${period}` : ''}`, date, boutique]
      );
      depenseId = d.rows[0].id;
    }
    const paiement = await client.query(
      `INSERT INTO accounting_state_payments (merchant_id, kind, period, amount, payment_method, payment_date, note, cash_expense_id, paid_by, offset_amount)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10) RETURNING id`,
      [merchantId, type, period || null, montant, paymentMethod, date, commentaire, depenseId, req.user.id, compensation]
    );
    const num = await client.query(`SELECT COALESCE(MAX(entry_number), 0) + 1 AS n FROM accounting_entries WHERE merchant_id = $1`, [merchantId]);
    const entree = await client.query(
      `INSERT INTO accounting_entries (merchant_id, journal_id, entry_number, entry_date, reference, label, source_type, source_id, created_by)
       VALUES ($1, $2, $3, $4::date, $5, $6, 'paiement_etat', $7, $8) RETURNING id, entry_number`,
      [merchantId, journal.rows[0].id, Number(num.rows[0].n), date, `ETAT-${type.toUpperCase()}`, libelle, paiement.rows[0].id, req.user.id]
    );
    await client.query(
      `INSERT INTO accounting_lines (entry_id, merchant_id, account_id, debit, credit, label) VALUES ($1, $2, $3, $4, 0, $5)`,
      [entree.rows[0].id, merchantId, compteDette, arrondi(montant + compensation), libelle]
    );
    await client.query(
      `INSERT INTO accounting_lines (entry_id, merchant_id, account_id, debit, credit, label) VALUES ($1, $2, $3, 0, $4, $5)`,
      [entree.rows[0].id, merchantId, compteTreso, montant, libelle]
    );
    if (compensation > 0) {
      await client.query(
        `INSERT INTO accounting_lines (entry_id, merchant_id, account_id, debit, credit, label) VALUES ($1, $2, $3, 0, $4, $5)`,
        [entree.rows[0].id, merchantId, compteTvaDeductible, compensation, `${libelle} — TVA déductible compensée`]
      );
    }
    await client.query(`UPDATE accounting_state_payments SET entry_id = $1 WHERE id = $2`, [entree.rows[0].id, paiement.rows[0].id]);
    await client.query('COMMIT');
    await logActivity({
      merchantId, userId: req.user.id, action: 'accounting_state_payment',
      description: `a enregistré le paiement « ${libelle} » (${Math.round(montant).toLocaleString('fr-FR')} FCFA)`,
    });
    res.status(201).json({ id: paiement.rows[0].id, entryNumber: entree.rows[0].entry_number, compensation });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, 'Erreur lors de l\'enregistrement du paiement.');
  } finally {
    client.release();
  }
});

router.delete('/state-payments/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Paiement introuvable.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, req.user.merchantId);
    const p = await client.query(
      `SELECT id, entry_id, cash_expense_id, kind, to_char(payment_date, 'YYYY-MM-DD') AS d FROM accounting_state_payments
       WHERE id = $1 AND merchant_id = $2 AND cancelled = false FOR UPDATE`,
      [req.params.id, req.user.merchantId]
    );
    if (p.rows.length === 0) throw erreurMetier(404, 'Paiement introuvable.');
    await verifierExerciceOuvert(client, req.user.merchantId, p.rows[0].d);
    if (p.rows[0].entry_id) {
      await client.query(`DELETE FROM accounting_entries WHERE id = $1 AND merchant_id = $2`, [p.rows[0].entry_id, req.user.merchantId]);
    }
    if (p.rows[0].cash_expense_id) {
      await client.query(`DELETE FROM cash_expenses WHERE id = $1 AND merchant_id = $2`, [p.rows[0].cash_expense_id, req.user.merchantId]);
    }
    await client.query(`UPDATE accounting_state_payments SET cancelled = true WHERE id = $1`, [req.params.id]);
    await client.query('COMMIT');
    await logActivity({
      merchantId: req.user.merchantId, userId: req.user.id, action: 'accounting_state_payment_cancelled',
      description: `a annulé un paiement à l'État (${DETTES_ETAT[p.rows[0].kind]?.label || p.rows[0].kind})`,
    });
    res.json({ message: 'Paiement annulé.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de l'annulation du paiement.");
  } finally {
    client.release();
  }
});

// ---------- Impôt sur les résultats et clôture d'exercice ----------
// L'exercice est l'année civile. Clôturer un exercice le fige : plus aucune écriture
// (manuelle, charge, paiement à l'État, synchro automatique) ne peut y être ajoutée,
// modifiée ou supprimée. Les soldes des comptes de bilan se reportent d'eux-mêmes sur
// l'exercice suivant ; le résultat se cumule dans le bilan.

async function anneesCloturees(db, merchantId) {
  const r = await db.query(`SELECT year FROM accounting_fiscal_years WHERE merchant_id = $1`, [merchantId]);
  return new Set(r.rows.map((x) => Number(x.year)));
}

async function verifierExerciceOuvert(db, merchantId, dateStr) {
  const annee = Number(String(dateStr).slice(0, 4));
  const closes = await anneesCloturees(db, merchantId);
  if (closes.has(annee)) {
    throw erreurMetier(400, `L'exercice ${annee} est clôturé : aucune écriture ne peut plus y être ajoutée, modifiée ou supprimée.`);
  }
}

const TAUX_IS_DEFAUT = 30;

// Résultat comptable de l'année avant impôt sur les résultats (comptes 89 exclus).
async function resultatAvantImpot(merchantId, annee) {
  const rows = await agreger(merchantId, `${annee}-01-01`, `${annee}-12-31`);
  return arrondi(
    rows
      .filter((r) => ['6', '7', '8'].includes(r.code[0]) && !r.code.startsWith('89'))
      .reduce((s, r) => s + r.credit - r.debit, 0)
  );
}

function lireParametresIs(source) {
  const taux = source.rate === undefined || source.rate === '' ? TAUX_IS_DEFAUT : Number(source.rate);
  const minimum = source.minimum === undefined || source.minimum === '' ? 0 : Number(source.minimum);
  if (!Number.isFinite(taux) || taux < 0 || taux > 100) throw erreurMetier(400, "Le taux de l'impôt est invalide.");
  if (!Number.isFinite(minimum) || minimum < 0) throw erreurMetier(400, 'Le minimum fiscal est invalide.');
  return { taux, minimum: arrondi(minimum) };
}

function lireAnnee(valeur) {
  const annee = Number(valeur);
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) throw erreurMetier(400, 'Année invalide.');
  return annee;
}

const impotCalcule = (resultat, { taux, minimum }) =>
  Math.max(arrondi((Math.max(0, resultat) * taux) / 100), minimum);

async function impotComptabilise(db, merchantId, annee) {
  const r = await db.query(
    `SELECT COALESCE(SUM(l.debit), 0) AS montant
     FROM accounting_entries e JOIN accounting_lines l ON l.entry_id = e.id
     WHERE e.merchant_id = $1 AND e.source_type = 'impot_is' AND e.source_id = $2`,
    [merchantId, `is-${annee}`]
  );
  const montant = Number(r.rows[0].montant);
  return montant > 0 ? montant : null;
}

router.get('/fiscal-years', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT year, result_before_tax, tax_amount, net_result, closed_at FROM accounting_fiscal_years
       WHERE merchant_id = $1 ORDER BY year DESC`,
      [req.user.merchantId]
    );
    res.json(r.rows);
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la récupération des exercices.');
  }
});

// GET /accounting/closing-preview?year=&rate=&minimum= — situation d'un exercice avant clôture.
router.get('/closing-preview', async (req, res) => {
  try {
    const annee = lireAnnee(req.query.year);
    const params = lireParametresIs(req.query);
    const merchantId = req.user.merchantId;
    const closes = await anneesCloturees(pool, merchantId);
    const resultat = await resultatAvantImpot(merchantId, annee);
    const comptabilise = await impotComptabilise(pool, merchantId, annee);
    const rows = await agreger(merchantId, null, `${annee}-12-31`);
    const totalDebit = arrondi(rows.reduce((t, r) => t + r.debit, 0));
    const totalCredit = arrondi(rows.reduce((t, r) => t + r.credit, 0));
    const propose = impotCalcule(resultat, params);
    const termine = annee < Number(aujourdhui().slice(0, 4));
    const controles = [
      { id: 'termine', ok: termine, label: termine ? `L'année ${annee} est terminée.` : `L'année ${annee} n'est pas terminée : clôture impossible.` },
      { id: 'equilibre', ok: totalDebit === totalCredit, label: totalDebit === totalCredit ? 'La balance est équilibrée.' : 'La balance est déséquilibrée.' },
      {
        id: 'impot', ok: resultat <= 0 || comptabilise !== null,
        label: resultat <= 0 ? "Pas d'impôt à comptabiliser (résultat nul ou négatif)." : comptabilise !== null
          ? "L'impôt sur les résultats est comptabilisé." : "L'impôt sur les résultats n'est pas encore comptabilisé.",
      },
    ];
    res.json({
      year: annee, closed: closes.has(annee), rate: params.taux, minimum: params.minimum,
      resultBeforeTax: resultat, taxProposed: propose, taxBooked: comptabilise,
      netResult: arrondi(resultat - (comptabilise || 0)),
      checks: controles,
      canClose: !closes.has(annee) && controles.every((c) => c.ok),
    });
  } catch (err) {
    repondreErreur(res, err, "Erreur lors de l'analyse de l'exercice.");
  }
});

// POST /accounting/income-tax {year, rate, minimum} — comptabilise (ou recalcule) l'impôt :
// débit 891 « Impôts sur les bénéfices », crédit 441 « État, impôts sur les bénéfices ».
router.post('/income-tax', async (req, res) => {
  const client = await pool.connect();
  try {
    const annee = lireAnnee(req.body.year);
    const params = lireParametresIs(req.body);
    const merchantId = req.user.merchantId;
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    await verifierExerciceOuvert(client, merchantId, `${annee}-12-31`);
    const resultat = await resultatAvantImpot(merchantId, annee);
    const montant = impotCalcule(resultat, params);
    await client.query(`DELETE FROM accounting_entries WHERE merchant_id = $1 AND source_type = 'impot_is' AND source_id = $2`, [merchantId, `is-${annee}`]);
    if (montant > 0) {
      const compteCharge = await assurerCompte(client, merchantId, '891', 'Impôts sur les bénéfices');
      const compteDette = await assurerCompte(client, merchantId, '441', 'État, impôts sur les bénéfices');
      const journal = await client.query(`SELECT id FROM accounting_journals WHERE merchant_id = $1 AND code = 'OD'`, [merchantId]);
      if (journal.rows.length === 0) throw erreurMetier(400, "Le journal des opérations diverses (OD) est introuvable dans votre plan comptable.");
      const fin = `${annee}-12-31`;
      const date = fin <= aujourdhui() ? fin : aujourdhui();
      const num = await client.query(`SELECT COALESCE(MAX(entry_number), 0) + 1 AS n FROM accounting_entries WHERE merchant_id = $1`, [merchantId]);
      const libelle = `Impôt sur les résultats ${annee}`;
      const entree = await client.query(
        `INSERT INTO accounting_entries (merchant_id, journal_id, entry_number, entry_date, reference, label, source_type, source_id, created_by)
         VALUES ($1, $2, $3, $4::date, $5, $6, 'impot_is', $7, $8) RETURNING id`,
        [merchantId, journal.rows[0].id, Number(num.rows[0].n), date, `IS-${annee}`, libelle, `is-${annee}`, req.user.id]
      );
      await client.query(`INSERT INTO accounting_lines (entry_id, merchant_id, account_id, debit, credit, label) VALUES ($1, $2, $3, $4, 0, $5)`,
        [entree.rows[0].id, merchantId, compteCharge, montant, libelle]);
      await client.query(`INSERT INTO accounting_lines (entry_id, merchant_id, account_id, debit, credit, label) VALUES ($1, $2, $3, 0, $4, $5)`,
        [entree.rows[0].id, merchantId, compteDette, montant, libelle]);
    }
    await client.query('COMMIT');
    await logActivity({
      merchantId, userId: req.user.id, action: 'accounting_income_tax',
      description: `a comptabilisé l'impôt sur les résultats ${annee} (${Math.round(montant).toLocaleString('fr-FR')} FCFA)`,
    });
    res.json({ year: annee, resultBeforeTax: resultat, tax: montant });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de la comptabilisation de l'impôt.");
  } finally {
    client.release();
  }
});

router.post('/fiscal-years/:year/close', async (req, res) => {
  const client = await pool.connect();
  try {
    const annee = lireAnnee(req.params.year);
    const merchantId = req.user.merchantId;
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    if ((await anneesCloturees(client, merchantId)).has(annee)) throw erreurMetier(400, `L'exercice ${annee} est déjà clôturé.`);
    if (annee >= Number(aujourdhui().slice(0, 4))) throw erreurMetier(400, `L'exercice ${annee} n'est pas terminé.`);
    const rows = await agreger(merchantId, null, `${annee}-12-31`);
    if (arrondi(rows.reduce((t, r) => t + r.debit, 0)) !== arrondi(rows.reduce((t, r) => t + r.credit, 0))) {
      throw erreurMetier(400, 'La balance est déséquilibrée : corrigez-la avant de clôturer.');
    }
    const avant = await resultatAvantImpot(merchantId, annee);
    const impot = await impotComptabilise(client, merchantId, annee);
    if (avant > 0 && impot === null && req.body.withoutIncomeTax !== true) {
      throw erreurMetier(400, "L'impôt sur les résultats n'est pas comptabilisé : comptabilisez-le avant de clôturer.");
    }
    await client.query(
      `INSERT INTO accounting_fiscal_years (merchant_id, year, result_before_tax, tax_amount, net_result, closed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [merchantId, annee, avant, impot || 0, arrondi(avant - (impot || 0)), req.user.id]
    );
    await client.query('COMMIT');
    await logActivity({
      merchantId, userId: req.user.id, action: 'accounting_year_closed',
      description: `a clôturé l'exercice comptable ${annee}`,
    });
    res.json({ year: annee, resultBeforeTax: avant, tax: impot || 0, netResult: arrondi(avant - (impot || 0)) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de la clôture de l'exercice.");
  } finally {
    client.release();
  }
});

// Seul le dernier exercice clôturé peut être rouvert.
router.post('/fiscal-years/:year/reopen', async (req, res) => {
  const client = await pool.connect();
  try {
    const annee = lireAnnee(req.params.year);
    const merchantId = req.user.merchantId;
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const closes = [...(await anneesCloturees(client, merchantId))];
    if (!closes.includes(annee)) throw erreurMetier(404, `L'exercice ${annee} n'est pas clôturé.`);
    if (annee !== Math.max(...closes)) throw erreurMetier(400, `Rouvrez d'abord l'exercice ${Math.max(...closes)} : seul le dernier exercice clôturé peut être rouvert.`);
    await client.query(`DELETE FROM accounting_fiscal_years WHERE merchant_id = $1 AND year = $2`, [merchantId, annee]);
    await client.query('COMMIT');
    await logActivity({
      merchantId, userId: req.user.id, action: 'accounting_year_reopened',
      description: `a rouvert l'exercice comptable ${annee}`,
    });
    res.json({ year: annee });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de la réouverture de l'exercice.");
  } finally {
    client.release();
  }
});

// ---------- PDF des états comptables ----------
// POST /accounting/pdf {entreprise, titre, periode, sections:[{titre?, colonnes:[{label, align?}], lignes}]}
// où une ligne est un tableau de cellules ou { fort: true, cells: [...] }. Renvoie un PDF
// noir et blanc que la page affiche en aperçu (télécharger / imprimer). Sert au journal,
// au grand livre, aux balances, au compte de résultat et au bilan.

const nettoyerTexte = (v) => String(v ?? '').replace(/[\u202f\u00a0\u2009]/g, ' ').slice(0, 400);

router.post('/pdf', async (req, res) => {
  const { entreprise, titre, periode, sections } = req.body || {};
  if (!Array.isArray(sections) || sections.length === 0 || sections.length > 2000) {
    return res.status(400).json({ error: 'Contenu du PDF invalide.' });
  }
  let nbLignes = 0;
  for (const sec of sections) {
    if (!sec || !Array.isArray(sec.colonnes) || sec.colonnes.length === 0 || sec.colonnes.length > 12 || !Array.isArray(sec.lignes)) {
      return res.status(400).json({ error: 'Contenu du PDF invalide.' });
    }
    nbLignes += sec.lignes.length;
  }
  if (nbLignes > 30000) return res.status(400).json({ error: 'Trop de lignes pour un seul PDF : réduisez la période.' });

  const maxColonnes = Math.max(...sections.map((x) => x.colonnes.length));
  const doc = new PDFDocument({ size: 'A4', layout: maxColonnes >= 6 ? 'landscape' : 'portrait', margin: 36, bufferPages: true });
  doc.on('error', (e) => console.error('pdfkit (comptabilité) :', e));
  const nomFichier = nettoyerTexte(titre || 'etat').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'etat';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nomFichier}.pdf"`);
  doc.pipe(res);

  const gauche = doc.page.margins.left;
  const largeur = doc.page.width - gauche - doc.page.margins.right;
  const bas = () => doc.page.height - doc.page.margins.bottom - 18;

  doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(nettoyerTexte(entreprise), gauche, doc.y, { width: largeur });
  doc.font('Helvetica-Bold').fontSize(16).text(nettoyerTexte(titre), { width: largeur });
  if (periode) doc.font('Helvetica').fontSize(10).text(nettoyerTexte(periode), { width: largeur });
  doc.moveDown(0.6);

  for (const sec of sections) {
    const n = sec.colonnes.length;
    // Largeurs : proportionnelles au contenu (bornées), les montants restent compacts.
    const poids = sec.colonnes.map((c, i) => {
      const longueur = Math.max(String(c.label || '').length, ...sec.lignes.slice(0, 300).map((l) => {
        const cells = Array.isArray(l) ? l : l?.cells || [];
        return nettoyerTexte(cells[i]).length;
      }));
      return Math.min(Math.max(longueur, 6), c.align === 'right' ? 16 : 44);
    });
    const total = poids.reduce((a, b) => a + b, 0);
    const largeurs = poids.map((w) => (w / total) * largeur);
    const x = (i) => gauche + largeurs.slice(0, i).reduce((a, b) => a + b, 0);

    const dessinerEntete = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5);
      const h = Math.max(...sec.colonnes.map((c, i) => doc.heightOfString(nettoyerTexte(c.label), { width: largeurs[i] - 6 }))) + 6;
      sec.colonnes.forEach((c, i) => doc.text(nettoyerTexte(c.label), x(i) + 3, y + 3, { width: largeurs[i] - 6, align: c.align === 'right' ? 'right' : 'left' }));
      doc.moveTo(gauche, y + h).lineTo(gauche + largeur, y + h).lineWidth(0.8).strokeColor('#000').stroke();
      doc.y = y + h + 2;
    };

    if (doc.y + 60 > bas()) doc.addPage();
    if (sec.titre) doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(nettoyerTexte(sec.titre), gauche, doc.y, { width: largeur });
    dessinerEntete();

    for (const ligne of sec.lignes) {
      const fort = !Array.isArray(ligne) && ligne?.fort === true;
      const cells = Array.isArray(ligne) ? ligne : ligne?.cells || [];
      doc.font(fort ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      const h = Math.max(...sec.colonnes.map((c, i) => doc.heightOfString(nettoyerTexte(cells[i]), { width: largeurs[i] - 6 }))) + 4;
      if (doc.y + h > bas()) {
        doc.addPage();
        dessinerEntete();
        doc.font(fort ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      }
      const y = doc.y;
      sec.colonnes.forEach((c, i) => {
        doc.text(nettoyerTexte(cells[i]), x(i) + 3, y + 2, { width: largeurs[i] - 6, align: c.align === 'right' ? 'right' : 'left' });
      });
      if (fort) doc.moveTo(gauche, y + h - 1).lineTo(gauche + largeur, y + h - 1).lineWidth(0.4).strokeColor('#000').stroke();
      doc.y = y + h;
    }
    doc.moveDown(0.8);
  }

  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(pages.start + i);
    doc.font('Helvetica').fontSize(8).fillColor('#000');
    // Le pied de page s'écrit dans la marge basse : on l'annule le temps de l'écrire,
    // sinon pdfkit ajoute une page blanche après chaque page.
    const margeBasse = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const piedY = doc.page.height - margeBasse + 6;
    doc.text(`Page ${i + 1} / ${pages.count}`, gauche, piedY, { width: largeur, align: 'right', lineBreak: false });
    doc.text(`Édité le ${new Date().toLocaleDateString('fr-FR')}`, gauche, piedY, { width: largeur, align: 'left', lineBreak: false });
    doc.page.margins.bottom = margeBasse;
  }
  doc.end();
});

// ---------- Synchronisation automatique ----------

const DELAI_SYNCHRO_MS = 30000;
const ETAT_SYNCHRO = new Map(); // merchantId -> { at, dernier, enCours }
const PLAN_VERIFIE = new Set();

// Insère des écritures automatiques par paquets de 500 (indispensable à la
// première synchronisation, qui peut reprendre des milliers de ventes).
async function creerEnLot(client, merchantId, userId, type, lot) {
  if (lot.length === 0) return;
  const base = await client.query(
    `SELECT COALESCE(MAX(entry_number), 0) AS n FROM accounting_entries WHERE merchant_id = $1`,
    [merchantId]
  );
  let numero = Number(base.rows[0].n);
  for (let i = 0; i < lot.length; i += 500) {
    const morceau = lot.slice(i, i + 500);
    const numeros = morceau.map(() => ++numero);
    const ins = await client.query(
      `INSERT INTO accounting_entries (merchant_id, journal_id, entry_number, entry_date, reference, label, source_type, source_id, source_sig, created_by)
       SELECT $1::uuid, t.j, t.n, t.d::date, t.r, t.l, $2::text, t.sid, t.sig, $3::uuid
       FROM unnest($4::uuid[], $5::bigint[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[]) AS t(j, n, d, r, l, sid, sig)
       RETURNING id, source_id`,
      [merchantId, type, userId || null, morceau.map((e) => e.journalId), numeros, morceau.map((e) => e.date),
        morceau.map((e) => e.reference || null), morceau.map((e) => e.label), morceau.map((e) => e.sourceId), morceau.map((e) => e.sig)]
    );
    const idParSource = new Map(ins.rows.map((r) => [r.source_id, r.id]));
    const entrees = [];
    const comptes = [];
    const debits = [];
    const credits = [];
    const libelles = [];
    for (const e of morceau) {
      for (const l of e.lignes) {
        entrees.push(idParSource.get(e.sourceId));
        comptes.push(l.accountId);
        debits.push(l.debit);
        credits.push(l.credit);
        libelles.push(e.label);
      }
    }
    await client.query(
      `INSERT INTO accounting_lines (entry_id, merchant_id, account_id, debit, credit, label)
       SELECT t.e, $1::uuid, t.a, t.d, t.c, t.l
       FROM unnest($2::uuid[], $3::uuid[], $4::numeric[], $5::numeric[], $6::text[]) AS t(e, a, d, c, l)`,
      [merchantId, entrees, comptes, debits, credits, libelles]
    );
  }
}

// Compare les écritures voulues (calculées depuis la source) à celles déjà
// générées : supprime ce qui n'existe plus ou a changé, crée ce qui manque.
async function reconcilier(client, merchantId, userId, refs, type, voulues) {
  const existantes = await client.query(
    `SELECT id, source_id, source_sig, to_char(entry_date, 'YYYY-MM-DD') AS d FROM accounting_entries WHERE merchant_id = $1 AND source_type = $2`,
    [merchantId, type]
  );
  // Un exercice clôturé est figé : la synchro ne crée, ne modifie ni ne supprime rien dedans.
  const closes = await anneesCloturees(client, merchantId);
  const parSource = new Map(voulues.map((v) => [v.sourceId, v]));
  const ok = new Set();
  const aSupprimer = [];
  for (const ex of existantes.rows) {
    if (closes.has(Number(ex.d.slice(0, 4)))) {
      ok.add(ex.source_id);
      continue;
    }
    const v = parSource.get(ex.source_id);
    if (v && v.sig === ex.source_sig && !ok.has(ex.source_id)) ok.add(ex.source_id);
    else aSupprimer.push(ex.id);
  }
  if (aSupprimer.length > 0) {
    await client.query(`DELETE FROM accounting_entries WHERE merchant_id = $1 AND id = ANY($2::uuid[])`, [merchantId, aSupprimer]);
  }
  const aCreer = [];
  const erreurs = [];
  for (const v of voulues) {
    if (ok.has(v.sourceId)) continue;
    if (closes.has(Number(String(v.date).slice(0, 4)))) continue;
    const journalId = refs.journaux.get(v.journal);
    const lignes = v.lignes
      .filter((l) => l.debit > 0 || l.credit > 0)
      .map((l) => ({ accountId: refs.comptesParCode.get(l.compte), debit: l.debit, credit: l.credit }));
    if (!journalId || lignes.some((l) => !l.accountId)) {
      erreurs.push(`${type} : compte ou journal manquant pour « ${v.label} »`);
      continue;
    }
    const totalDebit = arrondi(lignes.reduce((t, l) => t + l.debit, 0));
    const totalCredit = arrondi(lignes.reduce((t, l) => t + l.credit, 0));
    if (totalDebit <= 0 || totalDebit !== totalCredit) {
      erreurs.push(`${type} : écriture déséquilibrée ignorée (« ${v.label} »)`);
      continue;
    }
    aCreer.push({ ...v, journalId, lignes });
  }
  await creerEnLot(client, merchantId, userId, type, aCreer);
  return { crees: aCreer.length, supprimees: aSupprimer.length, erreurs };
}

// --- Sources : chacune renvoie les écritures qu'elle doit produire ---

// Bulletins de paie : comptabilisés à la fin du mois concerné (ou aujourd'hui si
// le mois n'est pas terminé). Charge de personnel (661), charges sociales
// patronales (664) et CFCE (641) contre : personnel à payer (422xxx), CSS (431),
// IPRES (432), impôts retenus à la source (447) et CFCE à payer (442).
async function lirePaie(client, merchantId, debut, ctx) {
  const fin = `(to_date(p.month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date`;
  const r = await client.query(
    `SELECT p.id::text AS id, p.user_id::text AS user_id, p.month, p.gross_salary, p.net_a_payer,
            p.ipres_salarial, p.css_salarial, p.irpp, p.trimf, p.ipres_patronal, p.css_patronal, p.cfce, u.full_name,
            to_char(LEAST(${fin}, CURRENT_DATE), 'YYYY-MM-DD') AS d
     FROM payslips p JOIN users u ON u.id = p.user_id
     WHERE p.merchant_id = $1 AND ${fin} >= $2::date
     ORDER BY p.month, u.full_name`,
    [merchantId, debut]
  );
  const out = [];
  let ecarts = 0;
  for (const row of r.rows) {
    const n = (v) => arrondi(Number(v) || 0);
    const net = n(row.net_a_payer);
    const css = n(row.css_salarial);
    const ipres = n(row.ipres_salarial);
    const retenue = arrondi(n(row.irpp) + n(row.trimf));
    const patronal = arrondi(n(row.ipres_patronal) + n(row.css_patronal));
    const cfce = n(row.cfce);
    // Le brut est déduit du net et des retenues pour que l'écriture soit toujours équilibrée.
    const brut = arrondi(net + css + ipres + retenue);
    if (!(brut > 0)) continue;
    if (Math.abs(brut - n(row.gross_salary)) > 1) ecarts += 1;
    const personnel = await ctx.tiers.obtenir('personnel', row.user_id);
    out.push({
      sourceId: row.id, date: row.d, journal: 'OD', reference: `PAIE-${row.month}`,
      label: `Paie ${row.full_name} — ${row.month}`,
      sig: `${brut}|${net}|${css}|${ipres}|${retenue}|${patronal}|${cfce}|${row.d}|${row.user_id}|t3`,
      lignes: [
        ligne('661', brut, 0),
        ligne('664', patronal, 0),
        ligne('641', cfce, 0),
        ligne(personnel, 0, net),
        ligne('431', 0, arrondi(css + n(row.css_patronal))),
        ligne('432', 0, arrondi(ipres + n(row.ipres_patronal))),
        ligne('447', 0, retenue),
        ligne('442', 0, cfce),
      ],
    });
  }
  if (ecarts > 0) ctx.avertissements.push(`${ecarts} bulletin(s) de paie dont le brut ne correspond pas au net + retenues : le brut comptabilisé est celui déduit du net.`);
  return out;
}

// Salaires versés (net payé) : débit du personnel à payer (422xxx) quand le
// bulletin existe — il a déjà été comptabilisé —, sinon débit 661 ; crédit trésorerie.
async function lireSalaires(client, merchantId, debut, ctx) {
  const r = await client.query(
    `SELECT sp.id::text AS id, sp.user_id::text AS user_id, sp.month, sp.amount, sp.payment_method,
            to_char(sp.paid_at::date, 'YYYY-MM-DD') AS d, u.full_name, (p.id IS NOT NULL) AS bulletin
     FROM salary_payments sp
     JOIN users u ON u.id = sp.user_id
     LEFT JOIN payslips p ON p.user_id = sp.user_id AND p.month = sp.month
     WHERE u.merchant_id = $1 AND sp.paid_at::date >= $2::date
     ORDER BY sp.paid_at`,
    [merchantId, debut]
  );
  const out = [];
  for (const row of r.rows) {
    const montant = arrondi(row.amount);
    if (!(montant > 0)) continue;
    const mode = modeNormalise(row.payment_method);
    const [compte, journal] = tresorerie(mode === 'cheque' ? 'virement' : mode);
    const debit = row.bulletin ? await ctx.tiers.obtenir('personnel', row.user_id) : '661';
    out.push({
      sourceId: row.id, date: row.d, journal, reference: `SAL-${row.month}`,
      label: `Salaire ${row.full_name} — ${row.month}`,
      sig: `${montant}|${row.payment_method}|${row.d}|${row.full_name}|${row.bulletin}|t3`,
      lignes: [ligne(debit, montant, 0), ligne(compte, 0, montant)],
    });
  }
  return out;
}

// Mouvements de la page Caisse saisis à la main. Déjà repris ailleurs, donc ignorés :
// salaires, remboursements de retours, charges payées via le module, transferts
// entre boutiques. Le reste est classé par mots-clés du motif.
const REGLES_DEPENSES = [
  [/loyer/, '622'],
  [/electricite|courant|senelec|seneau|sen eau|\beau\b/, '605'],
  [/wifi|internet|telephone|forfait|sonatel/, '628'],
  [/assurance/, '625'],
  [/comptab|cabinet|honorair|avocat|conseil|notaire/, '632'],
  [/menuisi|reparation|entretien|maintenance|plomb|electricien|peinture|nettoyage/, '624'],
  [/livraison/, '612'],
  [/transport|taxi|carburant|essence|gasoil/, '618'],
  [/banque|bancaire|agios/, '631'],
  [/publicite|affiche|flyer|promotion/, '627'],
  [/impot|taxe|patente|dgid/, '641'],
];

async function lireCaisse(client, merchantId, debut, ctx) {
  const r = await client.query(
    `SELECT id::text AS id, movement_type, payment_method, amount, COALESCE(reason, '') AS reason, charge_account,
            to_char(expense_date, 'YYYY-MM-DD') AS d
     FROM cash_expenses
     WHERE merchant_id = $1 AND COALESCE(amount, 0) > 0
       AND (expense_date >= $2::date
            OR (movement_type = 'entree' AND (reason ILIKE 'solde de d%but%' OR reason ILIKE 'solde initial%')))
     ORDER BY expense_date, created_at`,
    [merchantId, debut]
  );
  const out = [];
  const nonClassees = [];
  let apports = 0;
  for (const row of r.rows) {
    const motif = sansAccent(row.reason).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const montant = arrondi(row.amount);
    const mode = modeNormalise(row.payment_method);
    const entree = row.movement_type === 'entree';
    let lignes;
    let journal;
    let date = row.d;
    let nom;
    let sigCharge = '';

    if (entree) {
      if (/^de la boutique/.test(motif)) continue; // transfert entre boutiques
      const [compte, j] = tresorerie(mode === 'cheque' ? 'especes' : mode);
      journal = j;
      if (/solde de debut|solde initial|solde d ouverture/.test(motif)) {
        if (date < debut) date = debut; // solde d'ouverture ramené au début de la comptabilité
        lignes = [ligne(compte, montant, 0), ligne('121', 0, montant)];
        nom = 'Solde de caisse initial';
      } else if (/cheque/.test(motif)) {
        lignes = [ligne(compte, montant, 0), ligne('513', 0, montant)];
        nom = 'Encaissement de chèque';
      } else {
        lignes = [ligne(compte, montant, 0), ligne('462', 0, montant)];
        nom = `Entrée de caisse : ${row.reason}`.slice(0, 120);
        apports += 1;
      }
    } else {
      if (/^(salaire|remboursement retour|transfert vers)/.test(motif) || row.reason.startsWith('Charge — ') || row.reason.startsWith('Paiement État — ')) continue;
      // Nature de charge choisie dans le formulaire de la page Caisse : elle prime sur les mots-clés.
      const compteCharge = /^6\d{1,5}$/.test(row.charge_account || '') ? row.charge_account : null;
      const regle = REGLES_DEPENSES.find(([re]) => re.test(motif));
      const [compte, j] = tresorerie(mode === 'cheque' ? 'virement' : mode);
      journal = j;
      if (!regle && !compteCharge) nonClassees.push(row.reason);
      lignes = [ligne(compteCharge || (regle ? regle[1] : '658'), montant, 0), ligne(compte, 0, montant)];
      sigCharge = compteCharge ? `|${compteCharge}` : '';
      nom = `Sortie de caisse : ${row.reason}`.slice(0, 120);
    }
    out.push({
      sourceId: row.id, date, journal, reference: 'CAISSE', label: nom,
      sig: `${montant}|${row.movement_type}|${row.payment_method}|${row.reason}|${date}|t3${sigCharge}`,
      lignes,
    });
  }
  if (nonClassees.length > 0) {
    ctx.avertissements.push(`${nonClassees.length} sortie(s) de caisse non classées, comptabilisées en charges diverses (658) : ${[...new Set(nonClassees)].slice(0, 3).join(', ')}.`);
  }
  if (apports > 0) ctx.avertissements.push(`${apports} entrée(s) de caisse non reconnues, comptabilisées en compte courant d'associé (462).`);
  return out;
}

// --- Outils communs aux sources ---

const sansAccent = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Les modes de paiement de plusieurs tables sont du texte libre : on les
// ramène à 'especes' | 'wave' | 'orange_money' | 'virement' | 'cheque' |
// 'credit' (dette ou avoir) | null (non reconnu).
function modeNormalise(texte) {
  const t = sansAccent(texte);
  if (!t) return null;
  if (t.includes('wave')) return 'wave';
  if (t.includes('orange')) return 'orange_money';
  if (t.includes('cheque')) return 'cheque';
  if (t.includes('virement') || t.includes('banque') || t.includes('bank')) return 'virement';
  if (t.includes('credit') || t.includes('dette') || t.includes('avoir') || t.includes('a_payer')) return 'credit';
  if (t.includes('espece') || t.includes('cash') || t.includes('caisse') || t.includes('comptant')) return 'especes';
  return null;
}
// mode -> [compte de trésorerie, journal]
const TRESORERIE = {
  especes: ['571', 'CA'], wave: ['5211', 'BQ'], orange_money: ['5212', 'BQ'], virement: ['521', 'BQ'], cheque: ['513', 'BQ'],
};
const tresorerie = (mode) => TRESORERIE[mode] || TRESORERIE.especes;
const ligne = (compte, debit, credit) => ({ compte, debit: arrondi(debit), credit: arrondi(credit) });
const SQL_JOUR_TZ = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

// --- Comptes auxiliaires de tiers (6 chiffres) ---
// Clients à crédit : 411001 à 411899 (411900 = assurances, compte collectif).
// Fournisseurs : 401001 à 401999. Un compte n'est créé que pour un tiers qui a
// une opération à crédit ; son numéro ne change plus ensuite.
const CONFIG_TIERS = {
  client: { prefixe: '411', largeur: 3, premier: 1, dernier: 899, collectif: '411', table: 'clients', libelle: 'clients' },
  assureur: { prefixe: '4119', largeur: 2, premier: 1, dernier: 99, collectif: '411900', table: 'insurers', libelle: 'assureurs' },
  fournisseur: { prefixe: '401', largeur: 3, premier: 1, dernier: 999, collectif: '401', table: 'suppliers', libelle: 'fournisseurs' },
  personnel: { prefixe: '422', largeur: 3, premier: 1, dernier: 999, collectif: '422', table: 'users', libelle: 'personnel' },
};

async function nomTiers(client, merchantId, type, id) {
  const r = await client.query(
    `SELECT to_jsonb(t) AS j FROM ${CONFIG_TIERS[type].table} t WHERE t.id = $1::uuid AND t.merchant_id = $2`,
    [id, merchantId]
  );
  const j = r.rows[0]?.j || {};
  const nom = j.name || j.full_name || j.business_name || j.company_name || [j.first_name, j.last_name].filter(Boolean).join(' ');
  return String(nom || `Tiers ${String(id).slice(0, 8)}`).trim().slice(0, 150);
}

function creerResolveurTiers(client, merchantId, refs, avertissements) {
  let existants = null; // `${type}:${id}` -> code
  let pris = null; // codes auxiliaires déjà utilisés
  const prochain = {};
  const complets = new Set();

  async function charger() {
    if (existants) return;
    const m = await client.query(
      `SELECT t.tiers_type, t.tiers_id, a.code FROM accounting_tiers_accounts t
       JOIN accounting_accounts a ON a.id = t.account_id WHERE t.merchant_id = $1`,
      [merchantId]
    );
    existants = new Map(m.rows.map((r) => [`${r.tiers_type}:${r.tiers_id}`, r.code]));
    const c = await client.query(
      `SELECT code FROM accounting_accounts WHERE merchant_id = $1 AND code ~ '^(411|401|422)[0-9]{3}$'`,
      [merchantId]
    );
    pris = new Set(c.rows.map((r) => r.code));
  }

  return {
    // Renvoie le numéro de compte auxiliaire du tiers (créé si besoin), ou le
    // compte collectif (411 / 401) si le tiers est inconnu ou la plage pleine.
    async obtenir(type, id) {
      const cfg = CONFIG_TIERS[type];
      if (!id) return cfg.collectif;
      await charger();
      const cle = `${type}:${id}`;
      if (existants.has(cle)) return existants.get(cle);
      let n = prochain[type] || cfg.premier;
      while (n <= cfg.dernier && pris.has(`${cfg.prefixe}${String(n).padStart(cfg.largeur, '0')}`)) n += 1;
      if (n > cfg.dernier) {
        if (!complets.has(type)) {
          complets.add(type);
          avertissements.push(`Plus de numéro libre pour les comptes auxiliaires ${cfg.libelle} : les suivants restent sur le compte ${cfg.collectif}.`);
        }
        return cfg.collectif;
      }
      prochain[type] = n + 1;
      const code = `${cfg.prefixe}${String(n).padStart(cfg.largeur, '0')}`;
      const nom = await nomTiers(client, merchantId, type, id);
      const compte = await client.query(
        `INSERT INTO accounting_accounts (merchant_id, code, label) VALUES ($1, $2, $3) RETURNING id`,
        [merchantId, code, nom]
      );
      await client.query(
        `INSERT INTO accounting_tiers_accounts (merchant_id, tiers_type, tiers_id, account_id) VALUES ($1, $2, $3, $4)`,
        [merchantId, type, id, compte.rows[0].id]
      );
      refs.comptesParCode.set(code, compte.rows[0].id);
      existants.set(cle, code);
      pris.add(code);
      return code;
    },
  };
}

// Pour le bilan, les comptes auxiliaires sont regroupés en une ligne par
// compte collectif : clients débiteurs (411) / créditeurs (419), fournisseurs
// créditeurs (401) / débiteurs (409). Le détail reste dans la balance.
const REGROUPEMENTS = [
  { prefixe: '4119', debiteur: ['411900', 'Clients — assurances (tiers payant)'], crediteur: ['419', 'Clients créditeurs (avances reçues)'] },
  { prefixe: '411', debiteur: ['411', 'Clients'], crediteur: ['419', 'Clients créditeurs (avances reçues)'] },
  { prefixe: '401', debiteur: ['409', 'Fournisseurs débiteurs (avances versées)'], crediteur: ['401', 'Fournisseurs'] },
  { prefixe: '422', debiteur: ['421', 'Personnel, avances et acomptes'], crediteur: ['422', 'Personnel, rémunérations dues'] },
];
function regrouperAuxiliaires(rows) {
  const parCode = new Map();
  const ajouter = (code, label, debit, credit) => {
    const x = parCode.get(code) || { code, label, debit: 0, credit: 0 };
    x.debit += debit;
    x.credit += credit;
    parCode.set(code, x);
  };
  for (const r of rows) {
    const g = REGROUPEMENTS.find((x) => r.code.length === 6 && r.code.startsWith(x.prefixe));
    if (!g) {
      ajouter(r.code, r.label, r.debit, r.credit);
      continue;
    }
    const solde = arrondi(r.debit - r.credit);
    if (solde >= 0) ajouter(g.debiteur[0], g.debiteur[1], solde, 0);
    else ajouter(g.crediteur[0], g.crediteur[1], 0, -solde);
  }
  return [...parCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

// Ventes validées ou livrées : produit (701) et TVA (443) d'un côté ; caisse,
// banque, clients (411) ou assurance (4111) de l'autre ; plus la sortie de
// stock au prix de revient (débit 6031, crédit 311).
async function lireVentes(client, merchantId, debut, ctx) {
  const r = await client.query(
    `SELECT o.id::text AS id, o.order_seq, o.client_id::text AS client_id,
            (SELECT cl.insurer_id::text FROM clients cl WHERE cl.id = o.client_id) AS insurer_id,
            o.payment_method::text AS pm,
            COALESCE(o.total_amount, 0) AS total, COALESCE(o.tva_amount, 0) AS tva,
            ${SQL_JOUR_TZ('COALESCE(o.validated_at, o.delivered_at, o.created_at)')} AS d,
            COALESCE((SELECT SUM(oi.quantity * COALESCE(oi.unit_cost, 0)) FROM order_items oi WHERE oi.order_id = o.id), 0) AS cogs,
            COALESCE((SELECT SUM(c.amount) FROM insurer_copayments c WHERE c.order_id = o.id), 0) AS copay,
            (SELECT c.payment_method FROM insurer_copayments c WHERE c.order_id = o.id LIMIT 1) AS copay_pm
     FROM orders o
     WHERE o.merchant_id = $1 AND o.status IN ('validee', 'livree')
       AND COALESCE(o.validated_at, o.delivered_at, o.created_at) >= $2::date
     ORDER BY COALESCE(o.validated_at, o.delivered_at, o.created_at), o.order_seq`,
    [merchantId, debut]
  );
  const out = [];
  for (const row of r.rows) {
    const total = arrondi(row.total);
    if (!(total > 0)) continue;
    const tva = Math.min(arrondi(row.tva), total);
    const ht = arrondi(total - tva);
    const cogs = arrondi(row.cogs);
    const lignes = [];
    if (row.pm === 'a_credit') {
      lignes.push(ligne(await ctx.tiers.obtenir('client', row.client_id), total, 0));
    } else if (row.pm === 'tiers_payant') {
      const part = Math.min(arrondi(row.copay), total);
      if (part > 0) lignes.push(ligne(tresorerie(modeNormalise(row.copay_pm))[0], part, 0));
      if (total - part > 0) lignes.push(ligne(await ctx.tiers.obtenir('assureur', row.insurer_id), total - part, 0));
    } else {
      lignes.push(ligne(tresorerie(modeNormalise(row.pm))[0], total, 0));
    }
    if (ht > 0) lignes.push(ligne('701', 0, ht));
    if (tva > 0) lignes.push(ligne('443', 0, tva));
    if (cogs > 0) {
      lignes.push(ligne('6031', cogs, 0));
      lignes.push(ligne('311', 0, cogs));
    }
    out.push({
      sourceId: row.id, date: row.d, journal: 'VT', reference: row.order_seq ? `V${row.order_seq}` : null,
      label: `Vente${row.order_seq ? ` n°${row.order_seq}` : ''}`,
      sig: `${total}|${tva}|${row.pm}|${cogs}|${row.copay}|${row.d}|${row.client_id}|${row.insurer_id}|t3`,
      lignes,
    });
  }
  return out;
}

// Retours clients remboursés : annule la vente (701, TVA) et remet en stock
// au prix de revient de la vente d'origine.
async function lireRetours(client, merchantId, debut, ctx) {
  const r = await client.query(
    `SELECT pr.id::text AS id, pr.client_id::text AS client_id, pr.refund_amount AS refund, pr.refund_method, pr.quantity,
            ${SQL_JOUR_TZ('pr.created_at')} AS d, o.order_seq,
            COALESCE(o.total_amount, 0) AS o_total, COALESCE(o.tva_amount, 0) AS o_tva,
            (SELECT AVG(oi.unit_cost) FROM order_items oi WHERE oi.order_id = pr.order_id AND oi.product_id = pr.product_id) AS cost
     FROM product_returns pr LEFT JOIN orders o ON o.id = pr.order_id
     WHERE pr.merchant_id = $1 AND pr.created_at >= $2::date AND COALESCE(pr.refund_amount, 0) > 0`,
    [merchantId, debut]
  );
  const out = [];
  for (const row of r.rows) {
    const refund = arrondi(row.refund);
    const oTotal = Number(row.o_total);
    const oTva = Number(row.o_tva);
    const tvaPart = oTotal > 0 && oTva > 0 ? arrondi(Math.min((refund * oTva) / oTotal, refund)) : 0;
    const ht = arrondi(refund - tvaPart);
    const mode = modeNormalise(row.refund_method);
    const valeur = arrondi((Number(row.cost) || 0) * (Number(row.quantity) || 0));
    const lignes = [];
    if (ht > 0) lignes.push(ligne('701', ht, 0));
    if (tvaPart > 0) lignes.push(ligne('443', tvaPart, 0));
    if (mode === 'credit') lignes.push(ligne(await ctx.tiers.obtenir('client', row.client_id), 0, refund));
    else lignes.push(ligne(tresorerie(mode)[0], 0, refund));
    if (valeur > 0) {
      lignes.push(ligne('311', valeur, 0));
      lignes.push(ligne('6031', 0, valeur));
    }
    out.push({
      sourceId: row.id, date: row.d, journal: 'VT', reference: 'RET',
      label: `Retour client${row.order_seq ? ` — vente n°${row.order_seq}` : ''}`,
      sig: `${refund}|${row.refund_method}|${valeur}|${row.d}|${row.client_id}|t2`,
      lignes,
    });
  }
  return out;
}

// Règlements reçus des clients à crédit : débit trésorerie, crédit du compte
// auxiliaire du client (411xxx).
async function lireReglementsClients(client, merchantId, debut, ctx) {
  const r = await client.query(
    `SELECT id::text AS id, client_id::text AS client_id, amount, payment_method, to_char(created_at, 'YYYY-MM-DD') AS d
     FROM credit_payments WHERE merchant_id = $1 AND created_at >= $2::date AND COALESCE(amount, 0) > 0
     ORDER BY created_at`,
    [merchantId, debut]
  );
  const out = [];
  for (const row of r.rows) {
    const montant = arrondi(row.amount);
    const [compte, journal] = tresorerie(modeNormalise(row.payment_method));
    const compteClient = await ctx.tiers.obtenir('client', row.client_id);
    out.push({
      sourceId: row.id, date: row.d, journal, reference: 'RGL', label: 'Règlement client',
      sig: `${montant}|${row.payment_method}|${row.d}|${row.client_id}|t2`,
      lignes: [ligne(compte, montant, 0), ligne(compteClient, 0, montant)],
    });
  }
  return out;
}

// Règlements reçus des assureurs (tiers payant) : débit trésorerie, crédit du
// compte auxiliaire de l'assureur (4119xx).
async function lireReglementsAssureurs(client, merchantId, debut, ctx) {
  const r = await client.query(
    `SELECT id::text AS id, insurer_id::text AS insurer_id, amount, payment_method, ${SQL_JOUR_TZ('paid_at')} AS d
     FROM insurer_payments WHERE merchant_id = $1 AND paid_at >= $2::date AND COALESCE(amount, 0) > 0
     ORDER BY paid_at`,
    [merchantId, debut]
  );
  const out = [];
  for (const row of r.rows) {
    const montant = arrondi(row.amount);
    const [compte, journal] = tresorerie(modeNormalise(row.payment_method));
    const compteAssureur = await ctx.tiers.obtenir('assureur', row.insurer_id);
    out.push({
      sourceId: row.id, date: row.d, journal, reference: 'ASS', label: 'Règlement assureur',
      sig: `${montant}|${row.payment_method}|${row.d}|${row.insurer_id}|t3`,
      lignes: [ligne(compte, montant, 0), ligne(compteAssureur, 0, montant)],
    });
  }
  return out;
}

// Achats (entrées de stock avec un coût, hors transferts), regroupés par
// jour / fournisseur / facture / mode de paiement : achat (601) contre
// trésorerie ou compte auxiliaire du fournisseur (401xxx) si l'achat est à
// crédit, plus l'entrée en stock (311 / 6031).
async function lireAchats(client, merchantId, debut, ctx) {
  const jour = `COALESCE(m.movement_date, (m.created_at AT TIME ZONE 'UTC')::date)`;
  const r = await client.query(
    `SELECT MIN(m.id::text) AS id, SUM(m.total_cost) AS total, COALESCE(SUM(m.tva_amount), 0) AS tva, m.payment_method AS pm, m.cash_method AS cm,
            m.invoice_number AS inv, to_char(${jour}, 'YYYY-MM-DD') AS d, MAX(s.name) AS supplier,
            m.supplier_id::text AS supplier_id
     FROM stock_movements m LEFT JOIN suppliers s ON s.id = m.supplier_id
     WHERE m.merchant_id = $1 AND m.movement_type = 'entree' AND m.transfer_id IS NULL
       AND COALESCE(m.total_cost, 0) > 0 AND ${jour} >= $2::date
     GROUP BY m.supplier_id, m.payment_method, m.cash_method, m.invoice_number, ${jour}
     ORDER BY ${jour}, MIN(m.id::text)`,
    [merchantId, debut]
  );
  const sansCout = await client.query(
    `SELECT COUNT(*) AS n FROM stock_movements m
     WHERE m.merchant_id = $1 AND m.movement_type = 'entree' AND m.transfer_id IS NULL
       AND COALESCE(m.total_cost, 0) = 0 AND ${jour} >= $2::date`,
    [merchantId, debut]
  );
  if (Number(sansCout.rows[0].n) > 0) {
    ctx.avertissements.push(`${sansCout.rows[0].n} entrée(s) de stock sans coût d'achat : non comptabilisées comme achats (elles apparaissent dans l'ajustement automatique du stock).`);
  }
  let inconnus = 0;
  const out = [];
  for (const row of r.rows) {
    const total = arrondi(row.total);
    // total_cost est le montant payé TTC ; la TVA déductible (445) en est extraite.
    const tva = Math.min(arrondi(row.tva), total);
    const ht = arrondi(total - tva);
    const p = modeNormalise(row.pm);
    const c = modeNormalise(row.cm);
    let compteCredit = null;
    if (p !== 'credit') {
      const mode = c && c !== 'credit' ? c : p && p !== 'credit' ? p : null;
      if (mode) compteCredit = tresorerie(mode)[0];
      else inconnus += 1;
    }
    if (!compteCredit) compteCredit = await ctx.tiers.obtenir('fournisseur', row.supplier_id);
    out.push({
      sourceId: row.id, date: row.d, journal: 'AC', reference: row.inv || null,
      label: `Achat${row.supplier ? ` — ${row.supplier}` : ''}`,
      sig: `${total}|${tva}|${row.pm}|${row.cm}|${row.inv}|${row.d}|${row.supplier}|${row.supplier_id}|t3`,
      lignes: [ligne('601', ht, 0), ligne('445', tva, 0), ligne(compteCredit, 0, total), ligne('311', ht, 0), ligne('6031', 0, ht)],
    });
  }
  if (inconnus > 0) ctx.avertissements.push(`${inconnus} achat(s) au mode de paiement non reconnu : comptabilisés en dette fournisseur.`);
  return out;
}

// Règlements aux fournisseurs : débit du compte auxiliaire du fournisseur
// (401xxx), crédit trésorerie.
async function lireReglementsFournisseurs(client, merchantId, debut, ctx) {
  const r = await client.query(
    `SELECT sp.id::text AS id, sp.supplier_id::text AS supplier_id, sp.amount, sp.payment_method,
            to_char(sp.paid_at, 'YYYY-MM-DD') AS d, s.name AS supplier
     FROM supplier_payments sp LEFT JOIN suppliers s ON s.id = sp.supplier_id
     WHERE sp.merchant_id = $1 AND sp.paid_at >= $2::date AND COALESCE(sp.amount, 0) > 0
     ORDER BY sp.paid_at`,
    [merchantId, debut]
  );
  const out = [];
  for (const row of r.rows) {
    const montant = arrondi(row.amount);
    const [compte, journal] = tresorerie(modeNormalise(row.payment_method));
    const compteFournisseur = await ctx.tiers.obtenir('fournisseur', row.supplier_id);
    out.push({
      sourceId: row.id, date: row.d, journal, reference: 'RGF',
      label: `Règlement fournisseur${row.supplier ? ` — ${row.supplier}` : ''}`,
      sig: `${montant}|${row.payment_method}|${row.d}|${row.supplier}|${row.supplier_id}|t2`,
      lignes: [ligne(compteFournisseur, montant, 0), ligne(compte, 0, montant)],
    });
  }
  return out;
}

// Valeur du stock : le stock réel (quantités × prix de revient) est la
// référence. Deux écritures automatiques font coïncider le compte 311 avec lui :
//  - "ouverture" (figée) : stock déjà présent au début de la comptabilité,
//    contrepartie 121 (report à nouveau) ;
//  - "ecart" (recalculée) : pertes, casse ou surplus constatés ensuite, via 6031.
async function lireStock(client, merchantId, debut, ctx) {
  if (ctx.echec) return null; // une source a échoué : on ne touche pas au stock
  const val = await client.query(
    `SELECT COALESCE(SUM(ps.quantity_in_stock * COALESCE(p.cost_price, 0)), 0) AS v,
            COUNT(*) FILTER (WHERE COALESCE(p.cost_price, 0) = 0) AS sans_prix
     FROM product_stock ps JOIN products p ON p.id = ps.product_id
     WHERE ps.merchant_id = $1 AND ps.quantity_in_stock > 0`,
    [merchantId]
  );
  const valeurReelle = arrondi(val.rows[0].v);
  if (Number(val.rows[0].sans_prix) > 0) {
    ctx.avertissements.push(`${val.rows[0].sans_prix} produit(s) en stock sans prix de revient : valeur du stock sous-estimée.`);
  }
  const flux = await client.query(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS solde
     FROM accounting_lines l JOIN accounting_entries e ON e.id = l.entry_id JOIN accounting_accounts a ON a.id = l.account_id
     WHERE l.merchant_id = $1 AND a.code = '311' AND e.source_type <> 'stock'`,
    [merchantId]
  );
  const ledger = arrondi(flux.rows[0].solde);
  const ouv = await client.query(
    `SELECT COALESCE(SUM(l.debit), 0) AS montant
     FROM accounting_entries e JOIN accounting_lines l ON l.entry_id = e.id JOIN accounting_accounts a ON a.id = l.account_id
     WHERE e.merchant_id = $1 AND e.source_type = 'stock' AND e.source_id = 'ouverture' AND a.code = '311'`,
    [merchantId]
  );
  let ouverture = arrondi(ouv.rows[0].montant);
  if (ouverture <= 0) ouverture = Math.max(0, arrondi(valeurReelle - ledger));

  const out = [];
  if (ouverture > 0) {
    out.push({
      sourceId: 'ouverture', date: debut, journal: 'OD', reference: 'STOCK-INIT',
      label: 'Stock initial (repris automatiquement)', sig: 'ouverture',
      lignes: [ligne('311', ouverture, 0), ligne('121', 0, ouverture)],
    });
  }
  const ecart = arrondi(valeurReelle - (ledger + ouverture));
  if (Math.abs(ecart) >= 1) {
    out.push({
      sourceId: 'ecart', date: aujourdhui(), journal: 'OD', reference: 'STOCK-AJ',
      label: 'Ajustement automatique de la valeur du stock', sig: String(ecart),
      lignes: ecart > 0 ? [ligne('311', ecart, 0), ligne('6031', 0, ecart)] : [ligne('6031', -ecart, 0), ligne('311', 0, -ecart)],
    });
  }
  return out;
}

// L'ordre compte : le stock vient en dernier, une fois tous les flux comptabilisés.
const SOURCES = [
  { type: 'vente', lire: lireVentes },
  { type: 'retour', lire: lireRetours },
  { type: 'reglement_client', lire: lireReglementsClients },
  { type: 'reglement_assureur', lire: lireReglementsAssureurs },
  { type: 'achat', lire: lireAchats },
  { type: 'reglement_fournisseur', lire: lireReglementsFournisseurs },
  { type: 'paie', lire: lirePaie },
  { type: 'salaire', lire: lireSalaires },
  { type: 'caisse', lire: lireCaisse },
  { type: 'stock', lire: lireStock },
];

async function synchroniserMaintenant(merchantId, userId) {
  const resume = { created: 0, removed: 0, errors: [], warnings: [] };
  const ctx = { avertissements: resume.warnings, echec: false };
  const client = await pool.connect();
  try {
    const m = await client.query(
      `SELECT COALESCE(accounting_start_date, date_trunc('year', CURRENT_DATE)::date)::text AS debut FROM merchants WHERE id = $1`,
      [merchantId]
    );
    const debut = m.rows[0]?.debut;
    if (!debut) return resume;

    // Ajoute au plan comptable les comptes ajoutés depuis l'activation (une fois par démarrage).
    if (!PLAN_VERIFIE.has(merchantId)) {
      await initialiserComptabilite(client, merchantId);
      await assurerCompte(client, merchantId, '445', 'État, TVA récupérable sur achats');
      await assurerCompte(client, merchantId, '441', 'État, impôts sur les bénéfices');
      await assurerCompte(client, merchantId, '891', 'Impôts sur les bénéfices');
      PLAN_VERIFIE.add(merchantId);
    }

    for (const source of SOURCES) {
      try {
        await client.query('BEGIN');
        await verrouiller(client, merchantId);
        const comptes = await client.query(`SELECT id, code FROM accounting_accounts WHERE merchant_id = $1`, [merchantId]);
        const journaux = await client.query(`SELECT id, code FROM accounting_journals WHERE merchant_id = $1`, [merchantId]);
        const refs = {
          comptesParCode: new Map(comptes.rows.map((r) => [r.code, r.id])),
          journaux: new Map(journaux.rows.map((r) => [r.code, r.id])),
        };
        ctx.tiers = creerResolveurTiers(client, merchantId, refs, ctx.avertissements);
        const voulues = await source.lire(client, merchantId, debut, ctx);
        if (voulues === null) {
          await client.query('ROLLBACK');
          continue;
        }
        const r = await reconcilier(client, merchantId, userId, refs, source.type, voulues);
        await client.query('COMMIT');
        resume.created += r.crees;
        resume.removed += r.supprimees;
        resume.errors.push(...r.erreurs);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`Synchro ${source.type} :`, err);
        resume.errors.push(source.type);
        ctx.echec = true;
      }
    }
  } finally {
    client.release();
  }
  return resume;
}

// Lance la synchronisation si elle n'a pas tourné depuis 30 s (ou si force).
// Ne lève jamais d'erreur : un échec de synchro ne doit pas bloquer la lecture.
async function assurerSynchro(merchantId, userId, force = false) {
  const etat = ETAT_SYNCHRO.get(merchantId) || {};
  if (etat.enCours) return etat.enCours;
  if (!force && etat.at && Date.now() - etat.at < DELAI_SYNCHRO_MS) return etat.dernier;
  const enCours = synchroniserMaintenant(merchantId, userId)
    .catch((err) => {
      console.error('Synchronisation comptable :', err);
      return { created: 0, removed: 0, errors: ['synchronisation'], warnings: [] };
    })
    .then((resultat) => {
      ETAT_SYNCHRO.set(merchantId, { at: Date.now(), dernier: resultat });
      return resultat;
    });
  ETAT_SYNCHRO.set(merchantId, { ...etat, enCours });
  return enCours;
}

// POST /accounting/sync — force une synchronisation immédiate (bouton "Actualiser").
router.post('/sync', async (req, res) => {
  const resultat = await assurerSynchro(req.user.merchantId, req.user.id, true);
  res.json(resultat);
});

// ---------- États ----------

// Totaux débit/crédit par compte sur une période (bornes facultatives).
async function agreger(merchantId, from, to) {
  const result = await pool.query(
    `SELECT a.code, a.label, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
     FROM accounting_lines l
     JOIN accounting_entries e ON e.id = l.entry_id
     JOIN accounting_accounts a ON a.id = l.account_id
     WHERE l.merchant_id = $1
       AND ($2::date IS NULL OR e.entry_date >= $2::date)
       AND ($3::date IS NULL OR e.entry_date <= $3::date)
     GROUP BY a.code, a.label
     ORDER BY a.code`,
    [merchantId, from || null, to || null]
  );
  return result.rows.map((r) => ({ code: r.code, label: r.label, debit: Number(r.debit), credit: Number(r.credit) }));
}

// Regroupe les comptes dont le numéro commence par l'un des préfixes.
function groupe(rows, prefixes, sens) {
  const comptes = rows
    .filter((r) => prefixes.some((p) => r.code.startsWith(p)))
    .map((r) => ({ code: r.code, label: r.label, montant: arrondi(sens === 'credit' ? r.credit - r.debit : r.debit - r.credit) }))
    .filter((c) => c.montant !== 0);
  return { total: arrondi(comptes.reduce((s, c) => s + c.montant, 0)), comptes };
}

function verifierPeriode(req, res) {
  const { from, to } = req.query;
  if ((from && !dateOk(from)) || (to && !dateOk(to))) {
    res.status(400).json({ error: 'Dates invalides.' });
    return false;
  }
  return true;
}

// GET /accounting/ledger?code=411&from=&to= — grand livre d'un compte, avec
// solde cumulé (débit − crédit ; positif = débiteur).
router.get('/ledger', async (req, res) => {
  if (!verifierPeriode(req, res)) return;
  const { code, from, to } = req.query;
  if (!code) return res.status(400).json({ error: 'Le numéro de compte est requis.' });
  try {
    const compte = await pool.query(
      `SELECT id, code, label FROM accounting_accounts WHERE merchant_id = $1 AND code = $2`,
      [req.user.merchantId, String(code)]
    );
    if (compte.rows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    const idCompte = compte.rows[0].id;

    let ouverture = 0;
    if (from) {
      const o = await pool.query(
        `SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS solde
         FROM accounting_lines l JOIN accounting_entries e ON e.id = l.entry_id
         WHERE l.merchant_id = $1 AND l.account_id = $2 AND e.entry_date < $3::date`,
        [req.user.merchantId, idCompte, from]
      );
      ouverture = Number(o.rows[0].solde);
    }

    const lignes = await pool.query(
      `SELECT to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.entry_number, j.code AS journal, e.reference, COALESCE(l.label, e.label) AS label, l.debit, l.credit
       FROM accounting_lines l
       JOIN accounting_entries e ON e.id = l.entry_id
       JOIN accounting_journals j ON j.id = e.journal_id
       WHERE l.merchant_id = $1 AND l.account_id = $2
         AND ($3::date IS NULL OR e.entry_date >= $3::date)
         AND ($4::date IS NULL OR e.entry_date <= $4::date)
       ORDER BY e.entry_date, e.entry_number`,
      [req.user.merchantId, idCompte, from || null, to || null]
    );

    let cumul = ouverture;
    let totalDebit = 0;
    let totalCredit = 0;
    const mouvements = lignes.rows.map((l) => {
      const debit = Number(l.debit);
      const credit = Number(l.credit);
      cumul = arrondi(cumul + debit - credit);
      totalDebit += debit;
      totalCredit += credit;
      return { date: l.entry_date, entryNumber: Number(l.entry_number), journal: l.journal, reference: l.reference, label: l.label, debit, credit, solde: cumul };
    });
    res.json({
      account: { code: compte.rows[0].code, label: compte.rows[0].label },
      opening: arrondi(ouverture),
      lines: mouvements,
      totalDebit: arrondi(totalDebit),
      totalCredit: arrondi(totalCredit),
      closing: cumul,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du grand livre.' });
  }
});

// GET /accounting/general-ledger?from=&to=&classe= — grand livre général :
// tous les comptes mouvementés (ou ayant un solde d'ouverture), chacun avec ses
// lignes et son solde cumulé. `classe` (1 à 8) limite à une classe de comptes.
router.get('/general-ledger', async (req, res) => {
  if (!verifierPeriode(req, res)) return;
  const { from, to } = req.query;
  const classe = /^[1-8]$/.test(String(req.query.classe || '')) ? String(req.query.classe) : null;
  const LIMITE = 20000;
  try {
    const comptes = new Map();
    const compte = (code, label) => {
      if (!comptes.has(code)) comptes.set(code, { code, label, opening: 0, lines: [], totalDebit: 0, totalCredit: 0, closing: 0 });
      return comptes.get(code);
    };
    if (from) {
      const o = await pool.query(
        `SELECT a.code, a.label, SUM(l.debit - l.credit) AS solde
         FROM accounting_lines l JOIN accounting_entries e ON e.id = l.entry_id JOIN accounting_accounts a ON a.id = l.account_id
         WHERE l.merchant_id = $1 AND e.entry_date < $2::date AND ($3::text IS NULL OR a.code LIKE $3::text || '%')
         GROUP BY a.code, a.label`,
        [req.user.merchantId, from, classe]
      );
      for (const r of o.rows) {
        const s = arrondi(r.solde);
        if (s !== 0) compte(r.code, r.label).opening = s;
      }
    }
    const lignes = await pool.query(
      `SELECT a.code, a.label AS account_label, to_char(e.entry_date, 'YYYY-MM-DD') AS d, e.entry_number, j.code AS journal,
              e.reference, COALESCE(l.label, e.label) AS label, l.debit, l.credit
       FROM accounting_lines l
       JOIN accounting_entries e ON e.id = l.entry_id
       JOIN accounting_journals j ON j.id = e.journal_id
       JOIN accounting_accounts a ON a.id = l.account_id
       WHERE l.merchant_id = $1
         AND ($2::date IS NULL OR e.entry_date >= $2::date)
         AND ($3::date IS NULL OR e.entry_date <= $3::date)
         AND ($4::text IS NULL OR a.code LIKE $4::text || '%')
       ORDER BY a.code, e.entry_date, e.entry_number
       LIMIT ${LIMITE + 1}`,
      [req.user.merchantId, from || null, to || null, classe]
    );
    const tronque = lignes.rows.length > LIMITE;
    for (const l of tronque ? lignes.rows.slice(0, LIMITE) : lignes.rows) {
      const c = compte(l.code, l.account_label);
      c.lines.push({ date: l.d, entryNumber: Number(l.entry_number), journal: l.journal, reference: l.reference, label: l.label, debit: Number(l.debit), credit: Number(l.credit) });
    }
    const accounts = [...comptes.values()].sort((a, b) => a.code.localeCompare(b.code));
    for (const c of accounts) {
      let cumul = c.opening;
      for (const l of c.lines) {
        cumul = arrondi(cumul + l.debit - l.credit);
        l.solde = cumul;
        c.totalDebit += l.debit;
        c.totalCredit += l.credit;
      }
      c.totalDebit = arrondi(c.totalDebit);
      c.totalCredit = arrondi(c.totalCredit);
      c.closing = cumul;
    }
    res.json({ accounts, truncated: tronque });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du grand livre général.' });
  }
});

// GET /accounting/trial-balance?from=&to= — balance générale.
router.get('/trial-balance', async (req, res) => {
  if (!verifierPeriode(req, res)) return;
  try {
    const rows = await agreger(req.user.merchantId, req.query.from, req.query.to);
    const lignes = rows.map((r) => {
      const solde = arrondi(r.debit - r.credit);
      return { ...r, soldeDebiteur: solde > 0 ? solde : 0, soldeCrediteur: solde < 0 ? -solde : 0 };
    });
    const somme = (k) => arrondi(lignes.reduce((s, l) => s + l[k], 0));
    res.json({
      lines: lignes,
      totals: { debit: somme('debit'), credit: somme('credit'), soldeDebiteur: somme('soldeDebiteur'), soldeCrediteur: somme('soldeCrediteur') },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul de la balance.' });
  }
});

// GET /accounting/income-statement?from=&to= — compte de résultat (présentation
// simplifiée selon les classes 6, 7 et 8 du SYSCOHADA).
router.get('/income-statement', async (req, res) => {
  if (!verifierPeriode(req, res)) return;
  try {
    const rows = await agreger(req.user.merchantId, req.query.from, req.query.to);
    const produitsExploitation = groupe(rows, ['70', '71', '72', '73', '75', '78', '79'], 'credit');
    const chargesExploitation = groupe(rows, ['60', '61', '62', '63', '64', '65', '66', '68', '69'], 'debit');
    const produitsFinanciers = groupe(rows, ['77'], 'credit');
    const chargesFinancieres = groupe(rows, ['67'], 'debit');
    const produitsHao = groupe(rows, ['82', '84', '86', '88'], 'credit');
    const chargesHao = groupe(rows, ['81', '83', '85'], 'debit');
    const participation = groupe(rows, ['87'], 'debit');
    const impots = groupe(rows, ['89'], 'debit');

    const chiffreAffaires = groupe(rows, ['70'], 'credit').total;
    const margeCommerciale = arrondi(groupe(rows, ['701'], 'credit').total - groupe(rows, ['601', '6031'], 'debit').total);
    const resultatExploitation = arrondi(produitsExploitation.total - chargesExploitation.total);
    const resultatFinancier = arrondi(produitsFinanciers.total - chargesFinancieres.total);
    const resultatActivitesOrdinaires = arrondi(resultatExploitation + resultatFinancier);
    const resultatHao = arrondi(produitsHao.total - chargesHao.total);
    const resultatNet = arrondi(resultatActivitesOrdinaires + resultatHao - participation.total - impots.total);

    res.json({
      chiffreAffaires, margeCommerciale,
      produitsExploitation, chargesExploitation, resultatExploitation,
      produitsFinanciers, chargesFinancieres, resultatFinancier,
      resultatActivitesOrdinaires,
      produitsHao, chargesHao, resultatHao,
      participation, impots,
      resultatNet,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul du compte de résultat.' });
  }
});

// GET /accounting/balance-sheet?date= — bilan à une date (cumul de toutes les
// écritures jusqu'à cette date ; pas encore de clôture d'exercice).
router.get('/balance-sheet', async (req, res) => {
  const date = req.query.date || aujourdhui();
  if (!dateOk(date)) return res.status(400).json({ error: 'Date invalide.' });
  try {
    const rows = regrouperAuxiliaires(await agreger(req.user.merchantId, null, date));
    const solde = (r) => arrondi(r.debit - r.credit);
    const total = (comptes) => arrondi(comptes.reduce((s, c) => s + c.montant, 0));
    const comptesClasse = (n, filtre, signe) =>
      rows
        .filter((r) => r.code[0] === String(n) && filtre(solde(r)))
        .map((r) => ({ code: r.code, label: r.label, montant: arrondi(signe * solde(r)) }))
        .filter((c) => c.montant !== 0);

    const immobilisations = comptesClasse(2, () => true, 1);
    const stocks = comptesClasse(3, () => true, 1);
    const creances = comptesClasse(4, (s) => s > 0, 1);
    const tresorerieActif = comptesClasse(5, (s) => s > 0, 1);

    const resultat = arrondi(
      rows.filter((r) => ['6', '7', '8'].includes(r.code[0])).reduce((s, r) => s + r.credit - r.debit, 0)
    );
    const capitauxPropres = groupe(rows, ['10', '11', '12', '13', '14', '15'], 'credit').comptes;
    if (resultat !== 0) capitauxPropres.push({ code: '—', label: "Résultat cumulé (exercices précédents et exercice en cours)", montant: resultat });
    const dettesFinancieres = groupe(rows, ['16', '17', '18', '19'], 'credit').comptes;
    const passifCirculant = comptesClasse(4, (s) => s < 0, -1);
    const tresoreriePassif = comptesClasse(5, (s) => s < 0, -1);

    const actif = { immobilisations, stocks, creances, tresorerie: tresorerieActif };
    const passif = { capitauxPropres, dettesFinancieres, passifCirculant, tresorerie: tresoreriePassif };
    const totalActif = arrondi(Object.values(actif).reduce((s, c) => s + total(c), 0));
    const totalPassif = arrondi(Object.values(passif).reduce((s, c) => s + total(c), 0));

    res.json({
      date,
      actif: Object.fromEntries(Object.entries(actif).map(([k, c]) => [k, { total: total(c), comptes: c }])),
      passif: Object.fromEntries(Object.entries(passif).map(([k, c]) => [k, { total: total(c), comptes: c }])),
      totalActif, totalPassif, ecart: arrondi(totalActif - totalPassif),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul du bilan.' });
  }
});

module.exports = router;
