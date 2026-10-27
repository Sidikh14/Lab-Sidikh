import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

// Indique si le module comptabilité est activé pour le commerçant connecté
// (accès donné par l'owner). Tant que la réponse n'est pas arrivée, `loading`
// vaut true et `enabled` false : le module n'apparaît jamais "par erreur".
// Le manager et le comptable l'interrogent ; les autres rôles restent à `enabled: false`.
//
// Perf : la réponse est gardée en mémoire (revérifiée en arrière-plan après 20 secondes) et les
// requêtes simultanées sont partagées : la page Comptabilité ne repart plus de « Chargement… ».
const DUREE_FRAICHE_MS = 20000;
const cache = { cle: null, enabled: null, at: 0, promesse: null };

function chargerAcces(cle) {
  if (cache.promesse && cache.cle === cle) return cache.promesse;
  if (cache.cle !== cle) { cache.enabled = null; cache.at = 0; }
  cache.cle = cle;
  const promesse = api.getAccountingAccess()
    .then((d) => {
      const enabled = d.enabled === true;
      if (cache.cle === cle) { cache.enabled = enabled; cache.at = Date.now(); }
      return enabled;
    })
    .finally(() => { if (cache.promesse === promesse) cache.promesse = null; });
  cache.promesse = promesse;
  return promesse;
}

export function useAccountingAccess() {
  const { user, merchant, aRole } = useAuth();
  const autorise = Boolean(user) && (typeof aRole === 'function' ? aRole('manager', 'comptable') : user.role === 'manager');
  const cle = user && merchant ? `${user.id}:${user.role}:${merchant.id}` : null;
  const [acces, setAcces] = useState(() => (autorise && cle && cache.cle === cle && cache.enabled !== null
    ? { enabled: cache.enabled, loading: false }
    : { enabled: false, loading: true }));

  useEffect(() => {
    if (!autorise || !merchant) {
      setAcces({ enabled: false, loading: false });
      return undefined;
    }
    let actif = true;
    const enCache = cache.cle === cle && cache.enabled !== null ? cache.enabled : null;
    setAcces(enCache !== null ? { enabled: enCache, loading: false } : { enabled: false, loading: true });
    if (enCache !== null && Date.now() - cache.at < DUREE_FRAICHE_MS) return undefined;
    chargerAcces(cle)
      .then((enabled) => actif && setAcces({ enabled, loading: false }))
      .catch(() => actif && setAcces((a) => (a.loading ? { enabled: false, loading: false } : a)));
    return () => {
      actif = false;
    };
  }, [user?.id, user?.role, merchant?.id, autorise]);

  return acces;
}
