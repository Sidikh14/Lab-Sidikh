import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

function IconRecherche() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function IconCloche() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function Topbar() {
  const { user, merchant, logout } = useAuth();
  const navigate = useNavigate();
  const [recherche, setRecherche] = useState('');
  const [enRupture, setEnRupture] = useState(0);
  const [menuOuvert, setMenuOuvert] = useState(false);

  useEffect(() => {
    api
      .getProducts()
      .then((produits) => setEnRupture(produits.filter((p) => p.status === 'rupture').length))
      .catch(() => {});
  }, []);

  function handleRecherche(e) {
    e.preventDefault();
    if (recherche.trim()) {
      navigate(`/stock?q=${encodeURIComponent(recherche.trim())}`);
    }
  }

  const initiales = (user?.fullName || '?')
    .split(' ')
    .map((mot) => mot[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="barre-haut">
      <span className="barre-haut-commerce">{merchant?.businessName}</span>

      <form className="barre-haut-recherche" onSubmit={handleRecherche}>
        <IconRecherche />
        <input
          type="text"
          placeholder="Rechercher un produit…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
      </form>

      <button
        type="button"
        className="barre-haut-cloche"
        onClick={() => navigate('/')}
        aria-label={`${enRupture} produit(s) en rupture`}
      >
        <IconCloche />
        {enRupture > 0 && <span className="barre-haut-badge">{enRupture}</span>}
      </button>

      <div className="barre-haut-avatar-zone">
        <button type="button" className="avatar avatar--bouton" onClick={() => setMenuOuvert((v) => !v)}>
          {initiales}
        </button>
        {menuOuvert && (
          <div className="barre-haut-menu" onMouseLeave={() => setMenuOuvert(false)}>
            <p className="barre-haut-menu-nom">{user?.fullName}</p>
            <p className="barre-haut-menu-role">{user?.role}</p>
            <button type="button" onClick={logout}>Se déconnecter</button>
          </div>
        )}
      </div>
    </header>
  );
}
