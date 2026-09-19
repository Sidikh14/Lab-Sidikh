import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

function IconPlus() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

const LIBELLES_STATUT = {
  envoye: 'Envoyé',
  recu: 'Reçu',
  annule: 'Annulé',
};

function BadgeStatutTransfert({ statut }) {
  const classe = statut === 'recu' ? 'tampon tampon-sarcelle' : statut === 'annule' ? 'tampon tampon-brique' : 'tampon';
  return <span className={classe}>{LIBELLES_STATUT[statut] || statut}</span>;
}

export function TransfersPage() {
  const { user } = useAuth();
  const estManager = user.role === 'manager';

  const [transfers, setTransfers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [produitsSource, setProduitsSource] = useState([]);
  const [lignes, setLignes] = useState([]);
  const [enregistrement, setEnregistrement] = useState(false);

  const [detailOuvert, setDetailOuvert] = useState(null);
  const [chargementDetail, setChargementDetail] = useState(false);

  function charger() {
    setChargement(true);
    Promise.all([api.getStockTransfers(), api.getWarehouses()])
      .then(([t, w]) => {
        setTransfers(t);
        setWarehouses(w);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  const boutiquesActives = warehouses.filter((w) => w.is_active);
  // Un gérant ne peut envoyer que depuis SA boutique (le backend l'impose
  // de toute façon) : pas de sélecteur, la source est fixée.
  const boutiquesDestination = boutiquesActives.filter((w) => w.id !== fromWarehouseId);

  function ouvrirModaleCreation() {
    const source = estManager ? '' : user.warehouseId || '';
    setFromWarehouseId(source);
    setToWarehouseId('');
    setNotes('');
    setLignes([]);
    setProduitsSource([]);
    setModaleOuverte(true);
  }

  useEffect(() => {
    if (!fromWarehouseId) {
      setProduitsSource([]);
      return;
    }
    api.getProducts(fromWarehouseId).then(setProduitsSource).catch((err) => setErreur(err.message));
  }, [fromWarehouseId]);

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
      setErreur('Boutique source et destination requises.');
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
    setErreur('');
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

  async function ouvrirDetail(transfer) {
    setChargementDetail(true);
    setErreur('');
    try {
      const detail = await api.getStockTransfer(transfer.id);
      setDetailOuvert(detail);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargementDetail(false);
    }
  }

  async function handleReceive(transfer) {
    try {
      await api.receiveStockTransfer(transfer.id);
      setDetailOuvert(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleCancel(transfer) {
    if (!window.confirm('Annuler ce transfert ? Le stock sera restitué à la boutique source.')) return;
    try {
      await api.cancelStockTransfer(transfer.id);
      setDetailOuvert(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  // Peut réceptionner : la boutique destination est la sienne (ou manager).
  function peutReceptionner(transfer) {
    if (transfer.status !== 'envoye') return false;
    return estManager || user.warehouseId === transfer.to_warehouse_id;
  }

  // Peut annuler : la boutique source est la sienne (ou manager).
  function peutAnnuler(transfer) {
    if (transfer.status === 'annule') return false;
    return estManager || user.warehouseId === transfer.from_warehouse_id;
  }

  if (chargement) return <p className="etat-vide">Chargement…</p>;

  return (
    <>
      <div className="entete-page">
        <h1>Transferts entre boutiques</h1>
        <button
          className="btn btn-principal"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, boxShadow: '0 6px 16px -6px var(--accent)', fontWeight: 600 }}
          onClick={ouvrirModaleCreation}
        >
          <IconPlus />
          Nouveau transfert
        </button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {transfers.length === 0 ? (
        <p className="etat-vide">Aucun transfert pour l'instant.</p>
      ) : (
        <table className="tableau">
          <thead>
            <tr>
              <th>De</th>
              <th>Vers</th>
              <th>Statut</th>
              <th>Créé par</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => ouvrirDetail(t)}>
                <td>{t.from_warehouse_name}</td>
                <td>{t.to_warehouse_name}</td>
                <td><BadgeStatutTransfert statut={t.status} /></td>
                <td>{t.created_by_name || '—'}</td>
                <td>{new Date(t.created_at).toLocaleDateString('fr-FR')}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {peutReceptionner(t) && (
                    <button className="btn" style={{ marginRight: 6 }} onClick={() => handleReceive(t)}>Réceptionner</button>
                  )}
                  {peutAnnuler(t) && (
                    <button className="btn btn-brique" onClick={() => handleCancel(t)}>Annuler</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Nouveau transfert</h2>
            <form onSubmit={handleCreate}>
              {estManager && (
                <div className="champ-groupe">
                  <label className="etiquette" htmlFor="t-from">Boutique source</label>
                  <select
                    id="t-from"
                    className="champ"
                    value={fromWarehouseId}
                    onChange={(e) => {
                      setFromWarehouseId(e.target.value);
                      setLignes([]);
                    }}
                  >
                    <option value="">Choisir une boutique</option>
                    {boutiquesActives.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="t-to">Boutique destination</label>
                <select
                  id="t-to"
                  className="champ"
                  value={toWarehouseId}
                  onChange={(e) => setToWarehouseId(e.target.value)}
                  disabled={!fromWarehouseId}
                >
                  <option value="">Choisir une boutique</option>
                  {boutiquesDestination.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div className="champ-groupe">
                <label className="etiquette">Articles</label>
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
                        <option key={p.id} value={p.id}>{p.name} ({p.quantity_in_stock} en stock)</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      className="champ"
                      style={{ width: 90 }}
                      placeholder="Qté"
                      value={ligne.quantity}
                      onChange={(e) => modifierLigne(index, 'quantity', e.target.value)}
                    />
                    <button type="button" className="btn" onClick={() => retirerLigne(index)}>×</button>
                  </div>
                ))}
                <button type="button" className="btn" onClick={ajouterLigne} disabled={!fromWarehouseId}>
                  + Ajouter un article
                </button>
              </div>

              <div className="champ-groupe">
                <label className="etiquette" htmlFor="t-notes">Notes (facultatif)</label>
                <input id="t-notes" className="champ" value={notes} onChange={(e) => setNotes(e.target.value)} />
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

      {detailOuvert && (
        <div className="modale-fond" onClick={() => setDetailOuvert(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Transfert {detailOuvert.from_warehouse_name} → {detailOuvert.to_warehouse_name}</h2>
            <p style={{ marginBottom: 12 }}><BadgeStatutTransfert statut={detailOuvert.status} /></p>
            {detailOuvert.notes && <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 12 }}>{detailOuvert.notes}</p>}
            <table className="tableau">
              <thead>
                <tr><th>Produit</th><th>Quantité</th></tr>
              </thead>
              <tbody>
                {(detailOuvert.items || []).map((item) => (
                  <tr key={item.id}>
                    <td>{item.product_name}</td>
                    <td>{item.quantity}{item.is_weighted ? ' kg' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="actions-modale">
              <button type="button" className="btn" onClick={() => setDetailOuvert(null)}>Fermer</button>
              {peutAnnuler(detailOuvert) && (
                <button type="button" className="btn btn-brique" onClick={() => handleCancel(detailOuvert)}>Annuler ce transfert</button>
              )}
              {peutReceptionner(detailOuvert) && (
                <button type="button" className="btn btn-principal" onClick={() => handleReceive(detailOuvert)}>Réceptionner</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
