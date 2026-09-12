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
  const [conditionnements, setConditionnements] = useState([]);
  const [modalePrixOuverte, setModalePrixOuverte] = useState(false);
  const [prixModifies, setPrixModifies] = useState({});
  const [augmentationGlobale, setAugmentationGlobale] = useState('');
  const [enregistrementPrix, setEnregistrementPrix] = useState(false);
  const [modaleEntreeOuverte, setModaleEntreeOuverte] = useState(false);
  const [entreeStock, setEntreeStock] = useState({
    productId: '',
    quantity: '',
    supplierId: '',
    movementDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'comptant',
    totalCost: '',
  });
  const [enregistrementEntree, setEnregistrementEntree] = useState(false);
  const [modaleFournisseurRapide, setModaleFournisseurRapide] = useState(false);
  const [nouveauFournisseurRapide, setNouveauFournisseurRapide] = useState({ name: '', phone: '' });
  const [produitEnEdition, setProduitEnEdition] = useState(null);
  const [enregistrementEdition, setEnregistrementEdition] = useState(false);

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

  function ajouterConditionnement() {
    setConditionnements([...conditionnements, { label: '', price: '', quantityPerUnit: '' }]);
  }

  function modifierConditionnement(index, champ, valeur) {
    const copie = [...conditionnements];
    copie[index] = { ...copie[index], [champ]: valeur };
    setConditionnements(copie);
  }

  function retirerConditionnement(index) {
    setConditionnements(conditionnements.filter((_, i) => i !== index));
  }

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
        units: conditionnements
          .filter((c) => c.label && Number(c.price) && Number(c.quantityPerUnit))
          .map((c) => ({ label: c.label, price: Number(c.price), quantityPerUnit: Number(c.quantityPerUnit) })),
      });
      setModaleOuverte(false);
      setNouveauProduit({ name: '', sku: '', unitPrice: '', quantityInStock: '', quantityAlertThreshold: '5' });
      setConditionnements([]);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimer(product) {
    if (!window.confirm(`Retirer "${product.name}" du catalogue ?`)) return;
    try {
      await api.deleteProduct(product.id);
      setProduitEnEdition(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  function ouvrirEdition(product) {
    setProduitEnEdition({
      id: product.id,
      name: product.name,
      sku: product.sku || '',
      unitPrice: product.unit_price,
      quantityAlertThreshold: product.quantity_alert_threshold,
    });
  }

  async function handleEnregistrerEdition(e) {
    e.preventDefault();
    setEnregistrementEdition(true);
    try {
      await api.updateProduct(produitEnEdition.id, {
        name: produitEnEdition.name,
        sku: produitEnEdition.sku || undefined,
        unitPrice: Number(produitEnEdition.unitPrice),
        quantityAlertThreshold: Number(produitEnEdition.quantityAlertThreshold),
      });
      setProduitEnEdition(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementEdition(false);
    }
  }

  async function handleEntreeStock(e) {
    e.preventDefault();
    if (!entreeStock.productId || !Number(entreeStock.quantity)) {
      setErreur('Choisissez un produit et une quantité.');
      return;
    }
    if (entreeStock.paymentMethod === 'a_credit' && (!entreeStock.supplierId || !Number(entreeStock.totalCost))) {
      setErreur('Une entrée à crédit nécessite un fournisseur et le montant total de l\'achat.');
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
        paymentMethod: entreeStock.paymentMethod,
        totalCost: entreeStock.totalCost ? Number(entreeStock.totalCost) : undefined,
      });
      setModaleEntreeOuverte(false);
      setEntreeStock({
        productId: '',
        quantity: '',
        supplierId: '',
        movementDate: new Date().toISOString().slice(0, 10),
        paymentMethod: 'comptant',
        totalCost: '',
      });
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementEntree(false);
    }
  }

  async function handleCreationRapideFournisseur(e) {
    e.preventDefault();
    if (!nouveauFournisseurRapide.name) {
      setErreur('Le nom du fournisseur est requis.');
      return;
    }
    try {
      const fournisseur = await api.createSupplier(nouveauFournisseurRapide);
      setSuppliers((prev) => [...prev, fournisseur].sort((a, b) => a.name.localeCompare(b.name)));
      setEntreeStock((prev) => ({ ...prev, supplierId: fournisseur.id }));
      setModaleFournisseurRapide(false);
      setNouveauFournisseurRapide({ name: '', phone: '' });
    } catch (err) {
      setErreur(err.message);
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
          <button
            className="btn btn-principal"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, boxShadow: '0 6px 16px -6px var(--accent)', fontWeight: 600 }}
            onClick={() => setModaleOuverte(true)}
          >
            <IconPlus />
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
            <div
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
            <button className="btn" onClick={handleExportCsv}>Exporter CSV</button>
            <button className="btn" onClick={() => api.downloadProductsPdf().catch((err) => setErreur(err.message))}>Exporter PDF</button>
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
                  {peutGerer && (
                    <div className="carte-produit-actions">
                      <button
                        className="btn"
                        style={{ flex: 1, justifyContent: 'center', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        onClick={() => ouvrirEdition(p)}
                      >
                        <IconModifier />
                        Modifier
                      </button>
                    </div>
                  )}
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
                <label className="etiquette" htmlFor="p-price">Prix au détail (FCFA)</label>
                <input
                  id="p-price"
                  type="number"
                  className="champ"
                  value={nouveauProduit.unitPrice}
                  onChange={(e) => setNouveauProduit({ ...nouveauProduit, unitPrice: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="p-qty">Quantité initiale (unités de base)</label>
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

              <label className="etiquette" style={{ marginTop: 4 }}>
                Vente en gros (facultatif) — cartons, packs, etc.
              </label>
              {conditionnements.map((c, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input
                    className="champ"
                    placeholder="Ex: Carton"
                    value={c.label}
                    onChange={(e) => modifierConditionnement(index, 'label', e.target.value)}
                  />
                  <input
                    type="number"
                    className="champ"
                    style={{ width: 90 }}
                    placeholder="Prix"
                    value={c.price}
                    onChange={(e) => modifierConditionnement(index, 'price', e.target.value)}
                  />
                  <input
                    type="number"
                    className="champ"
                    style={{ width: 90 }}
                    placeholder="Contient"
                    value={c.quantityPerUnit}
                    onChange={(e) => modifierConditionnement(index, 'quantityPerUnit', e.target.value)}
                  />
                  <button type="button" className="btn" onClick={() => retirerConditionnement(index)}>×</button>
                </div>
              ))}
              <button type="button" className="btn" onClick={ajouterConditionnement} style={{ marginBottom: 16 }}>
                + Ajouter un conditionnement
              </button>

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
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    id="e-fournisseur"
                    className="champ"
                    style={{ flex: 1 }}
                    value={entreeStock.supplierId}
                    onChange={(e) => setEntreeStock({ ...entreeStock, supplierId: e.target.value })}
                  >
                    <option value="">Non renseigné</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <button type="button" className="btn" onClick={() => setModaleFournisseurRapide(true)}>
                    + Nouveau
                  </button>
                </div>
                {(() => {
                  const fournisseurChoisi = suppliers.find((s) => String(s.id) === String(entreeStock.supplierId));
                  if (!fournisseurChoisi || !(Number(fournisseurChoisi.debt) > 0)) return null;
                  return (
                    <p style={{ fontSize: 13, color: 'var(--brique, #b3423a)', marginTop: 6 }}>
                      Dette actuelle envers {fournisseurChoisi.name} : {Math.round(fournisseurChoisi.debt).toLocaleString('fr-FR')} FCFA
                    </p>
                  );
                })()}
              </div>
              <div className="champ-groupe">
                <label className="etiquette">Paiement de cet achat</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      flex: 1,
                      justifyContent: 'center',
                      background: entreeStock.paymentMethod === 'comptant' ? 'var(--accent)' : undefined,
                      color: entreeStock.paymentMethod === 'comptant' ? '#fff' : undefined,
                    }}
                    onClick={() => setEntreeStock({ ...entreeStock, paymentMethod: 'comptant' })}
                  >
                    Au comptant
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      flex: 1,
                      justifyContent: 'center',
                      background: entreeStock.paymentMethod === 'a_credit' ? 'var(--accent)' : undefined,
                      color: entreeStock.paymentMethod === 'a_credit' ? '#fff' : undefined,
                    }}
                    onClick={() => setEntreeStock({ ...entreeStock, paymentMethod: 'a_credit' })}
                  >
                    À crédit
                  </button>
                </div>
              </div>
              {entreeStock.paymentMethod === 'a_credit' && (
                <div className="champ-groupe">
                  <label className="etiquette" htmlFor="e-montant">Montant total de l'achat (FCFA)</label>
                  <input
                    id="e-montant"
                    type="number"
                    className="champ"
                    value={entreeStock.totalCost}
                    onChange={(e) => setEntreeStock({ ...entreeStock, totalCost: e.target.value })}
                  />
                </div>
              )}
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

      {modaleFournisseurRapide && (
        <div className="modale-fond" onClick={() => setModaleFournisseurRapide(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Nouveau fournisseur</h2>
            <form onSubmit={handleCreationRapideFournisseur}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="fr-name">Nom</label>
                <input
                  id="fr-name"
                  className="champ"
                  value={nouveauFournisseurRapide.name}
                  onChange={(e) => setNouveauFournisseurRapide({ ...nouveauFournisseurRapide, name: e.target.value })}
                  placeholder="Grossiste Baol"
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="fr-phone">Téléphone (facultatif)</label>
                <input
                  id="fr-phone"
                  className="champ"
                  value={nouveauFournisseurRapide.phone}
                  onChange={(e) => setNouveauFournisseurRapide({ ...nouveauFournisseurRapide, phone: e.target.value })}
                />
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setModaleFournisseurRapide(false)}>Annuler</button>
                <button type="submit" className="btn btn-principal">Créer et sélectionner</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {produitEnEdition && (
        <div className="modale-fond" onClick={() => setProduitEnEdition(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Modifier le produit</h2>
            <form onSubmit={handleEnregistrerEdition}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="pe-name">Nom du produit</label>
                <input
                  id="pe-name"
                  className="champ"
                  value={produitEnEdition.name}
                  onChange={(e) => setProduitEnEdition({ ...produitEnEdition, name: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="pe-sku">Référence / code</label>
                <input
                  id="pe-sku"
                  className="champ"
                  value={produitEnEdition.sku}
                  onChange={(e) => setProduitEnEdition({ ...produitEnEdition, sku: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="pe-price">Prix au détail (FCFA)</label>
                <input
                  id="pe-price"
                  type="number"
                  className="champ"
                  value={produitEnEdition.unitPrice}
                  onChange={(e) => setProduitEnEdition({ ...produitEnEdition, unitPrice: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="pe-alert">Seuil d'alerte</label>
                <input
                  id="pe-alert"
                  type="number"
                  className="champ"
                  value={produitEnEdition.quantityAlertThreshold}
                  onChange={(e) => setProduitEnEdition({ ...produitEnEdition, quantityAlertThreshold: e.target.value })}
                />
              </div>

              <div className="actions-modale" style={{ justifyContent: user.role === 'manager' ? 'space-between' : 'flex-end' }}>
                {user.role === 'manager' && (
                  <button
                    type="button"
                    className="btn btn-brique"
                    onClick={() => handleSupprimer(produitEnEdition)}
                  >
                    Supprimer ce produit
                  </button>
                )}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" className="btn" onClick={() => setProduitEnEdition(null)}>Annuler</button>
                  <button type="submit" className="btn btn-principal" disabled={enregistrementEdition}>
                    {enregistrementEdition ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
