import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { ActiviteListe, initiales, couleurPour } from '../components/ActiviteListe';
import { ModaleEncaissement } from '../components/ModaleEncaissement';
import { useLiveEvent } from '../offline/liveEvents';
import { RappelsFiscaux } from '../components/RappelsFiscaux';

// Quantités : la base renvoie NUMERIC(12,3) sous forme de texte ("12.000").
// On retire les décimales inutiles ("12"), et on garde une vraie décimale pour
// un produit vendu au poids ("2.500" devient "2,5").
function formaterQuantite(valeur) {
  const n = Number(valeur);
  return Number.isFinite(n) ? String(n).replace('.', ',') : '0';
}

function IconValeur() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="7" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconAlerte() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  );
}

function IconVentes() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
    </svg>
  );
}

function IconHorloge() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

function IconCamion() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="1" y="7" width="13" height="10" rx="1" />
      <path d="M14 10h4l3 3v4h-7z" />
      <circle cx="5.5" cy="19" r="1.6" />
      <circle cx="17.5" cy="19" r="1.6" />
    </svg>
  );
}

function IconCaisse() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 11h20M7 15h4" />
    </svg>
  );
}

function dateAujourdHui() {
  return new Date().toISOString().slice(0, 10);
}

function IconCloche() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}

// Convertit la clé publique VAPID (base64 URL-safe) en Uint8Array, format
// attendu par pushManager.subscribe().
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

const NOMS_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
function formatMois(moisStr) {
  const [annee, mois] = moisStr.split('-');
  return `${NOMS_MOIS[Number(mois) - 1]} ${annee}`;
}

const fcfa = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');

