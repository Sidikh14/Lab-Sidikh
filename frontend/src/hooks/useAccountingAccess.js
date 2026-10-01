import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

// Indique si le module comptabilité est activé pour le commerçant connecté
// (accès donné par l'owner). Tant que la réponse n'est pas arrivée, `loading`
// vaut true et `enabled` false : le module n'apparaît jamais "par erreur".
export function useAccountingAccess() {
  const { user, merchant } = useAuth();
  const [acces, setAcces] = useState({ enabled: false, loading: true });

  useEffect(() => {
    if (!user || user.role !== 'manager' || !merchant) {
      setAcces({ enabled: false, loading: false });
      return undefined;
    }
    let actif = true;
    api
      .getAccountingAccess()
      .then((d) => actif && setAcces({ enabled: d.enabled === true, loading: false }))
      .catch(() => actif && setAcces({ enabled: false, loading: false }));
    return () => {
      actif = false;
    };
  }, [user?.id, user?.role, merchant?.id]);

  return acces;
}
