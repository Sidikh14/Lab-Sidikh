const arrondi = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function anneesCloturees(db, merchantId) {
  const r = await db.query(`SELECT year FROM accounting_fiscal_years WHERE merchant_id = $1`, [merchantId]);
  return new Set(r.rows.map((x) => Number(x.year)));
}


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
      `INSERT INTO accounting_entries (merchant_id, journal_id, entry_number, entry_date, reference, label, source_type, source_id, source_sig, created_by, period_marker)
       SELECT $1::uuid, t.j, t.n, t.d::date, t.r, t.l, $2::text, t.sid, t.sig, $3::uuid, t.pm
       FROM unnest($4::uuid[], $5::bigint[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[]) AS t(j, n, d, r, l, sid, sig, pm)
       RETURNING id, source_id`,
      [merchantId, type, userId || null, morceau.map((e) => e.journalId), numeros, morceau.map((e) => e.date),
        morceau.map((e) => e.reference || null), morceau.map((e) => e.label), morceau.map((e) => e.sourceId), morceau.map((e) => e.sig),
        morceau.map((e) => e.marqueur || null)]
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


// ---------- Périodes closes : corrections (D2) et ventes tardives (D10) ----------
// Un exercice clôturé n'est jamais modifié. Quand un événement le concerne après la clôture
// (annulation, modification, vente hors-ligne arrivée tard), la synchro écrit dans le premier
// exercice ouvert une écriture « de correction » égale à l'écart entre ce qui devrait être
// comptabilisé et ce qui l'est déjà. Une vente jamais comptabilisée y est marquée « vente tardive ».
const TYPES_AVEC_CORRECTION = ['vente', 'retour', 'achat', 'reglement_client', 'reglement_assureur', 'reglement_fournisseur', 'caisse', 'facture_charge', 'reglement_charge'];
const SUFFIXE_CORRECTION = /~c\d{4}$/;

