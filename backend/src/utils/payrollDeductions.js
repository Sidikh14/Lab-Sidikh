// Retenues manuelles sur bulletin de paie.
//
// Deux familles, traitées différemment (comme sur un vrai bulletin) :
//  - ABSENCE non rémunérée : réduit le salaire BRUT, donc aussi l'assiette des
//    cotisations (IPRES/CSS) et de l'impôt (IRPP/TRIMF).
//  - AVANCE, PRÊT, AUTRE : déduites du NET, après cotisations et impôt
//    (récupération d'une somme déjà versée : elle n'est pas un revenu).

const TYPES_RETENUE = ['avance', 'absence', 'pret', 'autre'];

const LABEL_TYPE_RETENUE = {
  avance: 'Avance sur salaire',
  absence: 'Absence non rémunérée',
  pret: 'Remboursement de prêt',
  autre: 'Autre retenue',
};

class RetenueError extends Error {}

function arrondir(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Nettoie ce qui vient du client : type connu, libellé par défaut, montant > 0.
function normaliserRetenues(entree) {
  if (!Array.isArray(entree)) return [];
  return entree
    .map((d) => {
      const type = TYPES_RETENUE.includes(d && d.type) ? d.type : 'autre';
      const label = String((d && d.label) || '').trim() || LABEL_TYPE_RETENUE[type];
      return { type, label: label.slice(0, 120), amount: arrondir(d && d.amount) };
    })
    .filter((d) => d.amount > 0);
}

function totauxRetenues(retenues) {
  const somme = (liste) => arrondir(liste.reduce((total, d) => total + d.amount, 0));
  return {
    absences: somme(retenues.filter((d) => d.type === 'absence')),
    autres: somme(retenues.filter((d) => d.type !== 'absence')),
  };
}

// À appeler AVANT le calcul : les absences ne peuvent pas dépasser le salaire de base.
function verifierAbsences(baseSalary, retenues) {
  const { absences } = totauxRetenues(retenues);
  if (absences > arrondir(baseSalary)) {
    throw new RetenueError('Les absences dépassent le salaire de base.');
  }
  return absences;
}

// À appeler APRÈS calculerBulletin() : intègre les retenues au résultat.
// `resultat` doit avoir été calculé avec un salaire de base déjà diminué des absences.
function appliquerRetenues(resultat, baseSalary, retenues) {
  const { absences, autres } = totauxRetenues(retenues);
  const netApresImpots = Number(resultat.net_a_payer);
  if (autres > netApresImpots) {
    throw new RetenueError(
      `Les retenues (${Math.round(autres)} FCFA) dépassent le net à payer (${Math.round(netApresImpots)} FCFA).`
    );
  }
  return {
    ...resultat,
    base_salary: arrondir(baseSalary), // salaire de base contractuel, avant absences
    deductions_detail: retenues,
    absences_total: absences,
    deductions_total: autres,
    net_a_payer: arrondir(netApresImpots - autres),
  };
}

module.exports = {
  TYPES_RETENUE,
  LABEL_TYPE_RETENUE,
  RetenueError,
  normaliserRetenues,
  totauxRetenues,
  verifierAbsences,
  appliquerRetenues,
};
