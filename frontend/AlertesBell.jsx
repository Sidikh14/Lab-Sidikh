// src/components/AlertesBell.jsx
// À monter dans Topbar.jsx, uniquement si user.role est "manager" ou "gerant" :
//   <AlertesBell api={api} />

import { useEffect, useState } from 'react';
import { useLiveEvent } from '../hooks/useLiveEvent'; // [À CONFIRMER] chemin réel

export default function AlertesBell({ api }) {
  const [alertes, setAlertes] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const nonLues = alertes.filter((a) => !a.lu).length;

  const charger = async () => {
    const { data } = await api.get('/alerts');
    setAlertes(data);
  };

  useEffect(() => { charger(); }, []);
  useLiveEvent('alert:new', charger);

  const marquerLu = async (id) => {
    await api.patch(`/alerts/${id}/read`);
    charger();
  };

  return (
    <div className="cloche-alertes">
      <button onClick={() => setOuvert(!ouvert)}>
        🔔 {nonLues > 0 && <span className="badge-non-lues">{nonLues}</span>}
      </button>
      {ouvert && (
        <div className="menu-alertes">
          {alertes.length === 0 && <p>Aucune alerte</p>}
          {alertes.map((a) => (
            <div
              key={a.id}
              className={`item-alerte ${a.lu ? '' : 'non-lue'}`}
              onClick={() => marquerLu(a.id)}
            >
              <strong>{a.titre}</strong>
              <p>{a.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
