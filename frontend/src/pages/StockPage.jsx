import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';

const ROLES_GESTION = ['manager', 'gerant'];
const FILTRES_STATUT = [
  { value: 'tous', label: 'Tous statuts' },
  { value: 'en_stock', label: 'En stock' },
  { value: 'faible', label: 'Faible' },
  { value: 'rupture', label: 'Rupture' },
];

function IconBoite() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
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

export function StockPage() {
  const { user } = useAuth();
  const peutGerer = ROLES_GESTION.includes(user.role);
  const [searchParams] = useSearchParams();

  const [products, setProducts] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [recherche, setRecherche] = useState(searchParams.get('q') || '');
  const [filtreStatut, setFiltreStatut] = useState('tous');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouveauProduit, setNouveauProduit] = useState({ name: '', sku: '', unitPrice: '', quantityInStock: '', quantityAlertThreshold: '5' });

  function charger() {
    setChargement(true);
    api
      .getProducts()
      .then(setProducts)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  const produitsFiltres = useMemo(() => {
    return products.filter((p) => {
      const correspondRecherche = p.name.toLowerCase().includes(recherche.toLowerCase()) ||
        (p.sku || '').toLowerCase().includes(recherche.toLowerCase());
      const correspondStatut = filtreStatut === 'tous' || p.status === filtreStatut;
      return correspondRecherche && correspondStatut;
    });
  }, [products, recherche, filtreStatut]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!nouveauProduit.name) {
      setErreur('Le nom du produit est requis.');
      return;
    }
    try {
      await api.createProduct({
        name: nouveauProduit.name,
        sku: nouveauProduit.sku || undefined,
        unitPrice: Number(nouveauProduit.unitPrice) || 0,
        quantityInStock: Number(nouveauProduit.quantityInStock) || 0,
        quantityAlertThreshold: Number(nouveauProduit.quantityAlertThreshold) || 5,
      });
      setModaleOuverte(false);
      setNouveauProduit({ name: '', sku: '', unitPrice: '', quantityInStock: '', quantityAlertThreshold: '5' });
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
        <h1>Produits</h1>
        {peutGerer && (
          <button className="btn btn-principal" onClick={() => setModaleOuverte(true)}>
            Nouveau produit
          </button>
        )}
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-filtres">
        <div className="champ-avec-icone champ-avec-icone--pleine-largeur">
          <span className="champ-icone"><IconRecherche /></span>
          <input
            type="text"
            className="champ champ--avec-icone"
            placeholder="Rechercher par nom ou référence…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <select className="champ" style={{ width: 'auto' }} value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)}>
          {FILTRES_STATUT.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : produitsFiltres.length === 0 ? (
        <p className="etat-vide">
          {products.length === 0 ? 'Aucun produit enregistré. Ajoutez votre premier produit pour démarrer.' : 'Aucun produit ne correspond à ces filtres.'}
        </p>
      ) : (
        <div className="grille-produits">
          {produitsFiltres.map((p) => (
            <div key={p.id} className="carte-produit">
              <div className="carte-produit-entete">
                <span className="carte-produit-icone"><IconBoite /></span>
                <StatusBadge status={p.status} />
              </div>
              <p className="carte-produit-nom">{p.name}</p>
              {p.sku && <p className="carte-produit-sku">{p.sku}</p>}
              <p className="carte-produit-prix">{Number(p.unit_price).toLocaleString('fr-FR')} FCFA</p>
              <p className="carte-produit-stock">{p.quantity_in_stock} en stock</p>
              <div className="carte-produit-actions">
                <button className="btn" style={{ flex: 1, justifyContent: 'center', fontSize: 13 }} onClick={() => handleVente(p)}>
                  Vendre
                </button>
                {peutGerer && (
                  <button className="btn" style={{ fontSize: 13 }} onClick={() => handleSupprimer(p)}>
                    Retirer
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Nouveau produit</h2>
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
                <label className="etiquette" htmlFor="p-sku">Référence / code (facultatif)</label>
                <input
                  id="p-sku"
                  className="champ"
                  value={nouveauProduit.sku}
                  onChange={(e) => setNouveauProduit({ ...nouveauProduit, sku: e.target.value })}
                  placeholder="RIZ-25"
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
