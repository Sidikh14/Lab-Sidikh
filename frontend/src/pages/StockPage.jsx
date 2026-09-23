import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { ComptageTab } from './ComptageTab';
import { getSecteurConfig } from '../config/sectorConfig';

const ROLES_GESTION = ['manager', 'gerant'];
// Seuil d'alerte suggéré (pas imposé) quand la case "Produit vital" est
// cochée — reste librement modifiable ensuite par le pharmacien/gérant.
const SEUIL_ALERTE_VITAL_SUGGERE = 20;
const FILTRES_STATUT = [
  { value: 'tous', label: 'Tous statuts' },
  { value: 'en_stock', label: 'En stock' },
  { value: 'faible', label: 'Faible' },
  { value: 'rupture', label: 'Rupture' },
  { value: 'a_activer', label: 'À activer' },
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

function IconGrille() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="8" height="8" rx="1.3" />
      <rect x="13" y="3" width="8" height="8" rx="1.3" />
      <rect x="3" y="13" width="8" height="8" rx="1.3" />
      <rect x="13" y="13" width="8" height="8" rx="1.3" />
    </svg>
  );
}

function IconListe() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1.4" fill="currentColor" stroke="none" />
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

function IconImprimante() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9V3h12v6" />
      <rect x="4" y="9" width="16" height="9" rx="1.5" />
      <path d="M6 14h12v7H6z" />
    </svg>
  );
}

function codeInterne(product) {
  return product.sku || product.id.slice(0, 6).toUpperCase();
}

