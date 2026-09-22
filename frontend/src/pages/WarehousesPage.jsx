import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLiveEvent } from '../offline/liveEvents';
import { getSecteurConfig } from '../config/sectorConfig';

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

function IconTransferts() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 8h13" />
      <path d="M13 4l4 4-4 4" />
      <path d="M20 16H7" />
      <path d="M11 12l-4 4 4 4" />
    </svg>
  );
}

function IconFleche() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h13" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

const FILTRES_STATUT_TRANSFERT = [
  { value: 'tous', label: 'Tous' },
  { value: 'envoye', label: 'En transit' },
  { value: 'recu', label: 'Réceptionnés' },
  { value: 'annule', label: 'Annulés' },
];

const LABEL_STATUT_TRANSFERT = {
  envoye: 'En transit',
  recu: 'Réceptionné',
  annule: 'Annulé',
};

const CLASSE_STATUT_TRANSFERT = {
  envoye: 'tampon-ambre',
  recu: 'tampon-sarcelle',
  annule: 'tampon-brique',
};

// Page fusionnée (20/09) : Boutiques + Transferts, en deux onglets, pour
// alléger la barre latérale. Attention : contrairement à Boutiques
// (manager uniquement), Transferts était déjà accessible au gérant — la
// fusion ne doit pas lui retirer cet accès. Le gérant n'a donc que l'onglet
// Transferts (pas de bascule visible) ; seul le manager voit les deux.
export function WarehousesPage() {
  const { user, merchant } = useAuth();
  const secteurConfig = getSecteurConfig(merchant?.sector);
  const estManager = user.role === 'manager';
  const [searchParams] = useSearchParams();
  const [onglet, setOnglet] = useState(() => {
    if (!estManager) return 'transferts';
    return searchParams.get('tab') === 'transferts' ? 'transferts' : 'boutiques';
  });

  if (!estManager) {
    return (
      <>
        <div className="entete-page">
          <h1>Transferts entre {secteurConfig.libelleBoutique.toLowerCase()}s</h1>
        </div>
        <TransfertsTab />
      </>
    );
  }

  return (
    <>
      <div className="entete-page">
        <h1>{secteurConfig.libelleBoutique}s</h1>
      </div>

      <div className="onglets" style={{ marginBottom: 20 }}>
        <button className={onglet === 'boutiques' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('boutiques')}>
          {secteurConfig.libelleBoutique}s
        </button>
        <button className={onglet === 'transferts' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('transferts')}>
          Transferts
        </button>
      </div>

      {onglet === 'boutiques' ? <BoutiquesTab /> : <TransfertsTab />}
    </>
  );
}

