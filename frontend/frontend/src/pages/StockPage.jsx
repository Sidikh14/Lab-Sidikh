import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';

const ROLES_GESTION = ['manager', 'gerant'];

export function StockPage() {
  const { user } = useAuth();
  const peutGerer = ROLES_GESTION.includes(user.role);

  const [products, setProducts] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouveauProduit, setNouveauProduit] = useState({ name: '', unitPrice: '', quantityInStock: '', quantityAlertThreshold: '5' });

  function charger() {
    setChargement(true);
    api
      .getProducts()
      .then(setProducts)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!nouveauProduit.name) {
      setErreur('Le nom du produit est requis.');
      return;
    }
    try {
      await api.createProduct({
        name: nouveauProduit.name,
        unitPrice: Number(nouveauProduit.unitPrice) || 0,
        quantityInStock: Number(nouveauProduit.quantityInStock) || 0,
        quantityAlertThreshold: Number(nouveauProduit.quantityAlertThreshold) || 5,
      });
      setModaleOuverte(false);
      setNouveauProduit({ name: '', unitPrice: '', quantityInStock: '', quantityAlertThreshold: '5' });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleVente(product) {
    const saisie = window.prompt(`Quantité vendue pour "${product.name}" ?`, '1');
    if (!saisie) return;
    const quantite = Number(saisie);
    if (!Number.isInteger(quantite) || quantite <= 0) {
      setErreur('Quantité invalide.');
      return;
    }
    try {
      await api.recordStockMovement(product.id, { movementType: 'sortie', quantity: quantite, reason: 'Vente comptoir' });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimer(product) {
    if (!window.confirm(`Retirer "${product.name}" du catalogue ?`)) return;
    try {
      await api.deleteProduct(product.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <>
      <div className="entete-page">
        <h1>Stock</h1>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-outils">
        <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{products.length} référence(s)</span>
        {peutGerer && (
          <button className="btn btn-principal" onClick={() => setModaleOuverte(true)}>
            Ajouter un produit
          </button>
        )}
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : products.length === 0 ? (
        <p className="etat-vide">Aucun produit enregistré. Ajoutez votre premier produit pour démarrer.</p>
      ) : (
        <table className="registre">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Quantité</th>
              <th>Prix unitaire</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="chiffre">{p.quantity_in_stock}</td>
                <td className="chiffre">{Number(p.unit_price).toLocaleString('fr-FR')} FCFA</td>
                <td><StatusBadge status={p.status} /></td>
                <td>
                  <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => handleVente(p)}>
                    Vendre
                  </button>{' '}
                  {peutGerer && (
                    <button
                      className="btn"
                      style={{ padding: '5px 10px', fontSize: 13 }}
                      onClick={() => handleSupprimer(p)}
                    >
                      Retirer
                    </button>
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
            <h2>Ajouter un produit</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="p-name">Nom du produit</label>
                <input
                  id="p-name"
                  className="champ"
                  value={nouveauProduit.name}
                  onChange={(e) => setNouveauProduit({ ...nouveauProduit, name: e.target.value })}
                  placeholder="Riz brisé 25kg"
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="p-price">Prix unitaire (FCFA)</label>
                <input
                  id="p-price"
                  type="number"
                  className="champ"
                  value={nouveauProduit.unitPrice}
                  onChange={(e) => setNouveauProduit({ ...nouveauProduit, unitPrice: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="p-qty">Quantité initiale</label>
                <input
                  id="p-qty"
                  type="number"
                  className="champ"
                  value={nouveauProduit.quantityInStock}
                  onChange={(e) => setNouveauProduit({ ...nouveauProduit, quantityInStock: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="p-alert">Seuil d'alerte</label>
                <input
                  id="p-alert"
                  type="number"
                  className="champ"
                  value={nouveauProduit.quantityAlertThreshold}
                  onChange={(e) => setNouveauProduit({ ...nouveauProduit, quantityAlertThreshold: e.target.value })}
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
