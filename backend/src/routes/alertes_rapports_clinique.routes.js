const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireClinique } = require('../middleware/clinique');
const { creerAlerte } = require('../services/alerts.service');

const router = express.Router();
router.use(authenticate);

const FUSEAU = 'Africa/Dakar';

function jourDuJour() {
  return new Date().toLocaleDateString('en-CA', { timeZone: FUSEAU });
}

// Crée une alerte une seule fois par jour pour un même objet (journal clinic_alert_log).
// Renvoie true si l'alerte a été créée.
async function alerteUneFoisParJour(merchantId, type, referenceId, titre, message, roles) {
  const jour = jourDuJour();
  const inseree = await pool.query(
    `INSERT INTO clinic_alert_log (merchant_id, type, reference_id, jour) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING merchant_id`,
    [merchantId, type, referenceId, jour]
  );
  if (inseree.rows.length === 0) return false;
  await creerAlerte({ merchantId, type, titre, message, referenceId, roles }).catch((err) => console.error(`Erreur alerte ${type} :`, err));
  return true;
}

// POST /clinique/alertes/verifier — parcourt les situations à signaler et crée les alertes manquantes
router.post('/alertes/verifier', requireClinique('alertes', 'ecrire'), async (req, res) => {
  const m = req.user.merchantId;
  const creees = { rdv_proche: 0, resultat_pret: 0, attente_longue: 0, vaccin_du: 0, seuil_stock: 0, lot_peremption: 0 };
  try {
    // Rendez-vous dans les 2 prochaines heures, non encore arrivés
    const rdv = await pool.query(
      `SELECT a.id, a.starts_at, c.full_name FROM appointments a JOIN clients c ON c.id = a.client_id
       WHERE a.merchant_id = $1 AND a.status = 'planifie' AND a.starts_at BETWEEN now() AND now() + INTERVAL '2 hours'`,
      [m]
    );
    for (const r of rdv.rows) {
      const heure = new Date(r.starts_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: FUSEAU });
      if (await alerteUneFoisParJour(m, 'rdv_proche', r.id, 'Rendez-vous proche', `${r.full_name} a rendez-vous à ${heure}.`, ['accueil', 'medecin'])) creees.rdv_proche++;
    }

    // Résultats validés, pas encore publiés : à publier
    const res1 = await pool.query(
      `SELECT res.request_id, r.libelle, c.full_name FROM exam_results res
       JOIN exam_requests r ON r.id = res.request_id JOIN clients c ON c.id = r.client_id
       WHERE res.merchant_id = $1 AND res.statut = 'valide'`,
      [m]
    );
    for (const r of res1.rows) {
      if (await alerteUneFoisParJour(m, 'resultat_pret', r.request_id, 'Résultat prêt à publier', `${r.libelle} — ${r.full_name}.`, ['medecin'])) creees.resultat_pret++;
    }

    // Tickets d'attente de plus de 30 minutes
    const attente = await pool.query(
      `SELECT id, number, guichet FROM queue_tickets
       WHERE merchant_id = $1 AND status = 'en_attente' AND ticket_date = $2::date AND created_at < now() - INTERVAL '30 minutes'`,
      [m, jourDuJour()]
    );
    for (const t of attente.rows) {
      if (await alerteUneFoisParJour(m, 'attente_longue', t.id, "Attente trop longue", `Le ticket n° ${t.number} attend depuis plus de 30 minutes.`, ['accueil', 'medecin'])) creees.attente_longue++;
    }

    // Rappels de vaccins dus dans les 7 prochains jours ou en retard
    const vaccins = await pool.query(
      `SELECT v.id, v.prochain_rappel, c.full_name, cat.nom FROM vaccinations v
       JOIN clients c ON c.id = v.client_id JOIN vaccine_catalog cat ON cat.id = v.vaccine_id
       WHERE v.merchant_id = $1 AND v.prochain_rappel IS NOT NULL AND v.prochain_rappel <= CURRENT_DATE + 7`,
      [m]
    );
    for (const v of vaccins.rows) {
      if (await alerteUneFoisParJour(m, 'vaccin_du', v.id, 'Vaccin à faire', `${v.nom} — ${v.full_name} (échéance ${new Date(v.prochain_rappel).toLocaleDateString('fr-FR')}).`, ['infirmier', 'sage_femme', 'medecin'])) creees.vaccin_du++;
    }

    // Stock bas dans un lieu
    const stock = await pool.query(
      `SELECT ps.product_id, ps.warehouse_id, p.name, w.name AS lieu, ps.quantity_in_stock, p.quantity_alert_threshold
       FROM product_stock ps
       JOIN products p ON p.id = ps.product_id JOIN warehouses w ON w.id = ps.warehouse_id
       WHERE ps.merchant_id = $1 AND p.track_stock = TRUE AND p.quantity_alert_threshold IS NOT NULL
         AND ps.quantity_in_stock <= p.quantity_alert_threshold`,
      [m]
    );
    for (const s of stock.rows) {
      if (await alerteUneFoisParJour(m, 'seuil_stock', s.product_id, 'Stock bas', `${s.name} : ${s.quantity_in_stock} restant(s) à ${s.lieu}.`, ['gerant', 'manager'])) creees.seuil_stock++;
    }

    // Lots qui périment dans les 60 jours
    const lots = await pool.query(
      `SELECT l.id, l.lot_number, l.expiry_date, p.name FROM product_lots l JOIN products p ON p.id = l.product_id
       WHERE l.merchant_id = $1 AND l.quantity > 0 AND l.expiry_date IS NOT NULL
         AND l.expiry_date <= CURRENT_DATE + 60`,
      [m]
    );
    for (const l of lots.rows) {
      if (await alerteUneFoisParJour(m, 'lot_peremption', l.id, 'Lot proche de la péremption', `${l.name}, lot ${l.lot_number || 'sans numéro'} : péremption le ${new Date(l.expiry_date).toLocaleDateString('fr-FR')}.`, ['gerant', 'manager'])) creees.lot_peremption++;
    }

    res.json({ creees });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la vérification des alertes.' });
  }
});

