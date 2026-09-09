import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { ComptageTab } from './ComptageTab';

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

function codeInterne(product) {
  return product.sku || product.id.slice(0, 6).toUpperCase();
}

function telechargerCsv(nomFichier, lignes) {
  const contenu = lignes.map((ligne) => ligne.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + contenu], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function StockPage() {
  const { user } = useAuth();
  const peutGerer = ROLES_GESTION.includes(user.role);
  const [searchParams] = useSearchParams();

  const [onglet, setOnglet] = useState('catalogue');
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [recherche, setRecherche] = useState(searchParams.get('q') || '');
  const [filtreStatut, setFiltreStatut] = useState('tous');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouveauProduit, setNouveauProduit] = useState({ name: '', sku: '', unitPrice: '', quantityInStock: '', quantityAlertThreshold: '5' });
  const [modalePrixOuverte, setModalePrixOuverte] = useState(false);
  const [prixModifies, setPrixModifies] = useState({});
  const [augmentationGlobale, setAugmentationGlobale] = useState('');
  const [enregistrementPrix, setEnregistrementPrix] = useState(false);
  const [modaleEntreeOuverte, setModaleEntreeOuverte] = useState(false);
  const [entreeStock, setEntreeStock] = useState({ productId: '', quantity: '', supplierId: '', movementDate: new Date().toISOString().slice(0, 10) });
  const [enregistrementEntree, setEnregistrementEntree] = useState(false);

  function charger() {
    setChargement(true);
    Promise.all([api.getProducts(), api.getSuppliers().catch(() => [])])
      .then(([p, s]) => {
        setProducts(p);
        setSuppliers(s);
      })
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

  async function handleEntreeStock(e) {
    e.preventDefault();
    if (!entreeStock.productId || !Number(entreeStock.quantity)) {
      setErreur('Choisissez un produit et une quantité.');
      return;
    }
    setEnregistrementEntree(true);
    try {
      await api.recordStockMovement(entreeStock.productId, {
        movementType: 'entree',
        quantity: Number(entreeStock.quantity),
        supplierId: entreeStock.supplierId || undefined,
        movementDate: entreeStock.movementDate || undefined,
        reason: 'Réapprovisionnement',
      });
      setModaleEntreeOuverte(false);
      setEntreeStock({ productId: '', quantity: '', supplierId: '', movementDate: new Date().toISOString().slice(0, 10) });
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementEntree(false);
    }
  }

  function handleExportCsv() {
    const lignes = [
      ['Nom', 'Référence', 'Prix unitaire', 'Quantité en stock', 'Statut'],
      ...produitsFiltres.map((p) => [p.name, codeInterne(p), p.unit_price, p.quantity_in_stock, p.status]),
    ];
    telechargerCsv(`produits-${new Date().toISOString().slice(0, 10)}.csv`, lignes);
  }

  function ouvrirRevisionPrix() {
    setPrixModifies(Object.fromEntries(products.map((p) => [p.id, p.unit_price])));
    setAugmentationGlobale('');
    setModalePrixOuverte(true);
  }

  function appliquerAugmentationGlobale() {
    const pourcentage = Number(augmentationGlobale);
    if (!pourcentage) return;
    setPrixModifies((prev) => {
      const copie = { ...prev };
      products.forEach((p) => {
        copie[p.id] = Math.round(Number(p.unit_price) * (1 + pourcentage / 100));
      });
      return copie;
    });
  }

  async function handleEnregistrerPrix() {
    setEnregistrementPrix(true);
    try {
      const changements = products.filter((p) => Number(prixModifies[p.id]) !== Number(p.unit_price));
      await Promise.all(changements.map((p) => api.updateProduct(p.id, { unitPrice: Number(prixModifies[p.id]) })));
      setModalePrixOuverte(false);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementPrix(false);
    }
  }

  return (
    <>
      <div className="entete-page">
        <h1>Produits</h1>
        {peutGerer && onglet === 'catalogue' && (
          <button className="btn btn-principal" onClick={() => setModaleOuverte(true)}>
            Nouveau produit
          </button>
        )}
      </div>

      <div className="onglets">
        <button className={onglet === 'catalogue' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('catalogue')}>
          Catalogue produits
        </button>
        {peutGerer && (
          <button className={onglet === 'comptage' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('comptage')}>
            Comptage
          </button>
        )}
        <button className={onglet === 'etiquettes' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('etiquettes')}>
          Étiquettes
        </button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {onglet === 'catalogue' && (
        <>
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
            <button className="btn" onClick={handleExportCsv}>Exporter CSV</button>
            {peutGerer && <button className="btn" onClick={() => setModaleEntreeOuverte(true)}>Entrée de stock</button>}
            {peutGerer && <button className="btn" onClick={ouvrirRevisionPrix}>Réviser les prix</button>}
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
                  <p className="carte-produit-sku">{codeInterne(p)}</p>
                  <p className="carte-produit-prix">{Math.round(p.unit_price).toLocaleString('fr-FR')} FCFA</p>
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
        </>
      )}

      {onglet === 'comptage' && peutGerer && <ComptageTab />}

      {onglet === 'etiquettes' && (
        <>
          <div className="barre-outils no-print">
            <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{products.length} étiquette(s)</span>
            <button className="btn btn-principal" onClick={() => window.print()}>Imprimer</button>
          </div>
          <div className="grille-etiquettes">
            {products.map((p) => (
              <div key={p.id} className="etiquette-produit">
                <p className="etiquette-nom">{p.name}</p>
                <p className="etiquette-prix">{Math.round(p.unit_price).toLocaleString('fr-FR')} FCFA</p>
                <p className="etiquette-code">{codeInterne(p)}</p>
              </div>
            ))}
          </div>
        </>
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
                  placeholder="RIZ-25 (généré automatiquement sinon)"
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
                <button type="button" className="btn" onClick={() => setModaleOuverte(false)}>Annuler</button>
                <button type="submit" className="btn btn-principal">Ajouter</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalePrixOuverte && (
        <div className="modale-fond" onClick={() => setModalePrixOuverte(false)}>
          <div className="modale" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>Réviser les prix</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                type="number"
                className="champ"
                placeholder="% d'augmentation globale"
                value={augmentationGlobale}
                onChange={(e) => setAugmentationGlobale(e.target.value)}
              />
              <button type="button" className="btn" onClick={appliquerAugmentationGlobale}>Appliquer</button>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {products.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{p.name}</span>
                  <input
                    type="number"
                    className="champ"
                    style={{ width: 110 }}
                    value={prixModifies[p.id] ?? p.unit_price}
                    onChange={(e) => setPrixModifies({ ...prixModifies, [p.id]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <div className="actions-modale">
              <button type="button" className="btn" onClick={() => setModalePrixOuverte(false)}>Annuler</button>
              <button type="button" className="btn btn-principal" onClick={handleEnregistrerPrix} disabled={enregistrementPrix}>
                {enregistrementPrix ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
      {modaleEntreeOuverte && (
        <div className="modale-fond" onClick={() => setModaleEntreeOuverte(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Entrée de stock</h2>
            <form onSubmit={handleEntreeStock}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="e-produit">Produit</label>
                <select
                  id="e-produit"
                  className="champ"
                  value={entreeStock.productId}
                  onChange={(e) => setEntreeStock({ ...entreeStock, productId: e.target.value })}
                >
                  <option value="">Choisir un produit</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="e-qte">Quantité achetée</label>
                <input
                  id="e-qte"
                  type="number"
                  min="1"
                  className="champ"
                  value={entreeStock.quantity}
                  onChange={(e) => setEntreeStock({ ...entreeStock, quantity: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="e-fournisseur">Fournisseur (facultatif)</label>
                <select
                  id="e-fournisseur"
                  className="champ"
                  value={entreeStock.supplierId}
                  onChange={(e) => setEntreeStock({ ...entreeStock, supplierId: e.target.value })}
                >
                  <option value="">Non renseigné</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="e-date">Date de réception</label>
                <input
                  id="e-date"
                  type="date"
                  className="champ"
                  value={entreeStock.movementDate}
                  onChange={(e) => setEntreeStock({ ...entreeStock, movementDate: e.target.value })}
                />
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setModaleEntreeOuverte(false)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={enregistrementEntree}>
                  {enregistrementEntree ? 'Enregistrement…' : 'Ajouter au stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
