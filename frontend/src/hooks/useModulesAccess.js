import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

// Modules Comptabilité, Paie et Fiscalité : donnés commerçant par commerçant par l'owner.
// Le manager et le comptable les consultent (les pages précises d'un comptable sont choisies par le
// manager dans les permissions) ; pour les autres rôles tout est désactivé sans appel réseau.
export function useModulesAccess() {
  const { user, aRole } = useAuth();
  const [etat, setEtat] = useState({ loaded: false, accounting: false, payroll: false, fiscalite: false });
  const autorise = Boolean(user) && (typeof aRole === 'function' ? aRole('manager', 'comptable') : user.role === 'manager');

  useEffect(() => {
    let annule = false;
    if (!autorise) {
      setEtat({ loaded: true, accounting: false, payroll: false, fiscalite: false });
      return undefined;
    }
    api.getModulesAccess()
      .then((r) => { if (!annule) setEtat({ loaded: true, accounting: r.accounting === true, payroll: r.payroll === true, fiscalite: r.fiscalite === true }); })
      .catch(() => { if (!annule) setEtat((e) => ({ ...e, loaded: true })); });
    return () => { annule = true; };
  }, [user?.id, user?.role, autorise]);

  return etat;
}
