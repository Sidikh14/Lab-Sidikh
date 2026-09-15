// components/CreditRequestNotifications.jsx
// À monter une seule fois, au niveau du layout global (App.jsx), pour que
// la notif s'affiche peu importe la page sur laquelle est le caissier.
//
// Important : ce projet n'utilise pas Tailwind (voir tokens.css / app.css),
// donc ce composant s'appuie sur des styles inline + les variables CSS du
// thème, comme le reste de l'application — des classes Tailwind ici ne
// produiraient aucun style visible.
import { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLiveEvent } from '../offline/liveEvents';

function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function IconAlerte() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  );
}

function IconFermer() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export default function CreditRequestNotifications() {
  const { user } = useAuth();
  const [toasts, setToasts] = useState([]);

  function retirerToast(id) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  const handleEvent = useCallback(
    (data) => {
      if (!user || data.requestedBy !== user.id) return; // pas pour ce caissier

      const id = `${data.requestId}-${Date.now()}`;
      setToasts((prev) => [...prev, { id, ...data }]);

      setTimeout(() => retirerToast(id), 6000);
    },
    [user]
  );

  useLiveEvent('credit_request:resolved', handleEvent);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: 340,
        maxWidth: 'calc(100vw - 40px)',
      }}
    >
      {toasts.map((t) => {
        const estApprouvee = t.status === 'approuvee';
        const couleur = estApprouvee ? 'var(--vif)' : 'var(--danger)';
        const fond = estApprouvee ? 'var(--vif-clair)' : 'var(--danger-clair)';
        return (
          <div
            key={t.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              background: 'var(--carte)',
              border: '1px solid var(--trait)',
              borderLeft: `4px solid ${couleur}`,
              borderRadius: 'var(--rayon)',
              boxShadow: 'var(--ombre-flottante)',
              padding: '14px 14px 14px 16px',
              animation: 'apparitionToast 0.2s ease',
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: fond,
                color: couleur,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {estApprouvee ? <IconCheck /> : <IconAlerte />}
            </span>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--encre)', lineHeight: 1.5 }}>
              {estApprouvee ? (
                <>
                  Client <strong>{t.fullName}</strong> créé — la vente à crédit peut être encaissée.
                </>
              ) : (
                <>
                  Demande de crédit refusée pour <strong>{t.fullName}</strong>
                  {t.reason ? ` : ${t.reason}` : '.'}
                </>
              )}
            </div>
            <button
              onClick={() => retirerToast(t.id)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--encre-douce)',
                cursor: 'pointer',
                padding: 2,
                flexShrink: 0,
                display: 'inline-flex',
              }}
              aria-label="Fermer"
            >
              <IconFermer />
            </button>
          </div>
        );
      })}
      <style>{`
        @keyframes apparitionToast {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
