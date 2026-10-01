const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireModule } = require('../middleware/modules');
const { logActivity } = require('../utils/activityLog');

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

// Tout le reste : manager uniquement ET module activé par l'owner.
router.use(requireRole('manager'));
router.use(requireModule('comptabilite'));

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

// ---------- Charges (loyer, électricité…) : écritures automatiques ----------

const MODES_PAIEMENT = ['especes', 'wave', 'orange_money', 'virement', 'a_payer'];
// Compte crédité selon le mode de paiement (créés avec le plan comptable) :
// caisse, Wave, Orange Money, banque, ou fournisseurs si "à payer plus tard".
const COMPTE_PAR_MODE = { especes: '571', wave: '5211', orange_money: '5212', virement: '521', a_payer: '401' };
const JOURNAL_PAR_MODE = { especes: 'CA', wave: 'BQ', orange_money: 'BQ', virement: 'BQ', a_payer: 'AC' };
const MOIS_RE = /^\d{4}-\d{2}$/;

function moisSuivant(m) {
  const [a, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(a, mo, 1)).toISOString().slice(0, 7);
}
function moisAvant(m, n) {
  const [a, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(a, mo - 1 - n, 1)).toISOString().slice(0, 7);
}
function erreurMetier(statut, message) {
  return Object.assign(new Error(message), { statut });
}
async function verrouiller(client, merchantId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`acc:${merchantId}`]);
}
async function chargerReferences(client, merchantId) {
  const comptes = await client.query(
    `SELECT id, code FROM accounting_accounts WHERE merchant_id = $1 AND code = ANY($2::text[])`,
    [merchantId, Object.values(COMPTE_PAR_MODE)]
  );
  const journaux = await client.query(`SELECT id, code FROM accounting_journals WHERE merchant_id = $1`, [merchantId]);
  return {
    comptes: new Map(comptes.rows.map((r) => [r.code, r.id])),
    journaux: new Map(journaux.rows.map((r) => [r.code, r.id])),
  };
}

// Crée l'écriture (débit : compte de charge ; crédit : caisse/Wave/OM/banque/
// fournisseurs) et la trace dans accounting_charge_postings. À appeler dans une
// transaction où verrouiller() a déjà été exécuté.
async function posterCharge(client, refs, { merchantId, userId, charge, entryDate, amount, paymentMethod, period, label }) {
  const codeCredit = COMPTE_PAR_MODE[paymentMethod];
  const compteCredit = refs.comptes.get(codeCredit);
  const journalId = refs.journaux.get(JOURNAL_PAR_MODE[paymentMethod]);
  if (!compteCredit || !journalId) {
    throw erreurMetier(400, `Le compte ${codeCredit} ou le journal ${JOURNAL_PAR_MODE[paymentMethod]} est introuvable dans votre plan comptable.`);
  }
  const num = await client.query(
    `SELECT COALESCE(MAX(entry_number), 0) + 1 AS n FROM accounting_entries WHERE merchant_id = $1`,
    [merchantId]
  );
  const entree = await client.query(
    `INSERT INTO accounting_entries (merchant_id, journal_id, entry_number, entry_date, reference, label, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4::date, $5, $6, 'charge', $7, $8) RETURNING id, entry_number`,
    [merchantId, journalId, Number(num.rows[0].n), entryDate, period ? `CHG-${period}` : 'CHG', label, charge.id, userId || null]
  );
  const idEntree = entree.rows[0].id;
  await client.query(
    `INSERT INTO accounting_lines (entry_id, merchant_id, account_id, debit, credit, label) VALUES ($1, $2, $3, $4, 0, $5)`,
    [idEntree, merchantId, charge.account_id, amount, label]
  );
  await client.query(
    `INSERT INTO accounting_lines (entry_id, merchant_id, account_id, debit, credit, label) VALUES ($1, $2, $3, 0, $4, $5)`,
    [idEntree, merchantId, compteCredit, amount, label]
  );
  await client.query(
    `INSERT INTO accounting_charge_postings (merchant_id, charge_id, period, entry_id, entry_date, amount, payment_method)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7)`,
    [merchantId, charge.id, period || null, idEntree, entryDate, amount, paymentMethod]
  );
  return entree.rows[0].entry_number;
}

