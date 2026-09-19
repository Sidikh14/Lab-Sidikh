import { useEffect, useState } from 'react';
import { api } from '../api/client';

function IconPlus() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function IconModifier() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function WarehousesPage() {
  const [warehouses, setWarehouses] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouvelleBoutique, setNouvelleBoutique] = useState({ name: '', address: '' });
  const [enregistrement, setEnregistrement] = useState(false);

  const [boutiqueEnEdition, setBoutiqueEnEdition] = useState(null);
  const [enregistrementEdition, setEnregistrementEdition] = useState(false);

  function charger() {
    setChargement(true);
    api
      .getWarehouses()
      .then(setWarehouses)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!nouvelleBoutique.name.trim()) {
      setErreur('Le nom de la boutique est requis.');
      return;
    }
    setEnregistrement(true);
    try {
      await api.createWarehouse(nouvelleBoutique);
      setModaleOuverte(false);
      setNouvelleBoutique({ name: '', address: '' });
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  function ouvrirEdition(boutique) {
    setBoutiqueEnEdition({ id: boutique.id, name: boutique.name, address: boutique.address || '' });
  }

  async function handleEnregistrerEdition(e) {
    e.preventDefault();
    setEnregistrementEdition(true);
    try {
      await api.updateWarehouse(boutiqueEnEdition.id, {
        name: boutiqueEnEdition.name,
        address: boutiqueEnEdition.address,
      });
      setBoutiqueEnEdition(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementEdition(false);
    }
  }

  async function handleToggleStatus(boutique) {
    try {
      await api.setWarehouseStatus(boutique.id, !boutique.is_active);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (chargement) return <p className="etat-vide">Chargement…</p>;

  return (
    <>
      <div className="entete-page">
        <h1>Boutiques</h1>
        <button
          className="btn btn-principal"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, boxShadow: '0 6px 16px -6px var(--accent)', fontWeight: 600 }}
          onClick={() => setModaleOuverte(true)}
        >
          <IconPlus />
          Nouvelle boutique
        </button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {warehouses.length === 0 ? (
        <p className="etat-vide">Aucune boutique pour l'instant.</p>
      ) : (
        <div className="grille-cartes">
          {warehouses.map((w) => (
            <div key={w.id} className="carte" style={{ opacity: w.is_active ? 1 : 0.55 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <h3 style={{ margin: 0 }}>{w.name}</h3>
                  {w.address && <p style={{ fontSize: 13, color: 'var(--encre-douce)', margin: '4px 0 0' }}>{w.address}</p>}
                  {!w.is_active && <span className="tampon">Désactivée</span>}
                </div>
                <button className="btn" style={{ padding: '4px 8px' }} onClick={() => ouvrirEdition(w)} aria-label="Modifier">
                  <IconModifier />
                </button>
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className="btn" style={{ flex: 1 }} onClick={() => handleToggleStatus(w)}>
                  {w.is_active ? 'Désactiver' : 'Réactiver'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle boutique</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="b-name">Nom</label>
                <input
                  id="b-name"
                  className="champ"
                  value={nouvelleBoutique.name}
                  onChange={(e) => setNouvelleBoutique({ ...nouvelleBoutique, name: e.target.value })}
                  placeholder="Boutique Médina"
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="b-address">Adresse (facultatif)</label>
                <input
                  id="b-address"
                  className="champ"
                  value={nouvelleBoutique.address}
                  onChange={(e) => setNouvelleBoutique({ ...nouvelleBoutique, address: e.target.value })}
                />
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setModaleOuverte(false)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={enregistrement}>
                  {enregistrement ? 'Enregistrement…' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {boutiqueEnEdition && (
        <div className="modale-fond" onClick={() => setBoutiqueEnEdition(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Modifier la boutique</h2>
            <form onSubmit={handleEnregistrerEdition}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="be-name">Nom</label>
                <input
                  id="be-name"
                  className="champ"
                  value={boutiqueEnEdition.name}
                  onChange={(e) => setBoutiqueEnEdition({ ...boutiqueEnEdition, name: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="be-address">Adresse</label>
                <input
                  id="be-address"
                  className="champ"
                  value={boutiqueEnEdition.address}
                  onChange={(e) => setBoutiqueEnEdition({ ...boutiqueEnEdition, address: e.target.value })}
                />
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setBoutiqueEnEdition(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={enregistrementEdition}>
                  {enregistrementEdition ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
