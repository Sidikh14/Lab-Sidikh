import { createContext, useContext, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { api } from '../api/client';
import { appliquerThemeSecteur } from '../config/sectorConfig';
import { appliquerBranding, retirerBranding, lireCacheBranding, ecrireCacheBranding, effacerCacheBranding } from '../config/brandingTheme';
import { ChangementMotDePasseObligatoire } from '../components/ChangementMotDePasseObligatoire';

const AuthContext = createContext(null);

// Déconnexion automatique après 3 h sans activité (clic, frappe, défilement, toucher).
// L'horodatage est partagé via localStorage : l'activité dans un onglet compte pour tous.
const DELAI_INACTIVITE_MS = 3 * 60 * 60 * 1000;
const CLE_ACTIVITE = 'derniereActivite';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [merchant, setMerchant] = useState(() => {
    const stored = localStorage.getItem('merchant');
    return stored ? JSON.parse(stored) : null;
  });
  // Charte du commerçant : { enabled, palette, logo } ou null. `enabled`/`palette` = couleurs personnalisées (réglées par
  // l'owner) ; `logo` = logo de l'entreprise, affiché dans la barre latérale dès qu'il existe. La palette vient de la
  // connexion ; le logo (volumineux) est chargé séparément, au démarrage.
  // Au rechargement, la charte vient d'abord de la mémoire locale (affichage immédiat), puis elle est relue sur le serveur.
  const [branding, setBranding] = useState(() => lireCacheBranding(merchant?.id) || (merchant?.branding?.enabled ? { ...merchant.branding, logo: null } : null));
  // Faux tant que la charte du commerçant n'est pas connue : la barre latérale n'affiche alors aucun logo au lieu de
  // montrer un instant celui d'Amaterasu.
  const [brandingCharge, setBrandingCharge] = useState(() => !merchant || Boolean(lireCacheBranding(merchant.id)));
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
    localStorage.setItem(CLE_ACTIVITE, String(Date.now()));
    setUser(data.user);
    if (data.merchant) {
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      setMerchant(data.merchant);
      // La connexion renvoie déjà couleurs et logo : rien à attendre après.
      const charte = data.merchant.branding || null;
      setBranding(charte);
      ecrireCacheBranding(data.merchant.id, charte);
      setBrandingCharge(true);
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
    localStorage.removeItem(CLE_ACTIVITE);
    setUser(null);
    setMerchant(null);
    setBranding(null);
    setBrandingCharge(true);
    effacerCacheBranding();
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
  // useLayoutEffect : appliqué avant l'affichage, donc sans éclair aux couleurs d'Amaterasu.
  useLayoutEffect(() => {
    if (user && branding?.enabled && branding.palette) appliquerBranding(branding.palette);
    else retirerBranding();
  }, [branding, user]);

  // Au démarrage de l'application : relit la charte (couleurs + logo), pour qu'un changement fait par l'owner
  // arrive sans reconnexion.
  useEffect(() => {
    if (!user || !merchant) return undefined;
    let annule = false;
    api.getBranding()
      .then((b) => {
        if (annule) return;
        setBranding(b || null);
        ecrireCacheBranding(merchant.id, b || null);
        setBrandingCharge(true);
      })
      .catch(() => { if (!annule) setBrandingCharge(true); /* la charte Amaterasu par défaut reste en place */ });
    return () => { annule = true; };
  }, [user?.id, merchant?.id]);

  // Mot de passe provisoire : client.js déclenche cet événement quand le backend refuse l'accès tant que le
  // mot de passe n'est pas changé. Le drapeau est mémorisé avec l'utilisateur (survit au rechargement).
  useEffect(() => {
    function gererChangementRequis() {
      setUser((courant) => {
        if (!courant) return courant;
        const mis = { ...courant, mustChangePassword: true };
        localStorage.setItem('user', JSON.stringify(mis));
        return mis;
      });
    }
    window.addEventListener('password-change-required', gererChangementRequis);
    return () => window.removeEventListener('password-change-required', gererChangementRequis);
  }, []);

  const terminerChangementMotDePasse = useCallback(() => {
    setUser((courant) => {
      if (!courant) return courant;
      const mis = { ...courant, mustChangePassword: false };
      localStorage.setItem('user', JSON.stringify(mis));
      return mis;
    });
  }, []);

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

  // Inactivité : déconnecte après 3 h sans action de la personne (les requêtes automatiques en arrière-plan
  // ne comptent pas). Contrôlé à l'ouverture, toutes les 30 s et au retour sur l'onglet (veille du PC).
  useEffect(() => {
    if (!user) return undefined;
    const lire = () => Number(localStorage.getItem(CLE_ACTIVITE)) || 0;
    let dernierEcrit = 0;

    function verifier() {
      const derniere = lire();
      if (derniere && Date.now() - derniere > DELAI_INACTIVITE_MS) {
        logout();
        setSessionExpiredMessage("Vous avez été déconnecté après 3 heures d'inactivité. Veuillez vous reconnecter.");
        return true;
      }
      return false;
    }

    if (verifier()) return undefined;
    if (!lire()) { try { localStorage.setItem(CLE_ACTIVITE, String(Date.now())); } catch { /* ignoré */ } }

    function marquerActivite() {
      const maintenant = Date.now();
      if (maintenant - dernierEcrit < 15000) return; // limite les écritures
      dernierEcrit = maintenant;
      try { localStorage.setItem(CLE_ACTIVITE, String(maintenant)); } catch { /* ignoré */ }
    }
    function auRetour() { if (document.visibilityState === 'visible') verifier(); }

    const evenements = ['mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'];
    evenements.forEach((e) => window.addEventListener(e, marquerActivite, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', auRetour);
    const minuteur = setInterval(verifier, 30000);
    return () => {
      evenements.forEach((e) => window.removeEventListener(e, marquerActivite, { capture: true }));
      document.removeEventListener('visibilitychange', auRetour);
      clearInterval(minuteur);
    };
  }, [user?.id, logout]);

  const clearSessionExpiredMessage = useCallback(() => setSessionExpiredMessage(null), []);

  // Vrai si la personne a au moins un des rôles demandés (elle peut en cumuler plusieurs).
  const aRole = useCallback((...roles) => {
    const possedes = new Set([...(user?.roles || []), user?.role].filter(Boolean));
    return roles.some((r) => possedes.has(r));
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, merchant, branding, brandingCharge, login, register, logout, aRole, sessionExpiredMessage, clearSessionExpiredMessage }}>
      {children}
      {user?.mustChangePassword && (
        <ChangementMotDePasseObligatoire onTermine={terminerChangementMotDePasse} onDeconnexion={logout} />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
