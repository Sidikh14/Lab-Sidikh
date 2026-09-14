// components/CreditRequestNotifications.jsx
// À monter une seule fois, au niveau du layout global (App.jsx), pour que
// la notif s'affiche peu importe la page sur laquelle est le caissier.
import { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLiveEvent } from '../liveEvents';

export default function CreditRequestNotifications() {
  const { user } = useAuth();
  const [toasts, setToasts] = useState([]);

  const handleEvent = useCallback(
    (data) => {
      if (!user || data.requestedBy !== user.id) return; // pas pour ce caissier

      const id = `${data.requestId}-${Date.now()}`;
      setToasts((prev) => [...prev, { id, ...data }]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 6000);
    },
    [user]
  );

  useLiveEvent('credit_request:resolved', handleEvent);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-xl shadow-lg p-4 text-sm text-white ${
            t.status === 'approuvee' ? 'bg-cyan-600' : 'bg-red-600'
          }`}
        >
          {t.status === 'approuvee' ? (
            <>Client <strong>{t.fullName}</strong> créé — la vente à crédit peut être encaissée.</>
          ) : (
            <>
              Demande refusée pour <strong>{t.fullName}</strong>
              {t.reason ? ` : ${t.reason}` : ''}.
            </>
          )}
        </div>
      ))}
    </div>
  );
}
