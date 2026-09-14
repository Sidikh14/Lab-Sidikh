import { useEffect, useState } from 'react';
import { api } from '../api/client';

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
  const [commandes, setCommandes] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [lignes, setLignes] = useState([{ productId: '', quantity: 1, unitCost: '' }]);

  function charger() {
    setChargement(true);
    Promise.all([api.getPurchaseOrders(), api.getSuppliers(), api.getProducts()])
      .then(([po, s, p]) => {
        setCommandes(po);
        setSuppliers(s);
        setProducts(p);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

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
      await api.createPurchaseOrder({ supplierId, items, notes });
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

  return (
    <>
      <div className="entete-page">
        <h1>Commandes fournisseurs</h1>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-outils">
        <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{commandes.length} commande(s)</span>
        <button className="btn btn-principal" onClick={() => setModaleOuverte(true)} disabled={suppliers.length === 0}>
          Nouvelle commande
        </button>
      </div>

      {suppliers.length === 0 && !chargement && (
        <p className="etat-vide">Ajoutez d'abord un fournisseur avant de créer une commande.</p>
      )}

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : commandes.length === 0 ? (
        suppliers.length > 0 && <p className="etat-vide">Aucune commande fournisseur pour le moment.</p>
      ) : (
        <div className="liste-a-encaisser">
          {commandes.map((c) => (
            <div key={c.id} className="carte-a-encaisser">
              <span className="stat-icone" style={{ ...COULEUR_STATUT[c.status], width: 36, height: 36, flexShrink: 0 }}>
                <IconBonAchat />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="carte-a-encaisser-numero">{c.supplier_name}</p>
                <p className="carte-a-encaisser-client">{Number(c.total_amount).toLocaleString('fr-FR')} FCFA</p>
              </div>
              <select
                className="champ"
                style={{ width: 'auto', padding: '5px 8px', fontSize: 13 }}
                value={c.status}
                onChange={(e) => handleStatut(c, e.target.value)}
              >
                {STATUTS.map((s) => (
                  <option key={s} value={s}>{LABEL_STATUT[s]}</option>
                ))}
              </select>
              <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => handlePdf(c)}>
                PDF
              </button>
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
                <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
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
              <button type="button" className="btn" onClick={ajouterLigne} style={{ marginBottom: 16 }}>
                Ajouter un article
              </button>

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
