import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';

const ROLES_VALIDATION = ['manager', 'gerant'];
const STATUTS = ['en_attente', 'validee', 'livree', 'annulee'];

export function OrdersPage() {
  const { user } = useAuth();
  const peutValider = ROLES_VALIDATION.includes(user.role);

  const [orders, setOrders] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [clientId, setClientId] = useState('');
  const [lignes, setLignes] = useState([{ productId: '', quantity: 1 }]);

  function charger() {
    setChargement(true);
    Promise.all([api.getOrders(), api.getClients(), api.getProducts()])
      .then(([o, c, p]) => {
        setOrders(o);
        setClients(c);
        setProducts(p);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  function ajouterLigne() {
    setLignes([...lignes, { productId: '', quantity: 1 }]);
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
    const items = lignes
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantity) }));

    if (items.length === 0) {
      setErreur('Ajoutez au moins un produit à la commande.');
      return;
    }

    try {
      await api.createOrder({ clientId: clientId || null, items });
      setModaleOuverte(false);
      setClientId('');
      setLignes([{ productId: '', quantity: 1 }]);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleStatut(order, status) {
    try {
      await api.updateOrderStatus(order.id, status);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <>
      <div className="entete-page">
        <h1>Commandes</h1>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-outils">
        <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{orders.length} commande(s)</span>
        <button className="btn btn-principal" onClick={() => setModaleOuverte(true)}>
          Nouvelle vente
        </button>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : orders.length === 0 ? (
        <p className="etat-vide">Aucune commande enregistrée pour le moment.</p>
      ) : (
        <table className="registre">
          <thead>
            <tr>
              <th>Client</th>
              <th>Montant</th>
              <th>Statut</th>
              {peutValider && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{o.client_name || 'Client de passage'}</td>
                <td className="chiffre">{Number(o.total_amount).toLocaleString('fr-FR')} FCFA</td>
                <td><StatusBadge status={o.status} /></td>
                {peutValider && (
                  <td>
                    <select
                      className="champ"
                      style={{ width: 'auto', padding: '5px 8px', fontSize: 13 }}
                      value={o.status}
                      onChange={(e) => handleStatut(o, e.target.value)}
                    >
                      {STATUTS.map((s) => (
                        <option key={s} value={s}>{s.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle vente</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="o-client">Client (facultatif)</label>
                <select
                  id="o-client"
                  className="champ"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                >
                  <option value="">Client de passage</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name}</option>
                  ))}
                </select>
              </div>

              <label className="etiquette">Articles</label>
              {lignes.map((ligne, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select
                    className="champ"
                    value={ligne.productId}
                    onChange={(e) => modifierLigne(index, 'productId', e.target.value)}
                  >
                    <option value="">Choisir un produit</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    className="champ"
                    style={{ width: 80 }}
                    value={ligne.quantity}
                    onChange={(e) => modifierLigne(index, 'quantity', e.target.value)}
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

              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setModaleOuverte(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-principal">
                  Enregistrer la vente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
