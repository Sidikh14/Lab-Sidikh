import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function IconDashboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="12" width="8" height="9" rx="1.5" />
      <rect x="3" y="15" width="8" height="6" rx="1.5" />
    </svg>
  );
}

function IconStock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </svg>
  );
}

function IconVentes() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6" />
    </svg>
  );
}

function IconClients() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16.5 4.3a3.2 3.2 0 0 1 0 6.2" />
      <path d="M18.5 14.3c2.3.6 3.9 2.6 4 5.7" />
    </svg>
  );
}

function IconFournisseurs() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="10" width="13" height="8" rx="1.3" />
      <path d="M16 13h3l2 2.5V18h-5" />
      <circle cx="7.5" cy="19.5" r="1.4" />
      <circle cx="17" cy="19.5" r="1.4" />
    </svg>
  );
}

function IconAchats() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 4h2l1.2 12.4A2 2 0 0 0 9.2 18h8.6a2 2 0 0 0 2-1.7L21 8H7.5" />
      <path d="M12 11v4M10 13h4" />
    </svg>
  );
}

function IconEquipe() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="8.5" cy="8" r="3.2" />
      <path d="M2 19.5c0-3.4 2.9-5.7 6.5-5.7s6.5 2.3 6.5 5.7" />
      <path d="M18 8h4M20 6v4" />
    </svg>
  );
}

const TOUS_LES_LIENS = [
  { to: '/stock', label: 'Stock', icone: IconStock, module: 'stock' },
  { to: '/ventes', label: 'Ventes', icone: IconVentes, module: 'ventes' },
  { to: '/clients', label: 'Clients', icone: IconClients, module: 'clients' },
  { to: '/fournisseurs', label: 'Fournisseurs', icone: IconFournisseurs, module: 'fournisseurs' },
  { to: '/achats', label: 'Commandes fournisseurs', icone: IconAchats, module: 'achats' },
];

// Modules visibles par défaut pour chaque rôle, tant que le manager n'a pas
// personnalisé les permissions d'un membre précis (visibleModules).
const MODULES_PAR_DEFAUT = {
  manager: ['stock', 'ventes', 'clients', 'fournisseurs', 'achats'],
  gerant: ['stock', 'ventes', 'clients', 'fournisseurs', 'achats'],
  vendeur: ['stock', 'ventes', 'clients'],
  caissier: ['ventes'],
};

function modulesAutorises(user) {
  if (user.role === 'manager') return MODULES_PAR_DEFAUT.manager;
  if (Array.isArray(user.visibleModules)) return user.visibleModules;
  return MODULES_PAR_DEFAUT[user.role] || [];
}

export function Sidebar() {
  const { user, merchant, logout } = useAuth();
  const autorises = modulesAutorises(user);
  const liens = TOUS_LES_LIENS.filter((lien) => autorises.includes(lien.module));
  const voitEquipe = ['manager', 'gerant'].includes(user?.role);

  const initiales = (user?.fullName || '?')
    .split(' ')
    .map((mot) => mot[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <nav className="barre-laterale">
      <div className="marque">
        {merchant?.businessName || 'Mon commerce'}
        <span className="sous-titre">Sidikh Stock</span>
      </div>
      <ul className="nav-liste">
        <li>
          <NavLink to="/" end className={({ isActive }) => 'nav-lien' + (isActive ? ' actif' : '')}>
            <IconDashboard />
            Tableau de bord
          </NavLink>
        </li>
        {liens.map((lien) => {
          const Icone = lien.icone;
          return (
            <li key={lien.to}>
              <NavLink
                to={lien.to}
                className={({ isActive }) => 'nav-lien' + (isActive ? ' actif' : '')}
              >
                <Icone />
                {lien.label}
              </NavLink>
            </li>
          );
        })}
        {voitEquipe && (
          <li>
            <NavLink to="/equipe" className={({ isActive }) => 'nav-lien' + (isActive ? ' actif' : '')}>
              <IconEquipe />
              Équipe
            </NavLink>
          </li>
        )}
      </ul>
      {user && (
        <div className="pied-sidebar">
          <span className="avatar">{initiales}</span>
          <div style={{ minWidth: 0 }}>
            <p className="nom">{user.fullName}</p>
            <p className="role">{user.role}</p>
            <button className="lien-deconnexion" onClick={logout}>
              Se déconnecter
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
