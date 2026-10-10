import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';
import { appliquerThemeSecteur } from '../config/sectorConfig';
import { appliquerBranding, retirerBranding } from '../config/brandingTheme';

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
  // Charte graphique personnalisée du commerçant (réglée par l'owner) : { enabled, palette, logo } ou null.
  // La palette vient de la connexion ; le logo (volumineux) est chargé séparément, au démarrage.
  const [branding, setBranding] = useState(() => (merchant?.branding?.enabled ? { ...merchant.branding, logo: null } : null));
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState(null);

  function persist(data) {
    // boutiqueActiveId (mémorisée par StockPage/WarehousesPage/etc.) n'est
    // pas scopée par commerçant. Si on se connecte sur un commerçant
    // différent de celui déjà en mémoire, cet ID appartient forcément à
    // l'ancien commerçant (ex. grossiste) et n'existe pas chez le nouveau
    // (ex. électroménager) → backend répond "boutique introuvable". On
    // l'efface dans ce cas pour forcer une resélection propre.
    const merchantPrecedentId = merchant?.id
      ?? JSON.parse(localStorage.getItem('merchant') || 'null')?.id
      ?? null;
    if (data.merchant && merchantPrecedentId && merchantPrecedentId !== data.merchant.id) {
      localStorage.removeItem('boutiqueActiveId');
    }
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    if (data.merchant) {
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      setMerchant(data.merchant);
      setBranding(data.merchant.branding?.enabled ? { ...data.merchant.branding, logo: null } : null);
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
    localStorage.removeItem('boutiqueActiveId');
    setUser(null);
    setMerchant(null);
    setBranding(null);
  }, []);

  // Bascule les couleurs de l'app (--accent/--accent-clair) selon le
  // secteur du commerçant connecté : au chargement (état initial lu depuis
  // localStorage), à chaque connexion, et à la déconnexion (repasse au
  // thème par défaut puisque merchant redevient null).
  useEffect(() => {
    appliquerThemeSecteur(merchant?.sector);
    // Mémorisé aussi pour la page statique /maintenance.html, qui s'habille
    // aux couleurs du secteur. Volontairement conservé après déconnexion.
    if (merchant?.sector) {
      try { localStorage.setItem('secteurActif', merchant.sector); } catch { /* ignoré */ }
    }
  }, [merchant?.sector]);

  // Charte personnalisée : couleurs appliquées sur la page tant que la personne est connectée, puis retirées
  // (l'écran de connexion garde donc toujours les couleurs d'Amaterasu).
  useEffect(() => {
    if (branding?.enabled && branding.palette) appliquerBranding(branding.palette);
    else retirerBranding();
  }, [branding]);

  // Au démarrage de l'application : relit la charte (couleurs + logo), pour qu'un changement fait par l'owner
  // arrive sans reconnexion.
  useEffect(() => {
    if (!user || !merchant) return undefined;
    let annule = false;
    api.getBranding()
      .then((b) => { if (!annule) setBranding(b && b.enabled ? b : null); })
      .catch(() => { /* la charte Amaterasu par défaut reste en place */ });
    return () => { annule = true; };
  }, [user?.id, merchant?.id]);

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

  // Vrai si la personne a au moins un des rôles demandés (elle peut en cumuler plusieurs).
  const aRole = useCallback((...roles) => {
    const possedes = new Set([...(user?.roles || []), user?.role].filter(Boolean));
    return roles.some((r) => possedes.has(r));
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, merchant, branding, login, register, logout, aRole, sessionExpiredMessage, clearSessionExpiredMessage }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
