// payrollCalc.js — calcul du salaire net à partir du brut, selon les
// paramètres fiscaux/sociaux d'un commerçant (table payroll_settings).
//
// ⚠️ Les taux et barèmes par défaut (voir migration 005_payroll.sql) sont un
// point de départ, pas une garantie de conformité — à faire valider par un
// comptable avant tout usage réel. Ce module ne fait qu'appliquer les
// paramètres tels qu'ils sont configurés, il ne les invente pas.

// Applique un barème progressif à tranches sur un montant.
// tranches : [{ jusqua: number|null, taux: number }, ...] triées par
// jusqua croissant, jusqua=null pour la dernière tranche (sans plafond).
function appliquerBaremeProgressif(montant, tranches) {
  let impot = 0;
  let planchePrecedente = 0;
  for (const tranche of tranches) {
    const plafond = tranche.jusqua === null ? Infinity : Number(tranche.jusqua);
    if (montant <= planchePrecedente) break;
    const partDansLaTranche = Math.min(montant, plafond) - planchePrecedente;
    if (partDansLaTranche > 0) {
      impot += partDansLaTranche * Number(tranche.taux);
    }
    planchePrecedente = plafond;
  }
  return impot;
}

// Cherche le montant forfaitaire correspondant au palier (TRIMF).
// paliers : [{ jusqua: number|null, montant: number }, ...] triés croissant.
function chercherPalier(valeur, paliers) {
  for (const palier of paliers) {
    const plafond = palier.jusqua === null ? Infinity : Number(palier.jusqua);
    if (valeur <= plafond) return Number(palier.montant);
  }
  return 0;
}

// baseSalary, bonuses : nombres (FCFA/mois). settings : ligne payroll_settings.
// partsFiscales : quotient familial (1 = célibataire sans enfant à charge ;
// généralement +0.5 par enfant selon la situation déclarée par l'employé).
// Retourne un objet plat prêt à être stocké tel quel dans `payslips` (mêmes
// noms de colonnes) et utilisé pour l'affichage/le PDF.
function calculerBulletin({ baseSalary, bonuses = [], settings, partsFiscales = 1 }) {
  const parts = Number(partsFiscales) > 0 ? Number(partsFiscales) : 1;
  const base = Number(baseSalary) || 0;
  const bonusesTotal = bonuses.reduce((somme, b) => somme + Number(b.amount || 0), 0);
  const brut = base + bonusesTotal;

  const assietteIpres = settings.ipres_plafond_mensuel
    ? Math.min(brut, Number(settings.ipres_plafond_mensuel))
    : brut;
  const ipresSalarial = assietteIpres * Number(settings.ipres_taux_salarial);
  const ipresPatronal = assietteIpres * Number(settings.ipres_taux_patronal);

  const assietteCss = settings.css_plafond_mensuel
    ? Math.min(brut, Number(settings.css_plafond_mensuel))
    : brut;
  const cssSalarial = assietteCss * Number(settings.css_taux_salarial);
  const cssPatronal = assietteCss * Number(settings.css_taux_patronal);

  // Abattement calculé sur une base annuelle (brut x 12), puis ramené au mois
  // — évite les écarts d'arrondi entre un calcul purement mensuel et le
  // barème IRPP qui est lui-même annuel.
  const brutAnnuel = brut * 12;
  const abattementAnnuel = Math.min(
    brutAnnuel * Number(settings.abattement_taux),
    Number(settings.abattement_plafond_annuel)
  );
  const revenuImposableAnnuel = Math.max(0, brutAnnuel - abattementAnnuel);
  const revenuImposable = revenuImposableAnnuel / 12;

  // Quotient familial : on applique le barème à une seule "part" du revenu,
  // puis on multiplie l'impôt obtenu par le nombre de parts — méthode
  // standard (sans plafonnement des effets du quotient familial, non géré ici).
  const irppParPartAnnuel = appliquerBaremeProgressif(revenuImposableAnnuel / parts, settings.bareme_irpp);
  const irppAnnuel = irppParPartAnnuel * parts;
  const irpp = irppAnnuel / 12;

  const trimf = chercherPalier(brut, settings.trimf_bareme);

  const netAPayer = brut - ipresSalarial - cssSalarial - irpp - trimf;

  const cfce = brut * Number(settings.cfce_taux);
  const coutTotalEmployeur = brut + ipresPatronal + cssPatronal + cfce;

  return {
    base_salary: round2(base),
    bonuses_detail: bonuses.map((b) => ({ label: b.label, amount: round2(Number(b.amount) || 0) })),
    bonuses_total: round2(bonusesTotal),
    gross_salary: round2(brut),
    parts_fiscales: parts,
    ipres_salarial: round2(ipresSalarial),
    css_salarial: round2(cssSalarial),
    revenu_imposable: round2(revenuImposable),
    irpp: round2(irpp),
    trimf: round2(trimf),
    net_a_payer: round2(netAPayer),
    ipres_patronal: round2(ipresPatronal),
    css_patronal: round2(cssPatronal),
    cfce: round2(cfce),
    cout_total_employeur: round2(coutTotalEmployeur),
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = { calculerBulletin, appliquerBaremeProgressif, chercherPalier };