// Comptabilise les charges mensuelles échues qui ne l'ont pas encore été
// (24 mois maximum en arrière). Idempotent : un mois déjà traité — même
// annulé — n'est jamais recréé.
async function genererChargesRecurrentes(merchantId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const charges = await client.query(
      `SELECT id, label, account_id, amount, day_of_month, payment_method, start_month, created_at
       FROM accounting_charges
       WHERE merchant_id = $1 AND is_active = true AND is_recurring = true AND amount > 0`,
      [merchantId]
    );
    if (charges.rows.length === 0) {
      await client.query('COMMIT');
      return 0;
    }
    const deja = await client.query(
      `SELECT charge_id, period FROM accounting_charge_postings WHERE merchant_id = $1 AND period IS NOT NULL`,
      [merchantId]
    );
    const faits = new Set(deja.rows.map((r) => `${r.charge_id}|${r.period}`));
    const refs = await chargerReferences(client, merchantId);
    const jourJ = aujourdhui();
    const moisCourant = jourJ.slice(0, 7);
    const plancher = moisAvant(moisCourant, 23);
    let crees = 0;
    for (const c of charges.rows) {
      let m = c.start_month || new Date(c.created_at).toISOString().slice(0, 7);
      if (m < plancher) m = plancher;
      for (; m <= moisCourant; m = moisSuivant(m)) {
        const date = `${m}-${String(c.day_of_month || 1).padStart(2, '0')}`;
        if (date > jourJ || faits.has(`${c.id}|${m}`)) continue;
        await posterCharge(client, refs, {
          merchantId, userId, charge: c, entryDate: date, amount: Number(c.amount),
          paymentMethod: c.payment_method, period: m, label: `${c.label} — ${m}`,
        });
        crees += 1;
      }
    }
    await client.query('COMMIT');
    return crees;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function repondreErreur(res, err, defaut) {
  if (err.statut) return res.status(err.statut).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: defaut });
}

// Valide et normalise le corps d'une création/modification de charge.
async function lireCharge(req, { partiel }) {
  const b = req.body;
  const out = {};
  if (!partiel || b.label !== undefined) {
    out.label = String(b.label || '').trim().slice(0, 150);
    if (!out.label) throw erreurMetier(400, 'Le nom de la charge est requis.');
  }
  if (!partiel || b.accountId !== undefined) {
    if (!UUID_RE.test(String(b.accountId || ''))) throw erreurMetier(400, 'Choisissez un compte de charge.');
    const compte = await pool.query(
      `SELECT id, code FROM accounting_accounts WHERE id = $1 AND merchant_id = $2 AND is_active = true`,
      [b.accountId, req.user.merchantId]
    );
    if (compte.rows.length === 0 || !compte.rows[0].code.startsWith('6')) {
      throw erreurMetier(400, 'Le compte doit être un compte de charges (classe 6).');
    }
    out.accountId = b.accountId;
  }
  if (b.amount !== undefined && b.amount !== null && b.amount !== '') {
    out.amount = arrondi(b.amount);
    if (!(out.amount > 0)) throw erreurMetier(400, 'Le montant doit être positif.');
  }
  if (b.isRecurring !== undefined) out.isRecurring = b.isRecurring === true;
  if (b.dayOfMonth !== undefined && b.dayOfMonth !== null) {
    out.dayOfMonth = parseInt(b.dayOfMonth, 10);
    if (!(out.dayOfMonth >= 1 && out.dayOfMonth <= 28)) throw erreurMetier(400, 'Le jour du mois doit être entre 1 et 28.');
  }
  if (b.paymentMethod !== undefined) {
    if (!MODES_PAIEMENT.includes(b.paymentMethod)) throw erreurMetier(400, 'Mode de paiement invalide.');
    out.paymentMethod = b.paymentMethod;
  }
  if (b.startMonth) {
    if (!MOIS_RE.test(b.startMonth)) throw erreurMetier(400, 'Mois de départ invalide.');
    out.startMonth = b.startMonth;
  }
  if (b.isActive !== undefined) out.isActive = b.isActive === true;
  return out;
}

router.get('/charges', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.label, c.amount, c.is_recurring, c.day_of_month, c.payment_method, c.start_month, c.is_active,
              a.id AS account_id, a.code AS account_code, a.label AS account_label
       FROM accounting_charges c JOIN accounting_accounts a ON a.id = c.account_id
       WHERE c.merchant_id = $1 ORDER BY c.is_active DESC, c.label`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la récupération des charges.');
  }
});

router.post('/charges', async (req, res) => {
  try {
    const c = await lireCharge(req, { partiel: false });
    const recurrente = c.isRecurring === true;
    if (recurrente && !(c.amount > 0)) throw erreurMetier(400, 'Une charge mensuelle a besoin d\'un montant.');
    const result = await pool.query(
      `INSERT INTO accounting_charges (merchant_id, label, account_id, amount, is_recurring, day_of_month, payment_method, start_month)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.user.merchantId, c.label, c.accountId, c.amount || null, recurrente, recurrente ? (c.dayOfMonth || 1) : null,
        c.paymentMethod || 'especes', recurrente ? (c.startMonth || aujourdhui().slice(0, 7)) : null]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la création de la charge.');
  }
});

