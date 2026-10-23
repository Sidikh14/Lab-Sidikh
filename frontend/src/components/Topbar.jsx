import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

// Rôles qui reçoivent des alertes (même liste que alerts.routes.js côté backend).
const ROLES_ALERTES = ['manager', 'gerant', 'caissier', 'vendeur_caissier'];

function IconCloche() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

function IconSoleil() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" />
    </svg>
  );
}

function IconLune() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
    </svg>
  );
}

const CLE_THEME = 'themeSombre';
function lireThemeSombre() {
  try {
    const v = localStorage.getItem(CLE_THEME);
    if (v === '1') return true;
    if (v === '0') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function IconClocheBarree() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9a6 6 0 0 1 10.3-4.2M18 9c0 5 2 6 2 6H9" />
      <path d="M4 4l16 16" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

// Convertit la clé publique VAPID (base64 URL-safe) en Uint8Array, format attendu par pushManager.subscribe().
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

const formaterDate = (d) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function Topbar({ onOuvrirMenu }) {
  const { user, merchant, logout, aRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [enRupture, setEnRupture] = useState(0);
  const [menuOuvert, setMenuOuvert] = useState(false);

  // Mode sombre : posé sur <html data-theme="dark"> (voir le bloc ajouté dans app.css), mémorisé par la personne.
  const [themeSombre, setThemeSombre] = useState(lireThemeSombre);
  useEffect(() => {
    document.documentElement.dataset.theme = themeSombre ? 'dark' : 'light';
  }, [themeSombre]);
  function basculerTheme() {
    setThemeSombre((v) => {
      try { localStorage.setItem(CLE_THEME, v ? '0' : '1'); } catch { /* mémorisation facultative */ }
      return !v;
    });
  }

  const peutVoirAlertes = aRole(...ROLES_ALERTES);

  // Bascule notifications push : visible seulement pour le manager, jamais imposée.
  const peutGererPush = aRole('manager');
  const [statutPush, setStatutPush] = useState('indisponible'); // indisponible | inactif | actif | erreur
  const [pushEnCours, setPushEnCours] = useState(false);

  useEffect(() => {
    if (!peutGererPush) return undefined;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatutPush('indisponible');
      return undefined;
    }
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setStatutPush(subscription ? 'actif' : 'inactif'))
      .catch(() => setStatutPush('inactif'));
    return undefined;
  }, [peutGererPush]);

  async function activerPush() {
    setPushEnCours(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatutPush('inactif');
        return;
      }
      const { publicKey } = await api.getVapidPublicKey();
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api.subscribeToPush(subscription.toJSON());
      setStatutPush('actif');
    } catch {
      setStatutPush('erreur');
    } finally {
      setPushEnCours(false);
    }
  }

  async function desactiverPush() {
    setPushEnCours(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        try {
          if (typeof api.unsubscribeFromPush === 'function') await api.unsubscribeFromPush(subscription.endpoint);
        } catch {
          /* le serveur oubliera l'abonnement au prochain envoi échoué */
        }
        await subscription.unsubscribe();
      }
      setStatutPush('inactif');
    } catch {
      setStatutPush('erreur');
    } finally {
      setPushEnCours(false);
    }
  }

  function basculerPush() {
    if (pushEnCours) return;
    if (statutPush === 'actif') desactiverPush();
    else activerPush();
  }

  const [alertes, setAlertes] = useState([]);
  const [nonLues, setNonLues] = useState(0);
  const [panneauOuvert, setPanneauOuvert] = useState(false);
  const [bandeau, setBandeau] = useState(null);
  // Lu dans le gestionnaire temps réel sans relancer la connexion à chaque ouverture/fermeture du panneau.
  const panneauOuvertRef = useRef(false);
  useEffect(() => { panneauOuvertRef.current = panneauOuvert; }, [panneauOuvert]);

  // Téléphone : le panneau des notifications est centré sur l'écran (marge de 8 px de chaque côté) au lieu d'être
  // accroché à la cloche, ce qui le faisait déborder à gauche.
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 960px)').matches);
  const [topPanneau, setTopPanneau] = useState(64);
  const boutonClocheRef = useRef(null);
  const zoneClocheRef = useRef(null);
  const zoneAvatarRef = useRef(null);
  useEffect(() => {
    const requete = window.matchMedia('(max-width: 960px)');
    const maj = () => setMobile(requete.matches);
    requete.addEventListener('change', maj);
    return () => requete.removeEventListener('change', maj);
  }, []);

  // Un toucher (ou un clic) en dehors de la cloche / de l'avatar ferme le panneau des notifications et le menu du compte.
  // Échap les ferme aussi, et un changement de page également.
  useEffect(() => {
    if (!panneauOuvert && !menuOuvert) return undefined;
    function dehors(e) {
      if (panneauOuvert && zoneClocheRef.current && !zoneClocheRef.current.contains(e.target)) setPanneauOuvert(false);
      if (menuOuvert && zoneAvatarRef.current && !zoneAvatarRef.current.contains(e.target)) setMenuOuvert(false);
    }
    function touche(e) {
      if (e.key === 'Escape') { setPanneauOuvert(false); setMenuOuvert(false); }
    }
    document.addEventListener('pointerdown', dehors);
    document.addEventListener('keydown', touche);
    return () => {
      document.removeEventListener('pointerdown', dehors);
      document.removeEventListener('keydown', touche);
    };
  }, [panneauOuvert, menuOuvert]);

  useEffect(() => {
    setPanneauOuvert(false);
    setMenuOuvert(false);
  }, [location.pathname]);

  useEffect(() => {
    api
      .getProducts()
      .then((produits) => setEnRupture(produits.filter((p) => p.status === 'rupture').length))
      .catch(() => {});
  }, []);

  const rafraichirCompte = useCallback(() => {
    api.getAlertsUnreadCount().then((r) => setNonLues(r?.count || 0)).catch(() => {});
  }, []);

  const rafraichirListe = useCallback(() => {
    api.getAlerts().then((liste) => setAlertes(Array.isArray(liste) ? liste : [])).catch(() => {});
  }, []);

  // Compteur d'alertes non lues : relu toutes les 30 s (ce même appel déclenche côté serveur le contrôle
  // des lots bientôt périmés et des échéances fiscales, au plus une fois par heure).
  useEffect(() => {
    if (!peutVoirAlertes) return undefined;
    rafraichirCompte();
    const minuteur = setInterval(rafraichirCompte, 30000);
    return () => clearInterval(minuteur);
  }, [peutVoirAlertes, rafraichirCompte]);

  // Temps réel : une nouvelle alerte s'affiche aussitôt en bandeau. En cas d'échec de la connexion, le
  // compteur relu toutes les 30 s prend le relais.
  useEffect(() => {
    if (!peutVoirAlertes) return undefined;
    let source;
    try {
      source = new EventSource(api.alertsStreamUrl());
    } catch {
      return undefined;
    }
    source.addEventListener('alert:new', (e) => {
      try {
        setBandeau(JSON.parse(e.data));
        rafraichirCompte();
        if (panneauOuvertRef.current) rafraichirListe();
      } catch {
        /* message illisible : ignoré */
      }
    });
    return () => source.close();
  }, [peutVoirAlertes, rafraichirCompte, rafraichirListe]);

  useEffect(() => {
    if (!bandeau) return undefined;
    const minuteur = setTimeout(() => setBandeau(null), 8000);
    return () => clearTimeout(minuteur);
  }, [bandeau]);

  function ouvrirPanneau() {
    const rect = boutonClocheRef.current?.getBoundingClientRect();
    setTopPanneau(rect ? Math.round(rect.bottom + 8) : 64);
    setPanneauOuvert(true);
    rafraichirListe();
  }

  function basculerPanneau() {
    if (!peutVoirAlertes) {
      navigate('/');
      return;
    }
    if (panneauOuvert) setPanneauOuvert(false);
    else ouvrirPanneau();
  }

  const stylePanneau = mobile
    ? { position: 'fixed', left: 8, right: 8, top: topPanneau, maxHeight: `calc(100vh - ${topPanneau + 16}px)` }
    : { position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 340, maxWidth: '92vw', maxHeight: 420 };

  function marquerLue(alerte) {
    if (alerte.lu) return;
    setAlertes((liste) => liste.map((a) => (a.id === alerte.id ? { ...a, lu: true } : a)));
    setNonLues((n) => Math.max(0, n - 1));
    api.markAlertRead(alerte.id).catch(() => rafraichirCompte());
  }

  const initiales = (user?.fullName || '?')
    .split(' ')
    .map((mot) => mot[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const badge = peutVoirAlertes ? nonLues : enRupture;

  return (
    <header className="barre-haut">
      <div className="barre-haut-gauche">
        <button type="button" className="bouton-menu-mobile" onClick={onOuvrirMenu} aria-label="Ouvrir le menu">
          <IconMenu />
        </button>
      </div>

      <div className="barre-haut-marque">
        <span className="barre-haut-trait" aria-hidden="true" />
        <span className="barre-haut-commerce">{merchant?.businessName}</span>
        <span className="barre-haut-trait" aria-hidden="true" />
      </div>

      <div className="barre-haut-droite">
        <button
          type="button"
          className="barre-haut-theme"
          onClick={basculerTheme}
          aria-label={themeSombre ? 'Passer au thème clair' : 'Passer au thème sombre'}
          title={themeSombre ? 'Thème clair' : 'Thème sombre'}
        >
          {themeSombre ? <IconSoleil /> : <IconLune />}
        </button>

        {peutGererPush && statutPush !== 'indisponible' && (
          <button
            type="button"
            onClick={basculerPush}
            disabled={pushEnCours}
            title={statutPush === 'actif' ? 'Désactiver les notifications' : 'Activer les notifications'}
            aria-label={statutPush === 'actif' ? 'Désactiver les notifications' : 'Activer les notifications'}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--trait)',
              borderRadius: 999, background: statutPush === 'actif' ? 'var(--accent-clair, #eef2ff)' : 'var(--carte)',
              color: statutPush === 'actif' ? 'var(--accent, #6d28d9)' : '#6b7280',
              fontSize: 11, padding: '3px 8px', cursor: pushEnCours ? 'default' : 'pointer', opacity: pushEnCours ? 0.6 : 1,
            }}
          >
            {statutPush === 'actif' ? <IconCloche /> : <IconClocheBarree />}
            {statutPush === 'actif' ? 'Notifs actives' : 'Notifs coupées'}
          </button>
        )}

        <div ref={zoneClocheRef} style={{ position: 'relative' }}>
          <button
            type="button"
            ref={boutonClocheRef}
            className="barre-haut-cloche"
            onClick={basculerPanneau}
            aria-label={peutVoirAlertes ? `${nonLues} alerte(s) non lue(s)` : `${enRupture} produit(s) en rupture`}
          >
            <IconCloche />
            {badge > 0 && <span className="barre-haut-badge">{badge}</span>}
          </button>

          {panneauOuvert && peutVoirAlertes && (
            <div
              style={{
                ...stylePanneau,
                overflowY: 'auto', background: 'var(--carte)', color: 'var(--encre)', border: '1px solid var(--trait)', borderRadius: 12,
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 60, textAlign: 'left',
              }}
            >
              <div style={{ padding: '10px 14px', fontWeight: 700, borderBottom: '1px solid var(--trait)' }}>Notifications</div>
              {enRupture > 0 && (
                <button
                  type="button"
                  onClick={() => { setPanneauOuvert(false); navigate('/'); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 0, borderBottom: '1px solid var(--trait)', background: 'var(--accent-clair, #f3f4f6)', cursor: 'pointer' }}
                >
                  {enRupture} produit(s) en rupture de stock
                </button>
              )}
              {alertes.length === 0 && (
                <p style={{ padding: '16px 14px', margin: 0, color: 'var(--encre-douce)' }}>Aucune notification.</p>
              )}
              {alertes.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => marquerLue(a)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 0,
                    borderBottom: '1px solid var(--trait)', cursor: 'pointer',
                    background: a.lu ? 'var(--carte)' : 'var(--accent-clair, #eef2ff)',
                  }}
                >
                  <span style={{ display: 'block', fontWeight: a.lu ? 500 : 700, fontSize: 13 }}>{a.titre}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: 'var(--encre)', marginTop: 2 }}>{a.message}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--encre-douce)', marginTop: 4 }}>{formaterDate(a.created_at)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="barre-haut-avatar-zone" ref={zoneAvatarRef}>
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
      </div>

      {bandeau && (
        <div
          role="status"
          onClick={() => { setBandeau(null); ouvrirPanneau(); }}
          style={{
            position: 'fixed', top: 64, right: 16, width: 320, maxWidth: '92vw', background: 'var(--carte)', color: 'var(--encre)', cursor: 'pointer',
            border: '1px solid var(--trait)', borderLeft: '4px solid var(--accent, #6d28d9)', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: '10px 14px', zIndex: 80, textAlign: 'left',
          }}
        >
          <span style={{ display: 'block', fontWeight: 700, fontSize: 13 }}>{bandeau.titre}</span>
          <span style={{ display: 'block', fontSize: 12.5, color: 'var(--encre)', marginTop: 2 }}>{bandeau.message}</span>
        </div>
      )}
    </header>
  );
}
