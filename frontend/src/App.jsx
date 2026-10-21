import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { StockPage } from './pages/StockPage';
import { OrdersPage } from './pages/OrdersPage';
import { ClientsPage } from './pages/ClientsPage';
import { TeamPage } from './pages/TeamPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { CaissePage } from './pages/CaissePage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { ComptabilitePage } from './pages/ComptabilitePage';
import { FiscalitePage } from './pages/FiscalitePage';
import { PaiePage } from './pages/PaiePage';
import { MesBulletinsPage } from './pages/MesBulletinsPage';
import { CartePage } from './pages/CartePage';
import { MenuPublicPage } from './pages/MenuPublicPage';
import { AccueilCliniquePage } from './pages/clinique/AccueilCliniquePage';
import { DossierCliniquePage } from './pages/clinique/DossierCliniquePage';
import { CaisseCliniquePage } from './pages/clinique/CaisseCliniquePage';
import { LaboratoireCliniquePage } from './pages/clinique/LaboratoireCliniquePage';
import { HospitalisationCliniquePage } from './pages/clinique/HospitalisationCliniquePage';
import { PharmacieCliniquePage } from './pages/clinique/PharmacieCliniquePage';
import { PlanningCliniquePage } from './pages/clinique/PlanningCliniquePage';
import { RapportsCliniquePage } from './pages/clinique/RapportsCliniquePage';
import { AgendaMedecinPage } from './pages/clinique/AgendaMedecinPage';
import { api } from './api/client';
import OfflineBanner from './offline/OfflineBanner';
import CreditRequestNotifications from './components/CreditRequestNotifications';

// Un compte owner (propriétaire de la plateforme) n'est rattaché à aucun
// commerçant : il ne doit jamais atterrir sur les pages d'un commerce
// (dashboard, stock, ventes…), qui supposent toutes un `merchant` défini.
function RedirectSiOwner({ children }) {
  const { user } = useAuth();
  if (user?.role === 'owner') return <Navigate to="/admin" replace />;
  return children;
}

// À l'inverse, la page d'administration est réservée au owner — même un
// manager authentifié ne doit pas pouvoir y accéder.
function RequireOwner({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'owner') return <Navigate to="/" replace />;
  return children;
}

// Un comptable (sans autre rôle) n'a pas accès aux pages de gestion : retour au tableau de bord.
function SaufComptableSeul({ children }) {
  const { aRole } = useAuth();
  if (aRole('comptable') && !aRole('manager', 'gerant', 'vendeur', 'caissier')) return <Navigate to="/" replace />;
  return children;
}

function RouteGestion({ children }) {
  return (
    <RouteCommercant>
      <SaufComptableSeul>{children}</SaufComptableSeul>
    </RouteCommercant>
  );
}

function RouteCommercant({ children }) {
  return (
    <ProtectedRoute>
      <RedirectSiOwner>{children}</RedirectSiOwner>
    </ProtectedRoute>
  );
}

// Carte du restaurant : réservée au manager et au gérant d'un commerce du secteur restauration.
function RouteCarte({ children }) {
  const { merchant, aRole } = useAuth();
  if (merchant?.sector !== 'restauration' || !aRole('manager', 'gerant')) return <Navigate to="/" replace />;
  return <RouteCommercant>{children}</RouteCommercant>;
}

// Écrans de la clinique : réservés au secteur clinique et aux rôles d'accueil, de gestion.
function RouteClinique({ children, roles = ['accueil', 'manager', 'gerant'] }) {
  const { merchant, aRole } = useAuth();
  if (merchant?.sector !== 'clinique' || !aRole(...roles)) return <Navigate to="/" replace />;
  return <RouteCommercant>{children}</RouteCommercant>;
}

export default function App() {
  return (
    <AuthProvider>
      <CreditRequestNotifications />
      <BrowserRouter>
        <OfflineBanner api={api} />
        <Routes>
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/inscription" element={<RegisterPage />} />
          {/* Page publique du QR d'une table : le client n'a pas de compte. */}
          <Route path="/menu/:token" element={<MenuPublicPage />} />
          <Route path="/" element={<RouteCommercant><DashboardPage /></RouteCommercant>} />
          <Route path="/stock" element={<RouteGestion><StockPage /></RouteGestion>} />
          <Route path="/carte" element={<RouteCarte><CartePage /></RouteCarte>} />
          <Route path="/ventes" element={<RouteGestion><OrdersPage /></RouteGestion>} />
          <Route path="/clients" element={<RouteGestion><ClientsPage /></RouteGestion>} />
          <Route path="/fournisseurs" element={<RouteGestion><SuppliersPage /></RouteGestion>} />
          <Route path="/achats" element={<Navigate to="/fournisseurs?tab=achats" replace />} />
          <Route path="/caisse" element={<RouteGestion><CaissePage /></RouteGestion>} />
          <Route path="/entreprise" element={<RouteGestion><SettingsPage /></RouteGestion>} />
          <Route path="/salaires" element={<Navigate to="/paie" replace />} />
          <Route path="/paie" element={<RouteCommercant><PaiePage /></RouteCommercant>} />
          <Route path="/mes-bulletins" element={<RouteCommercant><MesBulletinsPage /></RouteCommercant>} />
          <Route path="/boutiques" element={<RouteGestion><WarehousesPage /></RouteGestion>} />
          <Route path="/transferts" element={<Navigate to="/boutiques?tab=transferts" replace />} />
          <Route path="/equipe" element={<RouteCommercant><TeamPage /></RouteCommercant>} />
          <Route path="/comptabilite" element={<RouteCommercant><ComptabilitePage /></RouteCommercant>} />
          <Route path="/fiscalite" element={<RouteCommercant><FiscalitePage /></RouteCommercant>} />
          <Route path="/clinique/accueil" element={<RouteClinique><AccueilCliniquePage /></RouteClinique>} />
          <Route path="/clinique/mon-agenda" element={<RouteClinique roles={['medecin']}><AgendaMedecinPage /></RouteClinique>} />
          <Route path="/clinique/rapports" element={<RouteClinique roles={['gerant', 'manager', 'comptable']}><RapportsCliniquePage /></RouteClinique>} />
          <Route path="/clinique/planning" element={<RouteClinique roles={['medecin', 'infirmier', 'sage_femme', 'accueil', 'gerant', 'manager', 'comptable']}><PlanningCliniquePage /></RouteClinique>} />
          <Route path="/clinique/pharmacie" element={<RouteClinique roles={['medecin', 'infirmier', 'sage_femme', 'gerant', 'manager']}><PharmacieCliniquePage /></RouteClinique>} />
          <Route path="/clinique/hospitalisation" element={<RouteClinique roles={['accueil', 'medecin', 'infirmier', 'sage_femme', 'gerant', 'manager']}><HospitalisationCliniquePage /></RouteClinique>} />
          <Route path="/clinique/laboratoire" element={<RouteClinique roles={['laborantin', 'medecin']}><LaboratoireCliniquePage /></RouteClinique>} />
          <Route path="/clinique/caisse" element={<RouteClinique roles={['caissier', 'accueil', 'gerant', 'manager']}><CaisseCliniquePage /></RouteClinique>} />
          <Route path="/clinique/dossiers" element={<RouteClinique roles={['medecin', 'infirmier', 'sage_femme']}><DossierCliniquePage /></RouteClinique>} />
          <Route path="/clinique/dossiers/:patientId" element={<RouteClinique roles={['medecin', 'infirmier', 'sage_femme']}><DossierCliniquePage /></RouteClinique>} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <RequireOwner>
                  <AdminPage />
                </RequireOwner>
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
