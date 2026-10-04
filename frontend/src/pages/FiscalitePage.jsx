import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useModulesAccess } from '../hooks/useModulesAccess';
import { ImpotsTab } from './ComptabilitePage';
import { PageModuleNonActive } from '../components/ModuleNonActive';

// Module Fiscalité : impôts (TVA, IR/TRIMF, CFCE) chaque mois et cotisations (CSS, IPRES)
// selon la périodicité choisie. Les montants viennent de la comptabilité et de la paie.
// Visible seulement si l'owner a activé la fiscalité (et la comptabilité sur laquelle elle s'appuie).
export function FiscalitePage() {
  const { user } = useAuth();
  const { loaded, accounting, fiscalite } = useModulesAccess();

  if (user?.role !== 'manager') return <Navigate to="/" replace />;
  if (!loaded) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;
  if (!accounting || !fiscalite) return <PageModuleNonActive nom="Fiscalité" />;

  return (
    <div>
      <div className="entete-page">
        <div>
          <h1>Fiscalité</h1>
          <p style={{ color: 'var(--encre-douce)', fontSize: 13, margin: '4px 0 0' }}>
            Impôts et cotisations · calculés automatiquement depuis la comptabilité et la paie · montants en FCFA
          </p>
        </div>
      </div>
      <ImpotsTab />
    </div>
  );
}

export default FiscalitePage;