// GET /clinique/rapports/activite?from=AAAA-MM-JJ&to=AAAA-MM-JJ — rapport d'activité (K18)
router.get('/rapports/activite', requireClinique('rapports', 'lire'), async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Les dates from et to sont requises.' });
  const m = req.user.merchantId;
  try {
    const consultations = await pool.query(
      `SELECT COALESCE(u.full_name, 'Non rattaché') AS praticien,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE c.status = 'signee') AS signees
       FROM consultations c JOIN users u ON u.id = c.practitioner_id
       WHERE c.merchant_id = $1 AND c.created_at::date BETWEEN $2::date AND $3::date
       GROUP BY praticien ORDER BY total DESC`,
      [m, from, to]
    );

    const recettes = await pool.query(
      `SELECT COALESCE(payment_method, 'non renseigné') AS mode, COUNT(*) AS ventes, SUM(total_amount) AS total
       FROM orders
       WHERE merchant_id = $1 AND status IN ('validee', 'livree') AND created_at::date BETWEEN $2::date AND $3::date
       GROUP BY mode ORDER BY total DESC`,
      [m, from, to]
    );

    const lits = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE statut <> 'hors_service') AS disponibles,
              COUNT(*) FILTER (WHERE statut = 'occupe') AS occupes
       FROM clinic_beds WHERE merchant_id = $1`,
      [m]
    );
    const disponibles = Number(lits.rows[0].disponibles);
    const occupes = Number(lits.rows[0].occupes);

    const attente = await pool.query(
      `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (called_at - created_at)) / 60)::numeric, 1) AS minutes_moyennes,
              COUNT(*) AS tickets_appeles
       FROM queue_tickets
       WHERE merchant_id = $1 AND called_at IS NOT NULL AND ticket_date BETWEEN $2::date AND $3::date`,
      [m, from, to]
    );

    res.json({
      periode: { from, to },
      consultationsParPraticien: consultations.rows,
      recettesParModePaiement: recettes.rows,
      occupationLits: {
        disponibles,
        occupes,
        taux: disponibles > 0 ? Math.round((occupes / disponibles) * 100) : 0,
      },
      delaiAttente: {
        minutesMoyennes: attente.rows[0].minutes_moyennes !== null ? Number(attente.rows[0].minutes_moyennes) : null,
        ticketsAppeles: Number(attente.rows[0].tickets_appeles),
      },
      note: "Les créances des assureurs se consultent dans l'écran Mutuelles (GET /insurers).",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du rapport.' });
  }
});

module.exports = router;
