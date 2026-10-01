import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StylesModernes } from '../components/StylesModernes';

const STATUTS = ['envoyee', 'recue', 'annulee'];
const LABEL_STATUT = { envoyee: 'Envoyée', recue: 'Reçue', annulee: 'Annulée' };
const COULEUR_STATUT = {
  envoyee: { background: 'var(--accent-clair)', color: 'var(--accent)' },
  recue: { background: 'var(--vif-clair, #d1fae5)', color: 'var(--vif, #059669)' },
  annulee: { background: 'var(--danger-clair)', color: 'var(--danger)' },
};

function IconBonAchat() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 4h13l3 3v13H4z" />
      <path d="M9 4v4H4" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

export function PurchaseOrdersPage() {
  const { user } = useAuth();
  const estManager = user.role === 'manager';

  const [commandes, setCommandes] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [filtreStatut, setFiltreStatut] = useState('tous');
  const [lignes, setLignes] = useState([{ productId: '', quantity: 1, unitCost: '' }]);

  // Boutique active — même sélecteur/clé localStorage que les autres pages.
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState(() => (estManager ? localStorage.getItem('boutiqueActiveId') || '' : ''));
  const [chargementBoutiques, setChargementBoutiques] = useState(estManager);
  const activeWarehouseId = estManager ? warehouseId : user.warehouseId;

  useEffect(() => {
    if (!estManager) return;
    api.getWarehouses()
      .then((liste) => {
        setWarehouses(liste);
        const actives = liste.filter((w) => w.is_active);
        setWarehouseId((avant) => {
          if (avant && actives.some((w) => w.id === avant)) return avant;
          return actives[0]?.id || '';
        });
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementBoutiques(false));
  }, [estManager]);

  useEffect(() => {
    if (estManager && warehouseId) localStorage.setItem('boutiqueActiveId', warehouseId);
  }, [estManager, warehouseId]);

  function charger() {
    if (!activeWarehouseId) return;
    setChargement(true);
    Promise.all([api.getPurchaseOrders(activeWarehouseId), api.getSuppliers(), api.getProducts(activeWarehouseId)])
      .then(([po, s, p]) => {
        setCommandes(po);
        setSuppliers(s);
        setProducts(p);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, [activeWarehouseId]);

  function ajouterLigne() {
    setLignes([...lignes, { productId: '', quantity: 1, unitCost: '' }]);
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
    if (!supplierId) {
      setErreur('Choisissez un fournisseur.');
      return;
    }
    const items = lignes
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) || 0 }));

    if (items.length === 0) {
      setErreur('Ajoutez au moins un produit.');
      return;
    }

    try {
      await api.createPurchaseOrder({ supplierId, items, notes, warehouseId: activeWarehouseId });
      setModaleOuverte(false);
      setSupplierId('');
      setNotes('');
      setLignes([{ productId: '', quantity: 1, unitCost: '' }]);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleStatut(commande, status) {
    try {
      await api.updatePurchaseOrderStatus(commande.id, status);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handlePdf(commande) {
    try {
      await api.downloadPurchaseOrderPdf(commande.id);
    } catch (err) {
      setErreur(err.message);
    }
  }

  const commandesFiltrees = filtreStatut === 'tous' ? commandes : commandes.filter((c) => c.status === filtreStatut);
  const nbParStatut = (statut) => commandes.filter((c) => c.status === statut).length;
  const montantEngage = commandes
    .filter((c) => c.status !== 'annulee')
    .reduce((somme, c) => somme + Number(c.total_amount || 0), 0);
  const totalEstime = lignes.reduce((somme, l) => somme + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);

  return (
    <>
      <StylesModernes />
      <div className="entete-page">
        <h1>Commandes fournisseurs</h1>
        {estManager && warehouses.length > 0 && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px 5px 11px',
              borderRadius: 999,
              border: '1px solid var(--trait)',
              background: 'var(--accent-clair)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M3 9l1.5-5h15L21 9" />
              <path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
              <path d="M9 20v-6h6v6" />
            </svg>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--accent)',
                outline: 'none',
                cursor: 'pointer',
                appearance: 'none',
                WebkitAppearance: 'none',
                padding: 0,
                maxWidth: 130,
              }}
            >
              {warehouses.filter((w) => w.is_active).map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {estManager && !chargementBoutiques && warehouses.length === 0 && (
        <p className="etat-vide">Aucune boutique n'a encore été créée. Créez-en une avant de commander.</p>
      )}

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="md-kpis">
        <div className="md-kpi md-kpi--hero">
          <span className="md-kpi-icone"><IconBonAchat /></span>
          <p className="md-kpi-label">Montant engagé</p>
          <p className="md-kpi-valeur">{Math.round(montantEngage).toLocaleString('fr-FR')} <small>FCFA</small></p>
          <p className="md-kpi-sous">hors commandes annulées</p>
        </div>
        <div className="md-kpi">
          <span className="md-kpi-icone"><IconBonAchat /></span>
          <p className="md-kpi-label">Commandes</p>
          <p className="md-kpi-valeur">{commandes.length}</p>
        </div>
        <div className="md-kpi">
          <span className="md-kpi-icone"><IconBonAchat /></span>
          <p className="md-kpi-label">En attente de réception</p>
          <p className="md-kpi-valeur">{nbParStatut('envoyee')}</p>
        </div>
      </div>

      <div className="md-outils" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="md-puces">
          <button type="button" className={'md-puce' + (filtreStatut === 'tous' ? ' actif' : '')} onClick={() => setFiltreStatut('tous')}>
            Toutes <span>{commandes.length}</span>
          </button>
          {STATUTS.map((st) => (
            <button
              key={st}
              type="button"
              className={'md-puce' + (filtreStatut === st ? ' actif' : '')}
              onClick={() => setFiltreStatut(st)}
            >
              {LABEL_STATUT[st]} <span>{nbParStatut(st)}</span>
            </button>
          ))}
        </div>
        <button className="btn btn-principal" onClick={() => setModaleOuverte(true)} disabled={suppliers.length === 0 || !activeWarehouseId}>
          + Nouvelle commande
        </button>
      </div>

      {suppliers.length === 0 && !chargement && (
        <p className="etat-vide">Ajoutez d'abord un fournisseur avant de créer une commande.</p>
      )}

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : commandes.length === 0 ? (
        suppliers.length > 0 && <p className="etat-vide">Aucune commande fournisseur pour le moment.</p>
      ) : commandesFiltrees.length === 0 ? (
        <p className="etat-vide">Aucune commande avec ce statut.</p>
      ) : (
        <div className="md-liste">
          {commandesFiltrees.map((c) => (
            <div key={c.id} className={'md-ligne' + (c.status === 'envoyee' ? ' md-ligne--prioritaire' : '')}>
              <span className="md-avatar" style={COULEUR_STATUT[c.status]}>
                <IconBonAchat />
              </span>
              <div className="md-bloc">
                <p className="md-titre">{c.supplier_name}</p>
                <p className="md-sous">
                  {c.created_at ? `Créée le ${new Date(c.created_at).toLocaleDateString('fr-FR')}` : 'Commande fournisseur'}
                </p>
              </div>
              <div className="md-bloc md-bloc--montant">
                <p className="md-montant">{Math.round(Number(c.total_amount)).toLocaleString('fr-FR')} FCFA</p>
                <span className="tampon" style={COULEUR_STATUT[c.status]}>{LABEL_STATUT[c.status]}</span>
              </div>
              <div className="md-actions">
                <select
                  className="champ"
                  style={{ width: 'auto', padding: '5px 8px', fontSize: 13 }}
                  value={c.status}
                  onChange={(e) => handleStatut(c, e.target.value)}
                >
                  {STATUTS.map((st) => (
                    <option key={st} value={st}>{LABEL_STATUT[st]}</option>
                  ))}
                </select>
                <button className="btn" onClick={() => handlePdf(c)}>PDF</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle commande fournisseur</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="po-supplier">Fournisseur</label>
                <select
                  id="po-supplier"
                  className="champ"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">Choisir un fournisseur</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <label className="etiquette">Articles à commander</label>
              {lignes.map((ligne, index) => (
                <div
                  key={index}
                  style={{ display: 'flex', gap: 8, marginBottom: 8, padding: 8, borderRadius: 12, background: 'var(--fond, #f9fafb)', border: '1px solid var(--trait, #e5e7eb)' }}
                >
                  <select
                    className="champ"
                    value={ligne.productId}
                    onChange={(e) => modifierLigne(index, 'productId', e.target.value)}
                  >
                    <option value="">Produit</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    className="champ"
                    style={{ width: 70 }}
                    placeholder="Qté"
                    value={ligne.quantity}
                    onChange={(e) => modifierLigne(index, 'quantity', e.target.value)}
                  />
                  <input
                    type="number"
                    min="0"
                    className="champ"
                    style={{ width: 110 }}
                    placeholder="Coût unit."
                    value={ligne.unitCost}
                    onChange={(e) => modifierLigne(index, 'unitCost', e.target.value)}
                  />
                  {lignes.length > 1 && (
                    <button type="button" className="btn" onClick={() => retirerLigne(index)}>
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="btn" onClick={ajouterLigne} style={{ marginBottom: 12 }}>
                + Ajouter un article
              </button>

              {totalEstime > 0 && (
                <div className="md-carte" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', marginBottom: 16 }}>
                  <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>Total estimé</span>
                  <strong style={{ fontSize: 18 }}>{Math.round(totalEstime).toLocaleString('fr-FR')} FCFA</strong>
                </div>
              )}

              <div className="champ-groupe">
                <label className="etiquette" htmlFor="po-notes">Notes (facultatif)</label>
                <input
                  id="po-notes"
                  className="champ"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setModaleOuverte(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-principal">
                  Créer la commande
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
