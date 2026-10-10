const express = require('express');
const PDFDocument = require('pdfkit');
const { getSoldeActuel, LABEL_METHODE } = require('../utils/cashBalance');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole, aRole } = require('../middleware/roles');
const { requireModule } = require('../middleware/modules');
const { requireOwnerModule } = require('../middleware/ownerModules');
const { requireComptaOuFiscalite } = require('../middleware/financePermissions');
const { logActivity } = require('../utils/activityLog');
const { initialiserComptabilite } = require('../utils/accountingSetup');
const { dessinerEtatPdf, dessinerPiedsDePage } = require('../utils/pdfEtat');

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
    // Le manager et le comptable accèdent à la comptabilité (le comptable peut cumuler d'autres rôles).
    if (!aRole(req.user, 'manager', 'comptable') || !req.user.merchantId) return res.json({ enabled: false });
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
// Natures soumises à la retenue à la source de 5 % (RAS Tiers et loyers) : compte -> nature BRS.
const TAUX_BRS = 0.05;
// Retenue due sur une base HT (en FCFA entiers).
const retenueBrs = (base) => Math.max(0, Math.round(Number(base) * TAUX_BRS));
const COMPTE_BRS = ['4478', 'État, retenues à la source (BRS)'];
const NATURES_BRS = { '622': 'loyer', '632': 'prestation', '624': 'prestation', '612': 'prestation', '618': 'prestation', '627': 'prestation' };

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
    // Le registre BRS n'est utile que si le module Fiscalité est activé pour ce commerçant.
    let brsActif = false;
    try {
      const f = await pool.query('SELECT fiscalite_enabled FROM merchants WHERE id = $1', [req.user.merchantId]);
      brsActif = f.rows[0]?.fiscalite_enabled === true;
    } catch (e) { /* colonne absente : on propose le champ de façon facultative */ }
    res.json({
      enabled: true,
      brsActif,
      natures: NATURES_CHARGES.filter((n) => presents.has(n[1])).map(([label, code]) => ({ label, code, brs: NATURES_BRS[code] || null })),
    });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors du chargement des natures de charges.');
  }
});


// ---------- Factures de charges : à payer plus tard ou payées par virement ----------
// Depuis « Nouvelle sortie de caisse », une charge peut être enregistrée sans sortie
// d'argent de la caisse : « À payer plus tard » (dette fournisseur, réglée ensuite
// depuis la caisse) ou « Virement » (payée directement par la banque).

async function debutComptabilite(db, merchantId) {
  const m = await db.query(
    `SELECT accounting_enabled, COALESCE(accounting_start_date, date_trunc('year', CURRENT_DATE)::date)::text AS debut
     FROM merchants WHERE id = $1`,
    [merchantId]
  );
  if (m.rows[0]?.accounting_enabled !== true) throw erreurMetier(400, "Le module comptabilité n'est pas activé.");
  return m.rows[0].debut;
}

// Ligne du registre BRS issue d'une facture de charge (créée au versement : virement immédiat
// ou règlement de la facture « à payer plus tard »).
async function enregistrerBrsFacture(client, merchantId, userId, factureId, { nom, ref, nature, date, montant, libelle }) {
  await client.query(
    `INSERT INTO accounting_brs_entries (merchant_id, beneficiary_name, beneficiary_ref, nature, paid_on, gross_ht, note, created_by, charge_bill_id)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9)
     ON CONFLICT (charge_bill_id) WHERE charge_bill_id IS NOT NULL DO NOTHING`,
    [merchantId, nom, ref || null, nature, date, montant, String(libelle || '').slice(0, 200), userId, factureId]
  );
}

router.get('/caisse/factures', accesCaisse, async (req, res) => {
  try {
    const m = await pool.query('SELECT accounting_enabled FROM merchants WHERE id = $1', [req.user.merchantId]);
    if (m.rows[0]?.accounting_enabled !== true) return res.json({ enabled: false, open: [], recent: [] });
    const open = await pool.query(
      `SELECT id::text AS id, label, amount, to_char(bill_date, 'YYYY-MM-DD') AS bill_date
       FROM accounting_charge_bills WHERE merchant_id = $1 AND paid_at IS NULL ORDER BY bill_date, created_at`,
      [req.user.merchantId]
    );
    const recent = await pool.query(
      `SELECT id::text AS id, label, amount, paid_method, to_char(paid_at, 'YYYY-MM-DD') AS paid_at
       FROM accounting_charge_bills WHERE merchant_id = $1 AND paid_at IS NOT NULL ORDER BY paid_at DESC, created_at DESC LIMIT 8`,
      [req.user.merchantId]
    );
    res.json({ enabled: true, open: open.rows, recent: recent.rows });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors du chargement des factures à payer.');
  }
});

router.post('/caisse/factures', accesCaisse, async (req, res) => {
  const { chargeAccount, detail, paymentMethod, brsBeneficiaryName, brsBeneficiaryRef } = req.body;
  const montant = arrondi(req.body.amount);
  // TVA déductible facultative : le montant saisi est TTC, la TVA en fait partie.
  const tva = arrondi(req.body.tvaAmount || 0);
  const date = req.body.billDate || aujourdhui();
  const nature = NATURES_CHARGES.find((n) => n[1] === String(chargeAccount));
  if (!nature) return res.status(400).json({ error: 'Choisissez la nature de la charge.' });
  if (!(montant > 0)) return res.status(400).json({ error: 'Le montant doit être positif.' });
  if (!(tva >= 0) || tva >= montant) return res.status(400).json({ error: 'La TVA doit être comprise entre 0 et le montant TTC.' });
  if (!['virement', 'a_payer'].includes(paymentMethod)) return res.status(400).json({ error: 'Mode invalide.' });
  if (!dateOk(date) || date > aujourdhui()) return res.status(400).json({ error: 'Date invalide.' });
  const libelle = `${nature[0]}${detail && String(detail).trim() ? ` — ${String(detail).trim().slice(0, 150)}` : ''}`;
  const merchantId = req.user.merchantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const debut = await debutComptabilite(client, merchantId);
    if (date < debut) throw erreurMetier(400, `Cette date est antérieure au début de la comptabilité (${debut}).`);
    await verifierExerciceOuvert(client, merchantId, date);
    await assurerCompte(client, merchantId, nature[1], nature[0]);
    if (tva > 0) await assurerCompte(client, merchantId, '445', 'État, TVA récupérable sur achats');
    const natureBrs = NATURES_BRS[nature[1]] || null;
    const beneficiaire = natureBrs ? String(brsBeneficiaryName || '').trim().slice(0, 200) : '';
    const refBeneficiaire = beneficiaire && brsBeneficiaryRef ? String(brsBeneficiaryRef).trim().slice(0, 40) : null;
    const baseBrs = arrondi(montant - tva);
    const retenue = beneficiaire && paymentMethod === 'virement' ? retenueBrs(baseBrs) : 0;
    if (beneficiaire) await assurerCompte(client, merchantId, COMPTE_BRS[0], COMPTE_BRS[1]);
    const facture = await client.query(
      `INSERT INTO accounting_charge_bills (merchant_id, nature_account, label, amount, bill_date, warehouse_id, paid_at, paid_method, created_by,
                                            brs_nature, brs_beneficiary_name, brs_beneficiary_ref, tva_amount, brs_retenue)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7::date, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [merchantId, nature[1], libelle, montant, date, UUID_RE.test(String(req.body.warehouseId || '')) ? req.body.warehouseId : null,
        paymentMethod === 'virement' ? date : null, paymentMethod === 'virement' ? 'virement' : null, req.user.id,
        beneficiaire ? natureBrs : null, beneficiaire || null, refBeneficiaire, tva, retenue]
    );
    // Virement : la somme est versée tout de suite, la retenue est donc due ce mois-ci.
    if (paymentMethod === 'virement' && beneficiaire) {
      await enregistrerBrsFacture(client, merchantId, req.user.id, facture.rows[0].id, { nom: beneficiaire, ref: refBeneficiaire, nature: natureBrs, date, montant: baseBrs, libelle });
    }
    await client.query('COMMIT');
    ETAT_SYNCHRO.delete(merchantId);
    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de l'enregistrement de la charge.");
  } finally {
    client.release();
  }
});

// Règlement d'une facture à payer : depuis la caisse (espèces, Wave, Orange Money) ou par virement.
router.post('/caisse/factures/:id/payer', accesCaisse, async (req, res) => {
  const { paymentMethod, warehouseId } = req.body;
  const date = req.body.paymentDate || aujourdhui();
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Facture invalide.' });
  if (![...MODES_CAISSE, 'virement'].includes(paymentMethod)) return res.status(400).json({ error: 'Mode de paiement invalide.' });
  if (!dateOk(date) || date > aujourdhui()) return res.status(400).json({ error: 'Date invalide.' });
  const merchantId = req.user.merchantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    await debutComptabilite(client, merchantId);
    const f = await client.query(
      `SELECT id, label, amount, COALESCE(tva_amount, 0) AS tva, to_char(bill_date, 'YYYY-MM-DD') AS d, brs_nature, brs_beneficiary_name, brs_beneficiary_ref FROM accounting_charge_bills
       WHERE id = $1 AND merchant_id = $2 AND paid_at IS NULL FOR UPDATE`,
      [req.params.id, merchantId]
    );
    if (f.rows.length === 0) throw erreurMetier(404, 'Facture introuvable ou déjà réglée.');
    const facture = f.rows[0];
    if (date < facture.d) throw erreurMetier(400, 'Le règlement ne peut pas précéder la facture.');
    await verifierExerciceOuvert(client, merchantId, date);
    const baseBrs = arrondi(Number(facture.amount) - Number(facture.tva));
    const avecBrs = Boolean(facture.brs_nature && facture.brs_beneficiary_name);
    const retenue = avecBrs ? retenueBrs(baseBrs) : 0;
    const sortieNette = arrondi(Number(facture.amount) - retenue);
    if (avecBrs) await assurerCompte(client, merchantId, COMPTE_BRS[0], COMPTE_BRS[1]);
    let depenseId = null;
    if (paymentMethod !== 'virement') {
      await verifierCaisse(req, client, merchantId, warehouseId, paymentMethod, sortieNette);
      const d = await client.query(
        `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date, movement_type, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6::date, 'sortie', $7) RETURNING id`,
        [merchantId, req.user.id, paymentMethod, sortieNette, `${MOTIF_REGLEMENT}${facture.label}`, date, warehouseId]
      );
      depenseId = d.rows[0].id;
    }
    await client.query(
      `UPDATE accounting_charge_bills SET paid_at = $2::date, paid_method = $3, paid_cash_expense_id = $4, brs_retenue = $5 WHERE id = $1`,
      [facture.id, date, paymentMethod, depenseId, retenue]
    );
    if (facture.brs_nature && facture.brs_beneficiary_name) {
      await enregistrerBrsFacture(client, merchantId, req.user.id, facture.id, {
        nom: facture.brs_beneficiary_name, ref: facture.brs_beneficiary_ref, nature: facture.brs_nature,
        date, montant: baseBrs, libelle: facture.label,
      });
    }
    await client.query('COMMIT');
    ETAT_SYNCHRO.delete(merchantId);
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, 'Erreur lors du règlement de la facture.');
  } finally {
    client.release();
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

// ---------- Rappels fiscaux (tableau de bord du manager, du gérant et du comptable) ----------
// Pour chacun des trois derniers mois, on liste les déclarations mensuelles à déposer (TVA, retenues sur
// salaires, BRS) qui ne sont pas encore enregistrées comme déposées, dès 10 jours avant leur échéance
// (le 15 du mois suivant, reportée au lundi si elle tombe un week-end).
const AVANCE_RAPPEL_JOURS = 10;
const JOURS_URGENT = 3;

const moisPrecedents = (jour, n) => {
  const [a, m] = jour.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 2 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
};
const ecartJours = (de, a) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000);

function calculerAlertesFiscales({ jour, regime, depots, activite }) {
  const alertes = [];
  for (const mois of moisPrecedents(jour, 3)) {
    const limite = limiteDepot(mois);
    const joursRestants = ecartJours(jour, limite);
    if (joursRestants > AVANCE_RAPPEL_JOURS) continue;
    const declarations = [
      { kind: 'tva', depot: 'tva', label: 'Déclaration de TVA', concerne: regime !== 'cgu' && activite.tva.has(mois) },
      { kind: 'salaires', depot: 'ir', label: 'Retenues sur salaires (IR, TRIMF, CFCE)', concerne: activite.salaires.has(mois) },
      { kind: 'brs', depot: 'brs', label: 'Déclaration de la BRS (retenue à la source)', concerne: activite.brs.has(mois) },
    ];
    for (const d of declarations) {
      if (!d.concerne || depots.has(`${d.depot}|${mois}`)) continue;
      alertes.push({
        id: `${d.kind}-${mois}`, kind: d.kind, label: d.label, periode: libellePeriode(mois), mois, limite, joursRestants,
        statut: joursRestants < 0 ? 'retard' : joursRestants <= JOURS_URGENT ? 'urgent' : 'proche',
      });
    }
  }
  return alertes.sort((x, y) => x.joursRestants - y.joursRestants);
}

// GET /accounting/fiscal-alerts — ouvert au manager, au gérant et au comptable (lecture seule).
router.get('/fiscal-alerts', async (req, res) => {
  try {
    const vide = { enabled: false, alertes: [] };
    if (!aRole(req.user, 'manager', 'gerant', 'comptable') || !req.user.merchantId) return res.json(vide);
    const merchantId = req.user.merchantId;
    const actif = await pool.query('SELECT accounting_enabled FROM merchants WHERE id = $1', [merchantId]);
    if (actif.rows[0]?.accounting_enabled !== true) return res.json(vide);

    const jour = aujourdhui();
    const mois = moisPrecedents(jour, 3);
    const debut = `${mois[mois.length - 1]}-01`;
    const [profil, deposes, ledger, brs] = await Promise.all([
      lireProfilFiscal(pool, merchantId),
      pool.query(`SELECT kind, period FROM accounting_tax_filings WHERE merchant_id = $1 AND kind IN ('tva', 'brs', 'ir') AND period = ANY($2)`, [merchantId, mois]),
      pool.query(
        `SELECT DISTINCT to_char(e.entry_date, 'YYYY-MM') AS m, a.code
         FROM accounting_lines l JOIN accounting_entries e ON e.id = l.entry_id JOIN accounting_accounts a ON a.id = l.account_id
         WHERE l.merchant_id = $1 AND a.code IN ('443', '445', '447', '442') AND e.entry_date >= $2::date AND e.source_type <> 'paiement_etat'`,
        [merchantId, debut]
      ),
      pool.query(`SELECT DISTINCT to_char(paid_on, 'YYYY-MM') AS m FROM accounting_brs_entries WHERE merchant_id = $1 AND paid_on >= $2::date`, [merchantId, debut]),
    ]);
    const activite = { tva: new Set(), salaires: new Set(), brs: new Set(brs.rows.map((r) => r.m)) };
    for (const r of ledger.rows) (['443', '445'].includes(r.code) ? activite.tva : activite.salaires).add(r.m);

    res.json({
      enabled: true,
      alertes: calculerAlertesFiscales({ jour, regime: profil.regime, depots: new Set(deposes.rows.map((r) => `${r.kind}|${r.period}`)), activite }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul des rappels fiscaux.' });
  }
});

// ---------- Pièces jointes des sorties de caisse et des factures de charges ----------
// Exception à la règle « manager uniquement » : le gérant et le caissier qui règlent des charges peuvent
// joindre un justificatif aux sorties de caisse de leur lieu et aux factures de charges, et supprimer
// leurs propres envois. Toute autre pièce (écritures, immobilisations…) reste réservée au manager.
const SOURCES_PIECES_CAISSE = {
  sortie_caisse: 'SELECT warehouse_id::text AS lieu, user_id::text AS auteur FROM cash_expenses WHERE id::text = $1 AND merchant_id = $2',
  facture_charge: 'SELECT warehouse_id::text AS lieu, created_by::text AS auteur FROM accounting_charge_bills WHERE id::text = $1 AND merchant_id = $2',
};

async function piecesCaisse(req, res, next) {
  if (aRole(req.user, 'manager', 'comptable')) return next(); // manager et comptable suivent le chemin habituel
  const refus = (msg = 'Les pièces jointes de la comptabilité sont réservées au manager.') => res.status(403).json({ error: msg });
  try {
    if (!ROLES_CAISSE.includes(req.user.role) || !req.user.merchantId) return refus('Accès refusé.');
    const m = await pool.query('SELECT accounting_enabled FROM merchants WHERE id = $1', [req.user.merchantId]);
    if (m.rows[0]?.accounting_enabled !== true) return refus("Le module comptabilité n'est pas activé.");

    let sourceType;
    let sourceId;
    const surUnePiece = req.path.match(/^\/([0-9a-f-]{36})(\/file)?$/i);
    if (req.path === '/' && ['GET', 'POST'].includes(req.method)) {
      ({ sourceType, sourceId } = req.query);
    } else if (surUnePiece && (req.method === 'DELETE' || (req.method === 'GET' && surUnePiece[2]))) {
      const p = await pool.query('SELECT source_type, source_id, created_by::text AS auteur FROM accounting_attachments WHERE id = $1 AND merchant_id = $2', [surUnePiece[1], req.user.merchantId]);
      if (p.rows.length === 0) return res.status(404).json({ error: 'Pièce introuvable.' });
      sourceType = p.rows[0].source_type;
      sourceId = p.rows[0].source_id;
      // Chacun ne supprime que ses propres envois.
      if (req.method === 'DELETE' && p.rows[0].auteur !== String(req.user.id)) return refus('Vous ne pouvez supprimer que vos propres pièces.');
    } else {
      return refus();
    }

    const requete = SOURCES_PIECES_CAISSE[sourceType];
    if (!requete || !sourceId) return refus();
    const source = await pool.query(requete, [String(sourceId), req.user.merchantId]);
    if (source.rows.length === 0) return res.status(404).json({ error: 'Opération introuvable.' });
    // Une sortie de caisse reste dans son lieu : le gérant et le caissier ne touchent que celles de leurs lieux ou les leurs.
    if (sourceType === 'sortie_caisse') {
      const { lieu, auteur } = source.rows[0];
      const lieuAutorise = !lieu || (req.user.warehouseIds || []).map(String).includes(lieu);
      if (!lieuAutorise && auteur !== String(req.user.id)) return refus('Cette sortie de caisse appartient à un autre lieu.');
    }
    req.pieceCaisse = true;
    next();
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la vérification des droits sur la pièce jointe.');
  }
}
router.use('/attachments', piecesCaisse);

// Tout le reste : manager uniquement ET module activé par l'owner (sauf pièces de caisse validées ci-dessus).
const sauf = (drapeau, garde) => (req, res, next) => (req[drapeau] ? next() : garde(req, res, next));
router.use(sauf('pieceCaisse', requireRole('manager', 'comptable')));
router.use(sauf('pieceCaisse', requireModule('comptabilite')));
// Un comptable n'ouvre que les pages que le manager lui a accordées (Comptabilité / Fiscalité).
router.use(sauf('pieceCaisse', requireComptaOuFiscalite(['/state-dues', '/state-payments', '/tax-settings', '/tax-profile', '/declarations', '/filings', '/brs-entries'])));
// Impôts, cotisations et paiements à l'État : module Fiscalité (activé séparément par l'owner).
router.use(['/state-dues', '/state-payments', '/tax-settings', '/tax-profile', '/declarations', '/filings', '/brs-entries'], requireOwnerModule('fiscalite'));

// Les consultations (journal, grand livre, balance, résultat, bilan) lancent
// d'abord la synchronisation automatique (au plus une fois toutes les 30 s) :
// rien n'est à saisir ni à actualiser à la main.
router.use(['/financing', '/adjustments', '/entries', '/ledger', '/general-ledger', '/trial-balance', '/income-statement', '/balance-sheet', '/state-dues', '/closing-preview', '/fiscal-years', '/declarations', '/reconciliations', '/aged-balance'], async (req, res, next) => {
  if (req.method === 'GET') await assurerSynchro(req.user.merchantId, req.user.id);
  next();
});

// ---------- Factures de charges : annulation (manager) ----------

router.delete('/charge-bills/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Facture invalide.' });
  const merchantId = req.user.merchantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const f = await client.query(
      `SELECT id, to_char(bill_date, 'YYYY-MM-DD') AS d FROM accounting_charge_bills
       WHERE id = $1 AND merchant_id = $2 AND paid_at IS NULL FOR UPDATE`,
      [req.params.id, merchantId]
    );
    if (f.rows.length === 0) throw erreurMetier(404, 'Facture introuvable ou déjà réglée.');
    await verifierExerciceOuvert(client, merchantId, f.rows[0].d);
    await client.query(`DELETE FROM accounting_charge_bills WHERE id = $1`, [req.params.id]);
    await client.query('COMMIT');
    ETAT_SYNCHRO.delete(merchantId);
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de l'annulation de la facture.");
  } finally {
    client.release();
  }
});

// ---------- Immobilisations ----------
// Registre des biens durables. Les écritures (acquisition, dotations mensuelles,
// cession) sont générées par la synchronisation à partir de ce registre.

router.get('/assets/categories', (req, res) => {
  res.json(Object.entries(CATEGORIES_IMMO).map(([key, c]) => ({
    key, label: c.label, duree: c.duree, amortissable: Boolean(c.amort),
  })));
});

const MODES_IMMO = ['especes', 'wave', 'orange_money', 'virement', 'a_payer', 'existant'];

router.get('/assets', async (req, res) => {
  try {
    const rows = await lireRegistreImmo(pool, req.user.merchantId);
    const jour = aujourdhui();
    res.json(rows.map((a) => {
      const plan = calendrierAmortissement(a, jour);
      const amorti = plan.length > 0 ? plan[plan.length - 1].cumul : 0;
      const base = arrondi(Number(a.cost) - Number(a.residual_value || 0));
      const duree = Number(a.useful_life_years) || 0;
      const cedee = Boolean(a.disposal_date);
      return {
        id: a.id, label: a.label, category: a.category, categoryLabel: CATEGORIES_IMMO[a.category]?.label || a.category,
        assetAccount: a.asset_account, acquisitionDate: a.acq, cost: Number(a.cost), residualValue: Number(a.residual_value || 0),
        usefulLifeYears: duree || null, paymentMethod: a.payment_method, debtOpen: a.payment_method === 'a_payer' && !a.paid,
        paidAt: a.paid || null, disposalDate: a.disp || null, disposalPrice: a.disposal_price === null ? null : Number(a.disposal_price),
        note: a.note || '',
        accumulated: amorti,
        netValue: cedee ? 0 : arrondi(Number(a.cost) - amorti),
        yearlyCharge: a.depreciation_account && duree > 0 ? arrondi(base / duree) : 0,
        status: cedee ? 'cedee' : (a.depreciation_account && amorti >= base ? 'amortie' : 'en_service'),
      };
    }));
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors du chargement des immobilisations.');
  }
});

router.post('/assets', async (req, res) => {
  const { category, paymentMethod, warehouseId, note } = req.body;
  const label = String(req.body.label || '').trim().slice(0, 150);
  const cat = CATEGORIES_IMMO[category];
  const cout = arrondi(req.body.cost);
  const residuelle = arrondi(req.body.residualValue || 0);
  const date = req.body.acquisitionDate;
  const duree = cat?.amort ? Number(req.body.usefulLifeYears || cat.duree) : null;
  if (!label) return res.status(400).json({ error: "Donnez un nom à l'immobilisation." });
  if (!cat) return res.status(400).json({ error: 'Catégorie invalide.' });
  if (!(cout > 0)) return res.status(400).json({ error: 'Le coût doit être positif.' });
  if (residuelle < 0 || residuelle >= cout) return res.status(400).json({ error: 'La valeur résiduelle doit être inférieure au coût.' });
  if (cat.amort && !(duree >= 0.5 && duree <= 60)) return res.status(400).json({ error: "La durée d'amortissement doit être entre 6 mois et 60 ans." });
  if (!MODES_IMMO.includes(paymentMethod)) return res.status(400).json({ error: 'Mode de paiement invalide.' });
  if (!dateOk(date) || date > aujourdhui()) return res.status(400).json({ error: "Date d'acquisition invalide." });
  const merchantId = req.user.merchantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const debut = await debutComptabilite(client, merchantId);
    if (date < debut && paymentMethod !== 'existant') {
      throw erreurMetier(400, `Ce bien a été acquis avant le début de la comptabilité (${debut}) : choisissez « Déjà possédé avant la comptabilité ».`);
    }
    await verifierExerciceOuvert(client, merchantId, date < debut ? debut : date);
    const enCaisse = MODES_CAISSE.includes(paymentMethod);
    if (enCaisse) await verifierCaisse(req, client, merchantId, warehouseId, paymentMethod, cout);
    await assurerCompte(client, merchantId, cat.compte, cat.nom);
    if (cat.amort) await assurerCompte(client, merchantId, cat.amort, cat.nomAmort);
    for (const [code, nom] of COMPTES_IMMO_COMMUNS) await assurerCompte(client, merchantId, code, nom);
    let depenseId = null;
    if (enCaisse) {
      const d = await client.query(
        `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date, movement_type, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6::date, 'sortie', $7) RETURNING id`,
        [merchantId, req.user.id, paymentMethod, cout, `${MOTIF_ACQUISITION}${label}`, date, warehouseId]
      );
      depenseId = d.rows[0].id;
    }
    await client.query(
      `INSERT INTO accounting_assets (merchant_id, label, category, asset_account, depreciation_account, acquisition_date, cost, residual_value,
                                      useful_life_years, payment_method, cash_expense_id, warehouse_id, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [merchantId, label, category, cat.compte, cat.amort || null, date, cout, residuelle, duree, paymentMethod, depenseId,
        enCaisse ? warehouseId : null, note ? String(note).trim().slice(0, 300) : null, req.user.id]
    );
    await client.query('COMMIT');
    ETAT_SYNCHRO.delete(merchantId);
    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de l'enregistrement de l'immobilisation.");
  } finally {
    client.release();
  }
});

