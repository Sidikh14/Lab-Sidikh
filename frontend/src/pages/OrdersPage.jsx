import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { ModaleEncaissement } from '../components/ModaleEncaissement';
import { useOfflineSync } from '../offline/useOfflineSync';
import { cacheProducts, cacheClients } from '../offline/db';
import { useLiveEvent } from '../offline/liveEvents';

const PEUT_CREER = ['manager', 'gerant', 'vendeur'];
const PEUT_ENCAISSER = ['manager', 'caissier'];
const PEUT_GERER_STATUT = ['manager', 'gerant', 'caissier'];

function IconPanier() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6" />
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

function IconCamera() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

// Scan par caméra (téléphone/tablette) via html5-qrcode : pas besoin de
// douchette physique, la caméra arrière du téléphone suffit à lire
// CODE128/EAN/QR. onDetect reçoit le texte décodé une seule fois par
// ouverture (on arrête le flux dès la première lecture réussie).
function ModaleScanCamera({ onDetect, onClose }) {
  const [erreurCamera, setErreurCamera] = useState('');

  useEffect(() => {
    const instance = new Html5Qrcode('zone-scan-camera', {
      // Formats réellement utilisés dans l'app (étiquettes en CODE_128 +
      // les formats courants qu'un fournisseur pourrait avoir déjà imprimés).
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.QR_CODE,
      ],
      // L'API native du navigateur (BarcodeDetector), utilisée par défaut sur
      // certains appareils, ne sait souvent lire que les QR codes : on force
      // le décodeur ZXing intégré à la librairie, bien plus fiable sur les
      // codes-barres 1D comme le CODE_128 de nos étiquettes. Ce réglage est à
      // la racine de la config (pas dans experimentalFeatures, qui est
      // l'ancien emplacement — le garder aussi ne coûte rien pour les
      // versions plus anciennes de la librairie).
      useBarCodeDetectorIfSupported: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: false },
      verbose: false,
    });
    let dejaDetecte = false;
    let demarre = false;

    instance
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (largeurVue, hauteurVue) => {
            const cote = Math.floor(Math.min(largeurVue, hauteurVue) * 0.7);
            return { width: cote, height: Math.floor(cote * 0.6) };
          }, disableFlip: false },
        (texteDecode) => {
          if (dejaDetecte) return;
          dejaDetecte = true;
          onDetect(texteDecode);
        },
        () => {
          // Échec de décodage sur une frame donnée : normal en continu, on ignore.
        }
      )
      .then(() => { demarre = true; })
      .catch(() => setErreurCamera("Impossible d'accéder à la caméra. Vérifie que le navigateur y est autorisé."));

    return () => {
      if (demarre) {
        instance.stop().then(() => instance.clear()).catch(() => {});
      } else {
        instance.clear().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modale-fond" onClick={onClose}>
      <div className="modale" onClick={(e) => e.stopPropagation()}>
        <h2>Scanner un produit</h2>
        <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
          Vise le code-barres avec la caméra du téléphone ou de la tablette.
        </p>
        {erreurCamera && <div className="erreur">{erreurCamera}</div>}
        <div id="zone-scan-camera" style={{ width: '100%', borderRadius: 'var(--rayon-petit)', overflow: 'hidden' }} />
        <div className="actions-modale">
          <button className="btn" onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  );
}

function IconCoche() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12.5l2.5 2.5L16 9" />
    </svg>
  );
}

function optionsDeVente(produit) {
  const detail = {
    unitId: null,
    label: produit.is_weighted ? 'Au poids' : 'Détail',
    price: Number(produit.unit_price),
    quantityPerUnit: 1,
  };
  const gros = (produit.units || []).map((u) => ({
    unitId: u.id,
    label: u.label,
    price: Number(u.price),
    quantityPerUnit: u.quantity_per_unit,
  }));
  return [detail, ...gros];
}

function cleLigne(productId, unitId) {
  return `${productId}::${unitId || 'detail'}`;
}

// Même règle que sur les étiquettes (StockPage.jsx) : SKU si renseigné,
// sinon les 6 premiers caractères de l'id produit.
function codeInterne(produit) {
  return produit.sku || produit.id.slice(0, 6).toUpperCase();
}

