import { useEffect, useState } from 'react';
import { api } from '../api/client';

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouveau, setNouveau] = useState({ name: '', phone: '', email: '', address: '' });

  function charger() {
    setChargement(true);
    api
      .getSuppliers()
      .then(setSuppliers)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!nouveau.name) {
      setErreur('Le nom du fournisseur est requis.');
      return;
    }
    try {
      await api.createSupplier(nouveau);
      setModaleOuverte(false);
      setNouveau({ name: '', phone: '', email: '', address: '' });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimer(supplier) {
    if (!window.confirm(`Retirer "${supplier.name}" de la liste des fournisseurs ?`)) return;
    try {
      await api.deleteSupplier(supplier.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <>
      <div className="entete-page">
        <h1>Fournisseurs</h1>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-outils">
        <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{suppliers.length} fournisseur(s)</span>
        <button className="btn btn-principal" onClick={() => setModaleOuverte(true)}>
          Ajouter un fournisseur
        </button>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : suppliers.length === 0 ? (
        <p className="etat-vide">Aucun fournisseur enregistré pour le moment.</p>
      ) : (
        <table className="registre">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Téléphone</th>
              <th>Email</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="chiffre">{s.phone || '—'}</td>
                <td>{s.email || '—'}</td>
                <td>
                  <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => handleSupprimer(s)}>
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Ajouter un fournisseur</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="f-name">Nom</label>
                <input
                  id="f-name"
                  className="champ"
                  value={nouveau.name}
                  onChange={(e) => setNouveau({ ...nouveau, name: e.target.value })}
                  placeholder="Grossiste Baol"
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="f-phone">Téléphone</label>
                <input
                  id="f-phone"
                  className="champ"
                  value={nouveau.phone}
                  onChange={(e) => setNouveau({ ...nouveau, phone: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="f-email">Email</label>
                <input
                  id="f-email"
                  type="email"
                  className="champ"
                  value={nouveau.email}
                  onChange={(e) => setNouveau({ ...nouveau, email: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="f-address">Adresse</label>
                <input
                  id="f-address"
                  className="champ"
                  value={nouveau.address}
                  onChange={(e) => setNouveau({ ...nouveau, address: e.target.value })}
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