// Règlement d'une immobilisation achetée « à payer ».
router.post('/assets/:id/pay', async (req, res) => {
  const { paymentMethod, warehouseId } = req.body;
  const date = req.body.paymentDate || aujourdhui();
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Immobilisation invalide.' });
  if (![...MODES_CAISSE, 'virement'].includes(paymentMethod)) return res.status(400).json({ error: 'Mode de paiement invalide.' });
  if (!dateOk(date) || date > aujourdhui()) return res.status(400).json({ error: 'Date invalide.' });
  const merchantId = req.user.merchantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const r = await client.query(
      `SELECT id, label, cost, to_char(acquisition_date, 'YYYY-MM-DD') AS acq FROM accounting_assets
       WHERE id = $1 AND merchant_id = $2 AND payment_method = 'a_payer' AND paid_at IS NULL FOR UPDATE`,
      [req.params.id, merchantId]
    );
    if (r.rows.length === 0) throw erreurMetier(404, 'Immobilisation introuvable ou déjà réglée.');
    const a = r.rows[0];
    if (date < a.acq) throw erreurMetier(400, "Le règlement ne peut pas précéder l'acquisition.");
    await verifierExerciceOuvert(client, merchantId, date);
    let depenseId = null;
    if (paymentMethod !== 'virement') {
      await verifierCaisse(req, client, merchantId, warehouseId, paymentMethod, Number(a.cost));
      const d = await client.query(
        `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date, movement_type, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6::date, 'sortie', $7) RETURNING id`,
        [merchantId, req.user.id, paymentMethod, Number(a.cost), `${MOTIF_REGLEMENT}${a.label}`, date, warehouseId]
      );
      depenseId = d.rows[0].id;
    }
    await client.query(
      `UPDATE accounting_assets SET paid_at = $2::date, paid_method = $3, paid_cash_expense_id = $4 WHERE id = $1`,
      [a.id, date, paymentMethod, depenseId]
    );
    await client.query('COMMIT');
    ETAT_SYNCHRO.delete(merchantId);
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors du règlement de l'immobilisation.");
  } finally {
    client.release();
  }
});

// Cession ou mise au rebut (prix = 0). Les dotations s'arrêtent le mois de la sortie.
router.post('/assets/:id/dispose', async (req, res) => {
  const { paymentMethod, warehouseId } = req.body;
  const date = req.body.date || aujourdhui();
  const prix = arrondi(req.body.price || 0);
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Immobilisation invalide.' });
  if (!dateOk(date) || date > aujourdhui()) return res.status(400).json({ error: 'Date invalide.' });
  if (prix < 0) return res.status(400).json({ error: 'Le prix ne peut pas être négatif.' });
  if (prix > 0 && ![...MODES_CAISSE, 'virement'].includes(paymentMethod)) {
    return res.status(400).json({ error: "Choisissez comment le prix de cession a été encaissé." });
  }
  const merchantId = req.user.merchantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const r = await client.query(
      `SELECT id, label, to_char(acquisition_date, 'YYYY-MM-DD') AS acq FROM accounting_assets
       WHERE id = $1 AND merchant_id = $2 AND disposal_date IS NULL FOR UPDATE`,
      [req.params.id, merchantId]
    );
    if (r.rows.length === 0) throw erreurMetier(404, 'Immobilisation introuvable ou déjà sortie.');
    const a = r.rows[0];
    if (date < a.acq) throw erreurMetier(400, "La sortie ne peut pas précéder l'acquisition.");
    await verifierExerciceOuvert(client, merchantId, date);
    let depenseId = null;
    if (prix > 0 && paymentMethod !== 'virement') {
      if (!UUID_RE.test(String(warehouseId || ''))) throw erreurMetier(400, "Choisissez la boutique qui encaisse (page Caisse).");
      const w = await client.query(`SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2`, [warehouseId, merchantId]);
      if (w.rows.length === 0) throw erreurMetier(400, 'Boutique introuvable.');
      const d = await client.query(
        `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date, movement_type, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6::date, 'entree', $7) RETURNING id`,
        [merchantId, req.user.id, paymentMethod, prix, `${MOTIF_CESSION}${a.label}`, date, warehouseId]
      );
      depenseId = d.rows[0].id;
    }
    await client.query(
      `UPDATE accounting_assets SET disposal_date = $2::date, disposal_price = $3, disposal_method = $4, disposal_cash_id = $5 WHERE id = $1`,
      [a.id, date, prix, prix > 0 ? paymentMethod : null, depenseId]
    );
    await client.query('COMMIT');
    ETAT_SYNCHRO.delete(merchantId);
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, 'Erreur lors de la sortie de l\'immobilisation.');
  } finally {
    client.release();
  }
});

router.delete('/assets/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Immobilisation invalide.' });
  const merchantId = req.user.merchantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const r = await client.query(
      `SELECT id, to_char(acquisition_date, 'YYYY-MM-DD') AS acq, cash_expense_id, paid_cash_expense_id, disposal_cash_id
       FROM accounting_assets WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [req.params.id, merchantId]
    );
    if (r.rows.length === 0) throw erreurMetier(404, 'Immobilisation introuvable.');
    const a = r.rows[0];
    const closes = await anneesCloturees(client, merchantId);
    if ([...closes].some((an) => an >= Number(a.acq.slice(0, 4)))) {
      throw erreurMetier(400, 'Un exercice clôturé couvre cette immobilisation : elle ne peut plus être supprimée.');
    }
    const caisse = [a.cash_expense_id, a.paid_cash_expense_id, a.disposal_cash_id].filter(Boolean);
    if (caisse.length > 0) await client.query(`DELETE FROM cash_expenses WHERE merchant_id = $1 AND id::text = ANY($2::text[])`, [merchantId, caisse.map(String)]);
    await client.query(`DELETE FROM accounting_assets WHERE id = $1`, [a.id]);
    await client.query('COMMIT');
    ETAT_SYNCHRO.delete(merchantId);
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de la suppression de l'immobilisation.");
  } finally {
    client.release();
  }
});

// ---------- Capital, apports et emprunts (financement) ----------
// Opérations qui n'apparaissent ni dans les ventes ni dans les charges : capital versé,
// apport ou retrait de l'exploitant, emprunt reçu et remboursement (capital + intérêts).
// Les écritures sont générées par la synchronisation à partir de cette table.

const KINDS_FINANCEMENT = {
  capital: { entree: true, label: 'Capital' },
  apport: { entree: true, label: "Apport de l'exploitant" },
  retrait: { entree: false, label: "Retrait de l'exploitant" },
  emprunt: { entree: true, label: 'Emprunt reçu' },
  remboursement: { entree: false, label: "Remboursement d'emprunt" },
};
const MODES_FINANCEMENT = ['especes', 'wave', 'orange_money', 'virement', 'existant'];

router.get('/financing', async (req, res) => {
  try {
    const merchantId = req.user.merchantId;
    const ops = await pool.query(
      `SELECT id::text AS id, kind, label, amount, interest_amount, to_char(op_date, 'YYYY-MM-DD') AS op_date, payment_method
       FROM accounting_financing WHERE merchant_id = $1 ORDER BY op_date DESC, created_at DESC`,
      [merchantId]
    );
    const rows = await agreger(merchantId, null, aujourdhui());
    const solde = (code, sens) => {
      const r = rows.find((x) => x.code === code);
      return r ? arrondi(sens === 'credit' ? r.credit - r.debit : r.debit - r.credit) : 0;
    };
    res.json({
      operations: ops.rows.map((o) => ({
        id: o.id, kind: o.kind, kindLabel: KINDS_FINANCEMENT[o.kind]?.label || o.kind, label: o.label,
        amount: Number(o.amount), interest: Number(o.interest_amount), date: o.op_date, paymentMethod: o.payment_method,
      })),
      summary: { capital: solde('101', 'credit'), currentAccount: solde('462', 'credit'), loans: solde('162', 'credit') },
    });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors du chargement du financement.');
  }
});

router.post('/financing', async (req, res) => {
  const { kind, paymentMethod, warehouseId } = req.body;
  const k = KINDS_FINANCEMENT[kind];
  const montant = arrondi(req.body.amount);
  const interets = kind === 'remboursement' ? arrondi(req.body.interestAmount || 0) : 0;
  const date = req.body.opDate || aujourdhui();
  const libelle = String(req.body.label || '').trim().slice(0, 150);
  if (!k) return res.status(400).json({ error: "Type d'opération invalide." });
  if (!(montant > 0)) return res.status(400).json({ error: 'Le montant doit être positif.' });
  if (interets < 0) return res.status(400).json({ error: 'Les intérêts ne peuvent pas être négatifs.' });
  if (!MODES_FINANCEMENT.includes(paymentMethod)) return res.status(400).json({ error: 'Mode invalide.' });
  if (paymentMethod === 'existant' && !['capital', 'emprunt'].includes(kind)) {
    return res.status(400).json({ error: "« Déjà en place avant la comptabilité » ne concerne que le capital et un emprunt en cours." });
  }
  if (!dateOk(date) || date > aujourdhui()) return res.status(400).json({ error: 'Date invalide.' });
  const merchantId = req.user.merchantId;
  const enCaisse = MODES_CAISSE.includes(paymentMethod);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const debut = await debutComptabilite(client, merchantId);
    if (date < debut && paymentMethod !== 'existant') {
      throw erreurMetier(400, `Cette date est antérieure au début de la comptabilité (${debut}) : choisissez « Déjà en place avant la comptabilité ».`);
    }
    await verifierExerciceOuvert(client, merchantId, date < debut ? debut : date);
    if (kind === 'remboursement') {
      const s = await client.query(
        `SELECT COALESCE(SUM(CASE WHEN kind = 'emprunt' THEN amount ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN kind = 'remboursement' THEN amount ELSE 0 END), 0) AS reste
         FROM accounting_financing WHERE merchant_id = $1`,
        [merchantId]
      );
      if (montant > Number(s.rows[0].reste)) {
        throw erreurMetier(400, `Le capital remboursé dépasse le solde des emprunts enregistrés (${Math.round(Number(s.rows[0].reste)).toLocaleString('fr-FR')} FCFA). Enregistrez d'abord l'emprunt.`);
      }
    }
    for (const [code, nom] of COMPTES_FINANCEMENT) await assurerCompte(client, merchantId, code, nom);
    let depenseId = null;
    if (enCaisse) {
      const total = arrondi(montant + interets);
      if (k.entree) {
        if (!UUID_RE.test(String(warehouseId || ''))) throw erreurMetier(400, 'Choisissez la boutique dont la caisse reçoit le versement (page Caisse).');
        const w = await client.query(`SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2`, [warehouseId, merchantId]);
        if (w.rows.length === 0) throw erreurMetier(400, 'Boutique introuvable.');
      } else {
        await verifierCaisse(req, client, merchantId, warehouseId, paymentMethod, total);
      }
      const d = await client.query(
        `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date, movement_type, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8) RETURNING id`,
        [merchantId, req.user.id, paymentMethod, total, `${MOTIF_FINANCEMENT}${k.label}${libelle ? ` : ${libelle}` : ''}`, date, k.entree ? 'entree' : 'sortie', warehouseId]
      );
      depenseId = d.rows[0].id;
    }
    await client.query(
      `INSERT INTO accounting_financing (merchant_id, kind, label, amount, interest_amount, op_date, payment_method, cash_expense_id, warehouse_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10)`,
      [merchantId, kind, libelle || k.label, montant, interets, date, paymentMethod, depenseId, enCaisse ? warehouseId : null, req.user.id]
    );
    await client.query('COMMIT');
    ETAT_SYNCHRO.delete(merchantId);
    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de l'enregistrement de l'opération.");
  } finally {
    client.release();
  }
});

router.delete('/financing/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Opération invalide.' });
  const merchantId = req.user.merchantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const r = await client.query(
      `SELECT id, kind, amount, to_char(op_date, 'YYYY-MM-DD') AS d, cash_expense_id
       FROM accounting_financing WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [req.params.id, merchantId]
    );
    if (r.rows.length === 0) throw erreurMetier(404, 'Opération introuvable.');
    const o = r.rows[0];
    await verifierExerciceOuvert(client, merchantId, o.d);
    if (o.kind === 'emprunt') {
      // On ne supprime pas un emprunt déjà remboursé en partie : le solde deviendrait négatif.
      const s = await client.query(
        `SELECT COALESCE(SUM(CASE WHEN kind = 'emprunt' THEN amount ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN kind = 'remboursement' THEN amount ELSE 0 END), 0) AS reste
         FROM accounting_financing WHERE merchant_id = $1`,
        [merchantId]
      );
      if (Number(s.rows[0].reste) - Number(o.amount) < 0) {
        throw erreurMetier(400, 'Des remboursements sont enregistrés sur cet emprunt : supprimez-les d\'abord.');
      }
    }
    if (o.cash_expense_id) await client.query(`DELETE FROM cash_expenses WHERE merchant_id = $1 AND id::text = $2`, [merchantId, String(o.cash_expense_id)]);
    await client.query(`DELETE FROM accounting_financing WHERE id = $1`, [o.id]);
    await client.query('COMMIT');
    ETAT_SYNCHRO.delete(merchantId);
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de la suppression de l'opération.");
  } finally {
    client.release();
  }
});

// ---------- Régularisations de fin de période ----------
// Charges payées d'avance (assurance annuelle…) ou engagées mais pas encore facturées
// (électricité consommée en décembre, facture reçue en janvier…). Elles rattachent la
// charge à la bonne période ; l'extourne (écriture inverse) est passée le lendemain.

const KINDS_REGULARISATION = {
  charge_avance: 'Charge constatée d\'avance',
  charge_a_payer: 'Charge à payer',
};

