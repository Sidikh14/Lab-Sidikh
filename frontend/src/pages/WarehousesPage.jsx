import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useLiveEvent } from '../offline/liveEvents';

function IconBoutique() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

function IconRecherche() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

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

function IconCadenas() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

const FILTRES_STATUT = [
  { value: 'tous', label: 'Toutes' },
  { value: 'actives', label: 'Actives' },
  { value: 'desactivees', label: 'Désactivées' },
];

export function WarehousesPage() {
  const [boutiques, setBoutiques] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [recherche, setRecherche] = useState('');
  const [filtreStatut, setFiltreStatut] = useState('tous');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouvelleBoutique, setNouvelleBoutique] = useState({ name: '', address: '' });
  const [boutiqueEnEdition, setBoutiqueEnEdition] = useState(null);
  const [enregistrement, setEnregistrement] = useState(false);

  function charger() {
    setChargement(true);
    api
      .getWarehouses()
      .then(setBoutiques)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  // Temps réel : une boutique créée/modifiée/(dés)activée sur un autre poste
  // apparaît sans avoir besoin d'actualiser (même mécanisme que les autres
  // pages modernisées : ClientsPage, SuppliersPage, TeamPage).
  useLiveEvent('activity:created', () => charger());

  const boutiquesFiltrees = useMemo(() => {
    return boutiques.filter((w) => {
      const correspondRecherche =
        w.name.toLowerCase().includes(recherche.toLowerCase()) ||
        (w.address || '').toLowerCase().includes(recherche.toLowerCase());
      const correspondStatut =
        filtreStatut === 'tous' ||
        (filtreStatut === 'actives' && w.is_active) ||
        (filtreStatut === 'desactivees' && !w.is_active);
      return correspondRecherche && correspondStatut;
    });
  }, [boutiques, recherche, filtreStatut]);

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
    setEnregistrement(true);
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
      setEnregistrement(false);
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

      <div className="barre-filtres">
        <div className="champ-avec-icone champ-avec-icone--pleine-largeur">
          <span className="champ-icone"><IconRecherche /></span>
          <input
            type="text"
            className="champ champ--avec-icone"
            placeholder="Rechercher par nom ou adresse…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <div
          className="filtre-pilules"
          style={{
            display: 'flex',
            gap: 4,
            padding: 4,
            background: 'var(--fond-alterne, rgba(0,0,0,0.03))',
            borderRadius: 999,
            border: '1px solid var(--trait)',
          }}
        >
          {FILTRES_STATUT.map((f) => {
            const actif = filtreStatut === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFiltreStatut(f.value)}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  padding: '7px 16px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: actif ? 600 : 500,
                  color: actif ? '#fff' : 'var(--encre-douce)',
                  background: actif ? 'var(--accent)' : 'transparent',
                  boxShadow: actif ? '0 4px 10px -3px var(--accent)' : 'none',
                  transition: 'background 0.15s ease, color 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : boutiquesFiltrees.length === 0 ? (
        <p className="etat-vide">
          {boutiques.length === 0 ? 'Aucune boutique pour le moment. Créez la première pour démarrer.' : 'Aucune boutique ne correspond à ces filtres.'}
        </p>
      ) : (
        <div className="grille-cartes">
          {boutiquesFiltrees.map((w) => (
            <div key={w.id} className="carte-entite">
              <div className="carte-entite-entete">
                <span className="carte-entite-icone"><IconBoutique /></span>
                <span className={`tampon ${w.is_active ? 'tampon-sarcelle' : 'tampon-brique'}`}>
                  {w.is_active ? 'Active' : 'Désactivée'}
                </span>
              </div>
              <p className="carte-entite-nom">{w.name}</p>
              <p className="carte-entite-detail">{w.address || 'Adresse non renseignée'}</p>
              <p className="carte-entite-souslegende">Depuis le {new Date(w.created_at).toLocaleDateString('fr-FR')}</p>
              <div className="carte-entite-actions">
                <button
                  className="btn"
                  style={{ padding: '7px 10px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={() => ouvrirEdition(w)}
                >
                  <IconModifier />
                  Modifier
                </button>
                <button
                  className="btn"
                  style={{ padding: '7px 10px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={() => handleToggleStatus(w)}
                  title={w.is_active ? 'Désactiver cette boutique' : 'Réactiver cette boutique'}
                >
                  <IconCadenas />
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
                  placeholder="Boutique Sacré-Cœur"
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
                <button type="submit" className="btn btn-principal" disabled={enregistrement}>
                  {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