export function OrdersPage() {
  const { user } = useAuth();
  const peutCreer = PEUT_CREER.includes(user.role);
  const peutEncaisser = PEUT_ENCAISSER.includes(user.role);
  const peutGererStatut = PEUT_GERER_STATUT.includes(user.role);
  const estManager = user.role === 'manager';
  const { isOnline, createOrder: creerVenteHorsLigne } = useOfflineSync(api);

  const [onglet, setOnglet] = useState(peutCreer ? 'caisse' : 'historique');
  const [orders, setOrders] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  // Boutique active — seul le manager doit la choisir explicitement (les
  // autres rôles sont assignés à la leur, le backend l'applique tout seul).
  // Même mémorisation locale que StockPage, pour rester cohérent d'une page à l'autre.
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

  const [rechercheCaisse, setRechercheCaisse] = useState('');
  const [panier, setPanier] = useState([]);
  const [clientId, setClientId] = useState('');
  const [tvaApplicable, setTvaApplicable] = useState(false);
  const [venteEnCours, setVenteEnCours] = useState(false);
  const [confirmationVente, setConfirmationVente] = useState(null);
  const [choixConditionnement, setChoixConditionnement] = useState(null);
  const [saisiePoids, setSaisiePoids] = useState(null);
  const [valeurPoids, setValeurPoids] = useState('');
  const [scannerCameraOuvert, setScannerCameraOuvert] = useState(false);
  const rechercheCaisseRef = useRef(null);

  const [commandeAEncaisser, setCommandeAEncaisser] = useState(null);
  const [chargementDetail, setChargementDetail] = useState(false);
  const [commandeEnEdition, setCommandeEnEdition] = useState(null);
  const [confirmationModification, setConfirmationModification] = useState(null);

  const [detailCommande, setDetailCommande] = useState(null);
  const [chargementDetailCommande, setChargementDetailCommande] = useState(false);
  const [exportDebut, setExportDebut] = useState(() => new Date().toISOString().slice(0, 10));
  const [exportFin, setExportFin] = useState(() => new Date().toISOString().slice(0, 10));
  const [exportEnCours, setExportEnCours] = useState(false);

  async function ouvrirDetailHistorique(order) {
    setChargementDetailCommande(true);
    setErreur('');
    try {
      const detail = await api.getOrder(order.id);
      setDetailCommande(detail);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargementDetailCommande(false);
    }
  }

  async function exporterVentesPdf() {
    setExportEnCours(true);
    setErreur('');
    try {
      await api.downloadOrdersPdf(exportDebut, exportFin, estManager ? warehouseId : undefined);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setExportEnCours(false);
    }
  }

  const peutTraiterRenvoi = ['manager', 'gerant', 'vendeur'].includes(user.role);

  // La liste des commandes (GET /orders) ne contient pas le détail des
  // articles : on va chercher la commande complète avant d'ouvrir la
  // modale d'encaissement, pour que le caissier voie exactement ce qui a
  // été vendu.
  async function ouvrirEncaissement(order) {
    setChargementDetail(true);
    setErreur('');
    try {
      const detail = await api.getOrder(order.id);
      setCommandeAEncaisser(detail);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargementDetail(false);
    }
  }

  // Reconstruit le panier à partir d'une commande renvoyée par le caissier,
  // pour que le vendeur reparte des articles déjà saisis plutôt que de zéro.
  function construirePanierDepuisCommande(detail, produitsDisponibles) {
    return (detail.items || []).map((item) => {
      const produit = produitsDisponibles.find((p) => p.id === item.product_id);
      let unitId = null;
      if (item.packaging_label && produit) {
        const unite = (produit.units || []).find((u) => u.label === item.packaging_label);
        if (unite) unitId = unite.id;
      }
      const quantity = item.packaging_label ? item.packaging_quantity : item.quantity;
      return { productId: item.product_id, unitId, quantity };
    });
  }

  async function demarrerModification(order) {
    setChargementDetail(true);
    setErreur('');
    try {
      const detail = await api.getOrder(order.id);
      setPanier(construirePanierDepuisCommande(detail, products));
      setClientId(detail.client_id ? String(detail.client_id) : '');
      setTvaApplicable(Boolean(detail.tva_applicable));
      setCommandeEnEdition(detail);
      setOnglet('caisse');
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargementDetail(false);
    }
  }

  function annulerEdition() {
    setPanier([]);
    setClientId('');
    setTvaApplicable(false);
    setCommandeEnEdition(null);
    setOnglet('historique');
  }

  async function annulerCommandeRenvoyee(order) {
    try {
      await api.updateOrderStatus(order.id, 'annulee');
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  function charger() {
    // Un manager sans boutique sélectionnée ne doit pas appeler /orders ni
    // /products (le backend renverrait 400 "La boutique est requise").
    if (estManager && !warehouseId) return;
    setChargement(true);
    Promise.all([api.getOrders(estManager ? warehouseId : undefined), api.getClients(), api.getProducts(estManager ? warehouseId : undefined)])
      .then(([o, c, p]) => {
        setOrders(o);
        setClients(c);
        setProducts(p);
        // Copie locale pour pouvoir continuer à vendre hors-ligne : on ne
        // met à jour ce cache que lorsqu'on a effectivement pu joindre le
        // serveur (donc jamais avec des données déjà périmées).
        cacheProducts(p);
        cacheClients(c);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, [warehouseId]);

  // Temps réel : dès qu'une vente est créée (par un vendeur) ou qu'une
  // activité est enregistrée quelque part dans l'app (encaissement, retour
  // au vendeur, annulation…), on recharge la liste sans que l'utilisateur
  // ait besoin d'actualiser la page.
  useLiveEvent('order:created', () => charger());
  useLiveEvent('activity:created', () => charger());

  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const idAModifier = searchParams.get('modifier');
    if (idAModifier && products.length > 0) {
      demarrerModification({ id: idAModifier });
      searchParams.delete('modifier');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, products]);

  const produitsCaisse = useMemo(() => {
    const recherche = rechercheCaisse.trim().toLowerCase();
    if (!recherche) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(recherche) || codeInterne(p).toLowerCase().includes(recherche)
    );
  }, [products, rechercheCaisse]);

  function demarrerAjout(produit) {
    if (produit.is_weighted) {
      const options = optionsDeVente(produit);
      if (options.length === 1) {
        // Aucun sac configuré pour ce produit : vente au poids directe.
        setValeurPoids('');
        setSaisiePoids(produit);
      } else {
        // Des sacs à prix fixe existent (ex: sac de pommes de terre) :
        // on laisse choisir entre "au poids" et un des sacs.
        setChoixConditionnement(produit);
      }
      return;
    }
    const options = optionsDeVente(produit);
    if (options.length === 1) {
      ajouterAuPanier(produit, options[0]);
    } else {
      setChoixConditionnement(produit);
    }
  }

  // Commun à la douchette (Entrée dans le champ de recherche) et au scan
  // caméra : cherche une correspondance exacte sur le SKU/code interne et
  // ajoute directement le produit au panier.
  function traiterCodeScanne(code) {
    const valeur = code.trim().toLowerCase();
    if (!valeur) return;
    const produit = products.find(
      (p) => codeInterne(p).toLowerCase() === valeur || (p.sku && p.sku.toLowerCase() === valeur)
    );
    if (!produit) {
      setErreur(`Aucun produit ne correspond au code "${code.trim()}".`);
      return;
    }
    if (produit.quantity_in_stock <= 0) {
      setErreur(`${produit.name} est en rupture de stock.`);
      return;
    }
    setErreur('');
    demarrerAjout(produit);
  }

  function handleRechercheCaisseKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!rechercheCaisse.trim()) return;
    traiterCodeScanne(rechercheCaisse);
    setRechercheCaisse('');
  }

  function handleCodeDetecteParCamera(code) {
    setScannerCameraOuvert(false);
    traiterCodeScanne(code);
  }

  function ajouterAuPanier(produit, option) {
    const baseParUnite = option.quantityPerUnit;
    const stockDisponibleEnOptions = Math.floor(produit.quantity_in_stock / baseParUnite);
    if (stockDisponibleEnOptions <= 0) return;

    setPanier((prev) => {
      const cle = cleLigne(produit.id, option.unitId);
      const existant = prev.find((l) => cleLigne(l.productId, l.unitId) === cle);
      if (existant) {
        if (existant.quantity >= stockDisponibleEnOptions) return prev;
        return prev.map((l) => (cleLigne(l.productId, l.unitId) === cle ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { productId: produit.id, unitId: option.unitId, quantity: 1 }];
    });
    setChoixConditionnement(null);
  }

  function changerQuantite(productId, unitId, delta) {
    setPanier((prev) =>
      prev
        .map((l) => (l.productId === productId && l.unitId === unitId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  // Arrondit à 1 décimale (100g près) : on ne vend pas au gramme près.
  function arrondirPoids(valeur) {
    return Math.round(valeur * 10) / 10;
  }

  function ajouterPeseAuPanier(produit, poids) {
    const stockDisponible = produit.quantity_in_stock;
    if (!(poids > 0) || poids > stockDisponible) return;

    setPanier((prev) => {
      const cle = cleLigne(produit.id, null);
      const existant = prev.find((l) => cleLigne(l.productId, l.unitId) === cle);
      if (existant) {
        const nouveauPoids = arrondirPoids(Math.min(existant.quantity + poids, stockDisponible));
        return prev.map((l) => (cleLigne(l.productId, l.unitId) === cle ? { ...l, quantity: nouveauPoids } : l));
      }
      return [...prev, { productId: produit.id, unitId: null, quantity: arrondirPoids(poids) }];
    });
    setSaisiePoids(null);
    setValeurPoids('');
  }

  function handleValiderPoids(e) {
    e.preventDefault();
    const poids = arrondirPoids(Number(valeurPoids));
    if (!poids || poids <= 0) {
      setErreur('Entrez un poids valide (ex : 0.5).');
      return;
    }
    if (poids > saisiePoids.quantity_in_stock) {
      setErreur(`Stock insuffisant : ${Number(saisiePoids.quantity_in_stock).toFixed(1)} kg disponible(s).`);
      return;
    }
    setErreur('');
    ajouterPeseAuPanier(saisiePoids, poids);
  }

  function modifierPoidsLigne(productId, unitId, nouveauPoidsStr) {
    const nouveauPoids = arrondirPoids(Number(nouveauPoidsStr));
    setPanier((prev) =>
      prev
        .map((l) => (l.productId === productId && l.unitId === unitId ? { ...l, quantity: nouveauPoids } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  function retirerDuPanier(productId, unitId) {
    setPanier((prev) => prev.filter((l) => !(l.productId === productId && l.unitId === unitId)));
  }

  const lignesPanier = panier
    .map((l) => {
      const produit = products.find((p) => p.id === l.productId);
      if (!produit) return null;
      const option = optionsDeVente(produit).find((o) => o.unitId === l.unitId);
      if (!option) return null;
      return { ...l, produit, option };
    })
    .filter(Boolean);

  const apercuCaisse = useMemo(() => {
    const sousTotal = lignesPanier.reduce((sum, l) => sum + l.option.price * l.quantity, 0);
    const tva = tvaApplicable ? Math.round(sousTotal * 0.18) : 0;
    return { sousTotal, tva, total: sousTotal + tva };
  }, [lignesPanier, tvaApplicable]);

  async function handlePayer() {
    if (lignesPanier.length === 0) return;
    setVenteEnCours(true);
    setErreur('');
    const payload = {
      clientId: clientId || null,
      items: panier.map((l) => ({ productId: l.productId, quantity: l.quantity, unitId: l.unitId || undefined })),
      tvaApplicable,
      warehouseId: estManager ? warehouseId : undefined,
    };
    try {
      if (commandeEnEdition) {
        const commande = await api.updateOrder(commandeEnEdition.id, payload);
        setPanier([]);
        setClientId('');
        setTvaApplicable(false);
        setCommandeEnEdition(null);
        setOnglet('historique');
        charger();
        setConfirmationModification(commande);
      } else {
        // creerVenteHorsLigne (useOfflineSync) décide seul : envoi direct si
        // en ligne, mise en file locale sinon. Dans ce dernier cas, la
        // réponse n'a pas de vrai order_number/id serveur — voir le rendu
        // de la modale de confirmation plus bas (order.offline).
        const commande = await creerVenteHorsLigne(payload);
        setPanier([]);
        setClientId('');
        setTvaApplicable(false);
        if (!commande.offline) charger();
        if (commande.offline) {
          setConfirmationVente(commande);
        } else if (peutEncaisser) {
          ouvrirEncaissement(commande);
        } else {
          setConfirmationVente(commande);
        }
      }
    } catch (err) {
      setErreur(err.message);
    } finally {
      setVenteEnCours(false);
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

  const ordersTries = peutEncaisser
    ? [...orders].sort((a, b) => {
        if (a.status === 'en_attente' && b.status !== 'en_attente') return -1;
        if (b.status === 'en_attente' && a.status !== 'en_attente') return 1;
        return new Date(b.created_at) - new Date(a.created_at);
      })
    : peutTraiterRenvoi
    ? [...orders].sort((a, b) => {
        if (a.status === 'renvoyee_vendeur' && b.status !== 'renvoyee_vendeur') return -1;
        if (b.status === 'renvoyee_vendeur' && a.status !== 'renvoyee_vendeur') return 1;
        return new Date(b.created_at) - new Date(a.created_at);
      })
    : orders;

  return (
    <>
      <div className="entete-page">
        <h1>Ventes & caisse</h1>
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
        <p className="etat-vide">Aucune boutique n'a encore été créée. Créez-en une avant d'enregistrer des ventes.</p>
      )}

      <div className="onglets">
        {peutCreer && (
          <button className={onglet === 'caisse' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('caisse')}>
            Caisse
          </button>
        )}
        <button className={onglet === 'historique' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('historique')}>
          Historique
        </button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {onglet === 'caisse' && peutCreer && (
        <div className="mise-en-page-caisse">
          <div className="caisse-produits">
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <div className="champ-avec-icone" style={{ marginBottom: 0, flex: 1 }}>
                <span className="champ-icone"><IconRecherche /></span>
                <input
                  ref={rechercheCaisseRef}
                  type="text"
                  className="champ champ--avec-icone"
                  placeholder="Rechercher ou scanner un produit…"
                  value={rechercheCaisse}
                  onChange={(e) => setRechercheCaisse(e.target.value)}
                  onKeyDown={handleRechercheCaisseKeyDown}
                />
              </div>
              <button
                type="button"
                className="btn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                onClick={() => setScannerCameraOuvert(true)}
              >
                <IconCamera />
                Scanner
              </button>
            </div>
            <div className="grille-caisse">
              {produitsCaisse.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="carte-caisse"
                  disabled={p.quantity_in_stock <= 0}
                  onClick={() => demarrerAjout(p)}
                >
                  <span className="carte-produit-icone"><IconPanier /></span>
                  <span className="carte-caisse-nom">{p.name}</span>
                  <span className="carte-caisse-prix">{Math.round(p.unit_price).toLocaleString('fr-FR')}</span>
                  {p.quantity_in_stock <= 0 ? (
                    <span className="tampon tampon-brique" style={{ marginTop: 4 }}>Rupture</span>
                  ) : (
                    <span className="carte-caisse-stock">
                      {p.is_weighted ? Number(p.quantity_in_stock).toFixed(1) : Math.round(Number(p.quantity_in_stock))}{p.is_weighted ? ' kg' : ''} en stock{p.units?.length > 0 ? ' · gros dispo' : ''}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="caisse-ticket">
            {commandeEnEdition && (
              <div
                style={{
                  background: 'var(--danger-clair)',
                  color: 'var(--danger)',
                  borderRadius: 'var(--rayon-petit)',
                  padding: '10px 14px',
                  marginBottom: 12,
                  fontSize: 13,
                }}
              >
                Modification de la commande <strong>{commandeEnEdition.order_number}</strong>, renvoyée par le caissier
                {commandeEnEdition.returned_reason ? ` (${commandeEnEdition.returned_reason})` : ''}.{' '}
                <button
                  type="button"
                  onClick={annulerEdition}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}
                >
                  Abandonner la modification
                </button>
              </div>
            )}
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="c-client">Client</label>
              <select id="c-client" className="champ" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Client de passage</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>

            <div className="ticket-lignes">
              {lignesPanier.length === 0 ? (
                <p className="etat-vide" style={{ padding: '32px 8px' }}>Ticket vide. Touchez un produit pour l'ajouter.</p>
              ) : (
                lignesPanier.map((l) => (
                  <div key={cleLigne(l.productId, l.unitId)} className="ticket-ligne">
                    <div style={{ minWidth: 0 }}>
                      <p className="ticket-ligne-nom">
                        {l.produit.name}
                        {l.option.label !== 'Détail' && <span style={{ color: 'var(--accent)' }}> · {l.option.label}</span>}
                      </p>
                      <p className="ticket-ligne-prix">
                        {Math.round(l.option.price).toLocaleString('fr-FR')} FCFA{l.produit.is_weighted ? '/kg' : ''}
                      </p>
                    </div>
                    {l.produit.is_weighted ? (
                      <div className="ticket-ligne-qte">
                        <input
                          type="number"
                          min="0.1"
                          step="0.1"
                          value={l.quantity}
                          onChange={(e) => modifierPoidsLigne(l.productId, l.unitId, e.target.value)}
                          style={{ width: 64, textAlign: 'center' }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--encre-douce)' }}>kg</span>
                      </div>
                    ) : (
                      <div className="ticket-ligne-qte">
                        <button type="button" onClick={() => changerQuantite(l.productId, l.unitId, -1)}>−</button>
                        <span>{l.quantity}</span>
                        <button type="button" onClick={() => changerQuantite(l.productId, l.unitId, 1)}>+</button>
                      </div>
                    )}
                    <button type="button" className="ticket-ligne-retirer" onClick={() => retirerDuPanier(l.productId, l.unitId)}>×</button>
                  </div>
                ))
              )}
            </div>

            <label className="case-a-cocher" style={{ margin: '12px 0' }}>
              <input type="checkbox" checked={tvaApplicable} onChange={(e) => setTvaApplicable(e.target.checked)} />
              Vente avec TVA (18 %)
            </label>

            <div className="ticket-totaux">
              <div className="ticket-total-ligne">
                <span>Sous-total</span>
                <span className="chiffre">{Math.round(apercuCaisse.sousTotal).toLocaleString('fr-FR')}</span>
              </div>
              {tvaApplicable && (
                <div className="ticket-total-ligne">
                  <span>TVA (18 %)</span>
                  <span className="chiffre">{Math.round(apercuCaisse.tva).toLocaleString('fr-FR')}</span>
                </div>
              )}
              <div className="ticket-total-ligne ticket-total-ligne--principal">
                <span>Total à payer</span>
                <span className="chiffre">{Math.round(apercuCaisse.total).toLocaleString('fr-FR')} FCFA</span>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-principal"
              style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
              disabled={lignesPanier.length === 0 || venteEnCours || (estManager && !warehouseId && !commandeEnEdition)}
              onClick={handlePayer}
            >
              {venteEnCours
                ? 'Enregistrement…'
                : commandeEnEdition
                ? `Enregistrer les modifications · ${Math.round(apercuCaisse.total).toLocaleString('fr-FR')} FCFA`
                : `Payer · ${Math.round(apercuCaisse.total).toLocaleString('fr-FR')} FCFA`}
            </button>
          </div>
        </div>
      )}

      {onglet === 'historique' && (
        <>
          <div className="barre-outils">
            <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{orders.length} vente(s)</span>
          </div>

          <div className="barre-filtres" style={{ marginBottom: 16 }}>
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="ov-debut">Du</label>
              <input id="ov-debut" type="date" className="champ" value={exportDebut} onChange={(e) => setExportDebut(e.target.value)} />
            </div>
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="ov-fin">Au</label>
              <input id="ov-fin" type="date" className="champ" value={exportFin} onChange={(e) => setExportFin(e.target.value)} />
            </div>
            <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={exporterVentesPdf} disabled={exportEnCours}>
              {exportEnCours ? 'Génération…' : 'Exporter PDF'}
            </button>
          </div>

          {chargement ? (
            <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
          ) : orders.length === 0 ? (
            <p className="etat-vide">Aucune vente enregistrée pour le moment.</p>
          ) : (
            <table className="registre">
              <thead>
                <tr>
                  <th>N° commande</th>
                  <th>Client</th>
                  <th>Montant</th>
                  <th>Statut</th>
                  {(peutEncaisser || peutGererStatut || peutTraiterRenvoi) && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {ordersTries.map((o) => (
                  <tr
                    key={o.id}
                    className={
                      'ligne-cliquable' +
                      (((o.status === 'en_attente' && peutEncaisser) || (o.status === 'renvoyee_vendeur' && peutTraiterRenvoi))
                        ? ' ligne-prioritaire'
                        : '')
                    }
                    onClick={() => ouvrirDetailHistorique(o)}
                  >
                    <td className="chiffre">{o.order_number}</td>
                    <td>{o.client_name || 'Client de passage'}</td>
                    <td className="chiffre">{Math.round(o.total_amount).toLocaleString('fr-FR')} FCFA</td>
                    <td><StatusBadge status={o.status} /></td>
                    {(peutEncaisser || peutGererStatut || peutTraiterRenvoi) && (
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                        {peutEncaisser && o.status === 'en_attente' && (
                          <button
                            className="btn btn-principal"
                            style={{ padding: '5px 10px', fontSize: 13 }}
                            disabled={chargementDetail}
                            onClick={() => ouvrirEncaissement(o)}
                          >
                            Encaisser
                          </button>
                        )}
                        {peutTraiterRenvoi && o.status === 'renvoyee_vendeur' && (
                          <>
                            <button
                              className="btn btn-principal"
                              style={{ padding: '5px 10px', fontSize: 13 }}
                              disabled={chargementDetail}
                              onClick={() => demarrerModification(o)}
                            >
                              Modifier
                            </button>
                            <button
                              className="btn btn-brique"
                              style={{ padding: '5px 10px', fontSize: 13 }}
                              onClick={() => annulerCommandeRenvoyee(o)}
                            >
                              Annuler
                            </button>
                          </>
                        )}
                        {peutGererStatut && o.status === 'validee' && o.client_name && (
                          <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => handleStatut(o, 'livree')}>
                            Marquer livrée
                          </button>
                        )}
                        {peutGererStatut && ['en_attente', 'validee'].includes(o.status) && (
                          <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => handleStatut(o, 'annulee')}>
                            Annuler
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {scannerCameraOuvert && (
        <ModaleScanCamera onDetect={handleCodeDetecteParCamera} onClose={() => setScannerCameraOuvert(false)} />
      )}

      {choixConditionnement && (
        <div className="modale-fond" onClick={() => setChoixConditionnement(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>{choixConditionnement.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>Choisissez le conditionnement à vendre</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {optionsDeVente(choixConditionnement).map((option) => (
                <button
                  key={option.unitId || 'detail'}
                  type="button"
                  className="btn"
                  style={{ justifyContent: 'space-between', padding: '12px 16px' }}
                  onClick={() => {
                    if (option.unitId === null && choixConditionnement.is_weighted) {
                      const produit = choixConditionnement;
                      setChoixConditionnement(null);
                      setValeurPoids('');
                      setSaisiePoids(produit);
                    } else {
                      ajouterAuPanier(choixConditionnement, option);
                    }
                  }}
                >
                  <span>
                    {option.label}
                    {option.quantityPerUnit > 1 ? ` (${option.quantityPerUnit}${choixConditionnement.is_weighted ? ' kg' : ' unités'})` : ''}
                  </span>
                  <span className="chiffre">
                    {option.unitId === null && choixConditionnement.is_weighted
                      ? `${Math.round(option.price).toLocaleString('fr-FR')} FCFA/kg`
                      : `${Math.round(option.price).toLocaleString('fr-FR')} FCFA`}
                  </span>
                </button>
              ))}
            </div>
            <div className="actions-modale">
              <button className="btn" onClick={() => setChoixConditionnement(null)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {saisiePoids && (
        <div className="modale-fond" onClick={() => setSaisiePoids(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>{saisiePoids.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
              {Math.round(saisiePoids.unit_price).toLocaleString('fr-FR')} FCFA/kg · {Number(saisiePoids.quantity_in_stock).toFixed(1)} kg en stock
            </p>
            <form onSubmit={handleValiderPoids}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="poids-saisi">Poids (kg)</label>
                <input
                  id="poids-saisi"
                  type="number"
                  step="0.1"
                  min="0.1"
                  autoFocus
                  className="champ"
                  placeholder="Ex : 0.5"
                  value={valeurPoids}
                  onChange={(e) => setValeurPoids(e.target.value)}
                />
              </div>
              {Number(valeurPoids) > 0 && (
                <p style={{ fontSize: 14, marginBottom: 12 }}>
                  Total : <strong>{Math.round(Number(valeurPoids) * saisiePoids.unit_price).toLocaleString('fr-FR')} FCFA</strong>
                </p>
              )}
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setSaisiePoids(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal">Ajouter</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {commandeAEncaisser && (
        <ModaleEncaissement
          commande={commandeAEncaisser}
          onClose={() => setCommandeAEncaisser(null)}
          onSuccess={() => {
            setCommandeAEncaisser(null);
            charger();
          }}
        />
      )}

      {(detailCommande || chargementDetailCommande) && (
        <div className="modale-fond" onClick={() => setDetailCommande(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            {chargementDetailCommande && !detailCommande ? (
              <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
            ) : (
              <>
                <h2>{detailCommande.order_number}</h2>
                <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
                  {detailCommande.client_name || 'Client de passage'} · <StatusBadge status={detailCommande.status} />
                </p>
                <table className="registre" style={{ marginBottom: 16 }}>
                  <thead>
                    <tr>
                      <th>Produit</th>
                      <th>Qté</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailCommande.items.map((it) => (
                      <tr key={it.id}>
                        <td>{it.product_name}</td>
                        <td className="chiffre">{it.quantity}</td>
                        <td className="chiffre">{Math.round(it.line_total).toLocaleString('fr-FR')} FCFA</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontWeight: 700, textAlign: 'right', marginBottom: 16 }}>
                  Total : {Math.round(detailCommande.total_amount).toLocaleString('fr-FR')} FCFA
                </p>
                <div className="actions-modale">
                  <button className="btn" onClick={() => setDetailCommande(null)}>Fermer</button>
                  <button
                    className="btn btn-principal"
                    onClick={() => api.previewOrderReceipt(detailCommande.id).catch((err) => setErreur(err.message))}
                  >
                    Télécharger en PDF
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {confirmationVente && (
        <div className="modale-fond" onClick={() => setConfirmationVente(null)}>
          <div className="modale" style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ color: 'var(--vif)', margin: '0 auto 12px', width: 'fit-content' }}>
              <IconCoche />
            </div>
            <h2 style={{ marginBottom: 6 }}>{confirmationVente.offline ? 'Vente enregistrée localement' : 'Vente enregistrée'}</h2>
            <p style={{ color: 'var(--encre-douce)', fontSize: 14, marginBottom: 16 }}>
              {confirmationVente.offline
                ? 'Pas de connexion — elle sera envoyée à la caisse automatiquement dès que le réseau revient.'
                : 'Elle a été envoyée à la caisse pour encaissement.'}
            </p>
            <div style={{ background: 'var(--fond)', border: '1px solid var(--trait)', borderRadius: 'var(--rayon-petit)', padding: '14px', marginBottom: 16 }}>
              {confirmationVente.offline ? (
                <p style={{ fontSize: 13, color: 'var(--encre-douce)', margin: 0 }}>
                  En attente de synchronisation — le numéro définitif sera visible dans l'historique une fois envoyée.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: 'var(--encre-douce)', margin: '0 0 4px' }}>Numéro à donner au client</p>
                  <p className="chiffre" style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{confirmationVente.order_number}</p>
                  <p style={{ fontSize: 13, color: 'var(--encre-douce)', margin: '4px 0 0' }}>
                    Total : {Math.round(confirmationVente.total_amount).toLocaleString('fr-FR')} FCFA
                  </p>
                </>
              )}
            </div>
            <button className="btn btn-principal" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setConfirmationVente(null)}>
              Compris
            </button>
          </div>
        </div>
      )}

      {confirmationModification && (
        <div className="modale-fond" onClick={() => setConfirmationModification(null)}>
          <div className="modale" style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ color: 'var(--vif)', margin: '0 auto 12px', width: 'fit-content' }}>
              <IconCoche />
            </div>
            <h2 style={{ marginBottom: 6 }}>Commande modifiée</h2>
            <p style={{ color: 'var(--encre-douce)', fontSize: 14, marginBottom: 16 }}>
              Elle est repartie chez le caissier pour encaissement.
            </p>
            <div style={{ background: 'var(--fond)', border: '1px solid var(--trait)', borderRadius: 'var(--rayon-petit)', padding: '14px', marginBottom: 16 }}>
              <p className="chiffre" style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{confirmationModification.order_number}</p>
              <p style={{ fontSize: 13, color: 'var(--encre-douce)', margin: '4px 0 0' }}>
                Nouveau total : {Math.round(confirmationModification.total_amount).toLocaleString('fr-FR')} FCFA
              </p>
            </div>
            <button className="btn btn-principal" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setConfirmationModification(null)}>
              Compris
            </button>
          </div>
        </div>
      )}
    </>
  );
}
