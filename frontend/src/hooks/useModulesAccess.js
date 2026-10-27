import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

// Modules Comptabilité, Paie et Fiscalité : donnés commerçant par commerçant par l'owner.
// Le manager et le comptable les consultent (les pages précises d'un comptable sont choisies par le
// manager dans les permissions) ; pour les autres rôles tout est désactivé sans appel réseau.
//
// Perf : la réponse est gardée en mémoire et partagée entre les pages Paie, Fiscalité et Comptabilité.
// Une page qui s'ouvre juste après une autre s'affiche aussitôt (plus de « Chargement… » à chaque
// changement de page) ; la valeur est revérifiée en arrière-plan quand elle a plus de 20 secondes,
// et deux pages qui demandent en même temps partagent la même requête.
const DUREE_FRAICHE_MS = 20000;
const ETAT_INITIAL = { loaded: false, accounting: false, payroll: false, fiscalite: false };
const cache = { cle: null, valeur: null, at: 0, promesse: null };

function chargerAcces(cle) {
  if (cache.promesse && cache.cle === cle) return cache.promesse;
  if (cache.cle !== cle) { cache.valeur = null; cache.at = 0; }
  cache.cle = cle;
  const promesse = api.getModulesAccess()
    .then((r) => {
      const valeur = { loaded: true, accounting: r.accounting === true, payroll: r.payroll === true, fiscalite: r.fiscalite === true };
      if (cache.cle === cle) { cache.valeur = valeur; cache.at = Date.now(); }
      return valeur;
    })
    .finally(() => { if (cache.promesse === promesse) cache.promesse = null; });
  cache.promesse = promesse;
  return promesse;
}

export function useModulesAccess() {
  const { user, aRole } = useAuth();
  const autorise = Boolean(user) && (typeof aRole === 'function' ? aRole('manager', 'comptable') : user.role === 'manager');
  const cle = user ? `${user.id}:${user.role}` : null;
  const [etat, setEtat] = useState(() => (autorise && cache.cle === cle && cache.valeur ? cache.valeur : ETAT_INITIAL));

  useEffect(() => {
    let annule = false;
    if (!autorise) {
      setEtat({ loaded: true, accounting: false, payroll: false, fiscalite: false });
      return undefined;
    }
    const enCache = cache.cle === cle && cache.valeur ? cache.valeur : null;
    setEtat(enCache || ETAT_INITIAL);
    if (enCache && Date.now() - cache.at < DUREE_FRAICHE_MS) return undefined;
    chargerAcces(cle)
      .then((valeur) => { if (!annule) setEtat(valeur); })
      .catch(() => { if (!annule) setEtat((e) => ({ ...e, loaded: true })); });
    return () => { annule = true; };
  }, [user?.id, user?.role, autorise]);

  return etat;
}
