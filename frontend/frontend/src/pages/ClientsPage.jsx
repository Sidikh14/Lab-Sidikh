import { useEffect, useState } from 'react';
import { api } from '../api/client';

export function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouveauClient, setNouveauClient] = useState({ fullName: '', phone: '', email: '' });

  function charger() {
    setChargement(true);
    api
      .getClients()
      .then(setClients)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!nouveauClient.fullName) {
      setErreur('Le nom du client est requis.');
      return;
    }
    try {
      await api.createClient(nouveauClient);
      setModaleOuverte(false);
      setNouveauClient({ fullName: '', phone: '', email: '' });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <>
      <div className="entete-page">
        <h1>Clients</h1>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-outils">
        <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{clients.length} client(s)</span>
        <button className="btn btn-principal" onClick={() => setModaleOuverte(true)}>
          Ajouter un client
        </button>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : clients.length === 0 ? (
        <p className="etat-vide">Aucun client enregistré. Ajoutez votre premier client.</p>
      ) : (
        <table className="registre">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Téléphone</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td>{c.full_name}</td>
                <td className="chiffre">{c.phone || '—'}</td>
                <td>{c.email || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Ajouter un client</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="c-name">Nom complet</label>
                <input
                  id="c-name"
                  className="champ"
                  value={nouveauClient.fullName}
                  onChange={(e) => setNouveauClient({ ...nouveauClient, fullName: e.target.value })}
                  placeholder="Aïcha Diallo"
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="c-phone">Téléphone</label>
                <input
                  id="c-phone"
                  className="champ"
                  value={nouveauClient.phone}
                  onChange={(e) => setNouveauClient({ ...nouveauClient, phone: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="c-email">Email</label>
                <input
                  id="c-email"
                  type="email"
                  className="champ"
                  value={nouveauClient.email}
                  onChange={(e) => setNouveauClient({ ...nouveauClient, email: e.target.value })}
                />
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setModaleOuverte(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-principal">
                  Ajouter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
