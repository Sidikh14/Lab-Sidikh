import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

// Indique si le module comptabilité est activé pour le commerçant connecté
// (accès donné par l'owner). Tant que la réponse n'est pas arrivée, `loading`
// vaut true et `enabled` false : le module n'apparaît jamais "par erreur".
// Le manager et le comptable l'interrogent ; les autres rôles restent à `enabled: false`.
export function useAccountingAccess() {
  const { user, merchant, aRole } = useAuth();
  const [acces, setAcces] = useState({ enabled: false, loading: true });
  const autorise = Boolean(user) && (typeof aRole === 'function' ? aRole('manager', 'comptable') : user.role === 'manager');

  useEffect(() => {
    if (!autorise || !merchant) {
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
  }, [user?.id, user?.role, merchant?.id, autorise]);

  return acces;
}
