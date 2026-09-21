import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';
import { appliquerThemeSecteur } from '../config/sectorConfig';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [merchant, setMerchant] = useState(() => {
    const stored = localStorage.getItem('merchant');
    return stored ? JSON.parse(stored) : null;
  });
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState(null);

  function persist(data) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    if (data.merchant) {
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      setMerchant(data.merchant);
    }
  }

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    persist(data);
    return data.user;
  }, []);

  const register = useCallback(async (payload, adminKey) => {
    const data = await api.register(payload, adminKey);
    persist(data);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('merchant');
    setUser(null);
    setMerchant(null);
  }, []);

  // Bascule les couleurs de l'app (--accent/--accent-clair) selon le
  // secteur du commerçant connecté : au chargement (état initial lu depuis
  // localStorage), à chaque connexion, et à la déconnexion (repasse au
  // thème par défaut puisque merchant redevient null).
  useEffect(() => {
    appliquerThemeSecteur(merchant?.sector);
  }, [merchant?.sector]);

  // client.js déclenche cet événement quand le backend répond 401
  // (token absent/invalide/expiré après 8h) : on déconnecte proprement
  // et on garde un message à afficher sur l'écran de connexion, plutôt
  // que de laisser l'utilisateur face à une erreur brute.
  useEffect(() => {
    function gererSessionExpiree() {
      logout();
      setSessionExpiredMessage('Votre session a expiré. Veuillez vous reconnecter.');
    }
    window.addEventListener('session-expired', gererSessionExpiree);
    return () => window.removeEventListener('session-expired', gererSessionExpiree);
  }, [logout]);

  const clearSessionExpiredMessage = useCallback(() => setSessionExpiredMessage(null), []);

  return (
    <AuthContext.Provider value={{ user, merchant, login, register, logout, sessionExpiredMessage, clearSessionExpiredMessage }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