function BoutiquesTab() {
  const { merchant } = useAuth();
  const secteurConfig = getSecteurConfig(merchant?.sector);
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
      setErreur(`Le nom de la ${secteurConfig.libelleBoutique.toLowerCase()} est requis.`);
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          className="btn btn-principal"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, boxShadow: '0 6px 16px -6px var(--accent)', fontWeight: 600 }}
          onClick={() => setModaleOuverte(true)}
        >
          <IconPlus />
          Nouvelle {secteurConfig.libelleBoutique.toLowerCase()}
        </button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {warehouses.length === 0 ? (
        <p className="etat-vide">Aucune {secteurConfig.libelleBoutique.toLowerCase()} pour l'instant.</p>
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
            <h2>Nouvelle {secteurConfig.libelleBoutique.toLowerCase()}</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="b-name">Nom</label>
                <input
                  id="b-name"
                  className="champ"
                  value={nouvelleBoutique.name}
                  onChange={(e) => setNouvelleBoutique({ ...nouvelleBoutique, name: e.target.value })}
                  placeholder={`${secteurConfig.libelleBoutique} Médina`}
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
            <h2>Modifier la {secteurConfig.libelleBoutique.toLowerCase()}</h2>
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

function TransfertsTab() {
  const { user, merchant } = useAuth();
  const secteurConfig = getSecteurConfig(merchant?.sector);
  const estManager = user.role === 'manager';

  const [transferts, setTransferts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [filtreStatut, setFiltreStatut] = useState('tous');

  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [produitsSource, setProduitsSource] = useState([]);
  const [lignes, setLignes] = useState([]);
  const [enregistrement, setEnregistrement] = useState(false);

  const [transfertDetail, setTransfertDetail] = useState(null);
  const [chargementDetail, setChargementDetail] = useState(false);
  const [actionEnCours, setActionEnCours] = useState(false);

  function charger() {
    setChargement(true);
    Promise.all([api.getStockTransfers(), api.getWarehouses()])
      .then(([t, w]) => {
        setTransferts(t);
        setWarehouses(w);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);
  useLiveEvent('activity:created', () => charger());

  const boutiquesActives = useMemo(() => warehouses.filter((w) => w.is_active), [warehouses]);

  const transfertsFiltres = useMemo(() => {
    return transferts.filter((t) => filtreStatut === 'tous' || t.status === filtreStatut);
  }, [transferts, filtreStatut]);

  function nomBoutique(id) {
    return warehouses.find((w) => w.id === id)?.name || '—';
  }

  function ouvrirCreation() {
    const depart = estManager ? '' : user.warehouseId || '';
    setFromWarehouseId(depart);
    setToWarehouseId('');
    setNotes('');
    setLignes([]);
    setProduitsSource([]);
    setModaleOuverte(true);
  }

  useEffect(() => {
    if (!modaleOuverte || !fromWarehouseId) {
      setProduitsSource([]);
      return;
    }
    api.getProducts(fromWarehouseId).then(setProduitsSource).catch((err) => setErreur(err.message));
  }, [modaleOuverte, fromWarehouseId]);

  function ajouterLigne() {
    setLignes([...lignes, { productId: '', quantity: '' }]);
  }

  function modifierLigne(index, champ, valeur) {
    const copie = [...lignes];
    copie[index] = { ...copie[index], [champ]: valeur };
    setLignes(copie);
  }

  function retirerLigne(index) {
    setLignes(lignes.filter((_, i) => i !== index));
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!fromWarehouseId || !toWarehouseId) {
      setErreur(`${secteurConfig.libelleBoutique} source et destination requises.`);
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      setErreur(`La ${secteurConfig.libelleBoutique.toLowerCase()} source et destination doivent être différentes.`);
      return;
    }
    const items = lignes
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantity) }));
    if (items.length === 0) {
      setErreur('Ajoutez au moins un article avec une quantité.');
      return;
    }
    setEnregistrement(true);
    try {
      await api.createStockTransfer({ fromWarehouseId, toWarehouseId, items, notes: notes || undefined });
      setModaleOuverte(false);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  function ouvrirDetail(transfert) {
    setChargementDetail(true);
    api
      .getStockTransfer(transfert.id)
      .then(setTransfertDetail)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementDetail(false));
  }

  async function handleReceptionner() {
    setActionEnCours(true);
    try {
      await api.receiveStockTransfer(transfertDetail.id);
      setTransfertDetail(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setActionEnCours(false);
    }
  }

  async function handleAnnuler() {
    if (!window.confirm(`Annuler ce transfert ? Le stock sera restitué à la ${secteurConfig.libelleBoutique.toLowerCase()} source.`)) return;
    setActionEnCours(true);
    try {
      await api.cancelStockTransfer(transfertDetail.id);
      setTransfertDetail(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setActionEnCours(false);
    }
  }

  const peutReceptionner =
    transfertDetail?.status === 'envoye' &&
    (estManager || user.warehouseId === transfertDetail?.to_warehouse_id);
  const peutAnnuler =
    transfertDetail?.status !== 'annule' &&
    (estManager || user.warehouseId === transfertDetail?.from_warehouse_id);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          className="btn btn-principal"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, boxShadow: '0 6px 16px -6px var(--accent)', fontWeight: 600 }}
          onClick={ouvrirCreation}
        >
          <IconPlus />
          Nouveau transfert
        </button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div
        className="filtre-pilules"
        style={{
          display: 'flex',
          gap: 4,
          padding: 4,
          marginBottom: 16,
          background: 'var(--fond-alterne, rgba(0,0,0,0.03))',
          borderRadius: 999,
          border: '1px solid var(--trait)',
          width: 'fit-content',
        }}
      >
        {FILTRES_STATUT_TRANSFERT.map((f) => {
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
                whiteSpace: 'nowrap',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : transfertsFiltres.length === 0 ? (
        <p className="etat-vide">
          {transferts.length === 0 ? 'Aucun transfert pour le moment.' : 'Aucun transfert ne correspond à ce filtre.'}
        </p>
      ) : (
        <div className="grille-cartes">
          {transfertsFiltres.map((t) => (
            <div key={t.id} className="carte-entite" style={{ cursor: 'pointer' }} onClick={() => ouvrirDetail(t)}>
              <div className="carte-entite-entete">
                <span className="carte-entite-icone"><IconTransferts /></span>
                <span className={`tampon ${CLASSE_STATUT_TRANSFERT[t.status] || ''}`}>{LABEL_STATUT_TRANSFERT[t.status] || t.status}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{t.from_warehouse_name}</span>
                <span style={{ color: 'var(--accent)', display: 'inline-flex', flexShrink: 0 }}><IconFleche /></span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{t.to_warehouse_name}</span>
              </div>
              <p className="carte-entite-detail">Créé par {t.created_by_name || '—'}</p>
              <p className="carte-entite-souslegende">{new Date(t.created_at).toLocaleDateString('fr-FR')} à {new Date(t.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          ))}
        </div>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <h2>Nouveau transfert</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="t-from">{secteurConfig.libelleBoutique} source</label>
                {estManager ? (
                  <select
                    id="t-from"
                    className="champ"
                    value={fromWarehouseId}
                    onChange={(e) => { setFromWarehouseId(e.target.value); setLignes([]); }}
                  >
                    <option value="">Choisir une {secteurConfig.libelleBoutique.toLowerCase()}</option>
                    {boutiquesActives.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                ) : (
                  <input className="champ" value={nomBoutique(fromWarehouseId)} disabled />
                )}
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="t-to">{secteurConfig.libelleBoutique} destination</label>
                <select
                  id="t-to"
                  className="champ"
                  value={toWarehouseId}
                  onChange={(e) => setToWarehouseId(e.target.value)}
                >
                  <option value="">Choisir une {secteurConfig.libelleBoutique.toLowerCase()}</option>
                  {boutiquesActives.filter((w) => w.id !== fromWarehouseId).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div className="champ-groupe">
                <label className="etiquette">Articles à transférer</label>
                {lignes.map((ligne, index) => (
                  <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <select
                      className="champ"
                      style={{ flex: 2 }}
                      value={ligne.productId}
                      onChange={(e) => modifierLigne(index, 'productId', e.target.value)}
                    >
                      <option value="">Choisir un produit</option>
                      {produitsSource.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({Math.round(Number(p.quantity_in_stock))} en stock)</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      className="champ"
                      style={{ width: 100 }}
                      placeholder="Qté"
                      min="0"
                      step="0.01"
                      value={ligne.quantity}
                      onChange={(e) => modifierLigne(index, 'quantity', e.target.value)}
                    />
                    <button type="button" className="btn" onClick={() => retirerLigne(index)}>×</button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn"
                  onClick={ajouterLigne}
                  disabled={!fromWarehouseId}
                  style={{ marginBottom: 16 }}
                >
                  + Ajouter un article
                </button>
              </div>

              <div className="champ-groupe">
                <label className="etiquette" htmlFor="t-notes">Notes (facultatif)</label>
                <input
                  id="t-notes"
                  className="champ"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setModaleOuverte(false)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={enregistrement}>
                  {enregistrement ? 'Envoi…' : 'Envoyer le transfert'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {(transfertDetail || chargementDetail) && (
        <div className="modale-fond" onClick={() => setTransfertDetail(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            {chargementDetail || !transfertDetail ? (
              <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
            ) : (
              <>
                <h2>{transfertDetail.from_warehouse_name} → {transfertDetail.to_warehouse_name}</h2>
                <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 4 }}>
                  Statut : <strong>{LABEL_STATUT_TRANSFERT[transfertDetail.status] || transfertDetail.status}</strong>
                </p>
                <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
                  Créé par {transfertDetail.created_by_name || '—'} le {new Date(transfertDetail.created_at).toLocaleDateString('fr-FR')}
                  {transfertDetail.received_by_name && <> · Réceptionné par {transfertDetail.received_by_name}</>}
                </p>
                {transfertDetail.notes && (
                  <p style={{ fontSize: 13, marginBottom: 16 }}>Notes : {transfertDetail.notes}</p>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
                  {transfertDetail.items.map((item) => (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--fond-alterne, #f5f5f5)', borderRadius: 6, fontSize: 13 }}>
                      <span>{item.product_name}</span>
                      <span>{item.is_weighted ? Number(item.quantity).toFixed(1) : Math.round(Number(item.quantity))}{item.is_weighted ? ' kg' : ''}</span>
                    </div>
                  ))}
                </div>
                <div className="actions-modale">
                  <button type="button" className="btn" onClick={() => setTransfertDetail(null)}>Fermer</button>
                  {peutAnnuler && (
                    <button type="button" className="btn btn-brique" onClick={handleAnnuler} disabled={actionEnCours}>
                      {actionEnCours ? 'Annulation…' : 'Annuler'}
                    </button>
                  )}
                  {peutReceptionner && (
                    <button type="button" className="btn btn-principal" onClick={handleReceptionner} disabled={actionEnCours}>
                      {actionEnCours ? 'Réception…' : 'Réceptionner'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