router.patch('/charges/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Charge introuvable.' });
  try {
    const c = await lireCharge(req, { partiel: true });
    const result = await pool.query(
      `UPDATE accounting_charges SET
         label = COALESCE($3, label), account_id = COALESCE($4, account_id), amount = COALESCE($5, amount),
         is_recurring = COALESCE($6, is_recurring), day_of_month = COALESCE($7, day_of_month),
         payment_method = COALESCE($8, payment_method), start_month = COALESCE($9, start_month),
         is_active = COALESCE($10, is_active)
       WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [req.params.id, req.user.merchantId, c.label ?? null, c.accountId ?? null, c.amount ?? null, c.isRecurring ?? null,
        c.dayOfMonth ?? null, c.paymentMethod ?? null, c.startMonth ?? null, c.isActive ?? null]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Charge introuvable.' });
    res.json({ id: result.rows[0].id });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la modification de la charge.');
  }
});

// POST /accounting/charges/generate — comptabilise les charges mensuelles
// échues ; appelé automatiquement à l'ouverture de l'onglet Charges.
router.post('/charges/generate', async (req, res) => {
  try {
    const crees = await genererChargesRecurrentes(req.user.merchantId, req.user.id);
    res.json({ created: crees });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la comptabilisation des charges.');
  }
});

// POST /accounting/charges/:id/pay — dépense ponctuelle (ou paiement
// supplémentaire) d'une charge : crée directement l'écriture.
router.post('/charges/:id/pay', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Charge introuvable.' });
  const { date, amount, paymentMethod } = req.body;
  const montant = arrondi(amount);
  if (!dateOk(date)) return res.status(400).json({ error: 'Date invalide.' });
  if (!(montant > 0)) return res.status(400).json({ error: 'Le montant doit être positif.' });
  if (!MODES_PAIEMENT.includes(paymentMethod)) return res.status(400).json({ error: 'Mode de paiement invalide.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, req.user.merchantId);
    const charge = await client.query(
      `SELECT id, label, account_id FROM accounting_charges WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    if (charge.rows.length === 0) throw erreurMetier(404, 'Charge introuvable.');
    const refs = await chargerReferences(client, req.user.merchantId);
    const numero = await posterCharge(client, refs, {
      merchantId: req.user.merchantId, userId: req.user.id, charge: charge.rows[0],
      entryDate: date, amount: montant, paymentMethod, period: null, label: charge.rows[0].label,
    });
    await client.query('COMMIT');
    await logActivity({
      merchantId: req.user.merchantId, userId: req.user.id, action: 'accounting_charge',
      description: `a comptabilisé la charge « ${charge.rows[0].label} » (${Math.round(montant).toLocaleString('fr-FR')} FCFA, écriture n°${numero})`,
    });
    res.status(201).json({ entryNumber: numero });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, 'Erreur lors de la comptabilisation de la charge.');
  } finally {
    client.release();
  }
});

router.get('/charges/postings', async (req, res) => {
  const limite = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  try {
    const result = await pool.query(
      `SELECT p.id, p.period, to_char(p.entry_date, 'YYYY-MM-DD') AS entry_date, p.amount, p.payment_method, p.cancelled,
              c.label AS charge_label, a.code AS account_code, e.entry_number
       FROM accounting_charge_postings p
       JOIN accounting_charges c ON c.id = p.charge_id
       JOIN accounting_accounts a ON a.id = c.account_id
       LEFT JOIN accounting_entries e ON e.id = p.entry_id
       WHERE p.merchant_id = $1
       ORDER BY p.entry_date DESC, p.created_at DESC LIMIT $2`,
      [req.user.merchantId, limite]
    );
    res.json(result.rows);
  } catch (err) {
    repondreErreur(res, err, "Erreur lors de la récupération de l'historique des charges.");
  }
});

// DELETE /accounting/charges/postings/:id — annule une comptabilisation :
// l'écriture est supprimée et le mois reste marqué "annulé" (jamais recréé).
router.delete('/charges/postings/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Comptabilisation introuvable.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const posting = await client.query(
      `SELECT p.id, p.entry_id, c.label FROM accounting_charge_postings p JOIN accounting_charges c ON c.id = p.charge_id
       WHERE p.id = $1 AND p.merchant_id = $2 AND p.cancelled = false FOR UPDATE OF p`,
      [req.params.id, req.user.merchantId]
    );
    if (posting.rows.length === 0) throw erreurMetier(404, 'Comptabilisation introuvable.');
    if (posting.rows[0].entry_id) {
      await client.query(`DELETE FROM accounting_entries WHERE id = $1 AND merchant_id = $2`, [posting.rows[0].entry_id, req.user.merchantId]);
    }
    await client.query(`UPDATE accounting_charge_postings SET cancelled = true WHERE id = $1`, [req.params.id]);
    await client.query('COMMIT');
    await logActivity({
      merchantId: req.user.merchantId, userId: req.user.id, action: 'accounting_charge_cancelled',
      description: `a annulé une comptabilisation de la charge « ${posting.rows[0].label} »`,
    });
    res.json({ message: 'Comptabilisation annulée.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de l'annulation.");
  } finally {
    client.release();
  }
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
    const rows = await agreger(req.user.merchantId, null, date);
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
    if (resultat !== 0) capitauxPropres.push({ code: '—', label: "Résultat de l'exercice (non encore clôturé)", montant: resultat });
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
