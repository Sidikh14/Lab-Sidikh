import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LIENS = [
  { to: '/', label: 'Tableau de bord', fin: true },
  { to: '/stock', label: 'Stock' },
  { to: '/commandes', label: 'Commandes' },
  { to: '/clients', label: 'Clients' },
];

export function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <nav className="barre-laterale">
      <div className="marque">Carnet</div>
      <ul className="nav-liste">
        {LIENS.map((lien) => (
          <li key={lien.to}>
            <NavLink
              to={lien.to}
              end={lien.fin}
              className={({ isActive }) => 'nav-lien' + (isActive ? ' actif' : '')}
            >
              {lien.label}
            </NavLink>
          </li>
        ))}
      </ul>
      {user && (
        <div className="pied-sidebar">
          <p className="nom">{user.fullName}</p>
          <p className="role">{user.role}</p>
          <button className="lien-deconnexion" onClick={logout}>
            Se déconnecter
          </button>
        </div>
      )}
    </nav>
  );
}