router.get('/adjustments', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id::text AS id, kind, nature_account, label, amount, reverse, to_char(adj_date, 'YYYY-MM-DD') AS adj_date
       FROM accounting_adjustments WHERE merchant_id = $1 ORDER BY adj_date DESC, created_at DESC`,
      [req.user.merchantId]
    );
    res.json(r.rows.map((a) => ({
      id: a.id, kind: a.kind, kindLabel: KINDS_REGULARISATION[a.kind] || a.kind, natureAccount: a.nature_account,
      natureLabel: NATURES_CHARGES.find((n) => n[1] === a.nature_account)?.[0] || a.nature_account,
      label: a.label, amount: Number(a.amount), reverse: a.reverse, date: a.adj_date, reverseDate: a.reverse ? jourSuivant(a.adj_date) : null,
    })));
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors du chargement des régularisations.');
  }
});

router.post('/adjustments', async (req, res) => {
  const { kind, chargeAccount } = req.body;
  const montant = arrondi(req.body.amount);
  const date = req.body.adjDate || aujourdhui();
  const nature = NATURES_CHARGES.find((n) => n[1] === String(chargeAccount));
  const libelle = String(req.body.label || '').trim().slice(0, 150);
  if (!KINDS_REGULARISATION[kind]) return res.status(400).json({ error: 'Type de régularisation invalide.' });
  if (!nature) return res.status(400).json({ error: 'Choisissez la nature de la charge.' });
  if (!(montant > 0)) return res.status(400).json({ error: 'Le montant doit être positif.' });
  if (!dateOk(date) || date > aujourdhui()) return res.status(400).json({ error: 'Date invalide.' });
  const merchantId = req.user.merchantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const debut = await debutComptabilite(client, merchantId);
    if (date < debut) throw erreurMetier(400, `Cette date est antérieure au début de la comptabilité (${debut}).`);
    await verifierExerciceOuvert(client, merchantId, date);
    for (const [code, nom] of COMPTES_FINANCEMENT) await assurerCompte(client, merchantId, code, nom);
    await assurerCompte(client, merchantId, nature[1], nature[0]);
    await client.query(
      `INSERT INTO accounting_adjustments (merchant_id, kind, nature_account, label, amount, adj_date, reverse, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8)`,
      [merchantId, kind, nature[1], libelle || nature[0], montant, date, req.body.reverse !== false, req.user.id]
    );
    await client.query('COMMIT');
    ETAT_SYNCHRO.delete(merchantId);
    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de l'enregistrement de la régularisation.");
  } finally {
    client.release();
  }
});

router.delete('/adjustments/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Régularisation invalide.' });
  const merchantId = req.user.merchantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const r = await client.query(
      `SELECT id, reverse, to_char(adj_date, 'YYYY-MM-DD') AS d FROM accounting_adjustments WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [req.params.id, merchantId]
    );
    if (r.rows.length === 0) throw erreurMetier(404, 'Régularisation introuvable.');
    await verifierExerciceOuvert(client, merchantId, r.rows[0].d);
    if (r.rows[0].reverse) await verifierExerciceOuvert(client, merchantId, jourSuivant(r.rows[0].d));
    await client.query(`DELETE FROM accounting_adjustments WHERE id = $1`, [r.rows[0].id]);
    await client.query('COMMIT');
    ETAT_SYNCHRO.delete(merchantId);
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, 'Erreur lors de la suppression de la régularisation.');
  } finally {
    client.release();
  }
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
  brs:      { code: COMPTE_BRS[0], label: 'RAS Tiers et loyers (BRS)', nomCompte: COMPTE_BRS[1] },
  cfce:     { code: '442', label: 'CFCE',                      nomCompte: 'État, impôts et taxes' },
  is:       { code: '441', label: 'Impôt sur les résultats',   nomCompte: 'État, impôts sur les bénéfices' },
};
const MODES_ETAT = ['especes', 'wave', 'orange_money', 'virement'];
const NOM_TRESORERIE = { '571': 'Caisse', '5211': 'Wave', '5212': 'Orange Money', '521': 'Banque' };
const MOTIF_ETAT = 'Paiement État — ';
const MOTIF_REGLEMENT = 'Règlement facture — ';
const MOTIF_ACQUISITION = 'Acquisition — ';
const MOTIF_CESSION = 'Cession — ';
const MOTIF_FINANCEMENT = 'Financement — ';

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
const IMPOTS_MENSUELS = ['tva', 'retenues', 'brs', 'cfce'];
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
       WHERE l.merchant_id = $1 AND a.code IN ('443', '445', '447', '4478', '442', '431', '432')
         AND e.entry_date <= $2::date AND e.source_type <> 'paiement_etat'
       GROUP BY 1, 2`,
      [merchantId, date]
    );
    const acc = { collectee: {}, deductible: {}, retenues: {}, brs: {}, cfce: {}, css: {}, ipres: {} };
    const ajouter = (famille, m, v) => { acc[famille][m] = arrondi((acc[famille][m] || 0) + v); };
    for (const r of mouvements.rows) {
      const d = Number(r.d);
      const c = Number(r.c);
      if (r.code === '443') ajouter('collectee', r.m, c - d);
      else if (r.code === '445') ajouter('deductible', r.m, d - c);
      else if (r.code === '447') ajouter('retenues', r.m, c - d);
      else if (r.code === '4478') ajouter('brs', r.m, c - d);
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

const nettoyerTexte = (v) => String(v ?? '').replace(/[\u202f\u00a0\u2009]/g, ' ').slice(0, 1500);

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
  const doc = new PDFDocument({ size: 'A4', layout: maxColonnes >= 6 ? 'landscape' : 'portrait', margin: 40, bufferPages: true });
  doc.on('error', (e) => console.error('pdfkit (comptabilité) :', e));
  const nomFichier = nettoyerTexte(titre || 'etat').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'etat';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nomFichier}.pdf"`);
  doc.pipe(res);

  dessinerEtatPdf(doc, { entreprise, titre, periode, sections }, nettoyerTexte);
  dessinerPiedsDePage(doc);
  doc.end();
});

// ---------- Déclarations DGID (TVA, retenues sur salaires) ----------
// Le module prépare les montants dans l'ordre des rubriques des déclarations de la DGID, avec une
// fiche PDF à recopier dans « Mon Espace Perso » / e-Tax. Le dépôt lui-même se fait sur le portail :
// une fois déposée, la déclaration est enregistrée ici avec son numéro de récépissé.

const REGIMES = ['cgu', 'reel_simplifie', 'reel_normal'];
const FORMES = ['societe_is', 'entreprise_individuelle'];
const NOMS_REGIME = { cgu: 'Contribution globale unique (CGU)', reel_simplifie: 'Réel simplifié', reel_normal: 'Réel normal' };

// Annexe « Exonérations » : ventes du mois sans TVA (hors exportations et suspensions, qui ont leur annexe).
// La ligne 15 vient du grand livre ; l'annexe liste les ventes concernées et expose l'écart éventuel avec elle,
// pour que le total de l'annexe soit toujours égal à la ligne 15.
function construireAnnexeExonerations(ventes, ligne15) {
  const total = arrondi(ventes.reduce((u, x) => u + Number(x.ht), 0));
  const ecart = arrondi(ligne15 - total);
  if (ventes.length === 0 && ligne15 <= 0) return { annexe: null, ecart: 0 };
  const lignes = ventes.map((x) => [dateFr(x.d), x.order_seq ? `V${x.order_seq}` : '—', x.client, fcfa(x.ht)]);
  if (ecart !== 0) {
    lignes.push([
      '', '',
      ecart > 0 ? 'Autres opérations exonérées (hors ventes)' : 'Ajustement (livraison ou retour non encore comptabilisé)',
      fcfa(ecart),
    ]);
  }
  lignes.push({ fort: true, cells: ['Total', '', '', fcfa(ligne15)] });
  return {
    annexe: {
      titre: 'Annexe EXONÉRATIONS',
      colonnes: [{ label: 'Date' }, { label: 'Vente' }, { label: 'Client' }, { label: 'Montant HT', align: 'right' }],
      lignes,
    },
    ecart,
  };
}

async function lireProfilFiscal(db, merchantId) {
  const r = await db.query(
    `SELECT ninea, legal_name, address, tax_center, regime, legal_form FROM accounting_tax_profile WHERE merchant_id = $1`,
    [merchantId]
  );
  // Les informations de l'entreprise (NINEA, adresse, nom) viennent de la page Entreprise : c'est elle
  // qui fait foi. Le profil fiscal ne sert qu'à ce qui n'y figure pas (centre des impôts, régime…).
  const m = await db.query(`SELECT business_name, to_jsonb(m) AS fiche FROM merchants m WHERE id = $1`, [merchantId]);
  const fiche = m.rows[0]?.fiche || {};
  const premier = (...cles) => cles.map((k) => fiche[k]).find((v) => typeof v === 'string' && v.trim()) || '';
  const p = r.rows[0] || {};
  const nineaEntreprise = String(premier('ninea', 'ninea_number', 'numero_ninea', 'tax_id')).trim();
  const adresseEntreprise = String(premier('address', 'adresse', 'business_address')).trim();
  return {
    ninea: nineaEntreprise || p.ninea || '',
    nineaSource: nineaEntreprise ? 'entreprise' : p.ninea ? 'profil' : '',
    legalName: p.legal_name || m.rows[0]?.business_name || '',
    address: adresseEntreprise || p.address || '',
    addressSource: adresseEntreprise ? 'entreprise' : p.address ? 'profil' : '',
    taxCenter: p.tax_center || '', regime: p.regime || 'reel_simplifie', legalForm: p.legal_form || 'societe_is',
  };
}

router.get('/tax-profile', async (req, res) => {
  try {
    res.json(await lireProfilFiscal(pool, req.user.merchantId));
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la lecture du profil fiscal.');
  }
});

router.put('/tax-profile', async (req, res) => {
  const { ninea, legalName, address, taxCenter, regime, legalForm } = req.body;
  if (!REGIMES.includes(regime)) return res.status(400).json({ error: "Régime d'imposition invalide." });
  if (!FORMES.includes(legalForm)) return res.status(400).json({ error: 'Forme juridique invalide.' });
  const net = (v, max) => (v ? String(v).trim().slice(0, max) : null);
  try {
    await pool.query(
      `INSERT INTO accounting_tax_profile (merchant_id, ninea, legal_name, address, tax_center, regime, legal_form, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (merchant_id) DO UPDATE SET ninea = EXCLUDED.ninea, legal_name = EXCLUDED.legal_name, address = EXCLUDED.address,
         tax_center = EXCLUDED.tax_center, regime = EXCLUDED.regime, legal_form = EXCLUDED.legal_form, updated_at = now()`,
      [req.user.merchantId, net(ninea, 20), net(legalName, 200), net(address, 300), net(taxCenter, 200), regime, legalForm]
    );
    res.json(await lireProfilFiscal(pool, req.user.merchantId));
  } catch (err) {
    repondreErreur(res, err, "Erreur lors de l'enregistrement du profil fiscal.");
  }
});

// ---------- Documents de déclaration au format DGID ----------
// Chaque déclaration reprend la présentation des documents de « Mon Espace Perso » : bloc
// « Contribuable et renseignements fiscaux » puis « Annexe fiscale » avec des lignes numérotées.
// Seuls les numéros de la CEL sur la valeur ajoutée viennent d'un document officiel ; ceux de la
// TVA, des retenues sur salaires et de la BRS sont provisoires (provisoire: true) tant que le
// formulaire officiel correspondant n'a pas été fourni.

