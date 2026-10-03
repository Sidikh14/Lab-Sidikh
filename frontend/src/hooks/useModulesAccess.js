import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

// Modules Comptabilité, Paie et Fiscalité : donnés commerçant par commerçant par l'owner.
// Seul le manager y a accès ; pour les autres rôles tout est désactivé sans appel réseau.
export function useModulesAccess() {
  const { user } = useAuth();
  const [etat, setEtat] = useState({ loaded: false, accounting: false, payroll: false, fiscalite: false });

  useEffect(() => {
    let annule = false;
    if (!user || user.role !== 'manager') {
      setEtat({ loaded: true, accounting: false, payroll: false, fiscalite: false });
      return undefined;
    }
    api.getModulesAccess()
      .then((r) => { if (!annule) setEtat({ loaded: true, accounting: r.accounting === true, payroll: r.payroll === true, fiscalite: r.fiscalite === true }); })
      .catch(() => { if (!annule) setEtat((e) => ({ ...e, loaded: true })); });
    return () => { annule = true; };
  }, [user?.id, user?.role]);

  return etat;
}
