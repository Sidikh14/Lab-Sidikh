import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function ProtectedRoute({ children }) {
  const { user } = useAuth();
  const [menuMobileOuvert, setMenuMobileOuvert] = useState(false);

  if (!user) {
    return <Navigate to="/connexion" replace />;
  }

  return (
    <div className="mise-en-page">
      <Sidebar ouvert={menuMobileOuvert} onFermer={() => setMenuMobileOuvert(false)} />
      {menuMobileOuvert && (
        <div className="fond-menu-mobile" onClick={() => setMenuMobileOuvert(false)} />
      )}
      <div className="zone-principale">
        <Topbar onOuvrirMenu={() => setMenuMobileOuvert(true)} />
        <main className="contenu">{children}</main>
      </div>
    </div>
  );
}