const NOMS_DECL = { tva: 'Taxe sur la valeur ajoutée', ir: 'IR RAS Salaires', trimf: 'TRIMF', cfce: 'CFCE', brs: 'RAS Tiers et loyers', cel: 'CEL sur la valeur ajoutée', cel_vl: 'CEL sur la valeur locative', vrs: 'Retenues sur salaires' };
const TEXTE_SALAIRES = 'Déclaration des retenues à la source sur les salaires';
const TEXTE_CEL_VL = "La présente déclaration doit être remplie, datée, signée et déposée au centre des services fiscaux compétent au plus tard le 31 janvier. Veuillez noter que, conformément aux dispositions du CGI, les informations contenues dans la présente déclaration sont susceptibles de vous être opposées dans le cadre d'une procédure de rappel de droit. Vous avez la faculté de notifier au service compétent les erreurs ou omissions relevées dans la déclaration dans les conditions fixées par ledit code. Les lignes 25, 40, 60, 65, 75, 80, 85 et 95 ci-dessous sont facultatives ; la ligne 90 est obligatoire. Pour de plus amples renseignements sur les lignes de cette déclaration et le mode de calcul de la taxe exigible, veuillez vous référer au Code général des impôts (CGI) ou télécharger la notice explicative sur le site de la DGID (www.impotsetdomaines.gouv.sn).";
const MOIS_MOIS_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ANNEE_RE = /^\d{4}$/;
const fcfa = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
const dateFr = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');
const dernierJour = (mois) => {
  const [a, m] = mois.split('-').map(Number);
  return `${mois}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
};
// Une échéance qui tombe un samedi ou un dimanche passe au lundi (ex. le 15 décembre 2024, un
// dimanche, devient le 16 ; le 31 janvier 2026, un samedi, devient le 2 février). Les jours fériés
// ne sont pas pris en compte.
function decalerWeekEnd(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
// Le 15 du mois suivant.
function limiteDepot(mois) {
  const [a, m] = mois.split('-').map(Number);
  const suivant = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return decalerWeekEnd(`${suivant}-15`);
}
const libelleOuiNon = (v) => (v ? 'OUI' : 'NON');

// Assemble le document commun : en-tête, annexe fiscale numérotée, annexes nominatives, fiche PDF.
// Comme sur le portail, une ligne à zéro reste vide ; une ligne peut renvoyer à une annexe (colonne du milieu).
const TEXTE_DGID = "Veuillez indiquer ci-dessous les renseignements demandés conformément au Code Général des Impôts. Vous devez également joindre les annexes requises sous peine des sanctions prévues par la loi. Les chèques bancaires ou postaux doivent être libellés à l'ordre du Chef du Bureau du Recouvrement. Les chèques bancaires doivent être barrés.";

function construireDocument({ kind, profil, periodeLabel, debut, fin, limiteDepotIso, limitePaiementIso, dateSoumission, lignes, annexes = [], provisoire, alertes = [], titreAnnexe = 'Annexe fiscale', texte = TEXTE_DGID, titrePdf }) {
  const titre = NOMS_DECL[kind];
  const adresse = profil.address || '';
  const entete = [
    ['NINEA', profil.ninea || '', "PÉRIODE D'IMPOSITION", periodeLabel.toUpperCase()],
    ["COMPTE D'IMPÔT", '', 'NOM DU CONTRIBUABLE', profil.legalName || ''],
    ['CENTRE FISCAL', profil.taxCenter || '', 'TYPE DE TAXE', titre.toUpperCase()],
    ['ÉTABLISSEMENT', '', 'CENTRE DE PERCEPTION', ''],
    ['DÉBUT DE LA PÉRIODE', dateFr(debut), 'OBJET IMPOSABLE', ''],
    ['DATE LIMITE DE DÉPÔT', dateFr(limiteDepotIso), 'FIN DE LA PÉRIODE', dateFr(fin)],
    ['DATE SOUMISSION', dateSoumission ? dateFr(dateSoumission) : '', 'DATE LIMITE DE PAIEMENT', limitePaiementIso ? dateFr(limitePaiementIso) : ''],
    ['ADRESSE DE CORRESPONDANCE', adresse, 'LOCALISATION', adresse],
  ];
  const avecAnnexe = lignes.some((l) => l.annexe);
  const valeur = (l) => {
    if (l.type === 'ouinon') return l.value ? 'OUI' : 'NON';
    if (l.value === null || l.value === undefined) return '';
    if (l.type === 'nombre') return String(l.value);
    return Math.round(l.value) === 0 && !l.afficherZero ? '' : fcfa(l.value);
  };
  const colonnesAnnexe = avecAnnexe
    ? [{ label: titreAnnexe }, { label: '' }, { label: 'Ligne', align: 'right' }, { label: 'Montant', align: 'right' }]
    : [{ label: titreAnnexe }, { label: 'Ligne', align: 'right' }, { label: 'Montant', align: 'right' }];
  const pdf = {
    entreprise: 'RÉPUBLIQUE DU SÉNÉGAL · Un Peuple – Un But – Une Foi',
    titre: (titrePdf || titre).toUpperCase(),
    periode: `DGID – Ministère des Finances et du Budget · Mon Espace Perso · Préparé par Amaterasu${provisoire ? ' · numéros de ligne provisoires' : ''}`,
    sections: [
      { paires: true, colonnes: [{ label: 'CONTRIBUABLE ET RENSEIGNEMENTS FISCAUX' }, { label: '' }, { label: '' }, { label: '' }], lignes: entete },
      { texte: true, colonnes: [{ label: '' }], lignes: [[texte]] },
      {
        colonnes: colonnesAnnexe,
        lignes: lignes.map((l) => ({
          fort: l.fort === true,
          cells: avecAnnexe ? [l.label, l.annexe || '', String(l.ligne), valeur(l)] : [l.label, String(l.ligne), valeur(l)],
        })),
      },
      ...annexes.map((x) => ({ titre: x.titre, colonnes: x.colonnes, lignes: x.lignes })),
    ],
  };
  return {
    kind, title: titre, period: periodeLabel, deadline: limiteDepotIso, deadlinePay: limitePaiementIso,
    provisoire, alertes, header: entete, texte, lines: lignes, annexes, pdf,
  };
}

async function depotEnregistre(merchantId, kind, period) {
  const r = await pool.query(
    `SELECT filed_on, receipt_number, amount_due FROM accounting_tax_filings WHERE merchant_id = $1 AND kind = $2 AND period = $3`,
    [merchantId, kind, period]
  );
  return r.rows[0] || null;
}

function alertesProfil(profil, alertes) {
  if (!profil.ninea) alertes.push('NINEA non renseigné : renseignez-le dans la page Entreprise avant de déclarer.');
  if (!profil.taxCenter) alertes.push('Centre fiscal non renseigné : complétez le profil fiscal.');
}

// GET /accounting/declarations/tva?month=AAAA-MM
router.get('/declarations/tva', async (req, res) => {
  try {
    const mois = String(req.query.month || '');
    if (!MOIS_MOIS_RE.test(mois)) return res.status(400).json({ error: 'Mois invalide (AAAA-MM).' });
    const merchantId = req.user.merchantId;
    const profil = await lireProfilFiscal(pool, merchantId);
    const mvt = await pool.query(
      `SELECT to_char(e.entry_date, 'YYYY-MM') AS m, a.code, COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
       FROM accounting_lines l JOIN accounting_entries e ON e.id = l.entry_id JOIN accounting_accounts a ON a.id = l.account_id
       WHERE l.merchant_id = $1 AND (a.code IN ('443', '445') OR a.code LIKE '70%') AND e.entry_date <= $2::date
         AND e.source_type <> 'paiement_etat' GROUP BY 1, 2`,
      [merchantId, dernierJour(mois)]
    );
    const facturee = {};
    const deduc = {};
    let chiffreHt = 0;
    for (const r of mvt.rows) {
      if (r.code === '443') facturee[r.m] = arrondi((facturee[r.m] || 0) + Number(r.c) - Number(r.d));
      else if (r.code === '445') deduc[r.m] = arrondi((deduc[r.m] || 0) + Number(r.d) - Number(r.c));
      else if (r.m === mois) chiffreHt = arrondi(chiffreHt + Number(r.c) - Number(r.d));
    }
    const t = chaineTva(facturee, deduc, mois)[mois] || { collectee: 0, deductible: 0, creditReporte: 0, creditUtilise: 0, creditAReporter: 0, du: 0 };
    const baseImposable = arrondi(t.collectee / 0.18);
    const exonere = Math.max(0, arrondi(chiffreHt - baseImposable));
    // Opérations typées du mois : exportations, suspensions, précompte (ventes) et importations (achats).
    const jourVente = SQL_JOUR_TZ('COALESCE(o.validated_at, o.delivered_at, o.created_at)');
    const ventesTypees = await pool.query(
      `SELECT o.order_seq, o.tva_regime, COALESCE(c.full_name, 'Client de passage') AS client,
              ${jourVente} AS d, (COALESCE(o.total_amount, 0) - COALESCE(o.tva_amount, 0)) AS ht, COALESCE(o.precompte_amount, 0) AS precompte
       FROM orders o LEFT JOIN clients c ON c.id = o.client_id
       WHERE o.merchant_id = $1 AND o.status IN ('validee', 'livree')
         AND (o.tva_regime <> 'normal' OR COALESCE(o.precompte_amount, 0) > 0)
         AND ${jourVente} LIKE $2
       ORDER BY ${jourVente}, o.order_seq`,
      [merchantId, `${mois}-%`]
    );
    const exportations = ventesTypees.rows.filter((x) => x.tva_regime === 'export');
    const suspensions = ventesTypees.rows.filter((x) => x.tva_regime === 'suspension');
    const precomptees = ventesTypees.rows.filter((x) => Number(x.precompte) > 0);
    const sommeHt = (rows) => arrondi(rows.reduce((u, x) => u + Number(x.ht), 0));
    const jourAchat = `COALESCE(m.movement_date, (m.created_at AT TIME ZONE 'UTC')::date)`;
    const importsRes = await pool.query(
      `SELECT to_char(${jourAchat}, 'YYYY-MM-DD') AS d, MAX(s.name) AS fournisseur, m.customs_declaration AS dum, m.invoice_number AS facture,
              COALESCE(SUM(m.customs_value), 0) AS valeur, COALESCE(SUM(m.customs_duties), 0) AS droits, COALESCE(SUM(m.tva_amount), 0) AS tva
       FROM stock_movements m LEFT JOIN suppliers s ON s.id = m.supplier_id
       WHERE m.merchant_id = $1 AND m.movement_type = 'entree' AND m.transfer_id IS NULL AND m.purchase_kind = 'import' AND COALESCE(m.total_cost, 0) > 0
         AND to_char(${jourAchat}, 'YYYY-MM') = $2
       GROUP BY m.supplier_id, m.customs_declaration, m.invoice_number, ${jourAchat}
       ORDER BY 1`,
      [merchantId, mois]
    );
    const montantImports = arrondi(importsRes.rows.reduce((u, x) => u + Number(x.valeur), 0));
    const tvaImports = arrondi(importsRes.rows.reduce((u, x) => u + Number(x.tva), 0));
    const neant = chiffreHt === 0 && t.collectee === 0;
    const alertes = [];
    alertesProfil(profil, alertes);
    if (profil.regime === 'cgu') alertes.push('Régime CGU : le redevable de la CGU ne facture pas la TVA. Vérifiez votre régime dans le profil fiscal.');
    if (neant) alertes.push('Aucune opération ce mois : déclaration « NÉANT ».');
    if (importsRes.rows.some((x) => !x.dum)) alertes.push("Une importation du mois n'a pas de numéro de déclaration en douane : complétez-le avant de joindre l'annexe.");

    // Lignes du formulaire « Taxe sur la valeur ajoutée » de la DGID (numéros et formules officiels).
    const L = {};
    L[5] = Math.round(chiffreHt);
    L[10] = Math.round(sommeHt(exportations));
    L[20] = Math.round(sommeHt(suspensions));
    // L'exonéré est le reste des opérations non taxées, une fois retirées les exportations et les suspensions.
    L[15] = Math.max(0, Math.round(exonere) - L[10] - L[20]);
    L[25] = (L[10] || 0) + L[15] + (L[20] || 0);
    L[35] = L[5] - L[25];
    L[45] = L[35] - (L[40] || 0);
    L[65] = Math.round(sommeHt(precomptees));
    L[70] = Math.round(precomptees.reduce((u, x) => u + Number(x.precompte), 0));
    L[80] = Math.round(montantImports);
    L[85] = Math.round(tvaImports);
    L[50] = Math.round((L[40] || 0) * 0.1);
    L[55] = Math.round(L[45] * 0.18);
    L[60] = L[50] + L[55];
    L[76] = (L[70] || 0) + (L[75] || 0);
    // La TVA d'importation est déjà comptée dans la TVA déductible du grand livre : on la sépare des achats locaux.
    L[90] = Math.max(0, Math.round(t.deductible) - L[85] - L[70]);
    L[91] = (L[85] || 0) + L[90];
    L[92] = L[76] + L[91];
    L[100] = Math.round(t.creditReporte);
    L[105] = (L[70] || 0) + (L[75] || 0) + (L[85] || 0) + L[90] + L[100];
    L[110] = Math.max(0, L[60] - L[105]);
    L[115] = Math.max(0, L[105] - L[60]);
    const l = (ligne, label, extra = {}) => ({ ligne, label, value: L[ligne] === undefined ? null : L[ligne], ...extra });
    const lignes = [
      l(5, 'Montant des opérations'),
      l(10, "Affaires à l'exportation", { annexe: 'EXPORTATIONS' }),
      l(15, "Affaires réalisées à l'intérieur non taxées", { annexe: 'EXONERATIONS' }),
      l(20, 'Affaires réalisées en suspension de la TVA', { annexe: 'SUSPENSIONS' }),
      l(25, 'Total affaires non soumises à la TVA (L10+L15+L20)'),
      l(30, 'Prélèvements et livraisons ou prestations à soi-même'),
      l(35, 'Montant Total Taxable (L5-L25)'),
      l(40, 'Montant taxable-Taux réduit'),
      l(45, 'Montant taxable-Taux Normal (L35-L40)'),
      l(50, 'Montant de la TVA-Taux Réduit (L40*10%)'),
      l(55, 'Montant de la TVA-Taux Normal (L45*18%)'),
      l(60, 'Montant de la TVA Brut (L50+L55)'),
      l(65, 'Affaires soumises au précompte'),
      l(70, 'Précompte de TVA', { annexe: 'TVA PRECOMPTEE' }),
      l(75, 'Imputation de chèques DDI'),
      l(76, 'Total des avances (L70+L75)'),
      l(80, 'Montant des importations du mois'),
      l(85, 'TVA Acquittée sur les importations du mois', { annexe: 'IMPORTATIONS' }),
      l(90, 'TVA acquittées sur les achats intérieurs du mois', { annexe: 'ACHATS LOCAUX' }),
      l(91, 'Déductions sur achats (L85+L90)'),
      l(92, 'Total déductions pour le mois (L76+L91)'),
      l(93, 'Solde total exigible pour la période'),
      l(95, 'Montant des remboursements demandés et accordés'),
      l(100, 'Crédit de TVA du mois précédent'),
      l(105, 'Montant total déductible pour le mois (L70+L75+L85+L90+L100)'),
      l(110, 'Solde Total Exigible (L60-L105 si positif)', { fort: true }),
      l(115, 'Crédit de TVA à reporter (L105-L60 si positif)', { fort: true }),
      l(120, 'Montant des remboursements demandés et en instruction'),
    ];

    // Annexe « Achats locaux » : factures d'achat du mois avec leur TVA déductible.
    const achats = await pool.query(
      `SELECT to_char(COALESCE(m.movement_date, (m.created_at AT TIME ZONE 'UTC')::date), 'YYYY-MM-DD') AS d, MAX(s.name) AS fournisseur,
              m.invoice_number AS facture, COALESCE(SUM(m.total_cost), 0) AS total, COALESCE(SUM(m.tva_amount), 0) AS tva
       FROM stock_movements m LEFT JOIN suppliers s ON s.id = m.supplier_id
       WHERE m.merchant_id = $1 AND m.movement_type = 'entree' AND m.transfer_id IS NULL AND COALESCE(m.tva_amount, 0) > 0
         AND to_char(COALESCE(m.movement_date, (m.created_at AT TIME ZONE 'UTC')::date), 'YYYY-MM') = $2
       GROUP BY m.supplier_id, m.invoice_number, COALESCE(m.movement_date, (m.created_at AT TIME ZONE 'UTC')::date)
       ORDER BY 1`,
      [merchantId, mois]
    );
    const annexesOps = [];
    const annexeVentes = (titre, rows, avecPrecompte) => rows.length === 0 ? [] : [{
      titre,
      colonnes: [{ label: 'Date' }, { label: 'Vente' }, { label: 'Client' }, { label: 'Montant HT', align: 'right' }, ...(avecPrecompte ? [{ label: 'Précompte', align: 'right' }] : [])],
      lignes: [
        ...rows.map((x) => [dateFr(x.d), x.order_seq ? `V${x.order_seq}` : '—', x.client, fcfa(x.ht), ...(avecPrecompte ? [fcfa(x.precompte)] : [])]),
        { fort: true, cells: ['Total', '', '', fcfa(sommeHt(rows)), ...(avecPrecompte ? [fcfa(rows.reduce((u, x) => u + Number(x.precompte), 0))] : [])] },
      ],
    }];
    annexesOps.push(...annexeVentes('Annexe EXPORTATIONS', exportations, false));
    annexesOps.push(...annexeVentes('Annexe SUSPENSIONS', suspensions, false));
    annexesOps.push(...annexeVentes('Annexe TVA PRECOMPTEE', precomptees, true));
    const exonerees = await pool.query(
      `SELECT o.order_seq, COALESCE(c.full_name, 'Client de passage') AS client, ${jourVente} AS d,
              COALESCE(o.total_amount, 0) AS ht
       FROM orders o LEFT JOIN clients c ON c.id = o.client_id
       WHERE o.merchant_id = $1 AND o.status IN ('validee', 'livree')
         AND COALESCE(o.tva_regime, 'normal') = 'normal' AND COALESCE(o.tva_amount, 0) = 0 AND COALESCE(o.total_amount, 0) > 0
         AND ${jourVente} LIKE $2
       ORDER BY ${jourVente}, o.order_seq`,
      [merchantId, `${mois}-%`]
    );
    const exo = construireAnnexeExonerations(exonerees.rows, L[15]);
    if (exo.annexe) annexesOps.push(exo.annexe);
    if (exo.ecart !== 0) alertes.push(`Annexe des exonérations : ${fcfa(Math.abs(exo.ecart))} d'écart entre les ventes sans TVA et la ligne 15 (voir la dernière ligne de l'annexe). Vérifiez les ventes à reliquat non livré et les retours du mois.`);
    if (importsRes.rows.length > 0) {
      annexesOps.push({
        titre: 'Annexe IMPORTATIONS',
        colonnes: [{ label: 'Date' }, { label: 'Fournisseur' }, { label: 'N° déclaration' }, { label: 'Valeur en douane', align: 'right' }, { label: 'Droits', align: 'right' }, { label: 'TVA', align: 'right' }],
        lignes: [
          ...importsRes.rows.map((x) => [dateFr(x.d), x.fournisseur || '—', x.dum || '—', fcfa(x.valeur), fcfa(x.droits), fcfa(x.tva)]),
          { fort: true, cells: ['Total', '', '', fcfa(montantImports), fcfa(importsRes.rows.reduce((u, x) => u + Number(x.droits), 0)), fcfa(tvaImports)] },
        ],
      });
    }
    const annexes = achats.rows.length === 0 ? [...annexesOps] : [{
      titre: 'Annexe ACHATS LOCAUX',
      colonnes: [{ label: 'Date' }, { label: 'Fournisseur' }, { label: 'N° facture' }, { label: 'Montant HT', align: 'right' }, { label: 'TVA', align: 'right' }],
      lignes: [
        ...achats.rows.map((x) => [dateFr(x.d), x.fournisseur || '—', x.facture || '—', fcfa(Number(x.total) - Number(x.tva)), fcfa(x.tva)]),
        { fort: true, cells: ['Total', '', '', fcfa(achats.rows.reduce((u, x) => u + Number(x.total) - Number(x.tva), 0)), fcfa(achats.rows.reduce((u, x) => u + Number(x.tva), 0))] },
      ],
    }, ...annexesOps];
    const filed = await depotEnregistre(merchantId, 'tva', mois);
    const doc = construireDocument({
      kind: 'tva', profil, periodeLabel: libellePeriode(mois), debut: `${mois}-01`, fin: dernierJour(mois),
      limiteDepotIso: limiteDepot(mois), limitePaiementIso: limiteDepot(mois), dateSoumission: filed?.filed_on,
      lignes, annexes, provisoire: false, alertes,
    });
    res.json({ ...doc, month: mois, amountDue: L[110], snapshot: { chiffreHt, exonere, collectee: t.collectee, deductible: t.deductible, creditReporte: t.creditReporte, aPayer: L[110], creditAReporter: L[115] }, filed });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la préparation de la déclaration de TVA.');
  }
});

// ----- Retenues sur salaires : trois déclarations séparées, comme sur le portail -----
// IR RAS Salaires (lignes 10 à 100), TRIMF (ligne 110) et CFCE (ligne 120).
async function lireSalairesMois(merchantId, mois) {
  const r = await pool.query(
    `SELECT u.full_name, COALESCE(p.gross_salary, 0) AS brut, COALESCE(p.irpp, 0) AS irpp, COALESCE(p.trimf, 0) AS trimf, COALESCE(p.cfce, 0) AS cfce
     FROM payslips p JOIN employees u ON u.id = p.user_id WHERE p.merchant_id = $1 AND p.month = $2 AND p.status <> 'remplace' ORDER BY u.full_name`,
    [merchantId, mois]
  );
  const salaries = r.rows.map((x) => ({ name: x.full_name, gross: Math.round(Number(x.brut)), ir: Math.round(Number(x.irpp)), trimf: Math.round(Number(x.trimf)), cfce: Math.round(Number(x.cfce)) }));
  const tot = salaries.reduce((t, l) => ({ gross: t.gross + l.gross, ir: t.ir + l.ir, trimf: t.trimf + l.trimf, cfce: t.cfce + l.cfce }), { gross: 0, ir: 0, trimf: 0, cfce: 0 });
  return { salaries, tot };
}

async function declarerSalaires(kind, req, res) {
  try {
    const mois = String(req.query.month || '');
    if (!MOIS_MOIS_RE.test(mois)) return res.status(400).json({ error: 'Mois invalide (AAAA-MM).' });
    const merchantId = req.user.merchantId;
    const profil = await lireProfilFiscal(pool, merchantId);
    const { salaries, tot } = await lireSalairesMois(merchantId, mois);
    const alertes = [];
    alertesProfil(profil, alertes);
    if (salaries.length === 0) alertes.push('Aucun bulletin de paie pour ce mois : générez les bulletins dans le module Paie avant de déclarer.');
    let lignes;
    let montant;
    let annexes = [];
    let inputs = null;
    if (kind === 'ir') {
      // La nationalité des salariés n'est pas suivie dans la paie : par défaut tous sont comptés comme sénégalais.
      const total = salaries.length;
      const etrangers = Math.min(total, Math.max(0, Math.round(Number(req.query.etrangers) || 0)));
      const salairesEtr = Math.min(tot.gross, Math.max(0, Math.round(Number(req.query.salairesEtrangers) || 0)));
      if (total > 0 && etrangers === 0) alertes.push('Tous les salariés sont comptés comme de nationalité sénégalaise (lignes 10 et 40). Ajustez ci-dessous si vous employez des étrangers.');
      const L70 = tot.ir;
      const L80 = 0;
      montant = L70 - L80;
      const z = { afficherZero: true };
      lignes = [
        { ligne: 10, label: 'Effectifs de nationalité sénégalaise rémunérés pour la période', value: total - etrangers, type: 'nombre' },
        { ligne: 20, label: 'Effectifs de nationalité étrangère rémunérés durant la période', value: etrangers, type: 'nombre' },
        { ligne: 30, label: "Nombre total d'employés rémunérés durant la période", value: total, type: 'nombre' },
        { ligne: 40, label: 'Salaires versés aux employés de nationalité sénégalaise', value: tot.gross - salairesEtr, ...z },
        { ligne: 50, label: 'Salaires versés aux employés de nationalité étrangère', value: salairesEtr, ...z },
        { ligne: 60, label: 'Masse salariale totale pour la période', value: tot.gross, ...z },
        { ligne: 70, label: "Montant de l'impôt sur le revenu retenu durant la période", value: L70, ...z },
        { ligne: 80, label: 'Montant des retenues GTA imputables sur la période', value: L80, ...z },
        { ligne: 100, label: "Montant de l'impôt sur le revenu dû durant la période", value: montant, fort: true, ...z },
      ];
      annexes = [{
        titre: 'État nominatif des salariés (pour votre dossier)',
        colonnes: [{ label: 'Salarié' }, { label: 'Salaire brut', align: 'right' }, { label: 'IR retenu', align: 'right' }],
        lignes: [...salaries.map((l) => [l.name, fcfa(l.gross), fcfa(l.ir)]), { fort: true, cells: ['Total', fcfa(tot.gross), fcfa(tot.ir)] }],
      }];
      inputs = { etrangers, salairesEtrangers: salairesEtr, total };
    } else if (kind === 'trimf') {
      montant = tot.trimf;
      lignes = [{ ligne: 110, label: 'TRIMF retenue durant la période', value: montant, fort: true, afficherZero: true }];
    } else {
      montant = tot.cfce;
      lignes = [{ ligne: 120, label: 'CFCE exigible pour la période', value: montant, fort: true, afficherZero: true }];
    }
    const filed = await depotEnregistre(merchantId, kind, mois);
    const doc = construireDocument({
      kind, profil, periodeLabel: libellePeriode(mois), debut: `${mois}-01`, fin: dernierJour(mois),
      limiteDepotIso: limiteDepot(mois), limitePaiementIso: limiteDepot(mois), dateSoumission: filed?.filed_on,
      lignes, annexes, provisoire: false, alertes, texte: TEXTE_SALAIRES,
    });
    res.json({ ...doc, month: mois, amountDue: montant, inputs, snapshot: { ...tot, montant }, filed });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la préparation de la déclaration des retenues sur salaires.');
  }
}
router.get('/declarations/ir', (req, res) => declarerSalaires('ir', req, res));
router.get('/declarations/trimf', (req, res) => declarerSalaires('trimf', req, res));
router.get('/declarations/cfce', (req, res) => declarerSalaires('cfce', req, res));

// ----- RAS Tiers et loyers (BRS) : retenue à la source de 5 % sur les sommes versées à des tiers -----
// Le registre contient uniquement les versements soumis à la retenue : la retenue est de 5 % du montant brut.

router.get('/brs-entries', async (req, res) => {
  const mois = String(req.query.month || '');
  if (!MOIS_MOIS_RE.test(mois)) return res.status(400).json({ error: 'Mois invalide (AAAA-MM).' });
  try {
    const r = await pool.query(
      `SELECT id, beneficiary_name, beneficiary_ref, nature, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, gross_ht, note,
              (cash_expense_id IS NOT NULL OR charge_bill_id IS NOT NULL) AS auto
       FROM accounting_brs_entries WHERE merchant_id = $1 AND to_char(paid_on, 'YYYY-MM') = $2 ORDER BY paid_on, beneficiary_name`,
      [req.user.merchantId, mois]
    );
    res.json(r.rows);
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la lecture du registre BRS.');
  }
});

router.post('/brs-entries', async (req, res) => {
  const { beneficiaryName, beneficiaryRef, nature, paidOn, grossHt, note } = req.body;
  const nom = String(beneficiaryName || '').trim().slice(0, 200);
  const montant = arrondi(grossHt);
  if (!nom) return res.status(400).json({ error: 'Le nom du bénéficiaire est requis.' });
  if (!['loyer', 'prestation'].includes(nature)) return res.status(400).json({ error: 'Nature invalide (loyer ou prestation).' });
  if (!dateOk(paidOn) || paidOn > aujourdhui()) return res.status(400).json({ error: 'Date de paiement invalide.' });
  if (!(montant > 0)) return res.status(400).json({ error: 'Le montant brut hors taxes doit être positif.' });
  try {
    await pool.query(
      `INSERT INTO accounting_brs_entries (merchant_id, beneficiary_name, beneficiary_ref, nature, paid_on, gross_ht, note, created_by)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8)`,
      [req.user.merchantId, nom, beneficiaryRef ? String(beneficiaryRef).trim().slice(0, 40) : null, nature, paidOn, montant,
        note ? String(note).trim().slice(0, 200) : null, req.user.id]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    repondreErreur(res, err, "Erreur lors de l'enregistrement dans le registre BRS.");
  }
});

router.delete('/brs-entries/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Ligne introuvable.' });
  try {
    const r = await pool.query(`DELETE FROM accounting_brs_entries WHERE id = $1 AND merchant_id = $2`, [req.params.id, req.user.merchantId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Ligne introuvable.' });
    res.json({ ok: true });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la suppression.');
  }
});

// GET /accounting/declarations/brs?month=AAAA-MM
router.get('/declarations/brs', async (req, res) => {
  try {
    const mois = String(req.query.month || '');
    if (!MOIS_MOIS_RE.test(mois)) return res.status(400).json({ error: 'Mois invalide (AAAA-MM).' });
    const merchantId = req.user.merchantId;
    const profil = await lireProfilFiscal(pool, merchantId);
    const r = await pool.query(
      `SELECT beneficiary_name, beneficiary_ref, nature, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, gross_ht
       FROM accounting_brs_entries WHERE merchant_id = $1 AND to_char(paid_on, 'YYYY-MM') = $2 ORDER BY paid_on, beneficiary_name`,
      [merchantId, mois]
    );
    const detail = r.rows.map((x) => ({ name: x.beneficiary_name, ref: x.beneficiary_ref || '', nature: x.nature, paidOn: x.paid_on, gross: Math.round(Number(x.gross_ht)) }));
    const somme = (nature) => detail.filter((d) => d.nature === nature).reduce((t, d) => t + d.gross, 0);
    // Lignes du formulaire « RAS Tiers et loyers » de la DGID.
    const L10 = somme('prestation');
    const L20 = somme('loyer');
    const L30 = L10 + L20;
    const L40 = Math.round(L30 * TAUX_BRS);
    const alertes = [];
    alertesProfil(profil, alertes);
    if (detail.length === 0) alertes.push('Aucune somme versée à un tiers enregistrée pour ce mois : ajoutez-les dans le registre ci-dessous, ou déclarez « NÉANT ».');
    alertes.push("Ligne 20 : les loyers sont ici comptés en plus de la ligne 10. Si le portail les inclut déjà dans la ligne 10, indiquez-le-moi.");
    const lignes = [
      { ligne: 10, label: 'Montant brut des sommes versées à des résidents du Sénégal', value: L10 },
      { ligne: 20, label: 'Montant brut des sommes versées à titre de loyer', value: L20 },
      { ligne: 30, label: 'Total des sommes versées', value: L30 },
      { ligne: 40, label: 'Total des retenues opérées', value: L40, fort: true },
    ];
    const annexes = detail.length === 0 ? [] : [{
      titre: 'État nominatif des bénéficiaires',
      colonnes: [{ label: 'Bénéficiaire' }, { label: 'NINEA / pièce' }, { label: 'Nature' }, { label: 'Date' }, { label: 'Montant brut', align: 'right' }, { label: 'Retenue 5 %', align: 'right' }],
      lignes: [
        ...detail.map((d) => [d.name, d.ref || '—', d.nature === 'loyer' ? 'Loyer' : 'Prestation', dateFr(d.paidOn), fcfa(d.gross), fcfa(d.gross * TAUX_BRS)]),
        { fort: true, cells: ['Total', '', '', '', fcfa(L30), fcfa(L40)] },
      ],
    }];
    const filed = await depotEnregistre(merchantId, 'brs', mois);
    const doc = construireDocument({
      kind: 'brs', profil, periodeLabel: libellePeriode(mois), debut: `${mois}-01`, fin: dernierJour(mois),
      limiteDepotIso: limiteDepot(mois), limitePaiementIso: limiteDepot(mois), dateSoumission: filed?.filed_on,
      lignes, annexes, provisoire: false, alertes,
    });
    res.json({ ...doc, month: mois, amountDue: L40, snapshot: { prestations: L10, loyers: L20, total: L30, retenues: L40 }, filed });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la préparation de la déclaration RAS Tiers et loyers.');
  }
});

// ----- CEL sur la valeur ajoutée : numéros de ligne du document officiel de la DGID -----
// Base = valeur ajoutée de l'année précédente, plafonnée à 70 % du chiffre d'affaires ; taux 1 % ;
// minimum 0,15 % du chiffre d'affaires (0,075 % pour les secteurs à faible marge ou à prix réglementés).
// GET /accounting/declarations/cel?year=AAAA[&ca=&va=&exonere=1&faibleMarge=1&telecom=1&portuaire=1]
router.get('/declarations/cel', async (req, res) => {
  try {
    const annee = String(req.query.year || '');
    if (!ANNEE_RE.test(annee)) return res.status(400).json({ error: 'Année invalide (AAAA).' });
    const merchantId = req.user.merchantId;
    const profil = await lireProfilFiscal(pool, merchantId);
    const n1 = Number(annee) - 1;
    const rows = await agreger(merchantId, `${n1}-01-01`, `${n1}-12-31`);
    const credit = (pref) => rows.filter((r) => pref.some((p) => r.code.startsWith(p))).reduce((t, r) => t + r.credit - r.debit, 0);
    const debit = (pref) => rows.filter((r) => pref.some((p) => r.code.startsWith(p))).reduce((t, r) => t + r.debit - r.credit, 0);
    const caCompta = arrondi(credit(['70']));
    // Valeur ajoutée comptable : produits d'exploitation (70 à 74) − consommations (60 à 63).
    const vaCompta = arrondi(credit(['70', '71', '72', '73', '74']) - debit(['60', '61', '62', '63']));
    const nombre = (v, defaut) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? defaut : arrondi(Number(v)));
    const ca = Math.max(0, Math.round(nombre(req.query.ca, caCompta)));
    const va = Math.round(nombre(req.query.va, vaCompta));
    const drapeau = (v) => v === '1' || v === 'true';
    const exonere = drapeau(req.query.exonere);
    const faibleMarge = drapeau(req.query.faibleMarge);
    const telecom = drapeau(req.query.telecom);
    const portuaire = drapeau(req.query.portuaire);
    const reelSimplifie = profil.regime === 'reel_simplifie';
    const vaMax = Math.round(ca * 0.7);
    const vaImposable = Math.max(0, Math.min(va, vaMax));
    const contribution1 = Math.round(vaImposable * 0.01);
    const min015 = Math.round(ca * 0.0015);
    const min0075 = Math.round(ca * 0.00075);
    const minimum = faibleMarge ? min0075 : min015;
    const aPayer = exonere ? 0 : Math.max(contribution1, minimum);
    const alertes = [];
    alertesProfil(profil, alertes);
    if (profil.regime === 'cgu') alertes.push("Régime CGU : la CEL s'applique aux contribuables du régime du bénéfice réel. Vérifiez votre régime dans le profil fiscal.");
    if (caCompta === 0) alertes.push(`Aucune vente comptabilisée en ${n1} : ajustez le chiffre d'affaires et la valeur ajoutée ci-dessous.`);
    if (telecom || portuaire) alertes.push("Régime particulier (télécommunications, installations portuaires) : imposition unique sur le chiffre d'affaires, non calculée ici.");
    alertes.push('Valeur ajoutée = produits d\'exploitation moins consommations (comptes 60 à 63). La loi liste les produits et charges admis selon le secteur : vérifiez-la avec votre comptable. Les lignes 45 à 105 sont indicatives, le portail calcule le montant définitif.');
    const lignes = [
      { ligne: 5, label: "Chiffre d'affaires de l'exercice précédent", value: ca },
      { ligne: 10, label: 'Valeur ajoutée déclarée', value: va },
      { ligne: 15, label: 'Valeur ajoutée imposable maximum (70 % du chiffre d\'affaires)', value: vaMax },
      { ligne: 20, label: 'Entreprise exonérée de CEL ? (OUI ou NON)', value: exonere, type: 'ouinon' },
      { ligne: 25, label: 'Activité faible marge ou à prix réglementé ? (OUI ou NON)', value: faibleMarge, type: 'ouinon' },
      { ligne: 30, label: 'Exploitant agréé de réseau de télécom. ouvert au public ? (OUI ou NON)', value: telecom, type: 'ouinon' },
      { ligne: 35, label: "Exploitant d'installations portuaires ? (OUI ou NON)", value: portuaire, type: 'ouinon' },
      { ligne: 40, label: 'Entreprise sous régime du réel simplifié ? (OUI ou NON)', value: reelSimplifie, type: 'ouinon' },
      { ligne: 45, label: 'Contribution minimale au taux de 0,15 %', value: min015 },
      { ligne: 50, label: 'Contribution minimale au taux de 0,075 %', value: faibleMarge ? min0075 : null },
      { ligne: 95, label: 'Montant de la contribution à 1 %', value: contribution1 },
      { ligne: 105, label: "Montant de l'impôt à payer", value: aPayer, fort: true },
    ];
    const filed = await depotEnregistre(merchantId, 'cel', annee);
    const doc = construireDocument({
      kind: 'cel', profil, periodeLabel: annee, debut: `${annee}-01-01`, fin: `${annee}-12-31`,
      limiteDepotIso: decalerWeekEnd(`${annee}-04-30`), limitePaiementIso: decalerWeekEnd(`${annee}-04-30`), dateSoumission: filed?.filed_on,
      lignes, provisoire: false, alertes,
    });
    res.json({
      ...doc, year: annee, amountDue: aPayer,
      inputs: { ca, va, caCompta, vaCompta, exonere, faibleMarge, telecom, portuaire },
      snapshot: { ca, va, vaMax, contribution1, minimum, aPayer },
      filed,
    });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la préparation de la CEL sur la valeur ajoutée.');
  }
});