// Écart entre les lignes voulues et les lignes déjà comptabilisées, compte par compte.
// Renvoie les lignes de l'écriture de correction (vide si rien à corriger).
function calculerCorrection(lignesVoulues, lignesFigees) {
  const net = new Map();
  for (const l of lignesVoulues) net.set(l.compte, arrondi((net.get(l.compte) || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0)));
  for (const l of lignesFigees) net.set(l.compte, arrondi((net.get(l.compte) || 0) - (Number(l.debit) || 0) + (Number(l.credit) || 0)));
  const lignes = [];
  for (const [compte, ecart] of [...net.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    if (Math.abs(ecart) < 1) continue;
    lignes.push(ecart > 0 ? { compte, debit: ecart, credit: 0 } : { compte, debit: 0, credit: -ecart });
  }
  const totalDebit = arrondi(lignes.reduce((t, l) => t + l.debit, 0));
  const totalCredit = arrondi(lignes.reduce((t, l) => t + l.credit, 0));
  return totalDebit === totalCredit ? lignes : [];
}

async function lireLignesFigees(client, merchantId, type, closes) {
  if (closes.size === 0) return new Map();
  const r = await client.query(
    `SELECT e.source_id, a.code, COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
     FROM accounting_entries e
     JOIN accounting_lines l ON l.entry_id = e.id
     JOIN accounting_accounts a ON a.id = l.account_id
     WHERE e.merchant_id = $1 AND e.source_type = $2 AND EXTRACT(YEAR FROM e.entry_date)::int = ANY($3::int[])
     GROUP BY e.source_id, a.code`,
    [merchantId, type, [...closes]]
  );
  const parBase = new Map();
  for (const row of r.rows) {
    const base = row.source_id.replace(SUFFIXE_CORRECTION, '');
    if (!parBase.has(base)) parBase.set(base, []);
    parBase.get(base).push({ compte: row.code, debit: Number(row.d), credit: Number(row.c) });
  }
  return parBase;
}

// Transforme les écritures voulues : celles qui touchent un exercice clos deviennent des corrections
// datées du premier exercice ouvert.
async function appliquerCorrections(client, merchantId, type, voulues, closes) {
  if (closes.size === 0 || !TYPES_AVEC_CORRECTION.includes(type)) return voulues;
  const figees = await lireLignesFigees(client, merchantId, type, closes);
  const premiereOuverte = Math.max(...closes) + 1;
  const dateReport = `${premiereOuverte}-01-01`;
  const voulueParBase = new Map(voulues.map((v) => [v.sourceId, v]));
  const resultat = [];
  const traites = new Set();

  for (const v of voulues) {
    const dejaFige = figees.has(v.sourceId);
    const dansExerciceClos = closes.has(Number(String(v.date).slice(0, 4)));
    if (!dejaFige && !dansExerciceClos) {
      resultat.push(v);
      continue;
    }
    traites.add(v.sourceId);
    const lignes = calculerCorrection(v.lignes, figees.get(v.sourceId) || []);
    if (lignes.length === 0) continue;
    resultat.push({
      ...v,
      sourceId: `${v.sourceId}~c${premiereOuverte}`,
      date: dateReport,
      label: dejaFige ? `Correction — ${v.label}` : v.label,
      sig: `corr:${lignes.map((l) => `${l.compte}:${l.debit}:${l.credit}`).join('|')}`,
      lignes,
      marqueur: !dejaFige && type === 'vente' ? 'vente_tardive' : 'correction',
    });
  }
  // Ce qui a été comptabilisé dans un exercice clos mais n'existe plus à la source (annulation) : on l'extourne.
  for (const [base, lignesFigees] of figees) {
    if (traites.has(base) || voulueParBase.has(base)) continue;
    const lignes = calculerCorrection([], lignesFigees);
    if (lignes.length === 0) continue;
    resultat.push({
      sourceId: `${base}~c${premiereOuverte}`, date: dateReport, journal: 'OD', reference: null,
      label: `Correction — annulation (${base})`,
      sig: `corr:${lignes.map((l) => `${l.compte}:${l.debit}:${l.credit}`).join('|')}`,
      lignes, marqueur: 'correction',
    });
  }
  return resultat;
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
  voulues = await appliquerCorrections(client, merchantId, type, voulues, closes);
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


// ---- fausse base ----
function fauxClient(etat) {
  return {
    async query(sql, params) {
      if (/FROM accounting_fiscal_years/.test(sql)) return { rows: [...etat.closes].map((y) => ({ year: y })) };
      if (/SELECT id, source_id, source_sig/.test(sql)) return { rows: etat.entries.filter((e) => e.type === params[1]).map((e) => ({ id: e.id, source_id: e.source_id, source_sig: e.sig, d: e.date })) };
      if (/GROUP BY e.source_id, a.code/.test(sql)) {
        const out = new Map();
        for (const e of etat.entries.filter((x) => x.type === params[1] && params[2].includes(Number(x.date.slice(0, 4))))) {
          for (const l of e.lignes) { const k = e.source_id + '|' + l.compte; const o = out.get(k) || { source_id: e.source_id, code: l.compte, d: 0, c: 0 }; o.d += l.debit; o.c += l.credit; out.set(k, o); }
        }
        return { rows: [...out.values()] };
      }
      if (/DELETE FROM accounting_entries/.test(sql)) { etat.supprimees.push(...params[1]); etat.entries = etat.entries.filter((e) => !params[1].includes(e.id)); return { rows: [] }; }
      if (/MAX\(entry_number\)/.test(sql)) return { rows: [{ n: 100 }] };
      if (/INSERT INTO accounting_entries/.test(sql)) {
        const [, type, , , , dates, , labels, sids, sigs, marqueurs] = params;
        const rows = sids.map((sid, i) => { const id = 'new' + (etat.seq++); etat.entries.push({ id, type, source_id: sid, sig: sigs[i], date: dates[i], label: labels[i], marqueur: marqueurs[i], lignes: [] }); return { id, source_id: sid }; });
        return { rows };
      }
      if (/INSERT INTO accounting_lines/.test(sql)) {
        const [, eids, comptes, debits, credits] = params;
        eids.forEach((eid, i) => etat.entries.find((e) => e.id === eid).lignes.push({ compte: comptes[i], debit: Number(debits[i]), credit: Number(credits[i]) }));
        return { rows: [] };
      }
      throw new Error('requête inattendue : ' + sql.slice(0, 60));
    },
  };
}
const refs = {
  journaux: new Map([['VT', 'jVT'], ['OD', 'jOD']]),
  comptesParCode: new Map([['411', '411'], ['701', '701'], ['4431', '4431'], ['571', '571']].map(([c]) => [c, c])),
};
const l = (compte, debit, credit) => ({ compte, debit, credit });
const vente = (id, date, ttc) => ({ sourceId: id, date, journal: 'VT', reference: id, label: 'Vente ' + id, sig: 's' + ttc, lignes: [l('571', ttc, 0), l('701', 0, ttc)] });
const assert = require('assert');

(async () => {
  // 1. Vente tardive : l'exercice 2025 est clos, une vente datée de 2025 arrive.
  let etat = { closes: new Set([2025]), entries: [], supprimees: [], seq: 1 };
  let r = await reconcilier(fauxClient(etat), 'm', 'u', refs, 'vente', [vente('V1', '2025-12-30', 1000)]);
  assert.equal(r.crees, 1);
  assert.equal(etat.entries[0].date, '2026-01-01');
  assert.equal(etat.entries[0].marqueur, 'vente_tardive');
  assert.equal(etat.entries[0].source_id, 'V1~c2026');
  // Rejouer la synchro ne doit rien recréer.
  r = await reconcilier(fauxClient(etat), 'm', 'u', refs, 'vente', [vente('V1', '2025-12-30', 1000)]);
  assert.equal(r.crees, 0); assert.equal(r.supprimees, 0);
  console.log('1 vente tardive OK (rejeu stable)');

  // 2. Vente comptabilisée avant la clôture, puis annulée après : extourne.
  etat = { closes: new Set([2025]), entries: [{ id: 'e1', type: 'vente', source_id: 'V2', sig: 's500', date: '2025-06-10', lignes: [l('571', 500, 0), l('701', 0, 500)] }], supprimees: [], seq: 1 };
  r = await reconcilier(fauxClient(etat), 'm', 'u', refs, 'vente', []);
  assert.equal(r.crees, 1); assert.equal(r.supprimees, 0);
  const corr = etat.entries.find((e) => e.source_id === 'V2~c2026');
  assert.equal(corr.date, '2026-01-01'); assert.equal(corr.marqueur, 'correction');
  const net = (e, c) => e.lignes.filter((x) => x.compte === c).reduce((t, x) => t + x.debit - x.credit, 0);
  assert.equal(net(corr, '571'), -500); assert.equal(net(corr, '701'), 500);
  r = await reconcilier(fauxClient(etat), 'm', 'u', refs, 'vente', []);
  assert.equal(r.crees, 0); assert.equal(r.supprimees, 0);
  console.log('2 annulation après clôture : extourne OK (rejeu stable)');

  // 3. Vente de 500 passée à 800 après la clôture : correction de +300.
  etat = { closes: new Set([2025]), entries: [{ id: 'e1', type: 'vente', source_id: 'V3', sig: 's500', date: '2025-06-10', lignes: [l('571', 500, 0), l('701', 0, 500)] }], supprimees: [], seq: 1 };
  r = await reconcilier(fauxClient(etat), 'm', 'u', refs, 'vente', [vente('V3', '2025-06-10', 800)]);
  assert.equal(r.crees, 1);
  const c3 = etat.entries.find((e) => e.source_id === 'V3~c2026');
  assert.equal(net(c3, '571'), 300); assert.equal(net(c3, '701'), -300);
  console.log('3 modification après clôture : écart de 300 OK');

  // 4. Aucun changement : rien à faire.
  etat = { closes: new Set([2025]), entries: [{ id: 'e1', type: 'vente', source_id: 'V4', sig: 's500', date: '2025-06-10', lignes: [l('571', 500, 0), l('701', 0, 500)] }], supprimees: [], seq: 1 };
  r = await reconcilier(fauxClient(etat), 'm', 'u', refs, 'vente', [vente('V4', '2025-06-10', 500)]);
  assert.equal(r.crees, 0); assert.equal(etat.entries.length, 1);
  console.log('4 vente inchangée dans un exercice clos : rien créé OK');

  // 5. Sans exercice clos : comportement normal.
  etat = { closes: new Set(), entries: [], supprimees: [], seq: 1 };
  r = await reconcilier(fauxClient(etat), 'm', 'u', refs, 'vente', [vente('V5', '2026-03-02', 200)]);
  assert.equal(r.crees, 1); assert.equal(etat.entries[0].source_id, 'V5'); assert.equal(etat.entries[0].marqueur, null);
  console.log('5 sans exercice clos : inchangé OK');

  // 6. Source non concernée (stock) : jamais de correction.
  etat = { closes: new Set([2025]), entries: [], supprimees: [], seq: 1 };
  r = await reconcilier(fauxClient(etat), 'm', 'u', refs, 'stock', [{ ...vente('ecart', '2026-02-02', 50), journal: 'OD' }]);
  assert.equal(r.crees, 1); assert.equal(etat.entries[0].source_id, 'ecart');
  console.log('6 source stock : inchangée OK');
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
