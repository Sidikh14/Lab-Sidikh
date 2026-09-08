import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function ProtectedRoute({ children }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/connexion" replace />;
  }

  return (
    <div className="mise-en-page">
      <Sidebar />
      <div className="zone-principale">
        <Topbar />
        <main className="contenu">{children}</main>
      </div>
    </div>
  );
}