// ----- CEL sur la valeur locative : numéros de ligne du document officiel de la DGID -----
// Déclarée avant le 31 janvier de l'année d'imposition. Le loyer annuel (ligne 45) est le loyer mensuel
// à verser, repris des charges (dernier loyer comptabilisé en 622), multiplié par le nombre de mois d'activité.
// GET /accounting/declarations/cel-vl?year=AAAA[&loyer=&mois=&terrains=&constructions=&agencements=&gratuit=&percu=&prepond=1&hotel=1]
router.get('/declarations/cel-vl', async (req, res) => {
  try {
    const annee = String(req.query.year || '');
    if (!ANNEE_RE.test(annee)) return res.status(400).json({ error: 'Année invalide (AAAA).' });
    const merchantId = req.user.merchantId;
    const profil = await lireProfilFiscal(pool, merchantId);
    const n1 = Number(annee) - 1;
    const rows = await agreger(merchantId, null, `${n1}-12-31`);
    const brut = (prefixes) => Math.max(0, Math.round(rows.filter((r) => prefixes.some((p) => r.code.startsWith(p))).reduce((t, r) => t + r.debit - r.credit, 0)));
    const terrainsCompta = brut(['22']);
    const constructionsCompta = brut(['231', '232', '233']);
    const agencementsCompta = brut(['234', '235', '238']);
    // Loyer mensuel à verser : dernier mois où un loyer (compte 622) a été comptabilisé dans les charges.
    const loy = await pool.query(
      `SELECT to_char(e.entry_date, 'YYYY-MM') AS m, COALESCE(SUM(l.debit - l.credit), 0) AS montant
       FROM accounting_lines l JOIN accounting_entries e ON e.id = l.entry_id JOIN accounting_accounts a ON a.id = l.account_id
       WHERE l.merchant_id = $1 AND a.code LIKE '622%' AND e.entry_date >= $2::date AND e.entry_date <= $3::date
       GROUP BY 1 HAVING COALESCE(SUM(l.debit - l.credit), 0) > 0 ORDER BY 1 DESC LIMIT 1`,
      [merchantId, `${n1}-01-01`, `${annee}-12-31`]
    );
    const loyerDetecte = Math.round(Number(loy.rows[0]?.montant || 0));
    const moisLoyer = loy.rows[0]?.m || null;
    const nombre = (v, defaut) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? defaut : Math.max(0, Math.round(Number(v))));
    const drapeau = (v) => v === '1' || v === 'true';
    const mois = Math.min(12, Math.max(1, nombre(req.query.mois, 12)));
    const loyerMensuel = nombre(req.query.loyer, loyerDetecte);
    const prepond = drapeau(req.query.prepond);
    const hotel = drapeau(req.query.hotel);
    const L = {};
    L[5] = nombre(req.query.terrains, terrainsCompta);
    L[10] = nombre(req.query.constructions, constructionsCompta);
    L[15] = nombre(req.query.agencements, agencementsCompta);
    L[20] = L[5] + L[10] + L[15];
    L[25] = Math.round(L[20] * 0.07);
    L[35] = prepond ? Math.round(L[25] * 0.4) : null;
    L[40] = prepond ? Math.round(L[35] * 0.2) : null;
    L[45] = loyerMensuel * mois;
    L[50] = nombre(req.query.gratuit, 0);
    L[60] = hotel ? Math.round(L[25] * 0.5 * 0.2) : null;
    L[65] = hotel ? Math.round((L[45] + L[50]) * 0.5 * 0.15) : null;
    L[70] = nombre(req.query.percu, 0);
    L[75] = L[70] > 0 ? Math.round(L[70] * 0.2) : null;
    L[80] = !hotel && !prepond ? Math.round(L[25] * 0.2) : null;
    L[85] = !hotel ? Math.round((L[45] + L[50]) * 0.15) : null;
    L[90] = mois;
    L[95] = (L[40] || 0) + (L[60] || 0) + (L[65] || 0) + (L[75] || 0) + (L[80] || 0) + (L[85] || 0);
    const alertes = [];
    alertesProfil(profil, alertes);
    if (loyerDetecte > 0 && req.query.loyer === undefined) {
      alertes.push(`Loyer mensuel repris des charges : ${fcfa(loyerDetecte)} FCFA (dernier loyer comptabilisé, ${libellePeriode(moisLoyer)}) × ${mois} mois = ${fcfa(L[45])} FCFA en ligne 45.`);
    } else if (loyerDetecte === 0 && req.query.loyer === undefined) {
      alertes.push("Aucun loyer comptabilisé dans les charges : enregistrez le loyer (nature « Loyer ») ou indiquez le loyer mensuel ci-dessous.");
    }
    if (L[75] !== null) alertes.push("Ligne 75 : le formulaire imprime « L75 x 20 % » ; j'applique 20 % au loyer perçu en ligne 70.");
    alertes.push('Le portail calcule le montant définitif de la ligne 95 : vérifiez-le avant de déposer.');
    const lignes = [
      { ligne: 5, label: "Valeur brute des terrains imposables inscrits à l'actif du bilan", value: L[5] },
      { ligne: 10, label: "Valeur brute des constructions imposables inscrites à l'actif du bilan", value: L[10] },
      { ligne: 15, label: "Valeur brute des agencements et installations imposables inscrites à l'actif du bilan", value: L[15] },
      { ligne: 20, label: 'Valeur brute totale des terrains, constructions, agencements et installations imposables (L5+L10+L15)', value: L[20] },
      { ligne: 25, label: 'Valeur locative imposable des locaux inscrits au bilan (L20x7%)', value: L[25] },
      { ligne: 30, label: 'Société à prépondérance immobilière ? OUI/NON', value: prepond, type: 'ouinon' },
      { ligne: 35, label: "Valeur locative imposable des locaux inscrits à l'actif du bilan des sociétés à prépondérance immobilière (L25x40%)", value: L[35] },
      { ligne: 40, label: 'CEL des sociétés à prépondérance immobilière (L35*20%)', value: L[40] },
      { ligne: 45, label: "Loyer versé par l'exploitant locataire", value: L[45] },
      { ligne: 50, label: 'Loyer estimé pour les locaux occupés à titre gratuit', value: L[50] },
      { ligne: 55, label: "Etablissements hôteliers et d'hébergement touristique agréés ? OUI/NON", value: hotel, type: 'ouinon' },
      { ligne: 60, label: "CEL terrains, constructions, installations et agencements inscrits au bilan des établissements hôteliers et d'hébergement touristique agréés ((L25*50%) x 20%)", value: L[60] },
      { ligne: 65, label: "CEL locataire ou occupant à titre gratuit des établissements hôteliers et d'hébergement touristique agréés ((L45+L50) x 50%) x 15%)", value: L[65] },
      { ligne: 70, label: 'Loyer perçu par le loueur professionnel', value: L[70] },
      { ligne: 75, label: "CEL loueur professionnel (chambres meublées, fonds de commerce, sous-location d'immeubles non meublés)", value: L[75] },
      { ligne: 80, label: "CEL terrains, constructions, installations et agencements inscrits au bilan (L25 x 20%)", value: L[80] },
      { ligne: 85, label: 'CEL locataire ou occupant à titre gratuit (L45+L50) x 15%', value: L[85] },
      { ligne: 90, label: "Nombre de mois d'activité", value: L[90], type: 'nombre' },
      { ligne: 95, label: 'CEL totale à payer', value: L[95], fort: true, afficherZero: true },
    ];
    const filed = await depotEnregistre(merchantId, 'cel_vl', annee);
    const doc = construireDocument({
      kind: 'cel_vl', profil, periodeLabel: annee, debut: `${annee}-01-01`, fin: `${annee}-12-31`,
      limiteDepotIso: decalerWeekEnd(`${annee}-01-31`), limitePaiementIso: null, dateSoumission: filed?.filed_on,
      lignes, provisoire: false, alertes, texte: TEXTE_CEL_VL, titrePdf: 'CEL sur la valeur locative - Déclaration',
    });
    res.json({
      ...doc, year: annee, amountDue: L[95],
      inputs: { loyerMensuel, loyerDetecte, moisLoyer, mois, terrains: L[5], constructions: L[10], agencements: L[15], terrainsCompta, constructionsCompta, agencementsCompta, gratuit: L[50], percu: L[70], prepond, hotel },
      snapshot: { loyerMensuel, mois, loyerAnnuel: L[45], total: L[95] },
      filed,
    });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la préparation de la CEL sur la valeur locative.');
  }
});

