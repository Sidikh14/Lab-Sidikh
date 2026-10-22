// payrollSimulate.js — « Simulation de bulletin » (net souhaité → sursalaire).
//
// Ne s'appuie que sur calculerBulletin (payrollCalc.js), déjà utilisé pour les vrais bulletins :
// aucune règle fiscale n'est réinventée ici, seulement une recherche numérique (bissection) du
// montant de sursalaire à ajouter aux primes existantes pour atteindre le net voulu.
// Le sursalaire est traité comme une prime imposable de plus (comme toutes les primes actuelles
// du moteur de paie — il n'y a pas aujourd'hui de notion de prime « non imposable » dans
// calculerBulletin ; à ajouter séparément si besoin).

const { calculerBulletin } = require('./payrollCalc');

function netPour(sursalaire, { baseSalary, bonusesExistantes, settings, partsFiscales }) {
  const bonuses = [...bonusesExistantes, { label: 'Sursalaire', amount: sursalaire }];
  return calculerBulletin({ baseSalary, bonuses, settings, partsFiscales }).net_a_payer;
}

// Recherche par bissection : le net est croissant avec le sursalaire (plus de brut => plus de net),
// donc une seule racine existe. Précision : 1 FCFA, 60 itérations max (largement suffisant).
function simulerSursalairePourNet({ baseSalary, bonusesExistantes = [], settings, partsFiscales = 1, netSouhaite }) {
  const base = Number(baseSalary) || 0;
  const cible = Number(netSouhaite) || 0;

  let basClamp = -base; // le sursalaire ne peut pas rendre le brut négatif
  let haut = Math.max(cible * 2, base, 1000000);
  // Élargit la borne haute tant qu'elle ne suffit pas (cas d'un net très élevé demandé).
  for (let i = 0; i < 20 && netPour(haut, { baseSalary: base, bonusesExistantes, settings, partsFiscales }) < cible; i += 1) {
    haut *= 2;
  }

  let sursalaire = 0;
  for (let i = 0; i < 60; i += 1) {
    sursalaire = (basClamp + haut) / 2;
    const net = netPour(sursalaire, { baseSalary: base, bonusesExistantes, settings, partsFiscales });
    if (net < cible) basClamp = sursalaire; else haut = sursalaire;
  }
  sursalaire = Math.max(0, Math.round(sursalaire));

  const bonuses = [...bonusesExistantes, { label: 'Sursalaire', amount: sursalaire }];
  const resultat = calculerBulletin({ baseSalary: base, bonuses, settings, partsFiscales });
  return { sursalaire, resultat };
}

module.exports = { simulerSursalairePourNet };
