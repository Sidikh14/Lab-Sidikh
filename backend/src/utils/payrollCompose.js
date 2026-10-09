// payrollCompose.js — assemble toutes les pièces d'un bulletin pour un employé et un mois :
// prorata d'entrée/départ, absences non payées, heures supplémentaires, avances à retenir,
// puis appelle le moteur existant (calculerBulletin) et applique les retenues.
// Rien n'est écrit en base ici : la route décide d'enregistrer ou seulement d'afficher un aperçu.

const {
  calculerBulletin,
  calculerRetenueAbsence,
  calculerHeuresSup,
  calculerPresence,
  calculerRetenueAvance,
} = require('./payrollCalc');
const {
  RetenueError,
  normaliserRetenues,
  totauxRetenues,
  verifierAbsences,
  appliquerRetenues,
} = require('./payrollDeductions');

function arrondir(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatJour(date) {
  const iso = typeof date === 'string' ? date.slice(0, 10) : new Date(date).toISOString().slice(0, 10);
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

// Les parts IPRES et CSS ne s'appliquent que si elles sont activées sur la fiche du salarié :
// sinon leurs taux sont mis à zéro pour ce bulletin (salarial comme patronal).
function reglagesPourEmploye(reglagesMarchand, employe) {
  const reglages = { ...reglagesMarchand };
  if (employe.ipres_enabled !== true) {
    reglages.ipres_taux_salarial = 0;
    reglages.ipres_taux_patronal = 0;
  }
  if (employe.css_enabled !== true) {
    reglages.css_taux_salarial = 0;
    reglages.css_taux_patronal = 0;
  }
  return reglages;
}

function nettoyerPrimes(bonuses) {
  return Array.isArray(bonuses)
    ? bonuses
        .filter((b) => b && b.label && Number(b.amount))
        .map((b) => ({ label: String(b.label).slice(0, 120), amount: Number(b.amount) }))
    : [];
}

// Primes déjà saisies pour le mois, sinon primes récurrentes de la fiche salaire.
async function primesDuMois(db, employeId, mois, recurrentes) {
  const { rows } = await db.query(
    'SELECT label, amount FROM salary_bonuses WHERE user_id = $1 AND month = $2 ORDER BY created_at',
    [employeId, mois]
  );
  if (rows.length > 0) return nettoyerPrimes(rows);
  return nettoyerPrimes(recurrentes);
}

// Retenues saisies à la main pour le mois (les lignes calculées sont recréées à chaque génération).
async function retenuesManuellesDuMois(db, employeId, mois) {
  const { rows } = await db.query(
    `SELECT type, label, amount FROM salary_deductions WHERE user_id = $1 AND month = $2 AND source = 'manuel' ORDER BY created_at`,
    [employeId, mois]
  );
  return rows;
}

// employe : { id, monthly_salary, parts_fiscales, ipres_enabled, css_enabled, hire_date, end_date }
// reglagesMarchand : ligne payroll_settings. bonuses / deductions : saisies manuelles (tableaux).
async function composerBulletin({ db, employe: employeBrut, mois, reglagesMarchand, bonuses, deductions }) {
  // Salaire de base applicable au mois : dernière ligne d'historique dont la date d'effet est
  // atteinte à la fin du mois (sinon le salaire configuré sur la fiche).
  const employe = { ...employeBrut };
  const historique = await db.query(
    `SELECT monthly_salary FROM employee_salary_history
     WHERE employee_id = $1 AND effective_from <= (to_date($2::text || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date
     ORDER BY effective_from DESC, created_at DESC LIMIT 1`,
    [employe.id, mois]
  );
  if (historique.rows.length > 0) employe.monthly_salary = historique.rows[0].monthly_salary;
  const salaireBase = Number(employe.monthly_salary);
  if (!salaireBase) throw new RetenueError("Configurez d'abord le salaire de base de cet employé.");

  const presence = calculerPresence(mois, employe.hire_date, employe.end_date);
  if (presence.travailles <= 0) {
    throw new RetenueError("Cet employé n'est pas en poste sur ce mois (dates d'embauche ou de fin).");
  }

  const baseJours = Number(reglagesMarchand.working_days_base) > 0 ? Number(reglagesMarchand.working_days_base) : 30;
  const heuresParJour = Number(reglagesMarchand.hours_per_day) > 0 ? Number(reglagesMarchand.hours_per_day) : 8;
  const reglages = reglagesPourEmploye(reglagesMarchand, employe);
  const listeBonus = nettoyerPrimes(bonuses);

  // Retenues : saisies manuelles + lignes calculées (marquées par `source`).
  const manuelles = normaliserRetenues(deductions).map(({ advance_id: _ignore, ...d }) => ({ ...d, source: 'manuel' }));
  const retenues = [...manuelles];

  // 1. Prorata d'entrée ou de départ en cours de mois.
  if (presence.travailles < presence.total) {
    const montant = arrondir(salaireBase * (1 - presence.facteur));
    if (montant > 0) {
      retenues.push({
        type: 'prorata',
        label: `Présence partielle (${presence.travailles}/${presence.total} jours)`,
        amount: montant,
        source: 'auto_prorata',
      });
    }
  }

  // 2. Absences non payées du mois (rattachées au mois de leur date de début).
  const absences = await db.query(
    `SELECT COALESCE(SUM(days), 0) AS jours
     FROM employee_absences
     WHERE employee_id = $1 AND is_paid = false AND to_char(start_date, 'YYYY-MM') = $2`,
    [employe.id, mois]
  );
  const joursAbsence = Number(absences.rows[0].jours);
  if (joursAbsence > 0) {
    retenues.push({
      type: 'absence',
      label: `Absences non payées (${joursAbsence} j)`,
      amount: calculerRetenueAbsence(salaireBase, joursAbsence, baseJours),
      source: 'auto_absence',
    });
  }

  // 3. Heures supplémentaires : ajoutées aux gains avec la majoration de leur catégorie.
  const taux = Array.isArray(reglagesMarchand.overtime_rates) ? reglagesMarchand.overtime_rates : [];
  const heures = await db.query(
    `SELECT category, SUM(hours) AS heures FROM employee_overtime
     WHERE employee_id = $1 AND to_char(work_date, 'YYYY-MM') = $2 GROUP BY category ORDER BY category`,
    [employe.id, mois]
  );
  const primesHeuresSup = [];
  for (const ligne of heures.rows) {
    const categorie = taux.find((t) => t.code === ligne.category);
    if (!categorie || !(Number(categorie.rate) > 0)) {
      throw new RetenueError(`Majoration « ${ligne.category} » inconnue : configurez-la dans les réglages de paie avant de générer le bulletin.`);
    }
    const nbHeures = Number(ligne.heures);
    primesHeuresSup.push({
      label: `Heures supplémentaires — ${categorie.label || categorie.code} (${nbHeures} h)`,
      amount: calculerHeuresSup(salaireBase, nbHeures, categorie.rate, baseJours, heuresParJour),
      kind: 'overtime',
    });
  }
  const overtimeTotal = arrondir(primesHeuresSup.reduce((s, p) => s + p.amount, 0));

  // 4. Calcul : les absences et le prorata réduisent le brut (donc cotisations et impôt).
  const retenuesAvantAvances = retenues.map((d) => ({ ...d }));
  const absencesTotal = verifierAbsences(salaireBase, retenuesAvantAvances);
  const calcule = calculerBulletin({
    baseSalary: salaireBase - absencesTotal,
    bonuses: [...listeBonus, ...primesHeuresSup],
    settings: reglages,
    partsFiscales: employe.parts_fiscales,
  });

  // 5. Avances et prêts : mensualité plafonnée au solde restant et au net disponible.
  const disponibleInitial = Math.max(0, Number(calcule.net_a_payer) - totauxRetenues(retenuesAvantAvances).autres);
  let disponible = disponibleInitial;
  const avances = await db.query(
    `SELECT a.id, a.kind, a.advance_date, a.monthly_amount,
            a.amount - COALESCE((
              SELECT SUM(r.amount) FROM employee_advance_repayments r
              LEFT JOIN payslips p ON p.id = r.payslip_id
              WHERE r.advance_id = a.id AND r.month <> $2 AND (p.id IS NULL OR p.status <> 'remplace')
            ), 0) AS restant
     FROM employee_advances a
     WHERE a.employee_id = $1 AND a.start_month <= $2
     ORDER BY a.advance_date, a.created_at`,
    [employe.id, mois]
  );
  const utilisationsAvances = [];
  for (const a of avances.rows) {
    const retenue = calculerRetenueAvance(a.monthly_amount, a.restant, disponible);
    if (retenue <= 0) continue;
    disponible = arrondir(disponible - retenue);
    const estPret = a.kind === 'pret';
    retenuesAvantAvances.push({
      type: estPret ? 'pret' : 'avance',
      label: `${estPret ? 'Prêt' : 'Avance'} du ${formatJour(a.advance_date)}`,
      amount: retenue,
      advance_id: a.id,
      source: 'auto_avance',
    });
    utilisationsAvances.push({ advance_id: a.id, amount: retenue });
  }

  const resultat = appliquerRetenues(calcule, salaireBase, retenuesAvantAvances);
  resultat.overtime_total = overtimeTotal;
  resultat.advances_total = arrondir(utilisationsAvances.reduce((s, u) => s + u.amount, 0));

  return { resultat, retenues: retenuesAvantAvances, listeBonus, utilisationsAvances, reglages };
}

// Recalcule solde et statut des avances d'un employé à partir des remboursements
// retenus sur les bulletins non remplacés.
async function rafraichirAvances(db, employeId) {
  await db.query(
    `UPDATE employee_advances a SET balance = a.amount - COALESCE((
       SELECT SUM(r.amount) FROM employee_advance_repayments r
       LEFT JOIN payslips p ON p.id = r.payslip_id
       WHERE r.advance_id = a.id AND (p.id IS NULL OR p.status <> 'remplace')), 0)
     WHERE a.employee_id = $1`,
    [employeId]
  );
  await db.query(
    `UPDATE employee_advances SET status = CASE WHEN balance <= 0 THEN 'solde' ELSE 'en_cours' END WHERE employee_id = $1`,
    [employeId]
  );
}

module.exports = {
  composerBulletin,
  rafraichirAvances,
  reglagesPourEmploye,
  nettoyerPrimes,
  primesDuMois,
  retenuesManuellesDuMois,
  RetenueError,
};
