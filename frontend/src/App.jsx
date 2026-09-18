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
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { CaissePage } from './pages/CaissePage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';
import { SalariesPage } from './pages/SalariesPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { TransfersPage } from './pages/TransfersPage';
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

function RouteCommercant({ children }) {
  return (
    <ProtectedRoute>
      <RedirectSiOwner>{children}</RedirectSiOwner>
    </ProtectedRoute>
  );
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
          <Route path="/" element={<RouteCommercant><DashboardPage /></RouteCommercant>} />
          <Route path="/stock" element={<RouteCommercant><StockPage /></RouteCommercant>} />
          <Route path="/ventes" element={<RouteCommercant><OrdersPage /></RouteCommercant>} />
          <Route path="/clients" element={<RouteCommercant><ClientsPage /></RouteCommercant>} />
          <Route path="/fournisseurs" element={<RouteCommercant><SuppliersPage /></RouteCommercant>} />
          <Route path="/achats" element={<RouteCommercant><PurchaseOrdersPage /></RouteCommercant>} />
          <Route path="/caisse" element={<RouteCommercant><CaissePage /></RouteCommercant>} />
          <Route path="/entreprise" element={<RouteCommercant><SettingsPage /></RouteCommercant>} />
          <Route path="/salaires" element={<RouteCommercant><SalariesPage /></RouteCommercant>} />
          <Route path="/boutiques" element={<RouteCommercant><WarehousesPage /></RouteCommercant>} />
          <Route path="/transferts" element={<RouteCommercant><TransfersPage /></RouteCommercant>} />
          <Route path="/equipe" element={<RouteCommercant><TeamPage /></RouteCommercant>} />
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