// CODE128 accepte lettres + chiffres, donc marche aussi bien avec un SKU
// personnalisé qu'avec le code auto-généré (6 premiers caractères de l'id).
function CodeBarreEtiquette({ valeur }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current || !valeur) return;
    try {
      JsBarcode(svgRef.current, valeur, {
        format: 'CODE128',
        width: 2,
        height: 45,
        fontSize: 12,
        margin: 10,
        displayValue: true,
      });
    } catch {
      // valeur non encodable (cas limite) : on laisse le SVG vide plutôt que de casser la page
    }
  }, [valeur]);

  return <svg ref={svgRef} className="etiquette-code-barre" style={{ maxWidth: '100%', height: 'auto' }} />;
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
  const { user, merchant } = useAuth();
  const peutGerer = ROLES_GESTION.includes(user.role);
  const estManager = user.role === 'manager';
  const secteurConfig = getSecteurConfig(merchant?.sector);
  const estPharmacie = merchant?.sector === 'pharmacie';
  const estElectromenager = merchant?.sector === 'electromenager';
  const [categories, setCategories] = useState([]);
  const [searchParams] = useSearchParams();

  const [onglet, setOnglet] = useState('catalogue');
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [recherche, setRecherche] = useState(searchParams.get('q') || '');
  const [filtreStatut, setFiltreStatut] = useState('tous');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouveauProduit, setNouveauProduit] = useState({ name: '', sku: '', unitPrice: '', quantityInStock: '', quantityAlertThreshold: '5', isWeighted: false, categoryId: '', tvaApplicable: true, isVital: false, requiresPrescription: false, requiresColdChain: false, attributes: {}, lotNumber: '', expiryDate: '' });
  const [conditionnements, setConditionnements] = useState([]);
  const [modalePrixOuverte, setModalePrixOuverte] = useState(false);
  const [prixModifies, setPrixModifies] = useState({});
  const [augmentationGlobale, setAugmentationGlobale] = useState('');
  const [enregistrementPrix, setEnregistrementPrix] = useState(false);
  const [modaleEntreeOuverte, setModaleEntreeOuverte] = useState(false);
  const entreeStockVide = {
    items: [{ productId: '', quantity: '', montant: '', lotNumber: '', expiryDate: '' }],
    supplierId: '',
    movementDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'comptant',
    totalCost: '',
    invoiceNumber: '',
    cashMethod: 'especes',
    avecAvance: false,
    advanceAmount: '',
    advanceCashMethod: 'especes',
  };
  const [entreeStock, setEntreeStock] = useState(entreeStockVide);
  const [enregistrementEntree, setEnregistrementEntree] = useState(false);
  function ajouterLigneEntree() {
    setEntreeStock((prev) => ({ ...prev, items: [...prev.items, { productId: '', quantity: '', montant: '', lotNumber: '', expiryDate: '' }] }));
  }
  function retirerLigneEntree(index) {
    setEntreeStock((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  }
  function modifierLigneEntree(index, champ, valeur) {
    setEntreeStock((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === index ? { ...it, [champ]: valeur } : it)),
    }));
  }
  const [modaleFournisseurRapide, setModaleFournisseurRapide] = useState(false);
  const [nouveauFournisseurRapide, setNouveauFournisseurRapide] = useState({ name: '', phone: '' });
  const [produitEnEdition, setProduitEnEdition] = useState(null);
  const [enregistrementEdition, setEnregistrementEdition] = useState(false);
  const [produitsSelectionnes, setProduitsSelectionnes] = useState(new Set());
  const [vueProduits, setVueProduits] = useState(() => localStorage.getItem('vueProduits') || 'grille');
  const [quantitesEtiquettes, setQuantitesEtiquettes] = useState({});
  const [impressionEnAttente, setImpressionEnAttente] = useState(false);

  // Boutique active — seul le manager doit la choisir explicitement (les
  // autres rôles sont assignés à la leur, le backend l'applique tout seul).
  // Mémorisée en local pour ne pas la redemander à chaque navigation.
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState(() => (estManager ? localStorage.getItem('boutiqueActiveId') || '' : ''));
  const [chargementBoutiques, setChargementBoutiques] = useState(estManager);

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
    // Un manager sans boutique sélectionnée ne doit pas appeler /products
    // (le backend renverrait 400 "La boutique est requise").
    if (estManager && !warehouseId) return;
    setChargement(true);
    Promise.all([api.getProducts(warehouseId), api.getSuppliers().catch(() => [])])
      .then(([p, s]) => {
        setProducts(p);
        setSuppliers(s);
        // Par défaut, toutes les étiquettes sont sélectionnées (comportement
        // équivalent à "tout imprimer" d'avant).
        setProduitsSelectionnes(new Set(p.map((prod) => prod.id)));
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, [warehouseId]);

  const [equivalences, setEquivalences] = useState([]);
  useEffect(() => {
    if (!estPharmacie && !estElectromenager) return;
    api.getCategories().then(setCategories).catch((err) => setErreur(err.message));
    if (estPharmacie) {
      api.getProductEquivalences().then(setEquivalences).catch((err) => setErreur(err.message));
    }
  }, [estPharmacie, estElectromenager]);

  function changerVueProduits(vue) {
    setVueProduits(vue);
    localStorage.setItem('vueProduits', vue);
  }

  function basculerSelectionEtiquette(id) {
    setProduitsSelectionnes((avant) => {
      const nouveau = new Set(avant);
      if (nouveau.has(id)) nouveau.delete(id);
      else nouveau.add(id);
      return nouveau;
    });
  }

  function definirQuantiteEtiquette(id, quantite) {
    const nb = Math.max(1, Number(quantite) || 1);
    setQuantitesEtiquettes((avant) => ({ ...avant, [id]: nb }));
  }

  function toutSelectionner() {
    setProduitsSelectionnes(new Set(products.map((p) => p.id)));
  }

  function toutDeselectionner() {
    setProduitsSelectionnes(new Set());
  }

  // Bouton rapide "Étiquette" sur une carte produit du catalogue : bascule
  // sur l'onglet Étiquettes avec seulement ce produit sélectionné, puis
  // ouvre directement la boîte d'impression une fois le DOM à jour.
  function imprimerEtiquetteUnique(produit) {
    setProduitsSelectionnes(new Set([produit.id]));
    setOnglet('etiquettes');
    setImpressionEnAttente(true);
  }

  useEffect(() => {
    if (impressionEnAttente && onglet === 'etiquettes') {
      setImpressionEnAttente(false);
      const t = setTimeout(() => window.print(), 60);
      return () => clearTimeout(t);
    }
  }, [impressionEnAttente, onglet]);

  const totalEtiquettesAImprimer = useMemo(() => {
    let total = 0;
    produitsSelectionnes.forEach((id) => {
      total += quantitesEtiquettes[id] ?? 1;
    });
    return total;
  }, [produitsSelectionnes, quantitesEtiquettes]);

  const produitsFiltres = useMemo(() => {
    return products
      .filter((p) => {
        const correspondRecherche = p.name.toLowerCase().includes(recherche.toLowerCase()) ||
          (p.sku || '').toLowerCase().includes(recherche.toLowerCase());
        const correspondStatut = filtreStatut === 'tous' || p.status === filtreStatut;
        return correspondRecherche && correspondStatut;
      })
      // Produits activés (stock déjà entré au moins une fois) en premier, "À activer" en dernier.
      .sort((a, b) => (a.status === 'a_activer') - (b.status === 'a_activer'));
  }, [products, recherche, filtreStatut]);

  // Liaisons de substitution (princeps <-> génériques) du produit en cours
  // d'édition, avec le nom du produit lié résolu depuis la liste products.
  const equivalencesProduitEdition = useMemo(() => {
    if (!produitEnEdition) return [];
    return equivalences
      .filter((l) => l.product_id_1 === produitEnEdition.id || l.product_id_2 === produitEnEdition.id)
      .map((l) => {
        const autreId = l.product_id_1 === produitEnEdition.id ? l.product_id_2 : l.product_id_1;
        const autreProduit = products.find((p) => p.id === autreId);
        return { linkId: l.id, id: autreId, name: autreProduit?.name || 'Produit inconnu' };
      });
  }, [equivalences, produitEnEdition, products]);

  // Produits pouvant encore être liés (exclut le produit lui-même et ceux déjà liés).
  const candidatsEquivalence = useMemo(() => {
    if (!produitEnEdition) return [];
    const dejaLiesIds = new Set(equivalencesProduitEdition.map((e) => e.id));
    return products
      .filter((p) => p.id !== produitEnEdition.id && !dejaLiesIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, produitEnEdition, equivalencesProduitEdition]);

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
        isWeighted: estPharmacie ? false : nouveauProduit.isWeighted,
        isVital: nouveauProduit.isVital,
        requiresPrescription: estPharmacie ? nouveauProduit.requiresPrescription : undefined,
        requiresColdChain: estPharmacie ? nouveauProduit.requiresColdChain : undefined,
        warehouseId: estManager ? warehouseId : undefined,
        categoryId: (estPharmacie || estElectromenager) ? (nouveauProduit.categoryId || undefined) : undefined,
        tvaApplicable: estPharmacie ? nouveauProduit.tvaApplicable : undefined,
        attributes: nouveauProduit.attributes,
        lotNumber: estPharmacie ? (nouveauProduit.lotNumber || undefined) : undefined,
        expiryDate: estPharmacie ? (nouveauProduit.expiryDate || undefined) : undefined,
        units: conditionnements
          .filter((c) => c.label && Number(c.price) && Number(c.quantityPerUnit))
          .map((c) => ({ label: c.label, price: Number(c.price), quantityPerUnit: Number(c.quantityPerUnit) })),
      });
      setModaleOuverte(false);
      setNouveauProduit({ name: '', sku: '', unitPrice: '', quantityInStock: '', quantityAlertThreshold: '5', isWeighted: false, categoryId: '', tvaApplicable: true, isVital: false, requiresPrescription: false, requiresColdChain: false, attributes: {}, lotNumber: '', expiryDate: '' });
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

  const [nouveauConditionnementEdition, setNouveauConditionnementEdition] = useState({ label: '', price: '', quantityPerUnit: '' });
  const [lotsProduitEdition, setLotsProduitEdition] = useState(null);
  const [destructionLotEnCours, setDestructionLotEnCours] = useState(null);
  const [nouvelleEquivalenceId, setNouvelleEquivalenceId] = useState('');
  const [enregistrementEquivalence, setEnregistrementEquivalence] = useState(false);

  function chargerLotsProduit(productId) {
    setLotsProduitEdition(null);
    api.getProductLots(productId, estManager ? warehouseId : undefined)
      .then(setLotsProduitEdition)
      .catch(() => setLotsProduitEdition([]));
  }

  async function handleAjouterEquivalence() {
    if (!nouvelleEquivalenceId || !produitEnEdition) return;
    setEnregistrementEquivalence(true);
    try {
      const lien = await api.addProductEquivalence(produitEnEdition.id, nouvelleEquivalenceId);
      setEquivalences((prev) => [...prev.filter((l) => l.id !== lien.id), lien]);
      setNouvelleEquivalenceId('');
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementEquivalence(false);
    }
  }

  async function handleSupprimerEquivalence(linkId) {
    try {
      await api.removeProductEquivalence(linkId);
      setEquivalences((prev) => prev.filter((l) => l.id !== linkId));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleDetruireLot(lotId) {
    if (!window.confirm('Détruire ce lot périmé ? Il sera retiré du stock affiché. Action irréversible.')) return;
    setDestructionLotEnCours(lotId);
    try {
      await api.destroyProductLot(produitEnEdition.id, lotId, estManager ? warehouseId : undefined);
      chargerLotsProduit(produitEnEdition.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setDestructionLotEnCours(null);
    }
  }

  function ouvrirEdition(product) {
    setProduitEnEdition({
      id: product.id,
      name: product.name,
      sku: product.sku || '',
      unitPrice: product.unit_price,
      quantityAlertThreshold: estPharmacie ? String(Math.round(Number(product.quantity_alert_threshold))) : product.quantity_alert_threshold,
      isWeighted: estPharmacie ? false : product.is_weighted,
      categoryId: product.category_id || '',
      tvaApplicable: product.tva_applicable !== false,
      isVital: Boolean(product.is_vital),
      requiresPrescription: Boolean(product.requires_prescription),
      requiresColdChain: Boolean(product.requires_cold_chain),
      units: product.units || [],
      attributes: product.attributes || {},
    });
    setNouveauConditionnementEdition({ label: '', price: '', quantityPerUnit: '' });
    if (estPharmacie) {
      chargerLotsProduit(product.id);
    }
  }

  async function handleAjouterConditionnementEdition() {
    if (!nouveauConditionnementEdition.label || !Number(nouveauConditionnementEdition.price) || !Number(nouveauConditionnementEdition.quantityPerUnit)) {
      setErreur('Remplissez le libellé, le prix et la quantité du conditionnement.');
      return;
    }
    try {
      const unite = await api.addProductUnit(produitEnEdition.id, {
        label: nouveauConditionnementEdition.label,
        price: Number(nouveauConditionnementEdition.price),
        quantityPerUnit: Number(nouveauConditionnementEdition.quantityPerUnit),
      });
      setProduitEnEdition({ ...produitEnEdition, units: [...produitEnEdition.units, unite] });
      setNouveauConditionnementEdition({ label: '', price: '', quantityPerUnit: '' });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimerConditionnementEdition(unitId) {
    try {
      await api.deleteProductUnit(produitEnEdition.id, unitId);
      setProduitEnEdition({ ...produitEnEdition, units: produitEnEdition.units.filter((u) => u.id !== unitId) });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
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
        isWeighted: estPharmacie ? false : produitEnEdition.isWeighted,
        isVital: produitEnEdition.isVital,
        requiresPrescription: estPharmacie ? produitEnEdition.requiresPrescription : undefined,
        requiresColdChain: estPharmacie ? produitEnEdition.requiresColdChain : undefined,
        categoryId: (estPharmacie || estElectromenager) ? (produitEnEdition.categoryId || null) : undefined,
        tvaApplicable: estPharmacie ? produitEnEdition.tvaApplicable : undefined,
        attributes: produitEnEdition.attributes,
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
    const items = entreeStock.items.filter((it) => it.productId);
    if (items.length === 0) {
      setErreur('Choisissez au moins un produit.');
      return;
    }
    if (items.some((it) => !Number(it.quantity) || Number(it.quantity) <= 0)) {
      setErreur('Chaque article doit avoir une quantité valide.');
      return;
    }
    const productIdsChoisis = items.map((it) => it.productId);
    if (new Set(productIdsChoisis).size !== productIdsChoisis.length) {
      setErreur('Un même produit apparaît plusieurs fois — regroupez-le en une seule ligne.');
      return;
    }
    // Avec plusieurs articles, le montant total n'est plus saisi à la main :
    // il se calcule à partir du montant renseigné sur chaque ligne.
    if (items.length > 1 && items.some((it) => !Number(it.montant) || Number(it.montant) <= 0)) {
      setErreur('Chaque article doit avoir un montant valide pour que le total se calcule.');
      return;
    }
    const totalAchatCalcule = items.length > 1
      ? items.reduce((somme, it) => somme + Number(it.montant), 0)
      : Number(entreeStock.totalCost);
    if (entreeStock.paymentMethod === 'a_credit' && (!entreeStock.supplierId || !totalAchatCalcule)) {
      setErreur('Un achat à crédit nécessite un fournisseur et le montant total de l\'achat.');
      return;
    }
    if (entreeStock.paymentMethod === 'comptant' && !totalAchatCalcule) {
      setErreur('Le montant total de l\'achat est requis pour un achat au comptant (pour le suivi de caisse).');
      return;
    }
    if (entreeStock.paymentMethod === 'a_credit' && entreeStock.avecAvance) {
      if (!Number(entreeStock.advanceAmount) || Number(entreeStock.advanceAmount) <= 0) {
        setErreur("Le montant de l'avance est invalide.");
        return;
      }
      if (Number(entreeStock.advanceAmount) > totalAchatCalcule) {
        setErreur("L'avance ne peut pas dépasser le montant total de l'achat.");
        return;
      }
    }
    setEnregistrementEntree(true);
    try {
      await api.recordStockPurchase({
        items: items.map((it) => ({
          productId: it.productId,
          quantity: Number(it.quantity),
          lotNumber: estPharmacie ? (it.lotNumber || undefined) : undefined,
          expiryDate: estPharmacie ? (it.expiryDate || undefined) : undefined,
        })),
        supplierId: entreeStock.supplierId || undefined,
        movementDate: entreeStock.movementDate || undefined,
        paymentMethod: entreeStock.paymentMethod,
        totalCost: totalAchatCalcule,
        invoiceNumber: entreeStock.invoiceNumber.trim() || undefined,
        cashMethod: entreeStock.paymentMethod === 'comptant' ? entreeStock.cashMethod : undefined,
        advanceAmount: entreeStock.paymentMethod === 'a_credit' && entreeStock.avecAvance ? Number(entreeStock.advanceAmount) : undefined,
        advanceCashMethod: entreeStock.paymentMethod === 'a_credit' && entreeStock.avecAvance ? entreeStock.advanceCashMethod : undefined,
        warehouseId: estManager ? warehouseId : undefined,
      });
      setModaleEntreeOuverte(false);
      setEntreeStock(entreeStockVide);
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
        <h1>{secteurConfig.libelleProduit}s</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
          {peutGerer && onglet === 'catalogue' && (
            <button
              className="btn btn-principal"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, boxShadow: '0 6px 16px -6px var(--accent)', fontWeight: 600 }}
              onClick={() => setModaleOuverte(true)}
              disabled={estManager && !warehouseId}
            >
              <IconPlus />
              Nouveau {secteurConfig.libelleProduit.toLowerCase()}
            </button>
          )}
        </div>
      </div>

      {estManager && !chargementBoutiques && warehouses.length === 0 && (
        <p className="etat-vide">Aucune {secteurConfig.libelleBoutique.toLowerCase()} n'a encore été créée. Créez-en une avant de gérer le stock.</p>
      )}

      <div className="onglets">
        <button className={onglet === 'catalogue' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('catalogue')}>
          Catalogue {secteurConfig.libelleProduit.toLowerCase()}s
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
            <button className="btn" onClick={handleExportCsv}>Exporter CSV</button>
            <button className="btn" onClick={() => api.downloadProductsPdf(estManager ? warehouseId : undefined).catch((err) => setErreur(err.message))}>Exporter PDF</button>
            {peutGerer && <button className="btn" onClick={() => setModaleEntreeOuverte(true)}>Entrée de stock</button>}
            {peutGerer && <button className="btn" onClick={ouvrirRevisionPrix}>Réviser les prix</button>}
            <div style={{ display: 'flex', border: '1px solid var(--trait)', borderRadius: 'var(--rayon-petit)', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => changerVueProduits('grille')}
                title="Vue grille"
                style={{
                  display: 'flex', alignItems: 'center', padding: '7px 10px', border: 'none', cursor: 'pointer',
                  background: vueProduits === 'grille' ? 'var(--accent)' : 'transparent',
                  color: vueProduits === 'grille' ? '#fff' : 'var(--encre-douce)',
                }}
              >
                <IconGrille />
              </button>
              <button
                type="button"
                onClick={() => changerVueProduits('liste')}
                title="Vue liste (sélection rapide)"
                style={{
                  display: 'flex', alignItems: 'center', padding: '7px 10px', border: 'none', cursor: 'pointer',
                  background: vueProduits === 'liste' ? 'var(--accent)' : 'transparent',
                  color: vueProduits === 'liste' ? '#fff' : 'var(--encre-douce)',
                }}
              >
                <IconListe />
              </button>
            </div>
          </div>

          {chargement ? (
            <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
          ) : produitsFiltres.length === 0 ? (
            <p className="etat-vide">
              {products.length === 0
                ? `Aucun ${secteurConfig.libelleProduit.toLowerCase()} enregistré. Ajoutez votre premier ${secteurConfig.libelleProduit.toLowerCase()} pour démarrer.`
                : `Aucun ${secteurConfig.libelleProduit.toLowerCase()} ne correspond à ces filtres.`}
            </p>
          ) : vueProduits === 'liste' ? (
            <table className="registre" style={{ marginBottom: 20 }}>
              <thead>
                <tr>
                  <th>{secteurConfig.libelleProduit}</th>
                  <th>SKU</th>
                  <th>Prix</th>
                  <th>Stock</th>
                  <th>Statut</th>
                  {peutGerer && <th></th>}
                </tr>
              </thead>
              <tbody>
                {produitsFiltres.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      {estPharmacie && p.is_vital && <span className="tampon tampon-brique" style={{ marginLeft: 6, fontSize: 11 }}>Vital</span>}
                      {p.requires_cold_chain && <span className="tampon tampon-info" style={{ marginLeft: 6, fontSize: 11 }}>❄ Froid</span>}
                      {p.requires_prescription && <span className="tampon tampon-sarcelle" style={{ marginLeft: 6, fontSize: 11 }}>Ordonnance</span>}
                    </td>
                    <td className="chiffre">{codeInterne(p)}</td>
                    <td className="chiffre">{Math.round(p.unit_price).toLocaleString('fr-FR')} FCFA{p.is_weighted ? '/kg' : ''}</td>
                    <td className="chiffre">{p.is_weighted ? Number(p.quantity_in_stock).toFixed(1) : Math.round(Number(p.quantity_in_stock))}{p.is_weighted ? ' kg' : ''}</td>
                    <td><StatusBadge status={p.status} /></td>
                    {peutGerer && (
                      <td>
                        <button
                          className="btn"
                          style={{ fontSize: 13, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          onClick={() => ouvrirEdition(p)}
                        >
                          <IconModifier />
                          Modifier
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="grille-produits">
              {produitsFiltres.map((p) => (
                <div key={p.id} className="carte-produit">
                  <div className="carte-produit-entete">
                    <span className="carte-produit-icone"><IconBoite /></span>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="carte-produit-nom">
                    {p.name}
                    {estPharmacie && p.is_vital && <span className="tampon tampon-brique" style={{ marginLeft: 6, fontSize: 11 }}>Vital</span>}
                    {p.requires_cold_chain && <span className="tampon tampon-info" style={{ marginLeft: 6, fontSize: 11 }}>❄ Froid</span>}
                    {p.requires_prescription && <span className="tampon tampon-sarcelle" style={{ marginLeft: 6, fontSize: 11 }}>Ordonnance</span>}
                  </p>
                  <p className="carte-produit-sku">{codeInterne(p)}</p>
                  <p className="carte-produit-prix">{Math.round(p.unit_price).toLocaleString('fr-FR')} FCFA{p.is_weighted ? '/kg' : ''}</p>
                  <p className="carte-produit-stock">{p.is_weighted ? Number(p.quantity_in_stock).toFixed(1) : Math.round(Number(p.quantity_in_stock))}{p.is_weighted ? ' kg' : ''} en stock</p>
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
          <div className="barre-outils no-print" style={{ flexWrap: 'wrap', gap: 12 }}>
            <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>
              {totalEtiquettesAImprimer} étiquette(s) à imprimer ({produitsSelectionnes.size} produit(s) sur {products.length})
            </span>
            <button className="btn" onClick={toutSelectionner}>Tout sélectionner</button>
            <button className="btn" onClick={toutDeselectionner}>Tout désélectionner</button>
            <button className="btn btn-principal" onClick={() => window.print()} disabled={totalEtiquettesAImprimer === 0}>
              Imprimer ({totalEtiquettesAImprimer})
            </button>
          </div>

          <div
            className="no-print"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 8,
              marginBottom: 24,
            }}
          >
            {products.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  padding: '8px 10px',
                  border: '1px solid var(--trait)',
                  borderRadius: 'var(--rayon-petit)',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={produitsSelectionnes.has(p.id)}
                    onChange={() => basculerSelectionEtiquette(p.id)}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                </label>
                <input
                  type="number"
                  min="1"
                  className="champ"
                  style={{ width: 56, padding: '4px 6px', textAlign: 'center', flexShrink: 0 }}
                  value={quantitesEtiquettes[p.id] ?? 1}
                  disabled={!produitsSelectionnes.has(p.id)}
                  onChange={(e) => definirQuantiteEtiquette(p.id, e.target.value)}
                  title="Nombre d'exemplaires"
                />
              </div>
            ))}
          </div>

          <div className="grille-etiquettes">
            {products.filter((p) => produitsSelectionnes.has(p.id)).flatMap((p) => {
              const nb = quantitesEtiquettes[p.id] ?? 1;
              return Array.from({ length: nb }, (_, i) => (
                <div key={`${p.id}-${i}`} className="etiquette-produit">
                  <p className="etiquette-nom">{p.name}</p>
                  <p className="etiquette-prix">{Math.round(p.unit_price).toLocaleString('fr-FR')} FCFA</p>
                  <CodeBarreEtiquette valeur={codeInterne(p)} />
                </div>
              ));
            })}
          </div>
        </>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Nouveau {secteurConfig.libelleProduit.toLowerCase()}</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="p-name">Nom du produit</label>
                <input
                  id="p-name"
                  className="champ"
                  value={nouveauProduit.name}
                  onChange={(e) => setNouveauProduit({ ...nouveauProduit, name: e.target.value })}
                  placeholder={estPharmacie ? 'Paracétamol 500mg' : estElectromenager ? 'Réfrigérateur 350L' : 'Riz brisé 25kg'}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="p-sku">Référence / code (facultatif)</label>
                <input
                  id="p-sku"
                  className="champ"
                  value={nouveauProduit.sku}
                  onChange={(e) => setNouveauProduit({ ...nouveauProduit, sku: e.target.value })}
                  placeholder={estPharmacie ? 'PARA-500 (généré automatiquement sinon)' : estElectromenager ? 'REF-350 (généré automatiquement sinon)' : 'RIZ-25 (généré automatiquement sinon)'}
                />
              </div>
              {!estPharmacie && !estElectromenager && (
                <div className="champ-groupe">
                  <label className="etiquette" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={nouveauProduit.isWeighted}
                      onChange={(e) => setNouveauProduit({ ...nouveauProduit, isWeighted: e.target.checked })}
                    />
                    Vendu au poids (prix au kg)
                  </label>
                </div>
              )}
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="p-price">{nouveauProduit.isWeighted ? 'Prix au kg (FCFA)' : 'Prix au détail (FCFA)'}</label>
                <input
                  id="p-price"
                  type="number"
                  className="champ"
                  value={nouveauProduit.unitPrice}
                  onChange={(e) => setNouveauProduit({ ...nouveauProduit, unitPrice: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="p-qty">{nouveauProduit.isWeighted ? 'Quantité initiale (kg)' : 'Quantité initiale (unités de base)'}</label>
                <input
                  id="p-qty"
                  type="number"
                  step={estPharmacie ? '1' : (nouveauProduit.isWeighted ? '0.1' : '1')}
                  className="champ"
                  value={nouveauProduit.quantityInStock}
                  onChange={(e) => setNouveauProduit({ ...nouveauProduit, quantityInStock: estPharmacie ? e.target.value.replace(/[.,].*$/, '') : e.target.value })}
                />
              </div>
              {estPharmacie && Number(nouveauProduit.quantityInStock) > 0 && (
                <div className="champ-groupe">
                  <label className="etiquette">Lot de ce stock initial</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="date"
                      className="champ"
                      style={{ flex: 1 }}
                      title="Date de péremption de ce lot"
                      value={nouveauProduit.expiryDate}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setNouveauProduit({ ...nouveauProduit, expiryDate: e.target.value })}
                    />
                    <input
                      type="text"
                      className="champ"
                      style={{ flex: 1 }}
                      placeholder="N° de lot (facultatif)"
                      value={nouveauProduit.lotNumber}
                      onChange={(e) => setNouveauProduit({ ...nouveauProduit, lotNumber: e.target.value })}
                    />
                  </div>
                </div>
              )}
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="p-alert">Seuil d'alerte</label>
                <input
                  id="p-alert"
                  type="number"
                  step={estPharmacie ? '1' : undefined}
                  className="champ"
                  value={nouveauProduit.quantityAlertThreshold}
                  onChange={(e) => setNouveauProduit({ ...nouveauProduit, quantityAlertThreshold: estPharmacie ? e.target.value.replace(/[.,].*$/, '') : e.target.value })}
                />
              </div>

              {estPharmacie && (
                <div className="champ-groupe">
                  <label className="etiquette" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={nouveauProduit.isVital}
                      onChange={(e) => {
                        const coche = e.target.checked;
                        setNouveauProduit((prev) => ({
                          ...prev,
                          isVital: coche,
                          // Suggestion de seuil plus élevé, uniquement si le champ
                          // n'a pas déjà été personnalisé — reste modifiable ensuite.
                          quantityAlertThreshold: coche && (prev.quantityAlertThreshold === '' || prev.quantityAlertThreshold === '5')
                            ? String(SEUIL_ALERTE_VITAL_SUGGERE)
                            : prev.quantityAlertThreshold,
                        }));
                      }}
                    />
                    Produit vital (première nécessité / urgence) — suggère un seuil d'alerte plus élevé
                  </label>
                </div>
              )}

              {estPharmacie && (
                <div className="champ-groupe">
                  <label className="etiquette" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={nouveauProduit.requiresPrescription}
                      onChange={(e) => setNouveauProduit({ ...nouveauProduit, requiresPrescription: e.target.checked })}
                    />
                    Ordonnance obligatoire pour la vente
                  </label>
                </div>
              )}

              {estPharmacie && (
                <div className="champ-groupe">
                  <label className="etiquette" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={nouveauProduit.requiresColdChain}
                      onChange={(e) => setNouveauProduit({ ...nouveauProduit, requiresColdChain: e.target.checked })}
                    />
                    Chaîne du froid (à conserver au frais)
                  </label>
                </div>
              )}

              {(estPharmacie || estElectromenager) && (
                <div className="champ-groupe">
                  <label className="etiquette" htmlFor="p-categorie">Catégorie</label>
                  <select
                    id="p-categorie"
                    className="champ"
                    value={nouveauProduit.categoryId || ''}
                    onChange={(e) => setNouveauProduit({ ...nouveauProduit, categoryId: e.target.value })}
                  >
                    <option value="">Aucune catégorie</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {estPharmacie && (
                <div className="champ-groupe">
                  <label className="etiquette" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={nouveauProduit.tvaApplicable}
                      onChange={(e) => setNouveauProduit({ ...nouveauProduit, tvaApplicable: e.target.checked })}
                    />
                    Soumis à la TVA (décochez pour un produit exonéré, ex. la plupart des médicaments)
                  </label>
                </div>
              )}

              {secteurConfig.champsProduitSup.map((champ) => (
                <div className="champ-groupe" key={champ.key}>
                  <label className="etiquette" htmlFor={`p-${champ.key}`}>{champ.label}</label>
                  <input
                    id={`p-${champ.key}`}
                    type={champ.type}
                    className="champ"
                    value={nouveauProduit.attributes[champ.key] || ''}
                    onChange={(e) =>
                      setNouveauProduit({
                        ...nouveauProduit,
                        attributes: { ...nouveauProduit.attributes, [champ.key]: e.target.value },
                      })
                    }
                  />
                </div>
              ))}

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
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginTop: -8, marginBottom: 16 }}>
              Plusieurs articles chez le même fournisseur, en un seul achat.
            </p>
            <form onSubmit={handleEntreeStock}>
              <div className="champ-groupe">
                <label className="etiquette">Articles</label>
                {entreeStock.items.map((item, index) => {
                  const produitLigne = products.find((p) => p.id === item.productId);
                  return (
                    <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <select
                          className="champ"
                          style={{ flex: 2 }}
                          value={item.productId}
                          onChange={(e) => modifierLigneEntree(index, 'productId', e.target.value)}
                        >
                          <option value="">Choisir un produit</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={estPharmacie ? '1' : (produitLigne?.is_weighted ? '0.1' : '1')}
                          step={estPharmacie ? '1' : (produitLigne?.is_weighted ? '0.1' : '1')}
                          className="champ"
                          style={{ flex: 1 }}
                          placeholder={produitLigne?.is_weighted ? 'Qté (kg)' : 'Qté'}
                          value={item.quantity}
                          onChange={(e) => modifierLigneEntree(index, 'quantity', estPharmacie ? e.target.value.replace(/[.,].*$/, '') : e.target.value)}
                        />
                        {entreeStock.items.length > 1 && (
                          <input
                            type="number"
                            className="champ"
                            style={{ flex: 1 }}
                            placeholder="Montant (FCFA)"
                            value={item.montant}
                            onChange={(e) => modifierLigneEntree(index, 'montant', e.target.value)}
                          />
                        )}
                        {entreeStock.items.length > 1 && (
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '8px 10px' }}
                            onClick={() => retirerLigneEntree(index)}
                            aria-label="Retirer cet article"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {produitLigne?.requires_cold_chain && (
                        <p style={{ margin: '2px 0 0 4px', fontSize: 12, color: 'var(--info)' }}>
                          ❄ Chaîne du froid — à conserver au frais dès la réception.
                        </p>
                      )}
                      {estPharmacie && item.productId && (
                        <div style={{ display: 'flex', gap: 8, paddingLeft: 4 }}>
                          <input
                            type="date"
                            className="champ"
                            style={{ flex: 1 }}
                            title="Date de péremption de ce lot"
                            value={item.expiryDate}
                            min={new Date().toISOString().slice(0, 10)}
                            onChange={(e) => modifierLigneEntree(index, 'expiryDate', e.target.value)}
                          />
                          <input
                            type="text"
                            className="champ"
                            style={{ flex: 1 }}
                            placeholder="N° de lot (facultatif)"
                            value={item.lotNumber}
                            onChange={(e) => modifierLigneEntree(index, 'lotNumber', e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                <button type="button" className="btn" onClick={ajouterLigneEntree}>
                  + Ajouter un article
                </button>
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
              {(entreeStock.paymentMethod === 'a_credit' || entreeStock.paymentMethod === 'comptant') && (
                <div className="champ-groupe">
                  <label className="etiquette" htmlFor="e-montant">
                    {entreeStock.items.length > 1
                      ? "Montant total de l'achat — calculé depuis les articles (FCFA)"
                      : "Montant total de l'achat (FCFA)"}
                  </label>
                  {entreeStock.items.length > 1 ? (
                    <input
                      id="e-montant"
                      className="champ"
                      value={entreeStock.items.reduce((s, it) => s + (Number(it.montant) || 0), 0).toLocaleString('fr-FR')}
                      disabled
                      readOnly
                    />
                  ) : (
                    <input
                      id="e-montant"
                      type="number"
                      className="champ"
                      value={entreeStock.totalCost}
                      onChange={(e) => setEntreeStock({ ...entreeStock, totalCost: e.target.value })}
                    />
                  )}
                </div>
              )}
              {entreeStock.paymentMethod === 'comptant' && (
                <div className="champ-groupe">
                  <label className="etiquette" htmlFor="e-cash-methode">Payé depuis (caisse)</label>
                  <select
                    id="e-cash-methode"
                    className="champ"
                    value={entreeStock.cashMethod}
                    onChange={(e) => setEntreeStock({ ...entreeStock, cashMethod: e.target.value })}
                  >
                    <option value="especes">Espèces</option>
                    <option value="wave">Wave</option>
                    <option value="orange_money">Orange Money</option>
                    <option value="cheque">Chèque</option>
                    <option value="virement">Virement</option>
                  </select>
                </div>
              )}
              {entreeStock.paymentMethod === 'a_credit' && (
                <div className="champ-groupe">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={entreeStock.avecAvance}
                      onChange={(e) => setEntreeStock({ ...entreeStock, avecAvance: e.target.checked })}
                    />
                    Verser une avance maintenant
                  </label>
                </div>
              )}
              {entreeStock.paymentMethod === 'a_credit' && entreeStock.avecAvance && (
                <>
                  <div className="champ-groupe">
                    <label className="etiquette" htmlFor="e-avance-montant">Montant de l'avance (FCFA)</label>
                    <input
                      id="e-avance-montant"
                      type="number"
                      className="champ"
                      value={entreeStock.advanceAmount}
                      onChange={(e) => setEntreeStock({ ...entreeStock, advanceAmount: e.target.value })}
                    />
                    {Number(entreeStock.totalCost) > 0 && Number(entreeStock.advanceAmount) > 0 && (
                      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                        Reste à devoir au fournisseur : {Math.max(0, Number(entreeStock.totalCost) - Number(entreeStock.advanceAmount)).toLocaleString('fr-FR')} FCFA
                      </p>
                    )}
                  </div>
                  <div className="champ-groupe">
                    <label className="etiquette" htmlFor="e-avance-methode">Avance payée depuis (caisse)</label>
                    <select
                      id="e-avance-methode"
                      className="champ"
                      value={entreeStock.advanceCashMethod}
                      onChange={(e) => setEntreeStock({ ...entreeStock, advanceCashMethod: e.target.value })}
                    >
                      <option value="especes">Espèces</option>
                      <option value="wave">Wave</option>
                      <option value="orange_money">Orange Money</option>
                      <option value="cheque">Chèque</option>
                      <option value="virement">Virement</option>
                    </select>
                  </div>
                </>
              )}
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="e-facture">N° de facture fournisseur (facultatif)</label>
                <input
                  id="e-facture"
                  className="champ"
                  value={entreeStock.invoiceNumber}
                  onChange={(e) => setEntreeStock({ ...entreeStock, invoiceNumber: e.target.value })}
                  placeholder="Ex : FAC-2026-0148"
                />
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
                  placeholder={estElectromenager ? 'Distributeur Electro Plus' : 'Grossiste Baol'}
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
            <h2>Modifier le {secteurConfig.libelleProduit.toLowerCase()}</h2>
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
              {!estPharmacie && !estElectromenager && (
                <div className="champ-groupe">
                  <label className="etiquette" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={produitEnEdition.isWeighted}
                      onChange={(e) => setProduitEnEdition({ ...produitEnEdition, isWeighted: e.target.checked })}
                    />
                    Vendu au poids (prix au kg)
                  </label>
                </div>
              )}
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="pe-price">{produitEnEdition.isWeighted ? 'Prix au kg (FCFA)' : 'Prix au détail (FCFA)'}</label>
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
                  step={estPharmacie ? '1' : undefined}
                  className="champ"
                  value={produitEnEdition.quantityAlertThreshold}
                  onChange={(e) => setProduitEnEdition({ ...produitEnEdition, quantityAlertThreshold: estPharmacie ? e.target.value.replace(/[.,].*$/, '') : e.target.value })}
                />
              </div>

              {estPharmacie && (
                <div className="champ-groupe">
                  <label className="etiquette" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={produitEnEdition.isVital}
                      onChange={(e) => {
                        const coche = e.target.checked;
                        setProduitEnEdition((prev) => ({
                          ...prev,
                          isVital: coche,
                          quantityAlertThreshold: coche && (prev.quantityAlertThreshold === '' || Number(prev.quantityAlertThreshold) < SEUIL_ALERTE_VITAL_SUGGERE)
                            ? String(SEUIL_ALERTE_VITAL_SUGGERE)
                            : prev.quantityAlertThreshold,
                        }));
                      }}
                    />
                    Produit vital (première nécessité / urgence) — suggère un seuil d'alerte plus élevé
                  </label>
                </div>
              )}

              {estPharmacie && (
                <div className="champ-groupe">
                  <label className="etiquette" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={produitEnEdition.requiresPrescription}
                      onChange={(e) => setProduitEnEdition({ ...produitEnEdition, requiresPrescription: e.target.checked })}
                    />
                    Ordonnance obligatoire pour la vente
                  </label>
                </div>
              )}

              {estPharmacie && (
                <div className="champ-groupe">
                  <label className="etiquette" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={produitEnEdition.requiresColdChain}
                      onChange={(e) => setProduitEnEdition({ ...produitEnEdition, requiresColdChain: e.target.checked })}
                    />
                    Chaîne du froid (à conserver au frais)
                  </label>
                </div>
              )}

              {(estPharmacie || estElectromenager) && (
                <div className="champ-groupe">
                  <label className="etiquette" htmlFor="pe-categorie">Catégorie</label>
                  <select
                    id="pe-categorie"
                    className="champ"
                    value={produitEnEdition.categoryId || ''}
                    onChange={(e) => setProduitEnEdition({ ...produitEnEdition, categoryId: e.target.value })}
                  >
                    <option value="">Aucune catégorie</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {estPharmacie && (
                <div className="champ-groupe">
                  <label className="etiquette" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={produitEnEdition.tvaApplicable}
                      onChange={(e) => setProduitEnEdition({ ...produitEnEdition, tvaApplicable: e.target.checked })}
                    />
                    Soumis à la TVA (décochez pour un produit exonéré, ex. la plupart des médicaments)
                  </label>
                </div>
              )}

              {secteurConfig.champsProduitSup.map((champ) => (
                <div className="champ-groupe" key={champ.key}>
                  <label className="etiquette" htmlFor={`pe-${champ.key}`}>{champ.label}</label>
                  <input
                    id={`pe-${champ.key}`}
                    type={champ.type}
                    className="champ"
                    value={produitEnEdition.attributes[champ.key] || ''}
                    onChange={(e) =>
                      setProduitEnEdition({
                        ...produitEnEdition,
                        attributes: { ...produitEnEdition.attributes, [champ.key]: e.target.value },
                      })
                    }
                  />
                </div>
              ))}

              {estPharmacie && (
                <div className="champ-groupe">
                  <label className="etiquette">Lots en stock (péremption)</label>
                  {lotsProduitEdition === null && (
                    <p style={{ fontSize: 13, color: 'var(--encre-douce)' }}>Chargement…</p>
                  )}
                  {lotsProduitEdition && lotsProduitEdition.length === 0 && (
                    <p style={{ fontSize: 13, color: 'var(--encre-douce)' }}>
                      Aucun lot enregistré pour cette boutique (stock non suivi par lot, ou pas encore de péremption renseignée).
                    </p>
                  )}
                  {lotsProduitEdition && lotsProduitEdition.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {lotsProduitEdition.map((lot) => (
                        <div
                          key={lot.id}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '4px 8px', borderRadius: 6,
                            background: lot.is_expired ? '#fee2e2' : (lot.is_expiring_soon ? '#ffedd5' : 'var(--fond-alterne, #f5f5f5)'),
                          }}
                        >
                          <span>{lot.lot_number || 'Sans n° de lot'} — {lot.quantity} unité(s)</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 600, color: lot.is_expired ? '#b91c1c' : (lot.is_expiring_soon ? '#c2410c' : 'inherit') }}>
                              {lot.is_expired ? 'Périmé le ' : (lot.is_expiring_soon ? 'Bientôt périmé : ' : 'Péremption : ')}
                              {new Date(lot.expiry_date).toLocaleDateString('fr-FR')}
                            </span>
                            {lot.is_expired && (
                              <button
                                type="button"
                                className="btn"
                                style={{ padding: '2px 8px', fontSize: 12 }}
                                disabled={destructionLotEnCours === lot.id}
                                onClick={() => handleDetruireLot(lot.id)}
                              >
                                {destructionLotEnCours === lot.id ? '…' : 'Détruire'}
                              </button>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {estPharmacie && (
                <div className="champ-groupe">
                  <label className="etiquette">Équivalents / génériques (proposés à la caisse en cas de rupture)</label>
                  {equivalencesProduitEdition.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                      {equivalencesProduitEdition.map((eq) => (
                        <div
                          key={eq.linkId}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '4px 8px', borderRadius: 6,
                            background: 'var(--fond-alterne, #f5f5f5)',
                          }}
                        >
                          <span>{eq.name}</span>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '2px 8px', fontSize: 12 }}
                            onClick={() => handleSupprimerEquivalence(eq.linkId)}
                          >
                            Délier
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {equivalencesProduitEdition.length === 0 && (
                    <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 8 }}>
                      Aucun équivalent lié pour l'instant.
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      className="champ"
                      value={nouvelleEquivalenceId}
                      onChange={(e) => setNouvelleEquivalenceId(e.target.value)}
                    >
                      <option value="">Choisir un médicament équivalent…</option>
                      {candidatsEquivalence.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn"
                      disabled={!nouvelleEquivalenceId || enregistrementEquivalence}
                      onClick={handleAjouterEquivalence}
                    >
                      {enregistrementEquivalence ? '…' : 'Lier'}
                    </button>
                  </div>
                </div>
              )}

              <div className="champ-groupe">
                <label className="etiquette">
                  Conditionnements (ex : {estElectromenager ? 'pack de 2 unités à prix fixe' : 'sac 25kg à prix fixe'})
                </label>
                {produitEnEdition.units.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    {produitEnEdition.units.map((u) => (
                      <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--fond-alterne, #f5f5f5)', borderRadius: 6 }}>
                        <span style={{ fontSize: 13 }}>
                          {u.label} — {Math.round(u.price).toLocaleString('fr-FR')} FCFA
                          {produitEnEdition.isWeighted ? ` (${u.quantity_per_unit} kg)` : ` (${u.quantity_per_unit} unités)`}
                        </span>
                        <button type="button" className="btn" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => handleSupprimerConditionnementEdition(u.id)}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="champ"
                    placeholder={estElectromenager ? 'Libellé (ex : Pack de 2)' : 'Libellé (ex : Sac 25kg)'}
                    value={nouveauConditionnementEdition.label}
                    onChange={(e) => setNouveauConditionnementEdition({ ...nouveauConditionnementEdition, label: e.target.value })}
                  />
                  <input
                    type="number"
                    className="champ"
                    style={{ width: 90 }}
                    placeholder="Prix"
                    value={nouveauConditionnementEdition.price}
                    onChange={(e) => setNouveauConditionnementEdition({ ...nouveauConditionnementEdition, price: e.target.value })}
                  />
                  <input
                    type="number"
                    className="champ"
                    style={{ width: 90 }}
                    placeholder={produitEnEdition.isWeighted ? 'Kg' : 'Qté'}
                    value={nouveauConditionnementEdition.quantityPerUnit}
                    onChange={(e) => setNouveauConditionnementEdition({ ...nouveauConditionnementEdition, quantityPerUnit: e.target.value })}
                  />
                  <button type="button" className="btn" onClick={handleAjouterConditionnementEdition}>+</button>
                </div>
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