// Version courte pour les étiquettes de graphique : 1 250 000 -> 1,3 M, 125 000 -> 125 k.
function abreger(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(Math.round(v / 100000) / 10).toString().replace('.', ',')} M`;
  if (v >= 1000) return `${Math.round(v / 1000)} k`;
  return String(Math.round(v));
}

// Styles du tableau de bord (préfixe db-). Ils s'appuient sur les variables
// CSS existantes (--accent, --trait, --surface, --encre-douce, --danger…).
const CSS_DASHBOARD = `
.db-salut{margin:-6px 0 18px;font-size:14px;color:var(--encre-douce)}
.db-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.db-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px}
.db-kpi{display:flex;flex-direction:column;gap:4px;background:var(--surface,#fff);border:1px solid var(--trait,#e5e7eb);border-radius:14px;padding:12px 14px;transition:border-color .15s,box-shadow .15s}
.db-kpi--clic{cursor:pointer}
.db-kpi--clic:hover{border-color:var(--accent);box-shadow:0 6px 18px rgba(17,24,39,.08)}
.db-kpi-icone{display:flex;align-items:center;justify-content:center;width:30px;height:30px;margin-bottom:6px;border-radius:9px;background:#eef2ff;background:var(--accent-clair,#eef2ff);color:var(--accent)}
.db-kpi--alerte .db-kpi-icone{background:var(--danger-clair,#fef2f2);color:var(--danger,#b91c1c)}
.db-kpi-label{margin:0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--encre-douce)}
.db-kpi-valeur{margin:0;font-size:20px;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums}
.db-kpi-valeur small{font-size:12px;font-weight:500;color:var(--encre-douce)}
.db-kpi-sous{margin:0;font-size:11px;color:var(--encre-douce)}
.db-kpi--hero{background:var(--accent);border-color:var(--accent);color:#fff}
.db-kpi--hero .db-kpi-icone{background:rgba(255,255,255,.18);color:#fff}
.db-kpi--hero .db-kpi-label,.db-kpi--hero .db-kpi-sous,.db-kpi--hero .db-kpi-valeur small{color:rgba(255,255,255,.8)}
.db-grille{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px;margin-bottom:24px}
.db-carte{background:var(--surface,#fff);border:1px solid var(--trait,#e5e7eb);border-radius:16px;padding:18px}
.db-carte-tete{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:14px}
.db-carte-tete h2{margin:0;font-size:15px}
.db-carte-tete span{font-size:13px;font-weight:600;color:var(--encre-douce);font-variant-numeric:tabular-nums}
.db-lien{padding:0;border:none;background:none;color:var(--accent);font-size:13px;cursor:pointer}
.db-histo{display:flex;align-items:flex-end;gap:10px;height:190px}
.db-histo-col{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px}
.db-histo-barre{width:100%;max-width:44px;border-radius:8px 8px 4px 4px;background:#e0e7ff;background:color-mix(in srgb,var(--accent) 22%,transparent);transition:height .3s}
.db-histo-col--jour .db-histo-barre{background:var(--accent)}
.db-histo-val{font-size:11px;white-space:nowrap;color:var(--encre-douce);font-variant-numeric:tabular-nums}
.db-histo-col--jour .db-histo-val{color:var(--accent);font-weight:700}
.db-histo-label{font-size:12px;color:var(--encre-douce)}
.db-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start;margin-bottom:24px}
.db-puces{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}
.db-puce{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border:1px solid var(--trait,#e5e7eb);border-radius:999px;background:var(--surface,#fff);color:var(--encre-douce);font-size:12px;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.db-puce:hover{border-color:var(--accent)}
.db-puce.actif{background:var(--accent);border-color:var(--accent);color:#fff}
.db-puce span{opacity:.75;font-variant-numeric:tabular-nums}
.db-titre-section{margin:14px 0 4px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--encre-douce)}
.db-ligne{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--trait,#e5e7eb)}
.db-ligne:first-of-type{border-top:none}
.db-titre-section + .db-ligne{border-top:none}
.db-pastille{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:38px;height:38px;border-radius:11px;font-size:14px;font-weight:700;background:#eef2ff;background:var(--accent-clair,#eef2ff);color:var(--accent)}
.db-pastille--danger{background:var(--danger-clair,#fef2f2);color:var(--danger,#b91c1c)}
.db-ligne-droite{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.db-montant-ligne{margin:0;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.db-table{background:var(--surface,#fff);border:1px solid var(--trait,#e5e7eb);border-radius:14px;overflow-x:auto}
.db-table table{width:100%;margin:0 !important;border-collapse:collapse}
.db-table th{padding:10px 14px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;text-align:left;color:var(--encre-douce);background:var(--fond,#f9fafb);border-bottom:1px solid var(--trait,#e5e7eb)}
.db-table td{padding:12px 14px;border-top:1px solid var(--trait,#e5e7eb)}
.db-table tbody tr:first-child td{border-top:none}
.db-alerte{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--trait,#e5e7eb)}
.db-alerte:first-child{border-top:none;padding-top:0}
.db-alerte-nom{margin:0;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.db-alerte-qte{margin:2px 0 0;font-size:12px;color:var(--encre-douce)}
.db-barres{display:flex;flex-direction:column;gap:14px}
.db-barre-ligne{display:grid;grid-template-columns:150px minmax(0,1fr) auto;gap:12px;align-items:center}
.db-barre-nom{margin:0;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.db-barre-piste{height:10px;border-radius:999px;background:var(--fond,#f3f4f6);overflow:hidden}
.db-barre-rempli{height:100%;border-radius:999px;background:var(--accent)}
.db-barre-montant{margin:0;font-size:14px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums}
.db-barre-sous{display:block;font-size:11px;font-weight:400;color:var(--encre-douce)}
@media (max-width:860px){
  .db-grille,.db-cols{grid-template-columns:1fr}
  .db-barre-ligne{grid-template-columns:minmax(0,1fr) auto}
  .db-barre-piste{grid-column:1 / -1;order:3}
}
`;

// Un comptable (sans autre rôle) n'a ni stock ni ventes : son tableau de bord se limite aux rappels fiscaux
// et aux raccourcis vers ses trois modules.
function DashboardComptable() {
  const navigate = useNavigate();
  const raccourcis = [
    { to: '/comptabilite', titre: 'Comptabilité', texte: 'Écritures, grand livre, bilan, clôture.' },
    { to: '/fiscalite', titre: 'Fiscalité', texte: 'Déclarations, impôts à payer, profil fiscal.' },
    { to: '/paie', titre: 'Paie', texte: 'Salaires, bulletins et réglages de paie.' },
  ];
  return (
    <>
      <div className="entete-page"><h1>Tableau de bord</h1></div>
      <RappelsFiscaux lien="/fiscalite" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {raccourcis.map((r) => (
          <button key={r.to} type="button" className="md-carte" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate(r.to)}>
            <strong style={{ fontSize: 15 }}>{r.titre}</strong>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--encre-douce)', marginTop: 4 }}>{r.texte}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function DashboardPage() {
  const { aRole } = useAuth();
  const comptableSeul = aRole('comptable') && !aRole('manager', 'gerant', 'vendeur', 'caissier');
  return comptableSeul ? <DashboardComptable /> : <DashboardCommerce />;
}

function DashboardCommerce() {
  const { user, merchant } = useAuth();
  const navigate = useNavigate();
  const vueEquipe = ['manager', 'gerant'].includes(user.role);
  const estCaissier = user.role === 'caissier';
  const estVendeur = user.role === 'vendeur';
  const estPharmacie = merchant?.sector === 'pharmacie';

  const [onglet, setOnglet] = useState('pilotage');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const [dateDebut, setDateDebut] = useState(dateAujourdHui());
  const [dateFin, setDateFin] = useState(dateAujourdHui());
  const [activite, setActivite] = useState([]);
  const [chargementActivite, setChargementActivite] = useState(true);
  const [activiteAujourdhui, setActiviteAujourdhui] = useState([]);
  const [retours, setRetours] = useState([]);

  const [commandeDetail, setCommandeDetail] = useState(null);
  const [chargementDetail, setChargementDetail] = useState(false);
  const [commandeAEncaisser, setCommandeAEncaisser] = useState(null);
  const [demandesCredit, setDemandesCredit] = useState([]);
  const [demandesRetour, setDemandesRetour] = useState([]);
  const [chiffreAffaires, setChiffreAffaires] = useState(null);
  const [benefice, setBenefice] = useState(null);
  const [venteParBoutique, setVenteParBoutique] = useState(null);
  const [alerteSalaires, setAlerteSalaires] = useState(null);
  const [lotsBientotPerimes, setLotsBientotPerimes] = useState([]);
  const [horizonOuvert, setHorizonOuvert] = useState(null);
  const [filtreAlerte, setFiltreAlerte] = useState('toutes');
  const [lotsPerimes, setLotsPerimes] = useState(null);
  const [registreDestructions, setRegistreDestructions] = useState(null);
  const [destructionEnCours, setDestructionEnCours] = useState(null);
  const estManager = user.role === 'manager';

  // Même boutique active que Stock/Ventes (mémorisée en local), pour que le
  // manager n'ait pas à la re-choisir en changeant de page.
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


  // Notifications push : statut affiché sur le tableau de bord manager.
  const [statutNotifications, setStatutNotifications] = useState('indisponible'); // indisponible | inactif | actif | erreur
  const [activationEnCours, setActivationEnCours] = useState(false);

  useEffect(() => {
    if (!estManager) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatutNotifications('indisponible');
      return;
    }
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setStatutNotifications(subscription ? 'actif' : 'inactif'))
      .catch(() => setStatutNotifications('inactif'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estManager]);

  async function activerNotifications() {
    setErreur('');
    setActivationEnCours(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatutNotifications('inactif');
        setErreur("Permission de notification refusée dans le navigateur.");
        return;
      }
      const { publicKey } = await api.getVapidPublicKey();
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api.subscribeToPush(subscription.toJSON());
      setStatutNotifications('actif');
    } catch (err) {
      setStatutNotifications('erreur');
      setErreur(err.message || "Impossible d'activer les notifications.");
    } finally {
      setActivationEnCours(false);
    }
  }

  function charger() {
    // Un manager sans boutique sélectionnée ne doit pas appeler /products
    // ni /orders (le backend renverrait 400 "La boutique est requise").
    if (estManager && !warehouseId) return;
    setChargement(true);
    Promise.all([
      api.getProducts(estManager ? warehouseId : undefined),
      api.getOrders(estManager ? warehouseId : undefined),
      api.getActivityToday(),
      api.getReturns(estManager ? warehouseId : undefined),
    ])
      .then(([p, o, a, r]) => {
        setProducts(p);
        setOrders(o);
        setActiviteAujourdhui(a);
        setRetours(r);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));

    if (vueEquipe) {
      api.getCreditRequests('en_attente').then(setDemandesCredit).catch((err) => setErreur(err.message));
      api.getRevenueByWarehouse().then(setVenteParBoutique).catch((err) => setErreur(err.message));
    }
    if (estPharmacie && vueEquipe) {
      api.getReturnRequests(estManager ? warehouseId : undefined)
        .then((liste) => setDemandesRetour(liste.filter((d) => d.status === 'en_attente')))
        .catch((err) => setErreur(err.message));
    }
    if (estManager) {
      api.getRevenue().then(setChiffreAffaires).catch((err) => setErreur(err.message));
      api.getProfit().then(setBenefice).catch((err) => setErreur(err.message));
      api.getSalaryAlert().then(setAlerteSalaires).catch((err) => setErreur(err.message));
    }
    if (estPharmacie && vueEquipe) {
      api.getExpiringLots(estManager ? warehouseId : undefined).then(setLotsBientotPerimes).catch((err) => setErreur(err.message));
      api.getExpiredLots(estManager ? warehouseId : undefined).then(setLotsPerimes).catch((err) => setErreur(err.message));
      api.getLotDestructions(estManager ? warehouseId : undefined).then(setRegistreDestructions).catch((err) => setErreur(err.message));
    }
  }

  // Détruit un lot périmé (le sort du stock) puis rafraîchit l'alerte et le registre.
  async function detruireLotPerime(lot) {
    const ok = window.confirm(
      `Détruire le lot ${lot.lot_number ? `n° ${lot.lot_number} ` : ''}de ${lot.product_name} (${Math.round(Number(lot.quantity))} unité(s)) ?\nIl sera retiré du stock et inscrit au registre des destructions.`
    );
    if (!ok) return;
    setDestructionEnCours(lot.lot_id);
    try {
      await api.destroyProductLot(lot.product_id, lot.lot_id, estManager ? warehouseId : undefined);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setDestructionEnCours(null);
    }
  }

  useEffect(charger, [warehouseId]);

  // Temps réel : une vente créée par un vendeur (widget "à encaisser"), ou
  // n'importe quelle activité journalisée ailleurs dans l'app (encaissement,
  // annulation, retour vendeur, clôture de caisse…), met à jour le tableau
  // de bord sans que l'utilisateur ait besoin d'actualiser la page.
  useLiveEvent('order:created', () => charger());
  useLiveEvent('activity:created', () => {
    charger();
    if (onglet === 'activite') chargerActivite();
  });
  // Approbation/refus d'une demande de crédit : recharger tout de suite pour
  // que le badge et le bouton "Encaisser" de la carte se mettent à jour sans
  // attendre le prochain 'activity:created'.
  useLiveEvent('credit_request:resolved', () => charger());

  function chargerActivite() {
    setChargementActivite(true);
    api.getActivityRange(dateDebut, dateFin).then(setActivite).catch((err) => setErreur(err.message)).finally(() => setChargementActivite(false));
  }

  useEffect(() => {
    if (onglet === 'activite') chargerActivite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet]);

  async function ouvrirDetailCommande(id) {
    setChargementDetail(true);
    try {
      const detail = await api.getOrder(id);
      setCommandeDetail(detail);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargementDetail(false);
    }
  }

  // Le widget "Ventes à encaisser" ne contient que les champs résumés de
  // GET /orders (pas les articles) : on va chercher la commande complète
  // avant d'ouvrir la modale, sinon le caissier voit une facture vide.
  async function ouvrirEncaissementDepuisDashboard(order) {
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

  async function annulerCommandeRenvoyee(order) {
    try {
      await api.updateOrderStatus(order.id, 'annulee');
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function marquerCommandeLivree(order) {
    try {
      await api.updateOrderStatus(order.id, 'livree');
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function approuverDemandeCredit(demande) {
    try {
      await api.approveCreditRequest(demande.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function rejeterDemandeCredit(demande) {
    try {
      await api.rejectCreditRequest(demande.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function approuverDemandeRetour(demande) {
    try {
      await api.approveReturnRequest(demande.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function refuserDemandeRetour(demande) {
    try {
      await api.rejectReturnRequest(demande.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const enRupture = products.filter((p) => p.status === 'rupture');
  const enFaible = products.filter((p) => p.status === 'faible');
  const commandesEnAttente = [...orders]
    .filter((o) => o.status === 'en_attente')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const commandesRenvoyees = [...orders]
    .filter((o) => o.status === 'renvoyee_vendeur')
    .sort((a, b) => new Date(b.returned_at || b.created_at) - new Date(a.returned_at || a.created_at));
  const aLivrer = orders.filter((o) => o.status === 'validee');
  const valeurStock = products.reduce((sum, p) => sum + Number(p.unit_price) * Number(p.quantity_in_stock), 0);
  const aujourdHui = new Date().toDateString();
  const ventesDuJourBrut = orders
    .filter((o) => new Date(o.created_at).toDateString() === aujourdHui)
    .reduce((sum, o) => sum + Number(o.total_amount), 0);

  // Un retour rembourse un client sur une vente (éventuellement d'un jour
  // précédent) : on ne déduit du jour que les remboursements enregistrés
  // aujourd'hui, pas le montant total de la commande d'origine.
  const retoursAujourdhui = retours.filter((r) => new Date(r.created_at).toDateString() === aujourdHui);
  const totalRembourseAujourdhui = retoursAujourdhui.reduce((sum, r) => sum + Number(r.refund_amount || 0), 0);
  const ventesDuJour = Math.max(0, ventesDuJourBrut - totalRembourseAujourdhui);

  const encaissementsAujourdhui = activiteAujourdhui.filter((a) => a.type === 'encaissement');
  const totalEncaisseAujourdhui = Math.max(
    0,
    encaissementsAujourdhui.reduce((sum, a) => sum + Number(a.montant), 0) - totalRembourseAujourdhui
  );

  const mesVentesAujourdhui = activiteAujourdhui.filter((a) => a.type === 'vente');
  const totalMesVentesAujourdhui = mesVentesAujourdhui.reduce((sum, a) => sum + Number(a.montant), 0);

  const resumeParVendeur = {};
  activite
    .filter((a) => a.type === 'vente')
    .forEach((a) => {
      const nom = a.user_name || 'Inconnu';
      if (!resumeParVendeur[nom]) resumeParVendeur[nom] = { count: 0, total: 0 };
      resumeParVendeur[nom].count += 1;
      resumeParVendeur[nom].total += Number(a.montant);
    });

  // Données dérivées pour le tableau de bord : ventes des 7 derniers jours,
  // alertes de stock et barres comparatives.
  const prenom = (user?.fullName || '').trim().split(' ')[0];
  const dateLongue = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const nbVentesJour = orders.filter((o) => new Date(o.created_at).toDateString() === aujourdHui).length;
  const jours7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const cle = d.toDateString();
    const total = orders
      .filter((o) => new Date(o.created_at).toDateString() === cle)
      .reduce((sum, o) => sum + Number(o.total_amount), 0);
    return {
      cle,
      total,
      estAujourdhui: i === 6,
      label: d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''),
      titre: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
    };
  });
  const max7 = Math.max(1, ...jours7.map((j) => j.total));
  const total7 = jours7.reduce((sum, j) => sum + j.total, 0);
  const alertesStock = [...enRupture, ...enFaible];
  const maxMois = Math.max(1, ...(chiffreAffaires?.byMonth || []).map((m) => Number(m.total) || 0));
  const maxBoutique = Math.max(1, ...(venteParBoutique || []).map((v) => Number(v.total) || 0));

  return (
    <>
      <div className="entete-page">
        <h1>Pilotage</h1>
        {estManager && warehouses.length > 0 && (
          <div className="selecteur-boutique">
            <span className="selecteur-boutique-icone">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9l1.5-5h15L21 9" />
                <path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
                <path d="M9 20v-6h6v6" />
              </svg>
            </span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.filter((w) => w.is_active).map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <style>{CSS_DASHBOARD}</style>
      <p className="db-salut">
        Bonjour{prenom ? ` ${prenom}` : ''} · {dateLongue}
      </p>

      {estManager && !chargementBoutiques && warehouses.length === 0 && (
        <p className="etat-vide">Aucune boutique n'a encore été créée. Créez-en une avant de consulter le tableau de bord.</p>
      )}

      <div className="onglets">
        <button className={onglet === 'pilotage' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('pilotage')}>
          Tableau de bord
        </button>
        <button className={onglet === 'activite' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('activite')}>
          Journal d'activité
        </button>
        {vueEquipe && (
          <button className={onglet === 'suivi' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('suivi')}>
            Stock &amp; livraisons
          </button>
        )}
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {onglet === 'pilotage' && (
        chargement ? (
          <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
        ) : estCaissier ? (
          <>
            <div className="db-kpis">
              <div className={'db-kpi' + (commandesEnAttente.length > 0 ? ' db-kpi--hero' : '')}>
                <span className="db-kpi-icone"><IconCaisse /></span>
                <p className="db-kpi-label">À encaisser</p>
                <p className="db-kpi-valeur">{commandesEnAttente.length}</p>
                <p className="db-kpi-sous">vente(s) en attente</p>
              </div>
              <div className="db-kpi">
                <span className="db-kpi-icone"><IconVentes /></span>
                <p className="db-kpi-label">Encaissé aujourd'hui</p>
                <p className="db-kpi-valeur">{fcfa(totalEncaisseAujourdhui)} <small>FCFA</small></p>
                <p className="db-kpi-sous">{encaissementsAujourdhui.length} encaissement(s)</p>
              </div>
            </div>

            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Ventes à encaisser</h2>
            {commandesEnAttente.length === 0 ? (
              <p className="etat-vide" style={{ marginBottom: 24 }}>Aucune vente en attente d'encaissement pour le moment.</p>
            ) : (
              <div className="liste-a-encaisser">
                {commandesEnAttente.map((o) => (
                  <div key={o.id} className="carte-a-encaisser">
                    <div style={{ minWidth: 0 }}>
                      <p className="carte-a-encaisser-numero">{o.order_number}</p>
                      <p className="carte-a-encaisser-client">{o.client_name || 'Client de passage'}</p>
                      {o.credit_request_status === 'en_attente' && (
                        <p style={{ color: 'var(--accent)', fontSize: 12, marginTop: 2 }}>Demande de crédit en attente de validation…</p>
                      )}
                      {o.credit_request_status === 'rejetee' && (
                        <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 2 }}>
                          Demande de crédit refusée{o.credit_request_reason ? ` : ${o.credit_request_reason}` : ''}
                        </p>
                      )}
                    </div>
                    <p className="carte-a-encaisser-montant">{Math.round(o.total_amount).toLocaleString('fr-FR')} FCFA</p>
                    <button
                      className="btn btn-principal"
                      disabled={chargementDetail || o.credit_request_status === 'en_attente'}
                      onClick={() => ouvrirEncaissementDepuisDashboard(o)}
                    >
                      Encaisser
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 24 }}>
              <ActiviteListe activite={activiteAujourdhui.slice(0, 8)} titre="Mon activité aujourd'hui" />
            </div>
          </>
        ) : estVendeur ? (
          <>
            <div className="db-kpis">
              <div className="db-kpi db-kpi--hero">
                <span className="db-kpi-icone"><IconValeur /></span>
                <p className="db-kpi-label">Total réalisé aujourd'hui</p>
                <p className="db-kpi-valeur">{fcfa(totalMesVentesAujourdhui)} <small>FCFA</small></p>
                <p className="db-kpi-sous">{mesVentesAujourdhui.length} vente(s)</p>
              </div>
              <div className={'db-kpi' + (commandesRenvoyees.length > 0 ? ' db-kpi--alerte' : '')}>
                <span className="db-kpi-icone"><IconAlerte /></span>
                <p className="db-kpi-label">Factures renvoyées</p>
                <p className="db-kpi-valeur">{commandesRenvoyees.length}</p>
                <p className="db-kpi-sous">à corriger ou annuler</p>
              </div>
            </div>

            {commandesRenvoyees.length > 0 && (
              <>
                <h2 style={{ fontSize: 16, marginBottom: 12 }}>Factures renvoyées par la caisse</h2>
                <div className="liste-a-encaisser" style={{ marginBottom: 24 }}>
                  {commandesRenvoyees.map((o) => (
                    <div key={o.id} className="carte-a-encaisser">
                      <div style={{ minWidth: 0 }}>
                        <p className="carte-a-encaisser-numero">{o.order_number}</p>
                        <p className="carte-a-encaisser-client">
                          {o.client_name || 'Client de passage'}
                          {o.returned_reason && <span style={{ color: 'var(--danger)' }}> · {o.returned_reason}</span>}
                        </p>
                      </div>
                      <p className="carte-a-encaisser-montant">{Math.round(o.total_amount).toLocaleString('fr-FR')} FCFA</p>
                      <button className="btn btn-principal" onClick={() => navigate(`/ventes?modifier=${o.id}`)}>Modifier</button>
                      <button className="btn btn-brique" onClick={() => annulerCommandeRenvoyee(o)}>Annuler</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <button className="btn btn-principal" style={{ marginBottom: 24 }} onClick={() => navigate('/ventes')}>
              + Nouvelle vente
            </button>

            <ActiviteListe activite={activiteAujourdhui.slice(0, 10)} titre="Mon activité aujourd'hui" />
          </>
        ) : (
          <>
            {estManager && statutNotifications === 'inactif' && (
              <div className="erreur" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <IconCloche />
                  Activez les notifications pour être alerté en temps réel (ventes importantes, ruptures de stock…).
                </span>
                <button className="btn btn-principal" onClick={activerNotifications} disabled={activationEnCours}>
                  {activationEnCours ? 'Activation…' : 'Activer'}
                </button>
              </div>
            )}

            {estPharmacie && lotsPerimes && lotsPerimes.count > 0 && (
              <div className="erreur" style={{ marginBottom: 20 }}>
                <p style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <IconAlerte />
                  {lotsPerimes.count} lot{lotsPerimes.count > 1 ? 's' : ''} périmé{lotsPerimes.count > 1 ? 's' : ''} encore en stock — {Math.round(lotsPerimes.totalValue).toLocaleString('fr-FR')} FCFA à retirer
                </p>
                <p style={{ fontSize: 12, marginBottom: 10 }}>Ces produits ne peuvent plus être vendus. Détruisez-les pour les sortir du stock.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {lotsPerimes.lots.map((l) => (
                    <div key={l.lot_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <span>
                        <strong>{l.product_name}</strong> · lot {l.lot_number || '—'} · périmé le {new Date(l.expiry_date).toLocaleDateString('fr-FR')} ({l.days_expired} j) · {Math.round(Number(l.quantity))} unité(s)
                      </span>
                      <button className="btn btn-principal" disabled={destructionEnCours === l.lot_id} onClick={() => detruireLotPerime(l)}>
                        {destructionEnCours === l.lot_id ? 'Destruction…' : 'Détruire'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {vueEquipe && <RappelsFiscaux lien={estManager ? '/fiscalite' : undefined} />}

            {estManager && alerteSalaires?.show && (
              <div className="erreur" style={{ marginBottom: 20, cursor: 'pointer' }} onClick={() => navigate('/salaires')}>
                Salaires de {formatMois(alerteSalaires.month)} non versés pour {alerteSalaires.unpaid.length} employé{alerteSalaires.unpaid.length > 1 ? 's' : ''} :{' '}
                {alerteSalaires.unpaid.map((u) => u.name).join(', ')}. Cliquez pour régler.
              </div>
            )}

            <div className="db-kpis">
              <div className="db-kpi db-kpi--hero">
                <span className="db-kpi-icone"><IconVentes /></span>
                <p className="db-kpi-label">Ventes du jour</p>
                <p className="db-kpi-valeur">{fcfa(ventesDuJour)} <small>FCFA</small></p>
                <p className="db-kpi-sous">
                  {nbVentesJour} vente(s){totalRembourseAujourdhui > 0 ? ` · ${fcfa(totalRembourseAujourdhui)} FCFA remboursés` : ''}
                </p>
              </div>
              <div className="db-kpi">
                <span className="db-kpi-icone"><IconValeur /></span>
                <p className="db-kpi-label">Valeur du stock</p>
                <p className="db-kpi-valeur">{fcfa(valeurStock)} <small>FCFA</small></p>
                <p className="db-kpi-sous">{products.length} produit(s)</p>
              </div>
              <div
                className={'db-kpi' + (vueEquipe ? ' db-kpi--clic' : '') + (alertesStock.length > 0 ? ' db-kpi--alerte' : '')}
                onClick={vueEquipe ? () => setOnglet('suivi') : undefined}
              >
                <span className="db-kpi-icone"><IconAlerte /></span>
                <p className="db-kpi-label">Alertes de seuil</p>
                <p className="db-kpi-valeur">{alertesStock.length}</p>
                <p className="db-kpi-sous">{enRupture.length} rupture(s) · {enFaible.length} stock faible</p>
              </div>
              <div className={'db-kpi' + (vueEquipe ? ' db-kpi--clic' : '')} onClick={vueEquipe ? () => setOnglet('suivi') : undefined}>
                <span className="db-kpi-icone"><IconCamion /></span>
                <p className="db-kpi-label">À livrer</p>
                <p className="db-kpi-valeur">{aLivrer.length}</p>
                <p className="db-kpi-sous">commande(s) validée(s)</p>
              </div>
            </div>

            <div className="db-grille">
              <div className="db-carte">
                <div className="db-carte-tete">
                  <h2>Ventes des 7 derniers jours</h2>
                  <span>{fcfa(total7)} FCFA</span>
                </div>
                <div className="db-histo">
                  {jours7.map((j) => (
                    <div
                      key={j.cle}
                      className={'db-histo-col' + (j.estAujourdhui ? ' db-histo-col--jour' : '')}
                      title={`${j.titre} : ${fcfa(j.total)} FCFA`}
                    >
                      <span className="db-histo-val">{j.total > 0 ? abreger(j.total) : ''}</span>
                      <div className="db-histo-barre" style={{ height: Math.max(4, Math.round((j.total / max7) * 130)) }} />
                      <span className="db-histo-label">{j.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="db-carte">
                <div className="db-carte-tete">
                  <h2>Alertes de stock</h2>
                  {vueEquipe && alertesStock.length > 0 && (
                    <button type="button" className="db-lien" onClick={() => setOnglet('suivi')}>Tout voir</button>
                  )}
                </div>
                {alertesStock.length === 0 ? (
                  <p className="etat-vide" style={{ padding: '12px 0' }}>Aucune alerte de seuil.</p>
                ) : (
                  <div>
                    {alertesStock.slice(0, 5).map((p) => (
                      <div key={p.id} className="db-alerte">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p className="db-alerte-nom">{p.name}</p>
                          <p className="db-alerte-qte">{formaterQuantite(p.quantity_in_stock)} en stock</p>
                        </div>
                        <StatusBadge status={p.status} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {demandesCredit.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16, marginBottom: 12 }}>Demandes de vente à crédit</h2>
                <div className="liste-a-encaisser">
                  {demandesCredit.map((d) => (
                    <div key={d.id} className="carte-a-encaisser">
                      <div style={{ minWidth: 0 }}>
                        <p className="carte-a-encaisser-numero">{d.full_name}</p>
                        <p className="carte-a-encaisser-client">
                          Commande CMD-{new Date(d.order_created_at).getFullYear()}-{String(d.order_seq).padStart(4, '0')}
                          {d.phone && ` · ${d.phone}`} · demandé par {d.requested_by_name || '—'}
                        </p>
                      </div>
                      <p className="carte-a-encaisser-montant">{Math.round(d.total_amount).toLocaleString('fr-FR')} FCFA</p>
                      <button className="btn btn-principal" onClick={() => approuverDemandeCredit(d)}>Approuver</button>
                      <button className="btn btn-brique" onClick={() => rejeterDemandeCredit(d)}>Rejeter</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {demandesRetour.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16, marginBottom: 12 }}>Demandes de retour</h2>
                <div className="liste-a-encaisser">
                  {demandesRetour.map((d) => (
                    <div key={d.id} className="carte-a-encaisser">
                      <div style={{ minWidth: 0 }}>
                        <p className="carte-a-encaisser-numero">
                          Commande CMD-{new Date(d.order_created_at).getFullYear()}-{String(d.order_seq).padStart(4, '0')}
                        </p>
                        <p className="carte-a-encaisser-client">
                          {d.reason}
                          {d.client_name && ` · ${d.client_name}`} · demandé par {d.requested_by_name || '—'}
                        </p>
                      </div>
                      <p className="carte-a-encaisser-montant">
                        {Math.round(d.refund_amount).toLocaleString('fr-FR')} FCFA
                      </p>
                      <button className="btn btn-principal" onClick={() => approuverDemandeRetour(d)}>Approuver</button>
                      <button className="btn btn-brique" onClick={() => refuserDemandeRetour(d)}>Rejeter</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 24 }}>
              <ActiviteListe activite={activiteAujourdhui.slice(0, 8)} titre="Activité récente" />
            </div>
          </>
        )
      )}

      {onglet === 'suivi' && vueEquipe && (
        <>
          <div className="db-kpis">
            <div className={'db-kpi' + (enRupture.length > 0 ? ' db-kpi--alerte' : '')}>
              <span className="db-kpi-icone"><IconAlerte /></span>
              <p className="db-kpi-label">En rupture</p>
              <p className="db-kpi-valeur">{enRupture.length}</p>
              <p className="db-kpi-sous">à réapprovisionner</p>
            </div>
            <div className={'db-kpi' + (enFaible.length > 0 ? ' db-kpi--alerte' : '')}>
              <span className="db-kpi-icone"><IconAlerte /></span>
              <p className="db-kpi-label">Stock faible</p>
              <p className="db-kpi-valeur">{enFaible.length}</p>
              <p className="db-kpi-sous">sous le seuil d'alerte</p>
            </div>
            <div className="db-kpi db-kpi--hero">
              <span className="db-kpi-icone"><IconCamion /></span>
              <p className="db-kpi-label">À livrer</p>
              <p className="db-kpi-valeur">{aLivrer.length}</p>
              <p className="db-kpi-sous">{fcfa(aLivrer.reduce((somme, o) => somme + Number(o.total_amount || 0), 0))} FCFA</p>
            </div>
            {estPharmacie && lotsPerimes && (
              <div className={'db-kpi' + (lotsPerimes.count > 0 ? ' db-kpi--alerte' : '')}>
                <span className="db-kpi-icone"><IconAlerte /></span>
                <p className="db-kpi-label">Lots périmés</p>
                <p className="db-kpi-valeur">{lotsPerimes.count}</p>
                <p className="db-kpi-sous">{fcfa(lotsPerimes.totalValue)} FCFA à retirer</p>
              </div>
            )}
          </div>

          <div className="db-cols">
            <div className="db-carte">
              <div className="db-carte-tete">
                <h2>Alertes de seuil</h2>
                <span>{alertesStock.length}</span>
              </div>

              {alertesStock.length === 0 ? (
                <p className="etat-vide" style={{ padding: '12px 0' }}>Aucune alerte de seuil pour le moment.</p>
              ) : (
                <>
                  <div className="db-puces">
                    {[
                      { valeur: 'toutes', libelle: 'Toutes', nb: alertesStock.length },
                      { valeur: 'rupture', libelle: 'Ruptures', nb: enRupture.length },
                      { valeur: 'faible', libelle: 'Stock faible', nb: enFaible.length },
                    ].map((f) => (
                      <button
                        key={f.valeur}
                        type="button"
                        className={'db-puce' + (filtreAlerte === f.valeur ? ' actif' : '')}
                        onClick={() => setFiltreAlerte(f.valeur)}
                      >
                        {f.libelle} <span>{f.nb}</span>
                      </button>
                    ))}
                  </div>

                  {[
                    { statut: 'rupture', titre: 'Ruptures de stock', liste: enRupture },
                    { statut: 'faible', titre: 'Stock faible', liste: enFaible },
                  ]
                    .filter((g) => g.liste.length > 0 && (filtreAlerte === 'toutes' || filtreAlerte === g.statut))
                    .map((g) => (
                      <div key={g.statut}>
                        {filtreAlerte === 'toutes' && <p className="db-titre-section">{g.titre} · {g.liste.length}</p>}
                        {g.liste.map((p) => (
                          <div key={p.id} className="db-ligne">
                            <span className={'db-pastille' + (g.statut === 'rupture' ? ' db-pastille--danger' : '')}>
                              <IconAlerte />
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p className="db-alerte-nom">{p.name}</p>
                              <p className="db-alerte-qte">
                                {formaterQuantite(p.quantity_in_stock)} en stock
                                {p.quantity_alert_threshold !== undefined && p.quantity_alert_threshold !== null
                                  ? ` · seuil ${formaterQuantite(p.quantity_alert_threshold)}`
                                  : ''}
                              </p>
                            </div>
                            <StatusBadge status={p.status} />
                          </div>
                        ))}
                      </div>
                    ))}
                </>
              )}
            </div>

            <div className="db-carte">
              <div className="db-carte-tete">
                <h2>Commandes à livrer</h2>
                <span>{aLivrer.length}</span>
              </div>

              {aLivrer.length === 0 ? (
                <p className="etat-vide" style={{ padding: '12px 0' }}>Aucune commande à livrer pour le moment.</p>
              ) : (
                aLivrer.map((o) => (
                  <div key={o.id} className="db-ligne db-ligne--livraison">
                    <span className="db-pastille">
                      {o.client_name ? o.client_name.trim()[0].toUpperCase() : <IconCamion />}
                    </span>
                    <div className="ligne-cliquable" style={{ flex: 1, minWidth: 0 }} onClick={() => ouvrirDetailCommande(o.id)}>
                      <p className="db-alerte-nom">{o.order_number}</p>
                      <p className="db-alerte-qte">
                        {o.client_name || 'Client de passage'} · {new Date(o.created_at).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                    <div className="db-ligne-droite">
                      <p className="db-montant-ligne">{fcfa(o.total_amount)} FCFA</p>
                      <button className="btn btn-principal" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => marquerCommandeLivree(o)}>
                        Marquer livrée
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {estPharmacie && (
            <div style={{ marginBottom: 24 }}>
              <div className="db-carte-tete">
                <h2 style={{ margin: 0, fontSize: 16 }}>Périmés imminents</h2>
              </div>
              {lotsBientotPerimes.every((h) => h.count === 0) ? (
                <p className="etat-vide">Aucun lot bientôt périmé.</p>
              ) : (
                <div className="db-kpis">
                  {lotsBientotPerimes.map((h) => (
                    <div
                      key={h.horizon}
                      className={'db-kpi' + (h.count > 0 ? ' db-kpi--clic db-kpi--alerte' : '')}
                      onClick={() => h.count > 0 && setHorizonOuvert(h)}
                    >
                      <span className="db-kpi-icone"><IconAlerte /></span>
                      <p className="db-kpi-label">
                        {h.horizon === '3_mois' ? '≤ 3 mois' : h.horizon === '6_mois' ? '3 à 6 mois' : '6 à 12 mois'}
                      </p>
                      <p className="db-kpi-valeur">{h.count}</p>
                      {h.count > 0 && <p className="db-kpi-sous">{fcfa(h.totalValue)} FCFA en jeu · voir le détail</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {estPharmacie && (
            <div style={{ marginBottom: 24 }}>
              <div className="db-carte-tete">
                <h2 style={{ margin: 0, fontSize: 16 }}>Registre des destructions</h2>
                {registreDestructions && registreDestructions.destructions.length > 0 && (
                  <span>
                    {Math.round(registreDestructions.totalQuantity)} unité(s) · {fcfa(registreDestructions.totalValue)} FCFA détruits
                  </span>
                )}
              </div>
              {!registreDestructions || registreDestructions.destructions.length === 0 ? (
                <p className="etat-vide">Aucun lot périmé détruit pour le moment.</p>
              ) : (
                <div className="db-table">
                  <table className="registre">
                    <thead>
                      <tr>
                        <th>Détruit le</th>
                        <th>Produit</th>
                        <th>N° de lot</th>
                        <th>Péremption</th>
                        <th>Qté</th>
                        <th>Valeur</th>
                        <th>Par</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registreDestructions.destructions.map((d) => (
                        <tr key={d.id}>
                          <td>{new Date(d.destroyed_at).toLocaleDateString('fr-FR')}</td>
                          <td style={{ fontWeight: 600 }}>{d.product_name}</td>
                          <td>{d.lot_number || '—'}</td>
                          <td>{d.expiry_date ? new Date(d.expiry_date).toLocaleDateString('fr-FR') : '—'}</td>
                          <td className="chiffre">{Math.round(Number(d.quantity))}</td>
                          <td className="chiffre">{fcfa(d.lost_value)} FCFA</td>
                          <td>{d.destroyed_by_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {onglet === 'activite' && (
        <>
          {estManager && chiffreAffaires && (
            <div style={{ marginBottom: 24 }}>
              <div className="db-kpis">
                <div className="db-kpi db-kpi--hero">
                  <span className="db-kpi-icone"><IconValeur /></span>
                  <p className="db-kpi-label">Chiffre d'affaires total</p>
                  <p className="db-kpi-valeur">{fcfa(chiffreAffaires.total)} <small>FCFA</small></p>
                </div>
                {benefice && (
                  <div className="db-kpi">
                    <span className="db-kpi-icone"><IconVentes /></span>
                    <p className="db-kpi-label">Bénéfice total</p>
                    <p className="db-kpi-valeur">{fcfa(benefice.total)} <small>FCFA</small></p>
                    {Number(chiffreAffaires.total) > 0 && (
                      <p className="db-kpi-sous">Marge : {Math.round((Number(benefice.total) / Number(chiffreAffaires.total)) * 100)} %</p>
                    )}
                  </div>
                )}
              </div>
              {benefice && benefice.itemsSansCout > 0 && (
                <p style={{ fontSize: 13, color: 'var(--texte-doux, #6b7280)', marginTop: -8, marginBottom: 20 }}>
                  {benefice.itemsSansCout} ligne(s) de vente n'ont pas de prix d'achat : le bénéfice est surestimé tant que les prix d'achat ne sont pas renseignés sur les produits.
                </p>
              )}

              {chiffreAffaires.byMonth.length > 0 && (
                <div className="db-carte">
                  <div className="db-carte-tete">
                    <h2>Chiffre d'affaires par mois</h2>
                  </div>
                  <div className="db-barres">
                    {chiffreAffaires.byMonth.map((m) => (
                      <div key={m.month} className="db-barre-ligne">
                        <p className="db-barre-nom">{formatMois(m.month)}</p>
                        <div className="db-barre-piste">
                          <div className="db-barre-rempli" style={{ width: `${Math.max(2, ((Number(m.total) || 0) / maxMois) * 100)}%` }} />
                        </div>
                        <p className="db-barre-montant">
                          {fcfa(m.total)} FCFA
                          {benefice && (
                            <span className="db-barre-sous">
                              Bénéfice : {fcfa(benefice.byMonth.find((b) => b.month === m.month)?.total || 0)} FCFA
                            </span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {vueEquipe && venteParBoutique && venteParBoutique.length > 0 && (
            <div className="db-carte" style={{ marginBottom: 24 }}>
              <div className="db-carte-tete">
                <h2>Ventes par boutique</h2>
              </div>
              <div className="db-barres">
                {venteParBoutique.map((v) => (
                  <div key={v.warehouseId} className="db-barre-ligne">
                    <p className="db-barre-nom">{v.warehouseName}</p>
                    <div className="db-barre-piste">
                      <div className="db-barre-rempli" style={{ width: `${Math.max(2, ((Number(v.total) || 0) / maxBoutique) * 100)}%` }} />
                    </div>
                    <p className="db-barre-montant">{fcfa(v.total)} FCFA</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="barre-filtres">
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="date-debut">Du</label>
              <input id="date-debut" type="date" className="champ" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
            </div>
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="date-fin">Au</label>
              <input id="date-fin" type="date" className="champ" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
            </div>
            <button className="btn btn-principal" style={{ alignSelf: 'flex-end' }} onClick={chargerActivite}>
              Afficher
            </button>
            <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => api.downloadActivityPdf(dateDebut, dateFin).catch((err) => setErreur(err.message))}>
              Exporter PDF
            </button>
          </div>

          {chargementActivite ? (
            <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
          ) : (
            <>
              {vueEquipe && Object.keys(resumeParVendeur).length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h2 style={{ fontSize: 16, marginBottom: 12 }}>Ventes par membre de l'équipe, sur cette période</h2>
                  <div className="grille-resume-equipe">
                    {Object.entries(resumeParVendeur)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([nom, r]) => (
                        <div key={nom} className="carte-resume-membre">
                          <span className="avatar avatar-couleur" style={{ background: couleurPour(nom) }}>
                            {initiales(nom)}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <p className="carte-resume-membre-nom">{nom}</p>
                            <p className="carte-resume-membre-detail">{r.count} vente{r.count > 1 ? 's' : ''}</p>
                          </div>
                          <p className="carte-resume-membre-total">{Math.round(r.total).toLocaleString('fr-FR')} FCFA</p>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <ActiviteListe
                activite={activite}
                titre={
                  (vueEquipe ? "Activité de l'équipe" : 'Mon activité') +
                  ' (' +
                  (dateDebut === dateFin
                    ? new Date(dateDebut).toLocaleDateString('fr-FR')
                    : `${new Date(dateDebut).toLocaleDateString('fr-FR')} → ${new Date(dateFin).toLocaleDateString('fr-FR')}`) +
                  ')'
                }
              />
            </>
          )}
        </>
      )}

      {horizonOuvert && (
        <div className="modale-fond" onClick={() => setHorizonOuvert(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>
              Périmés {horizonOuvert.horizon === '3_mois' ? 'sous 3 mois' : horizonOuvert.horizon === '6_mois' ? 'entre 3 et 6 mois' : 'entre 6 et 12 mois'}
            </h2>
            <table className="registre" style={{ marginBottom: 16 }}>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>N° de lot</th>
                  <th>Péremption</th>
                  <th>Qté</th>
                  <th>Valeur</th>
                </tr>
              </thead>
              <tbody>
                {horizonOuvert.lots.map((l) => (
                  <tr key={l.lot_id}>
                    <td>{l.product_name}</td>
                    <td>{l.lot_number || '—'}</td>
                    <td>{new Date(l.expiry_date).toLocaleDateString('fr-FR')}</td>
                    <td className="chiffre">{Math.round(Number(l.quantity))}</td>
                    <td className="chiffre">{Math.round(Number(l.quantity) * Number(l.unit_price)).toLocaleString('fr-FR')} FCFA</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="actions-modale">
              <button className="btn" onClick={() => setHorizonOuvert(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {(commandeDetail || chargementDetail) && (
        <div className="modale-fond" onClick={() => setCommandeDetail(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            {chargementDetail && !commandeDetail ? (
              <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
            ) : (
              <>
                <h2>{commandeDetail.order_number}</h2>
                <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
                  {commandeDetail.client_name || 'Client de passage'} · <StatusBadge status={commandeDetail.status} />
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
                    {commandeDetail.items.map((it) => (
                      <tr key={it.id}>
                        <td>{it.product_name}</td>
                        <td className="chiffre">{formaterQuantite(it.quantity)}</td>
                        <td className="chiffre">{Math.round(it.line_total).toLocaleString('fr-FR')} FCFA</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontWeight: 700, textAlign: 'right' }}>
                  Total : {Math.round(commandeDetail.total_amount).toLocaleString('fr-FR')} FCFA
                </p>
                <div className="actions-modale">
                  <button className="btn" onClick={() => setCommandeDetail(null)}>Fermer</button>
                </div>
              </>
            )}
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
    </>
  );
}