router.get('/filings', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, kind, period, amount_due, filed_on, receipt_number, created_at FROM accounting_tax_filings
       WHERE merchant_id = $1 ORDER BY period DESC, kind LIMIT 120`,
      [req.user.merchantId]
    );
    res.json(r.rows);
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la lecture des déclarations déposées.');
  }
});

// POST /accounting/filings {kind, period, filedOn, receiptNumber, amountDue, snapshot}
router.post('/filings', async (req, res) => {
  const { kind, period, filedOn, receiptNumber, amountDue, snapshot } = req.body;
  if (!['tva', 'ir', 'trimf', 'cfce', 'brs', 'cel', 'cel_vl', 'vrs'].includes(kind)) return res.status(400).json({ error: 'Type de déclaration invalide.' });
  const periodeOk = ['cel', 'cel_vl'].includes(kind) ? ANNEE_RE.test(String(period || '')) : MOIS_MOIS_RE.test(String(period || ''));
  if (!periodeOk) return res.status(400).json({ error: 'Période invalide.' });
  if (!dateOk(filedOn) || filedOn > aujourdhui()) return res.status(400).json({ error: 'Date de dépôt invalide.' });
  const montant = arrondi(amountDue);
  if (!(montant >= 0)) return res.status(400).json({ error: 'Montant invalide.' });
  try {
    await pool.query(
      `INSERT INTO accounting_tax_filings (merchant_id, kind, period, amount_due, filed_on, receipt_number, snapshot, created_by)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7::jsonb, $8)
       ON CONFLICT (merchant_id, kind, period) DO UPDATE SET amount_due = EXCLUDED.amount_due, filed_on = EXCLUDED.filed_on,
         receipt_number = EXCLUDED.receipt_number, snapshot = EXCLUDED.snapshot, created_by = EXCLUDED.created_by`,
      [req.user.merchantId, kind, period, montant, filedOn, receiptNumber ? String(receiptNumber).trim().slice(0, 60) : null,
        JSON.stringify(snapshot && typeof snapshot === 'object' ? snapshot : {}), req.user.id]
    );
    await logActivity({
      merchantId: req.user.merchantId, userId: req.user.id, action: 'tax_filing',
      description: `a enregistré le dépôt de « ${NOMS_DECL[kind]} » (${['cel', 'cel_vl'].includes(kind) ? period : libellePeriode(period)})`,
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    repondreErreur(res, err, "Erreur lors de l'enregistrement du dépôt.");
  }
});

router.delete('/filings/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Dépôt introuvable.' });
  try {
    const r = await pool.query(`DELETE FROM accounting_tax_filings WHERE id = $1 AND merchant_id = $2`, [req.params.id, req.user.merchantId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Dépôt introuvable.' });
    res.json({ ok: true });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la suppression du dépôt.');
  }
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
const TYPES_AVEC_CORRECTION = ['vente', 'retour', 'achat', 'perte', 'reglement_client', 'reglement_assureur', 'reglement_fournisseur', 'caisse', 'facture_charge', 'reglement_charge'];
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

// --- Sources : chacune renvoie les écritures qu'elle doit produire ---

// Bulletins de paie : comptabilisés à la fin du mois concerné (ou aujourd'hui si
// le mois n'est pas terminé). Charge de personnel (661), charges sociales
// patronales (664) et CFCE (641) contre : personnel à payer (422xxx), CSS (431),
// IPRES (432), impôts retenus à la source (447) et CFCE à payer (442).
async function lirePaie(client, merchantId, debut, ctx) {
  const fin = `(to_date(p.month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date`;
  const r = await client.query(
    `SELECT p.id::text AS id, p.user_id::text AS user_id, p.month, p.gross_salary, p.net_a_payer,
            p.ipres_salarial, p.css_salarial, p.irpp, p.trimf, p.ipres_patronal, p.css_patronal, p.cfce, p.deductions_total, u.full_name,
            to_char(LEAST(${fin}, CURRENT_DATE), 'YYYY-MM-DD') AS d
     FROM payslips p JOIN employees u ON u.id = p.user_id
     WHERE p.merchant_id = $1 AND p.status <> 'remplace' AND ${fin} >= $2::date
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
    // Retenues déduites du net (avances, prêts, autres) : elles soldent le compte du personnel (421).
    const deductions = n(row.deductions_total);
    // Le brut est déduit du net et des retenues pour que l'écriture soit toujours équilibrée.
    const brut = arrondi(net + css + ipres + retenue + deductions);
    if (!(brut > 0)) continue;
    if (Math.abs(brut - n(row.gross_salary)) > 1) ecarts += 1;
    const personnel = await ctx.tiers.obtenir('personnel', row.user_id);
    out.push({
      sourceId: row.id, date: row.d, journal: 'OD', reference: `PAIE-${row.month}`,
      label: `Paie ${row.full_name} — ${row.month}`,
      sig: `${brut}|${net}|${css}|${ipres}|${retenue}|${patronal}|${cfce}|${row.d}|${row.user_id}${deductions > 0 ? `|d${deductions}` : ''}|t3`,
      lignes: [
        ligne('661', brut, 0),
        ligne('664', patronal, 0),
        ligne('641', cfce, 0),
        ligne(personnel, 0, net),
        ligne(COMPTE_AVANCES_PERSONNEL, 0, deductions),
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

// Compte des avances et acomptes au personnel (SYSCOHADA : 421). À faire valider par l'expert-comptable.
const COMPTE_AVANCES_PERSONNEL = '421';

// Avances et prêts versés aux employés : débit du compte d'avances au personnel, crédit trésorerie.
// Les retenues sur bulletins (lirePaie) viennent ensuite le solder.
async function lireAvances(client, merchantId, debut, ctx) {
  const r = await client.query(
    `SELECT a.id::text AS id, a.amount, a.payment_method, to_char(a.advance_date, 'YYYY-MM-DD') AS d, e.full_name, a.kind
     FROM employee_advances a JOIN employees e ON e.id = a.employee_id
     WHERE a.merchant_id = $1 AND a.advance_date >= $2::date
     ORDER BY a.advance_date, a.created_at`,
    [merchantId, debut]
  );
  const out = [];
  for (const row of r.rows) {
    const montant = arrondi(row.amount);
    if (!(montant > 0)) continue;
    const mode = modeNormalise(row.payment_method);
    const [compte, journal] = tresorerie(mode === 'cheque' ? 'virement' : mode);
    out.push({
      sourceId: row.id, date: row.d, journal, reference: `AVP-${row.d.slice(0, 7)}`,
      label: `${row.kind === 'pret' ? 'Prêt' : 'Avance'} au personnel — ${row.full_name}`,
      sig: `${montant}|${row.payment_method}|${row.d}|${row.full_name}|t3`,
      lignes: [ligne(COMPTE_AVANCES_PERSONNEL, montant, 0), ligne(compte, 0, montant)],
    });
  }
  return out;
}

// Salaires versés (net payé) : débit du personnel à payer (422xxx) quand le
// bulletin existe — il a déjà été comptabilisé —, sinon débit 661 ; crédit trésorerie.
async function lireSalaires(client, merchantId, debut, ctx) {
  const r = await client.query(
    `SELECT sp.id::text AS id, sp.user_id::text AS user_id, sp.month, sp.amount, sp.payment_method,
            to_char(sp.paid_at::date, 'YYYY-MM-DD') AS d, u.full_name, (p.id IS NOT NULL) AS bulletin
     FROM salary_payments sp
     JOIN employees u ON u.id = sp.user_id
     LEFT JOIN payslips p ON p.user_id = sp.user_id AND p.month = sp.month AND p.status <> 'remplace'
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
    `SELECT id::text AS id, movement_type, payment_method, amount, COALESCE(reason, '') AS reason, charge_account, COALESCE(tva_amount, 0) AS tva, COALESCE(brs_retenue, 0) AS retenue,
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
      if (/^de la boutique/.test(motif) || row.reason.startsWith(MOTIF_CESSION) || row.reason.startsWith(MOTIF_FINANCEMENT)) continue; // transfert entre boutiques, cession d'immobilisation
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
      if (/^(salaire|avance sur salaire|remboursement retour|transfert vers)/.test(motif) || row.reason.startsWith('Charge — ') || row.reason.startsWith(MOTIF_ETAT)
        || row.reason.startsWith(MOTIF_REGLEMENT) || row.reason.startsWith(MOTIF_ACQUISITION)
        || row.reason.startsWith(MOTIF_FINANCEMENT)) continue;
      // Nature de charge choisie dans le formulaire de la page Caisse : elle prime sur les mots-clés.
      const compteCharge = /^6\d{1,5}$/.test(row.charge_account || '') ? row.charge_account : null;
      const regle = REGLES_DEPENSES.find(([re]) => re.test(motif));
      const [compte, j] = tresorerie(mode === 'cheque' ? 'virement' : mode);
      journal = j;
      if (!regle && !compteCharge) nonClassees.push(row.reason);
      // Retenue à la source : la caisse a sorti le net, la charge est enregistrée pour son montant brut.
      const retenue = arrondi(row.retenue);
      const brut = arrondi(montant + retenue);
      const tva = Math.min(arrondi(row.tva), brut);
      lignes = [ligne(compteCharge || (regle ? regle[1] : '658'), arrondi(brut - tva), 0)];
      if (tva > 0) lignes.push(ligne('445', tva, 0));
      lignes.push(ligne(compte, 0, montant));
      if (retenue > 0) lignes.push(ligne(COMPTE_BRS[0], 0, retenue));
      sigCharge = `${compteCharge ? `|${compteCharge}` : ''}${tva > 0 ? `|v${tva}` : ''}${retenue > 0 ? `|r${retenue}` : ''}`;
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
  personnel: { prefixe: '422', largeur: 3, premier: 1, dernier: 999, collectif: '422', table: 'employees', libelle: 'personnel' },
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
            COALESCE(o.total_amount, 0) AS total, COALESCE(o.tva_amount, 0) AS tva, COALESCE(o.precompte_amount, 0) AS precompte,
            ${SQL_JOUR_TZ('COALESCE(o.validated_at, o.delivered_at, o.created_at)')} AS d,
            COALESCE((SELECT SUM(oi.quantity * COALESCE(oi.unit_cost, 0)) FROM order_items oi WHERE oi.order_id = o.id), 0) AS cogs,
            COALESCE((SELECT SUM(CASE WHEN oi.quantity > 0 THEN LEAST(pr.quantity, oi.quantity) / oi.quantity * oi.line_total ELSE 0 END)
                      FROM pending_reservations pr JOIN order_items oi ON oi.id = pr.order_item_id
                      WHERE pr.order_id = o.id AND pr.status <> 'annulee' AND pr.delivered_at IS NULL), 0) AS differe,
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
    // Précompte de TVA : le client public verse cette part directement à l'État. Elle n'entre pas en
    // trésorerie ; elle devient une TVA récupérable (445) qui vient en déduction de la TVA à reverser.
    const precompte = row.pm === 'tiers_payant' || !lignes.length ? 0 : Math.min(arrondi(row.precompte), tva, lignes[0].debit - 0.01);
    if (precompte > 0) {
      lignes[0] = ligne(lignes[0].compte, arrondi(lignes[0].debit - precompte), 0);
      lignes.push(ligne('445', precompte, 0));
    }
    // Reliquat (D8) : la part de la vente dont la marchandise n'est pas encore livrée au client
    // n'est pas du chiffre d'affaires : elle reste en acompte client (419) jusqu'à la livraison.
    const differe = Math.min(arrondi(row.differe), ht);
    if (ht - differe > 0) lignes.push(ligne('701', 0, arrondi(ht - differe)));
    if (differe > 0) lignes.push(ligne('419', 0, differe));
    if (tva > 0) lignes.push(ligne('443', 0, tva));
    if (cogs > 0) {
      lignes.push(ligne('6031', cogs, 0));
      lignes.push(ligne('311', 0, cogs));
    }
    out.push({
      sourceId: row.id, date: row.d, journal: 'VT', reference: row.order_seq ? `V${row.order_seq}` : null,
      label: `Vente${row.order_seq ? ` n°${row.order_seq}` : ''}`,
      // La signature ne change que s'il y a un reliquat non livré : les ventes existantes ne sont pas réécrites.
      sig: `${total}|${tva}|${row.pm}|${cogs}|${row.copay}|${row.d}|${row.client_id}|${row.insurer_id}|t3${differe > 0 ? `|d${differe}` : ''}${precompte > 0 ? `|p${precompte}` : ''}`,
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

// Pertes de stock (casse, péremption, lot détruit, vol) : le stock sort à son prix de revient et
// la valeur perdue devient une charge (débit 6581, crédit 311). Valeur = quantité × coût unitaire
// enregistré au moment de la perte, à défaut le prix de revient actuel du produit.
async function lirePertes(client, merchantId, debut, ctx) {
  const r = await client.query(
    `SELECT sm.id::text AS id, sm.quantity, sm.reason, p.name AS produit,
            COALESCE(sm.unit_cost, p.cost_price, 0) AS cout,
            ${SQL_JOUR_TZ('sm.created_at')} AS d
     FROM stock_movements sm
     JOIN products p ON p.id = sm.product_id
     WHERE sm.merchant_id = $1 AND sm.movement_type = 'perte' AND sm.created_at >= $2::date
     ORDER BY sm.created_at`,
    [merchantId, debut]
  );
  const out = [];
  let sansCout = 0;
  for (const row of r.rows) {
    const valeur = arrondi(Number(row.quantity) * Number(row.cout));
    if (!(valeur > 0)) {
      sansCout += 1;
      continue;
    }
    out.push({
      sourceId: row.id, date: row.d, journal: 'OD', reference: 'PERTE',
      label: `Perte de stock — ${row.produit}${row.reason ? ` (${String(row.reason).slice(0, 80)})` : ''}`,
      sig: `${valeur}|${row.d}|p1`,
      lignes: [ligne('6581', valeur, 0), ligne('311', 0, valeur)],
    });
  }
  if (sansCout > 0) {
    ctx.avertissements.push(`${sansCout} perte(s) de stock sans prix de revient : renseignez le prix de revient du produit pour qu'elles soient comptabilisées.`);
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
// ---------- Immobilisations et factures de charges : écritures automatiques ----------

// Catégories d'immobilisations : compte de bien, compte d'amortissements, durée par défaut (ans).
// Plan indicatif SYSCOHADA : à faire valider par l'expert-comptable du commerçant.
const CATEGORIES_IMMO = {
  logiciel: { label: 'Logiciels, site internet, licences', compte: '213', nom: 'Logiciels et sites internet', amort: '2813', nomAmort: 'Amortissements des logiciels', duree: 3 },
  agencement: { label: 'Agencements et aménagements', compte: '235', nom: 'Aménagements de bureaux', amort: '2835', nomAmort: 'Amortissements des aménagements', duree: 10 },
  batiment: { label: 'Bâtiments', compte: '231', nom: 'Bâtiments sur sol propre', amort: '2831', nomAmort: 'Amortissements des bâtiments', duree: 20 },
  terrain: { label: 'Terrain (non amortissable)', compte: '223', nom: 'Terrains bâtis', amort: null, nomAmort: null, duree: null },
  materiel: { label: 'Matériel et outillage', compte: '241', nom: 'Matériel et outillage industriel et commercial', amort: '2841', nomAmort: 'Amortissements du matériel et outillage', duree: 5 },
  bureau: { label: 'Mobilier et matériel de bureau', compte: '244', nom: 'Matériel et mobilier', amort: '2844', nomAmort: 'Amortissements du matériel et mobilier', duree: 10 },
  informatique: { label: 'Matériel informatique', compte: '244', nom: 'Matériel et mobilier', amort: '2844', nomAmort: 'Amortissements du matériel et mobilier', duree: 3 },
  transport: { label: 'Matériel de transport', compte: '245', nom: 'Matériel de transport', amort: '2845', nomAmort: 'Amortissements du matériel de transport', duree: 5 },
  autre: { label: 'Autre immobilisation', compte: '248', nom: 'Autres matériels et mobiliers', amort: '2848', nomAmort: 'Amortissements des autres matériels', duree: 5 },
};
const COMPTES_IMMO_COMMUNS = [
  ['681', "Dotations aux amortissements d'exploitation"],
  ['811', "Valeurs comptables des cessions d'immobilisations"],
  ['821', "Produits des cessions d'immobilisations"],
  ['481', "Fournisseurs d'investissements"],
];

async function lireRegistreImmo(db, merchantId) {
  const r = await db.query(
    `SELECT id::text AS id, label, category, asset_account, depreciation_account,
            to_char(acquisition_date, 'YYYY-MM-DD') AS acq, cost, residual_value, useful_life_years, payment_method,
            to_char(paid_at, 'YYYY-MM-DD') AS paid, paid_method, to_char(disposal_date, 'YYYY-MM-DD') AS disp,
            disposal_price, disposal_method, note
     FROM accounting_assets WHERE merchant_id = $1 ORDER BY acquisition_date, created_at`,
    [merchantId]
  );
  return r.rows;
}

const indexMois = (d) => Number(d.slice(0, 4)) * 12 + (Number(d.slice(5, 7)) - 1);
const moisDepuisIndex = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
function finDeMois(mois) {
  const jours = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0)).getUTCDate();
  return `${mois}-${String(jours).padStart(2, '0')}`;
}

// Amortissement linéaire mensuel, dès le mois d'acquisition. Renvoie les dotations
// dues à la date `jour` (mois terminés ; le mois de sortie est arrêté à la date de sortie),
// avec le cumul après chaque dotation. Le dernier mois solde exactement la base amortissable.
function calendrierAmortissement(a, jour) {
  const duree = Number(a.useful_life_years) || 0;
  if (!a.depreciation_account || !(duree > 0)) return [];
  const base = arrondi(Number(a.cost) - Number(a.residual_value || 0));
  if (!(base > 0)) return [];
  const n = Math.max(1, Math.round(duree * 12));
  const depart = indexMois(a.acq);
  const moisSortie = a.disp ? a.disp.slice(0, 7) : null;
  const out = [];
  let precedent = 0;
  for (let k = 1; k <= n; k += 1) {
    const mois = moisDepuisIndex(depart + k - 1);
    if (moisSortie && mois > moisSortie) break;
    const cumul = k === n ? base : arrondi((base * k) / n);
    const montant = arrondi(cumul - precedent);
    precedent = cumul;
    const date = moisSortie && mois === moisSortie ? a.disp : finDeMois(mois);
    if (date > jour) break;
    if (montant > 0) out.push({ mois, date, montant, cumul });
  }
  return out;
}

const dateOuverture = (a, debut) => (a.acq < debut ? debut : a.acq);

async function lireFacturesCharges(client, merchantId, debut) {
  const r = await client.query(
    `SELECT id::text AS id, nature_account, label, amount, COALESCE(tva_amount, 0) AS tva, to_char(bill_date, 'YYYY-MM-DD') AS d
     FROM accounting_charge_bills WHERE merchant_id = $1 AND bill_date >= $2::date ORDER BY bill_date`,
    [merchantId, debut]
  );
  return r.rows.map((row) => {
    const montant = arrondi(row.amount);
    const tva = Math.min(arrondi(row.tva), montant);
    const lignes = [ligne(row.nature_account, arrondi(montant - tva), 0)];
    if (tva > 0) lignes.push(ligne('445', tva, 0));
    lignes.push(ligne('401', 0, montant));
    return {
      sourceId: row.id, date: row.d, journal: 'AC', reference: 'FAC',
      label: `Charge à payer : ${row.label}`.slice(0, 120),
      sig: `${montant}|${row.nature_account}|${row.d}|${row.label}|t1${tva > 0 ? `|v${tva}` : ''}`,
      lignes,
    };
  });
}

async function lireReglementsCharges(client, merchantId, debut) {
  const r = await client.query(
    `SELECT id::text AS id, label, amount, COALESCE(brs_retenue, 0) AS retenue, paid_method, to_char(paid_at, 'YYYY-MM-DD') AS d
     FROM accounting_charge_bills
     WHERE merchant_id = $1 AND paid_at IS NOT NULL AND paid_at >= $2::date AND bill_date >= $2::date ORDER BY paid_at`,
    [merchantId, debut]
  );
  return r.rows.map((row) => {
    const montant = arrondi(row.amount);
    const [compte, journal] = tresorerie(row.paid_method);
    const retenue = Math.min(arrondi(row.retenue), montant);
    const lignes = [ligne('401', montant, 0), ligne(compte, 0, arrondi(montant - retenue))];
    if (retenue > 0) lignes.push(ligne(COMPTE_BRS[0], 0, retenue));
    return {
      sourceId: row.id, date: row.d, journal, reference: 'REGL',
      label: `Règlement de facture : ${row.label}`.slice(0, 120),
      sig: `${montant}|${row.paid_method}|${row.d}|${row.label}|t1${retenue > 0 ? `|r${retenue}` : ''}`,
      lignes,
    };
  });
}

// Acquisition (ou reprise d'un bien déjà possédé) et règlement des acquisitions « à payer ».
async function lireImmobilisations(client, merchantId, debut) {
  const out = [];
  for (const a of await lireRegistreImmo(client, merchantId)) {
    const cout = arrondi(a.cost);
    if (a.payment_method === 'existant') {
      const date = dateOuverture(a, debut);
      const ant = calendrierAmortissement(a, aujourdhui()).filter((p) => p.mois < date.slice(0, 7));
      const amorti = ant.length > 0 ? ant[ant.length - 1].cumul : 0;
      const lignes = [ligne(a.asset_account, cout, 0)];
      if (amorti > 0) lignes.push(ligne(a.depreciation_account, 0, amorti));
      lignes.push(ligne('121', 0, arrondi(cout - amorti)));
      out.push({
        sourceId: `${a.id}|acq`, date, journal: 'OD', reference: 'IMMO',
        label: `Reprise d'immobilisation : ${a.label}`.slice(0, 120),
        sig: `${cout}|${amorti}|${date}|${a.asset_account}|t1`, lignes,
      });
      continue;
    }
    if (a.acq < debut) continue;
    const aPayer = a.payment_method === 'a_payer';
    const [compte, journal] = aPayer ? ['481', 'AC'] : tresorerie(a.payment_method);
    out.push({
      sourceId: `${a.id}|acq`, date: a.acq, journal, reference: 'IMMO',
      label: `Acquisition : ${a.label}`.slice(0, 120),
      sig: `${cout}|${a.payment_method}|${a.acq}|${a.asset_account}|t1`,
      lignes: [ligne(a.asset_account, cout, 0), ligne(compte, 0, cout)],
    });
    if (aPayer && a.paid) {
      const [ct, jr] = tresorerie(a.paid_method);
      out.push({
        sourceId: `${a.id}|pay`, date: a.paid, journal: jr, reference: 'REGL',
        label: `Règlement d'immobilisation : ${a.label}`.slice(0, 120),
        sig: `${cout}|${a.paid_method}|${a.paid}|t1`,
        lignes: [ligne('481', cout, 0), ligne(ct, 0, cout)],
      });
    }
  }
  return out;
}

// Dotations mensuelles aux amortissements (débit 681 / crédit compte 28x).
async function lireAmortissements(client, merchantId, debut) {
  const out = [];
  for (const a of await lireRegistreImmo(client, merchantId)) {
    const premierMois = dateOuverture(a, debut).slice(0, 7);
    for (const p of calendrierAmortissement(a, aujourdhui())) {
      if (p.mois < premierMois) continue;
      out.push({
        sourceId: `${a.id}|${p.mois}`, date: p.date, journal: 'OD', reference: 'AMORT',
        label: `Dotation amortissement : ${a.label} (${p.mois})`.slice(0, 120),
        sig: `${p.montant}|${a.depreciation_account}|${p.date}|t1`,
        lignes: [ligne('681', p.montant, 0), ligne(a.depreciation_account, 0, p.montant)],
      });
    }
  }
  return out;
}

// Cession ou mise au rebut : sortie du bien (et de ses amortissements), moins-value en 811,
// prix de vente éventuel en 821.
async function lireCessions(client, merchantId) {
  const out = [];
  for (const a of await lireRegistreImmo(client, merchantId)) {
    if (!a.disp) continue;
    const cout = arrondi(a.cost);
    const plan = calendrierAmortissement(a, aujourdhui());
    const amorti = plan.length > 0 ? plan[plan.length - 1].cumul : 0;
    const vnc = arrondi(cout - amorti);
    const prix = arrondi(a.disposal_price || 0);
    const lignes = [];
    if (amorti > 0) lignes.push(ligne(a.depreciation_account, amorti, 0));
    if (vnc > 0) lignes.push(ligne('811', vnc, 0));
    lignes.push(ligne(a.asset_account, 0, cout));
    let journal = 'OD';
    if (prix > 0) {
      const [compte, j] = tresorerie(a.disposal_method);
      journal = j;
      lignes.push(ligne(compte, prix, 0), ligne('821', 0, prix));
    }
    out.push({
      sourceId: `${a.id}|cession`, date: a.disp, journal, reference: 'CESS',
      label: `${prix > 0 ? 'Cession' : 'Mise au rebut'} : ${a.label}`.slice(0, 120),
      sig: `${cout}|${amorti}|${prix}|${a.disposal_method}|${a.disp}|t1`, lignes,
    });
  }
  return out;
}

// ---------- Financement et régularisations : écritures automatiques ----------

const COMPTES_FINANCEMENT = [
  ['101', 'Capital social'],
  ['462', 'Associés, comptes courants'],
  ['162', "Emprunts auprès des établissements de crédit"],
  ['671', "Intérêts des emprunts"],
  ['476', "Charges constatées d'avance"],
  ['408', 'Fournisseurs, factures non parvenues'],
];

function jourSuivant(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Capital, apports, retraits, emprunts et remboursements. Les opérations « déjà en place
// avant la comptabilité » (capital, emprunt en cours) sont reprises à la date de début,
// en contrepartie du report à nouveau (121).
async function lireFinancement(client, merchantId, debut) {
  const r = await client.query(
    `SELECT id::text AS id, kind, label, amount, interest_amount, payment_method, to_char(op_date, 'YYYY-MM-DD') AS d
     FROM accounting_financing WHERE merchant_id = $1 ORDER BY op_date, created_at`,
    [merchantId]
  );
  const out = [];
  for (const row of r.rows) {
    const montant = arrondi(row.amount);
    const interets = arrondi(row.interest_amount);
    const existant = row.payment_method === 'existant';
    const date = existant && row.d < debut ? debut : row.d;
    if (!existant && row.d < debut) continue;
    const [compte, journal] = existant ? ['121', 'OD'] : tresorerie(row.payment_method);
    let lignes;
    let nom;
    if (row.kind === 'capital') {
      lignes = [ligne(compte, montant, 0), ligne('101', 0, montant)];
      nom = existant ? 'Reprise du capital' : 'Apport en capital';
    } else if (row.kind === 'apport') {
      lignes = [ligne(compte, montant, 0), ligne('462', 0, montant)];
      nom = "Apport de l'exploitant";
    } else if (row.kind === 'retrait') {
      lignes = [ligne('462', montant, 0), ligne(compte, 0, montant)];
      nom = "Retrait de l'exploitant";
    } else if (row.kind === 'emprunt') {
      lignes = [ligne(compte, montant, 0), ligne('162', 0, montant)];
      nom = existant ? "Reprise d'emprunt en cours" : 'Emprunt reçu';
    } else {
      lignes = [ligne('162', montant, 0)];
      if (interets > 0) lignes.push(ligne('671', interets, 0));
      lignes.push(ligne(compte, 0, arrondi(montant + interets)));
      nom = "Remboursement d'emprunt";
    }
    out.push({
      sourceId: row.id, date, journal, reference: 'FIN',
      label: `${nom} : ${row.label}`.slice(0, 120),
      sig: `${row.kind}|${montant}|${interets}|${row.payment_method}|${date}|${row.label}|t1`,
      lignes,
    });
  }
  return out;
}

// Charges constatées d'avance (476) et charges à payer (408), avec extourne le lendemain.
async function lireRegularisations(client, merchantId, debut) {
  const r = await client.query(
    `SELECT id::text AS id, kind, nature_account, label, amount, reverse, to_char(adj_date, 'YYYY-MM-DD') AS d
     FROM accounting_adjustments WHERE merchant_id = $1 AND adj_date >= $2::date ORDER BY adj_date`,
    [merchantId, debut]
  );
  const out = [];
  const jour = aujourdhui();
  for (const a of r.rows) {
    const montant = arrondi(a.amount);
    const avance = a.kind === 'charge_avance';
    const compteBilan = avance ? '476' : '408';
    const nom = avance ? "Charge constatée d'avance" : 'Charge à payer';
    out.push({
      sourceId: `${a.id}|reg`, date: a.d, journal: 'OD', reference: 'REG',
      label: `${nom} : ${a.label}`.slice(0, 120),
      sig: `${a.kind}|${montant}|${a.nature_account}|${a.d}|${a.label}|t1`,
      lignes: avance
        ? [ligne(compteBilan, montant, 0), ligne(a.nature_account, 0, montant)]
        : [ligne(a.nature_account, montant, 0), ligne(compteBilan, 0, montant)],
    });
    const dateExtourne = jourSuivant(a.d);
    if (a.reverse && dateExtourne <= jour) {
      out.push({
        sourceId: `${a.id}|ext`, date: dateExtourne, journal: 'OD', reference: 'EXT',
        label: `Extourne — ${nom.toLowerCase()} : ${a.label}`.slice(0, 120),
        sig: `${a.kind}|${montant}|${a.nature_account}|${dateExtourne}|${a.label}|t1`,
        lignes: avance
          ? [ligne(a.nature_account, montant, 0), ligne(compteBilan, 0, montant)]
          : [ligne(compteBilan, montant, 0), ligne(a.nature_account, 0, montant)],
      });
    }
  }
  return out;
}

const SOURCES = [
  { type: 'vente', lire: lireVentes },
  { type: 'retour', lire: lireRetours },
  { type: 'reglement_client', lire: lireReglementsClients },
  { type: 'reglement_assureur', lire: lireReglementsAssureurs },
  { type: 'achat', lire: lireAchats },
  { type: 'reglement_fournisseur', lire: lireReglementsFournisseurs },
  { type: 'paie', lire: lirePaie },
  { type: 'salaire', lire: lireSalaires },
  { type: 'avance_personnel', lire: lireAvances },
  { type: 'caisse', lire: lireCaisse },
  { type: 'facture_charge', lire: lireFacturesCharges },
  { type: 'reglement_charge', lire: lireReglementsCharges },
  { type: 'immobilisation', lire: lireImmobilisations },
  { type: 'amortissement', lire: lireAmortissements },
  { type: 'cession', lire: lireCessions },
  { type: 'financement', lire: lireFinancement },
  { type: 'regularisation', lire: lireRegularisations },
  { type: 'perte', lire: lirePertes },
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
      await assurerCompte(client, merchantId, COMPTE_BRS[0], COMPTE_BRS[1]);
      await assurerCompte(client, merchantId, '441', 'État, impôts sur les bénéfices');
      await assurerCompte(client, merchantId, '891', 'Impôts sur les bénéfices');
      for (const [code, nom] of COMPTES_IMMO_COMMUNS) await assurerCompte(client, merchantId, code, nom);
      for (const [code, nom] of COMPTES_FINANCEMENT) await assurerCompte(client, merchantId, code, nom);
      for (const c of Object.values(CATEGORIES_IMMO)) {
        await assurerCompte(client, merchantId, c.compte, c.nom);
        if (c.amort) await assurerCompte(client, merchantId, c.amort, c.nomAmort);
      }
      await assurerCompte(client, merchantId, '6581', 'Pertes sur stocks (casse, péremption, vol)');
      await assurerCompte(client, merchantId, '419', 'Clients, avances et acomptes reçus');
      await assurerCompte(client, merchantId, COMPTE_AVANCES_PERSONNEL, 'Personnel, avances et acomptes');
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
    // Comptes de tiers (411…, 4119…, 401…) : lettre de chaque ligne. Le lettrage dépend de tout
    // l'historique du compte jusqu'à la date de fin, pas seulement de la période affichée.
    const codeCompte = String(compte.rows[0].code);
    if (codeCompte.startsWith('411') || codeCompte.startsWith('401')) {
      const histo = await pool.query(
        `SELECT e.entry_number, l.debit, l.credit
         FROM accounting_lines l JOIN accounting_entries e ON e.id = l.entry_id
         WHERE l.merchant_id = $1 AND l.account_id = $2 AND ($3::date IS NULL OR e.entry_date <= $3::date)
         ORDER BY e.entry_date, e.entry_number`,
        [req.user.merchantId, idCompte, to || null]
      );
      const toutes = histo.rows.map((h) => ({ cle: `${Number(h.entry_number)}|${Number(h.debit)}|${Number(h.credit)}`, debit: Number(h.debit), credit: Number(h.credit) }));
      const lettres = lettrerLignes(toutes, codeCompte.startsWith('401') ? 'credit' : 'debit');
      const parCle = new Map();
      toutes.forEach((t, i) => {
        if (!parCle.has(t.cle)) parCle.set(t.cle, []);
        parCle.get(t.cle).push(lettres[i]);
      });
      for (const m of mouvements) m.lettre = (parCle.get(`${m.entryNumber}|${m.debit}|${m.credit}`) || []).shift() || '';
    }
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

// GET /accounting/cash-flow?from=&to= — tableau des flux de trésorerie (méthode directe, D4).
// Calculé depuis les écritures qui touchent un compte de trésorerie (classe 5). Un virement entre deux
// comptes de trésorerie s'annule dans une même écriture : il n'apparaît pas comme flux.
const FLUX_LIGNES = {
  vente: ['exploitation', "Encaissements des ventes"],
  reglement_client: ['exploitation', 'Règlements reçus des clients'],
  reglement_assureur: ['exploitation', 'Règlements reçus des assureurs'],
  retour: ['exploitation', 'Remboursements aux clients'],
  achat: ['exploitation', 'Achats de marchandises payés'],
  reglement_fournisseur: ['exploitation', 'Règlements aux fournisseurs'],
  caisse: ['exploitation', 'Charges payées depuis la caisse'],
  facture_charge: ['exploitation', 'Charges payées'],
  reglement_charge: ['exploitation', 'Règlements de factures de charges'],
  paie: ['exploitation', 'Salaires et charges sociales'],
  salaire: ['exploitation', 'Salaires'],
  avance_personnel: ['exploitation', 'Avances au personnel'],
  immobilisation: ['investissement', "Acquisitions d'immobilisations"],
  cession: ['investissement', "Cessions d'immobilisations"],
  financement: ['financement', 'Emprunts, apports et remboursements'],
};
const FLUX_SECTIONS = [['exploitation', "Flux liés à l'activité"], ['investissement', "Flux d'investissement"], ['financement', 'Flux de financement'], ['autres', 'Autres flux']];

router.get('/cash-flow', async (req, res) => {
  if (!verifierPeriode(req, res)) return;
  if (!req.query.from || !req.query.to) return res.status(400).json({ error: 'La période (du … au …) est requise.' });
  try {
    const merchantId = req.user.merchantId;
    const flux = await pool.query(
      `SELECT t.source_type, COALESCE(SUM(GREATEST(t.net, 0)), 0) AS entrees, COALESCE(SUM(GREATEST(-t.net, 0)), 0) AS sorties
       FROM (
         SELECT e.id, e.source_type, SUM(l.debit - l.credit) AS net
         FROM accounting_entries e
         JOIN accounting_lines l ON l.entry_id = e.id
         JOIN accounting_accounts a ON a.id = l.account_id
         WHERE e.merchant_id = $1 AND e.entry_date BETWEEN $2::date AND $3::date AND a.code LIKE '5%'
         GROUP BY e.id, e.source_type
       ) t
       WHERE t.net <> 0
       GROUP BY t.source_type`,
      [merchantId, req.query.from, req.query.to]
    );
    const ouverture = await pool.query(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS solde
       FROM accounting_lines l
       JOIN accounting_entries e ON e.id = l.entry_id
       JOIN accounting_accounts a ON a.id = l.account_id
       WHERE e.merchant_id = $1 AND e.entry_date < $2::date AND a.code LIKE '5%'`,
      [merchantId, req.query.from]
    );
    const sections = new Map(FLUX_SECTIONS.map(([id, label]) => [id, { id, label, lignes: [], entrees: 0, sorties: 0 }]));
    for (const row of flux.rows) {
      const [idSection, label] = FLUX_LIGNES[row.source_type] || ['autres', `Autres opérations (${row.source_type})`];
      const entrees = arrondi(row.entrees);
      const sorties = arrondi(row.sorties);
      const s = sections.get(idSection);
      s.lignes.push({ label, entrees, sorties, net: arrondi(entrees - sorties) });
      s.entrees = arrondi(s.entrees + entrees);
      s.sorties = arrondi(s.sorties + sorties);
    }
    const liste = [...sections.values()].filter((s) => s.lignes.length > 0).map((s) => ({ ...s, net: arrondi(s.entrees - s.sorties) }));
    const variation = arrondi(liste.reduce((t, s) => t + s.net, 0));
    const ouvertureSolde = arrondi(ouverture.rows[0].solde);
    res.json({ from: req.query.from, to: req.query.to, opening: ouvertureSolde, variation, closing: arrondi(ouvertureSolde + variation), sections: liste });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul des flux de trésorerie.' });
  }
});

// ---------- Contrôles de cohérence (D1, D2, D10) ----------
// GET /accounting/controls — vérifie que la comptabilité tient debout : équilibre des écritures,
// stock comptable = stock réel, produits sans prix de revient, ventes tardives et corrections.
router.get('/controls', async (req, res) => {
  try {
    const merchantId = req.user.merchantId;
    const q = (sql, params = [merchantId]) => pool.query(sql, params).then((r) => r.rows[0]);
    const [equilibre, desequilibrees, stockCompta, stockReel, sansCout, tardives, corrections, pertesSansCout] = await Promise.all([
      q(`SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c FROM accounting_lines WHERE merchant_id = $1`),
      q(`SELECT COUNT(*) AS n FROM (SELECT entry_id FROM accounting_lines WHERE merchant_id = $1 GROUP BY entry_id HAVING ROUND(SUM(debit) - SUM(credit), 2) <> 0) t`),
      q(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM accounting_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.merchant_id = $1 AND a.code = '311'`),
      q(`SELECT COALESCE(SUM(ps.quantity_in_stock * COALESCE(p.cost_price, 0)), 0) AS v FROM product_stock ps JOIN products p ON p.id = ps.product_id WHERE ps.merchant_id = $1`),
      q(`SELECT COUNT(*) AS n FROM product_stock ps JOIN products p ON p.id = ps.product_id WHERE ps.merchant_id = $1 AND ps.quantity_in_stock > 0 AND COALESCE(p.cost_price, 0) = 0`),
      q(`SELECT COUNT(*) AS n FROM accounting_entries WHERE merchant_id = $1 AND period_marker = 'vente_tardive'`),
      q(`SELECT COUNT(*) AS n FROM accounting_entries WHERE merchant_id = $1 AND period_marker = 'correction'`),
      q(`SELECT COUNT(*) AS n FROM stock_movements sm JOIN products p ON p.id = sm.product_id WHERE sm.merchant_id = $1 AND sm.movement_type = 'perte' AND COALESCE(sm.unit_cost, p.cost_price, 0) = 0`),
    ]);
    const ecartBalance = arrondi(equilibre.d - equilibre.c);
    const ecartStock = arrondi(stockCompta.v - stockReel.v);
    const controles = [
      { id: 'balance', libelle: 'Total des débits = total des crédits', ok: ecartBalance === 0, detail: ecartBalance === 0 ? 'Équilibrée.' : `Écart de ${ecartBalance} FCFA.` },
      { id: 'ecritures', libelle: 'Chaque écriture est équilibrée', ok: Number(desequilibrees.n) === 0, detail: Number(desequilibrees.n) === 0 ? 'Aucune écriture déséquilibrée.' : `${desequilibrees.n} écriture(s) déséquilibrée(s).` },
      { id: 'stock', libelle: 'Stock comptable (311) = stock réel valorisé', ok: Math.abs(ecartStock) < 1, detail: Math.abs(ecartStock) < 1 ? 'Concordant.' : `Écart de ${ecartStock} FCFA (la prochaine synchronisation le corrige).` },
      { id: 'prix_revient', libelle: 'Produits en stock avec un prix de revient', ok: Number(sansCout.n) === 0, detail: Number(sansCout.n) === 0 ? 'Tous renseignés.' : `${sansCout.n} produit(s) en stock sans prix de revient.` },
      { id: 'pertes', libelle: 'Pertes de stock valorisées', ok: Number(pertesSansCout.n) === 0, detail: Number(pertesSansCout.n) === 0 ? 'Toutes valorisées.' : `${pertesSansCout.n} perte(s) non comptabilisée(s) faute de prix de revient.` },
      { id: 'tardives', libelle: 'Ventes tardives (arrivées après clôture)', ok: Number(tardives.n) === 0, info: true, detail: Number(tardives.n) === 0 ? 'Aucune.' : `${tardives.n} vente(s) rattachée(s) à un exercice ouvert.` },
      { id: 'corrections', libelle: 'Écritures de correction (après clôture)', ok: Number(corrections.n) === 0, info: true, detail: Number(corrections.n) === 0 ? 'Aucune.' : `${corrections.n} correction(s).` },
    ];
    res.json({ controls: controles, allOk: controles.filter((c) => !c.info).every((c) => c.ok) });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors des contrôles comptables.');
  }
});

// ---------- Soldes d'ouverture (D6) : assistant à faire une seule fois ----------
const COMPTES_OUVERTURE = {
  caisse: ['571', 'Caisse'], wave: ['5211', 'Wave'], orange_money: ['5212', 'Orange Money'], banque: ['521', 'Banque'],
  creances: ['411', 'Clients'], dettes: ['401', 'Fournisseurs'], capital: ['101', 'Capital social'],
};

router.get('/opening-balances', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT to_char(opening_date, 'YYYY-MM-DD') AS opening_date, balances, validated_at FROM accounting_opening_balances WHERE merchant_id = $1`,
      [req.user.merchantId]
    );
    res.json({ validated: r.rows.length > 0, ...(r.rows[0] || {}) });
  } catch (err) {
    repondreErreur(res, err, "Erreur lors de la lecture des soldes d'ouverture.");
  }
});

// POST /accounting/opening-balances { openingDate, balances: { caisse, wave, orange_money, banque, creances, dettes, capital } }
// Écrit une seule écriture d'ouverture ; le solde restant va au report à nouveau (121). Le stock et les
// immobilisations ne se saisissent pas ici : le stock vient des quantités réelles, les immobilisations de leur module.
router.post('/opening-balances', async (req, res) => {
  const { openingDate, balances } = req.body || {};
  if (!dateOk(openingDate)) return res.status(400).json({ error: "Date d'ouverture invalide." });
  const montants = {};
  for (const cle of Object.keys(COMPTES_OUVERTURE)) {
    const v = balances && balances[cle] !== undefined && balances[cle] !== '' ? Number(balances[cle]) : 0;
    if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `Montant invalide : ${COMPTES_OUVERTURE[cle][1]}.` });
    montants[cle] = arrondi(v);
  }
  if (Object.values(montants).every((v) => v === 0)) return res.status(400).json({ error: 'Saisissez au moins un solde.' });

  const merchantId = req.user.merchantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouiller(client, merchantId);
    const deja = await client.query(`SELECT 1 FROM accounting_opening_balances WHERE merchant_id = $1`, [merchantId]);
    if (deja.rows.length > 0) throw erreurMetier(400, "Les soldes d'ouverture ont déjà été validés : ils ne peuvent plus être modifiés.");
    await verifierExerciceOuvert(client, merchantId, openingDate);

    const journal = await client.query(`SELECT id FROM accounting_journals WHERE merchant_id = $1 AND code = 'OD'`, [merchantId]);
    if (journal.rows.length === 0) throw erreurMetier(400, "Journal des opérations diverses introuvable.");

    // Débit : trésorerie et créances ; crédit : dettes et capital ; le reste équilibre sur le report à nouveau.
    const debit = ['caisse', 'wave', 'orange_money', 'banque', 'creances'];
    const lignes = [];
    for (const cle of Object.keys(COMPTES_OUVERTURE)) {
      if (montants[cle] === 0) continue;
      const [code, nom] = COMPTES_OUVERTURE[cle];
      const compteId = await assurerCompte(client, merchantId, code, nom);
      lignes.push(debit.includes(cle) ? { compteId, debit: montants[cle], credit: 0 } : { compteId, debit: 0, credit: montants[cle] });
    }
    const totalDebit = arrondi(lignes.reduce((t, l) => t + l.debit, 0));
    const totalCredit = arrondi(lignes.reduce((t, l) => t + l.credit, 0));
    const reste = arrondi(totalDebit - totalCredit);
    if (reste !== 0) {
      const reportId = await assurerCompte(client, merchantId, '121', 'Report à nouveau');
      lignes.push(reste > 0 ? { compteId: reportId, debit: 0, credit: reste } : { compteId: reportId, debit: -reste, credit: 0 });
    }

    const num = await client.query(`SELECT COALESCE(MAX(entry_number), 0) + 1 AS n FROM accounting_entries WHERE merchant_id = $1`, [merchantId]);
    const entree = await client.query(
      `INSERT INTO accounting_entries (merchant_id, journal_id, entry_number, entry_date, reference, label, source_type, source_id, created_by)
       VALUES ($1, $2, $3, $4::date, 'OUVERTURE', $5, 'ouverture_solde', 'ouverture', $6) RETURNING id`,
      [merchantId, journal.rows[0].id, Number(num.rows[0].n), openingDate, "Soldes d'ouverture", req.user.id]
    );
    for (const l of lignes) {
      await client.query(
        `INSERT INTO accounting_lines (entry_id, merchant_id, account_id, debit, credit, label) VALUES ($1, $2, $3, $4, $5, $6)`,
        [entree.rows[0].id, merchantId, l.compteId, l.debit, l.credit, "Soldes d'ouverture"]
      );
    }
    await client.query(
      `INSERT INTO accounting_opening_balances (merchant_id, opening_date, balances, validated_by) VALUES ($1, $2::date, $3::jsonb, $4)`,
      [merchantId, openingDate, JSON.stringify(montants), req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ entryId: entree.rows[0].id, carriedForward: reste });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreur(res, err, "Erreur lors de l'enregistrement des soldes d'ouverture.");
  } finally {
    client.release();
  }
});

// ---------- Pièces jointes (D5) ----------
// Corps envoyé tel quel (image ou PDF), métadonnées dans l'URL : cela évite la limite de taille du
// parseur JSON global. 1,5 Mo maximum par pièce (l'image est compressée côté navigateur), 50 Mo par commerçant.
const PIECES_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const PIECE_MAX_OCTETS = 1572864;
const PIECES_QUOTA_OCTETS = 50 * 1024 * 1024;

router.post('/attachments', express.raw({ type: PIECES_TYPES, limit: '2mb' }), async (req, res) => {
  const { sourceType, sourceId, fileName } = req.query;
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (!sourceType || !sourceId || !fileName) return res.status(400).json({ error: 'Pièce jointe : source et nom du fichier requis.' });
  if (!PIECES_TYPES.includes(mime)) return res.status(400).json({ error: 'Format non accepté (JPEG, PNG, WebP ou PDF).' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Fichier vide.' });
  if (req.body.length > PIECE_MAX_OCTETS) return res.status(413).json({ error: 'Fichier trop volumineux (1,5 Mo maximum).' });
  try {
    const total = await pool.query(`SELECT COALESCE(SUM(size_bytes), 0) AS t FROM accounting_attachments WHERE merchant_id = $1`, [req.user.merchantId]);
    if (Number(total.rows[0].t) + req.body.length > PIECES_QUOTA_OCTETS) {
      return res.status(413).json({ error: 'Espace de stockage des pièces jointes plein (50 Mo).' });
    }
    const r = await pool.query(
      `INSERT INTO accounting_attachments (merchant_id, source_type, source_id, file_name, mime_type, size_bytes, content, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, file_name, mime_type, size_bytes, created_at`,
      [req.user.merchantId, String(sourceType).slice(0, 40), String(sourceId).slice(0, 80), String(fileName).slice(0, 200), mime, req.body.length, req.body, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    repondreErreur(res, err, "Erreur lors de l'enregistrement de la pièce jointe.");
  }
});

router.get('/attachments', async (req, res) => {
  const { sourceType, sourceId } = req.query;
  if (!sourceType || !sourceId) return res.status(400).json({ error: 'Source requise.' });
  try {
    const r = await pool.query(
      `SELECT id, file_name, mime_type, size_bytes, created_at FROM accounting_attachments
       WHERE merchant_id = $1 AND source_type = $2 AND source_id = $3 ORDER BY created_at DESC`,
      [req.user.merchantId, String(sourceType), String(sourceId)]
    );
    res.json(r.rows);
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la lecture des pièces jointes.');
  }
});

router.get('/attachments/:id/file', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  try {
    const r = await pool.query(`SELECT file_name, mime_type, content FROM accounting_attachments WHERE id = $1 AND merchant_id = $2`, [req.params.id, req.user.merchantId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Pièce introuvable.' });
    res.setHeader('Content-Type', r.rows[0].mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(r.rows[0].file_name)}"`);
    res.send(r.rows[0].content);
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la lecture de la pièce.');
  }
});

router.delete('/attachments/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  try {
    const r = await pool.query(`DELETE FROM accounting_attachments WHERE id = $1 AND merchant_id = $2 RETURNING id`, [req.params.id, req.user.merchantId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Pièce introuvable.' });
    res.status(204).send();
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la suppression de la pièce.');
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

// ---------- Balance âgée (clients, fournisseurs, assureurs) ----------
// Calculée depuis les comptes auxiliaires (411…, 401…, 4119…) : aucune table à ajouter.
// Les règlements ne sont pas rattachés à une facture précise ; ils sont imputés sur les
// plus anciennes factures d'abord (méthode « premier entré, premier sorti »). Ce qui reste
// ouvert est classé selon son ancienneté à la date choisie. Un règlement qui dépasse tout
// ce qui est dû apparaît comme avance (crédit du tiers).

const TRANCHES_AGE = [
  { label: '0 à 30 jours', min: 0, max: 30 },
  { label: '31 à 60 jours', min: 31, max: 60 },
  { label: '61 à 90 jours', min: 61, max: 90 },
  { label: 'Plus de 90 jours', min: 91, max: null },
];
const TIERS_AGES = {
  client: { titre: 'Clients', sens: 'debit', filtre: `a.code LIKE '411%' AND a.code NOT LIKE '4119%'` },
  assureur: { titre: 'Assureurs (tiers payant)', sens: 'debit', filtre: `a.code LIKE '4119%'` },
  fournisseur: { titre: 'Fournisseurs', sens: 'credit', filtre: `a.code LIKE '401%'` },
};

function joursEntre(debut, fin) {
  return Math.round((Date.parse(fin) - Date.parse(debut)) / 86400000);
}

// lignes : mouvements d'UN compte auxiliaire, triés par date. sens : 'debit' (le tiers nous doit,
// ex. client) ou 'credit' (nous lui devons, ex. fournisseur).
function ageerCompte(lignes, sens, auDate) {
  const ouverts = [];
  let reglements = 0;
  for (const l of lignes) {
    const net = arrondi(sens === 'debit' ? l.debit - l.credit : l.credit - l.debit);
    if (net > 0) ouverts.push({ date: l.date, reference: l.reference || '', label: l.label || '', initial: net, restant: net });
    else if (net < 0) reglements = arrondi(reglements - net);
  }
  for (const o of ouverts) {
    if (reglements <= 0) break;
    const pris = Math.min(o.restant, reglements);
    o.restant = arrondi(o.restant - pris);
    reglements = arrondi(reglements - pris);
  }
  const tranches = TRANCHES_AGE.map(() => 0);
  const items = [];
  for (const o of ouverts) {
    if (o.restant <= 0) continue;
    const age = Math.max(0, joursEntre(o.date, auDate));
    const i = TRANCHES_AGE.findIndex((t) => age >= t.min && (t.max === null || age <= t.max));
    tranches[i] = arrondi(tranches[i] + o.restant);
    items.push({ ...o, age });
  }
  return { tranches, avance: reglements, total: arrondi(tranches.reduce((s, t) => s + t, 0)), items };
}

// ---------- Lettrage automatique (comptes de tiers) ----------
// Même logique que la balance âgée : factures et règlements d'un tiers sont rapprochés du plus
// ancien au plus récent. Un groupe de lignes dont le total des factures égale celui des règlements
// reçoit une lettre (A, B, … Z, AA…) : ces lignes se compensent. Les lignes sans lettre sont
// encore ouvertes. Calculé à la demande, rien n'est enregistré : il suit donc toujours la comptabilité.

function lettreDepuisIndice(n) {
  let s = '';
  let k = n + 1;
  while (k > 0) {
    const reste = (k - 1) % 26;
    s = String.fromCharCode(65 + reste) + s;
    k = Math.floor((k - 1) / 26);
  }
  return s;
}

// lignes : mouvements d'UN compte de tiers, triés par date. Renvoie une lettre (ou '') par ligne.
function lettrerLignes(lignes, sens) {
  const factures = [];
  const reglements = [];
  lignes.forEach((l, i) => {
    const net = arrondi(sens === 'debit' ? l.debit - l.credit : l.credit - l.debit);
    if (net > 0) factures.push({ i, m: net });
    else if (net < 0) reglements.push({ i, m: -net });
  });
  const lettres = lignes.map(() => '');
  let f = 0;
  let r = 0;
  let sommeF = 0;
  let sommeR = 0;
  let groupe = [];
  let nb = 0;
  for (;;) {
    if (groupe.length > 0 && sommeF === sommeR) {
      const lettre = lettreDepuisIndice(nb++);
      groupe.forEach((i) => { lettres[i] = lettre; });
      groupe = [];
    }
    if (sommeF <= sommeR) {
      if (f >= factures.length) break;
      sommeF = arrondi(sommeF + factures[f].m);
      groupe.push(factures[f++].i);
    } else {
      if (r >= reglements.length) break;
      sommeR = arrondi(sommeR + reglements[r].m);
      groupe.push(reglements[r++].i);
    }
  }
  return lettres;
}

// GET /accounting/aged-balance?type=client|fournisseur|assureur&date=
router.get('/aged-balance', async (req, res) => {
  const type = String(req.query.type || 'client');
  const cfg = TIERS_AGES[type];
  const date = req.query.date || aujourdhui();
  if (!cfg) return res.status(400).json({ error: 'Type de tiers invalide.' });
  if (!dateOk(date)) return res.status(400).json({ error: 'Date invalide.' });
  try {
    const r = await pool.query(
      `SELECT a.code, a.label AS compte, to_char(e.entry_date, 'YYYY-MM-DD') AS d, e.reference, e.label, l.debit, l.credit
       FROM accounting_lines l
       JOIN accounting_entries e ON e.id = l.entry_id
       JOIN accounting_accounts a ON a.id = l.account_id
       WHERE l.merchant_id = $1 AND ${cfg.filtre} AND e.entry_date <= $2::date
       ORDER BY a.code, e.entry_date, e.entry_number`,
      [req.user.merchantId, date]
    );
    const parCompte = new Map();
    for (const row of r.rows) {
      if (!parCompte.has(row.code)) parCompte.set(row.code, { code: row.code, label: row.compte, lignes: [] });
      parCompte.get(row.code).lignes.push({ date: row.d, reference: row.reference, label: row.label, debit: Number(row.debit), credit: Number(row.credit) });
    }
    const tiers = [];
    for (const c of parCompte.values()) {
      const a = ageerCompte(c.lignes, cfg.sens, date);
      if (a.total > 0 || a.avance > 0) tiers.push({ code: c.code, label: c.label, ...a });
    }
    const somme = (f) => arrondi(tiers.reduce((s, t) => s + f(t), 0));
    res.json({
      type, titre: cfg.titre, date, trancheLabels: TRANCHES_AGE.map((t) => t.label), tiers,
      totals: { tranches: TRANCHES_AGE.map((_, i) => somme((t) => t.tranches[i])), avance: somme((t) => t.avance), total: somme((t) => t.total) },
    });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors du calcul de la balance âgée.');
  }
});

// ---------- Rapprochement caisse / banque / mobile money ----------
// Compare le solde réel (relevé de la banque, application Wave ou Orange Money,
// argent compté en caisse) au solde que la comptabilité calcule à la même date.
// Aucune écriture n'est générée : on garde seulement la comparaison et son historique.

const COMPTES_RAPPROCHEMENT = ['571', '5211', '5212', '521']; // Caisse, Wave, Orange Money, Banque

// Solde débiteur (débit − crédit) de chaque compte de trésorerie, écritures jusqu'à la date incluse.
// Les codes sont comparés exactement : 521 (banque) n'englobe pas 5211 (Wave) ni 5212 (Orange Money).
async function soldesTresorerie(merchantId, date) {
  const result = await pool.query(
    `SELECT a.code, COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS solde
     FROM accounting_lines l
     JOIN accounting_entries e ON e.id = l.entry_id
     JOIN accounting_accounts a ON a.id = l.account_id
     WHERE l.merchant_id = $1 AND a.code = ANY($2::text[]) AND e.entry_date <= $3::date
     GROUP BY a.code`,
    [merchantId, COMPTES_RAPPROCHEMENT, date]
  );
  const soldes = new Map(result.rows.map((row) => [row.code, arrondi(row.solde)]));
  return COMPTES_RAPPROCHEMENT.map((code) => ({ code, label: NOM_TRESORERIE[code], bookBalance: soldes.get(code) || 0 }));
}

// GET /accounting/reconciliations/balances?date= — soldes comptables des 4 comptes à la date.
router.get('/reconciliations/balances', async (req, res) => {
  const date = req.query.date || aujourdhui();
  if (!dateOk(date) || date > aujourdhui()) return res.status(400).json({ error: 'Date invalide.' });
  try {
    res.json({ date, accounts: await soldesTresorerie(req.user.merchantId, date) });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors du calcul des soldes comptables.');
  }
});

// GET /accounting/reconciliations?account= — historique, du plus récent au plus ancien.
router.get('/reconciliations', async (req, res) => {
  const compte = req.query.account ? String(req.query.account) : null;
  if (compte && !COMPTES_RAPPROCHEMENT.includes(compte)) return res.status(400).json({ error: 'Compte invalide.' });
  try {
    const r = await pool.query(
      `SELECT id::text AS id, account_code, to_char(rec_date, 'YYYY-MM-DD') AS rec_date,
              real_balance, book_balance, note, created_at
       FROM accounting_reconciliations
       WHERE merchant_id = $1 AND ($2::text IS NULL OR account_code = $2)
       ORDER BY rec_date DESC, created_at DESC
       LIMIT 300`,
      [req.user.merchantId, compte]
    );
    res.json(r.rows.map((x) => ({
      id: x.id, accountCode: x.account_code, accountLabel: NOM_TRESORERIE[x.account_code] || x.account_code,
      date: x.rec_date, realBalance: Number(x.real_balance), bookBalance: Number(x.book_balance),
      gap: arrondi(Number(x.real_balance) - Number(x.book_balance)), note: x.note || '', createdAt: x.created_at,
    })));
  } catch (err) {
    repondreErreur(res, err, "Erreur lors du chargement de l'historique des rapprochements.");
  }
});

// POST /accounting/reconciliations — { accountCode, recDate, realBalance, note }
// Le solde comptable est recalculé côté serveur (après synchro) et figé avec le solde réel.
router.post('/reconciliations', async (req, res) => {
  const { accountCode } = req.body;
  const date = req.body.recDate || aujourdhui();
  const brut = req.body.realBalance;
  const reel = brut === null || brut === undefined || brut === '' ? NaN : Number(brut);
  if (!COMPTES_RAPPROCHEMENT.includes(String(accountCode))) return res.status(400).json({ error: 'Choisissez le compte à rapprocher.' });
  if (!Number.isFinite(reel) || Math.abs(reel) >= 1e15) return res.status(400).json({ error: 'Saisissez le solde réel.' });
  if (!dateOk(date) || date > aujourdhui()) return res.status(400).json({ error: 'Date invalide.' });
  const note = String(req.body.note || '').trim().slice(0, 300);
  const merchantId = req.user.merchantId;
  try {
    await assurerSynchro(merchantId, req.user.id);
    const compte = (await soldesTresorerie(merchantId, date)).find((c) => c.code === String(accountCode));
    const ins = await pool.query(
      `INSERT INTO accounting_reconciliations (merchant_id, account_code, rec_date, real_balance, book_balance, note, created_by)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7) RETURNING id::text AS id`,
      [merchantId, String(accountCode), date, arrondi(reel), compte.bookBalance, note || null, req.user.id]
    );
    res.status(201).json({ id: ins.rows[0].id, bookBalance: compte.bookBalance, gap: arrondi(reel - compte.bookBalance) });
  } catch (err) {
    repondreErreur(res, err, "Erreur lors de l'enregistrement du rapprochement.");
  }
});

// DELETE /accounting/reconciliations/:id — corrige une saisie erronée (aucune écriture à annuler).
router.delete('/reconciliations/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Rapprochement invalide.' });
  try {
    const r = await pool.query(`DELETE FROM accounting_reconciliations WHERE id = $1 AND merchant_id = $2`, [req.params.id, req.user.merchantId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Rapprochement introuvable.' });
    res.json({ ok: true });
  } catch (err) {
    repondreErreur(res, err, 'Erreur lors de la suppression du rapprochement.');
  }
});

module.exports = router;
