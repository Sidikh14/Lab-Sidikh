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

function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5-6" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// Péremptions : nombre de jours entre aujourd'hui et la date de péremption (négatif = déjà périmé).
function joursRestants(dateStr) {
  const fin = new Date(dateStr);
  const auj = new Date(dateAujourdHui());
  return Math.ceil((fin - auj) / 86400000);
}

function libelleDelai(j) {
  if (j < 0) return `Périmé depuis ${-j} j`;
  if (j === 0) return "Périme aujourd'hui";
  if (j < 60) return `Dans ${j} j`;
  return `Dans ${Math.round(j / 30)} mois`;
}

function niveauDelai(j) {
  if (j <= 90) return 'urgent';
  if (j <= 180) return 'moyen';
  return 'faible';
}

const HORIZONS_PEREMPTION = {
  '3_mois': { titre: 'Moins de 3 mois', niveau: 'urgent' },
  '6_mois': { titre: 'Entre 3 et 6 mois', niveau: 'moyen' },
  '12_mois': { titre: 'Entre 6 et 12 mois', niveau: 'faible' },
};
const infoHorizon = (h) => HORIZONS_PEREMPTION[h] || HORIZONS_PEREMPTION['12_mois'];

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
.db-chart-resume{margin:-4px 0 10px;font-size:12px;color:var(--encre-douce)}
.db-chart-resume strong{font-weight:700}
.db-chart-up{color:var(--vif,#157347)}
.db-chart-down{color:var(--danger,#b42318)}
.db-chart{position:relative;height:196px;margin-top:6px}
.db-chart-plot{position:absolute;left:40px;right:0;bottom:26px;height:140px}
.db-chart-ligne{position:absolute;left:0;right:0;height:0;border-top:1px solid var(--trait,#e5e7eb)}
.db-chart-ligne span{position:absolute;left:-40px;width:34px;transform:translateY(-50%);text-align:right;font-size:10.5px;color:var(--encre-douce);font-variant-numeric:tabular-nums}
.db-chart-moy{position:absolute;left:0;right:0;height:0;border-top:1.5px dashed var(--soleil,#f2a81d);z-index:2;pointer-events:none}
.db-chart-moy span{position:absolute;right:0;bottom:3px;padding:1px 6px;border-radius:6px;font-size:10.5px;font-weight:600;background:var(--surface,#fff);color:var(--encre-douce)}
.db-histo{position:absolute;left:40px;right:0;top:0;bottom:0;display:flex;align-items:flex-end;gap:10px}
.db-histo-col{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;cursor:default;outline:none}
.db-histo-barre{width:100%;max-width:44px;border-radius:7px 7px 3px 3px;background:color-mix(in srgb,var(--accent) 40%,transparent);transition:height .3s,background .15s}
.db-histo-col--vide .db-histo-barre{background:color-mix(in srgb,var(--accent) 14%,transparent)}
.db-histo-col:hover .db-histo-barre,.db-histo-col:focus-visible .db-histo-barre{background:color-mix(in srgb,var(--accent) 65%,transparent)}
.db-histo-col--jour .db-histo-barre,.db-histo-col--jour:hover .db-histo-barre{background:var(--accent)}
.db-histo-val{height:18px;line-height:18px;font-size:11px;white-space:nowrap;color:var(--encre-douce);font-variant-numeric:tabular-nums}
.db-histo-col--jour .db-histo-val{color:var(--accent);font-weight:700}
.db-histo-label{height:26px;line-height:26px;font-size:12px;text-transform:capitalize;color:var(--encre-douce)}
.db-histo-col--jour .db-histo-label{color:var(--accent);font-weight:700}
.db-chart-tip{position:absolute;z-index:5;transform:translateX(-50%);min-width:140px;padding:8px 10px;border-radius:10px;background:var(--encre,#0f2747);color:#fff;font-size:12px;line-height:1.35;box-shadow:0 8px 20px rgba(0,0,0,.25);pointer-events:none;text-align:left}
.db-chart-tip strong{display:block;font-size:12px;text-transform:capitalize}
.db-chart-tip span{display:block;opacity:.85}
.db-chart-vide{position:absolute;left:40px;right:0;top:0;bottom:26px;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--encre-douce);pointer-events:none}
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
.db-niveau--urgent{--n:var(--danger,#b91c1c)}
.db-niveau--moyen{--n:#c2410c}
.db-niveau--faible{--n:#a16207}
.db-chip{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--n,var(--danger,#b91c1c));background:rgba(185,28,28,.1);background:color-mix(in srgb,var(--n,var(--danger,#b91c1c)) 12%,transparent)}
.db-perime{margin-bottom:20px;border:1px solid var(--trait,#e5e7eb);border-left:4px solid var(--danger,#b91c1c);border-radius:16px;background:var(--surface,#fff);overflow:hidden}
.db-perime-tete{display:flex;align-items:center;flex-wrap:wrap;gap:14px;padding:16px 18px;background:var(--danger-clair,#fef2f2)}
.db-perime-icone{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:38px;height:38px;border-radius:11px;background:var(--danger,#b91c1c);color:#fff}
.db-perime-titre{flex:1;min-width:220px}
.db-perime-titre h2{margin:0;font-size:15px;color:var(--danger,#b91c1c)}
.db-perime-titre p{margin:3px 0 0;font-size:12px;color:var(--encre-douce)}
.db-perime-total{margin:0;text-align:right;font-size:20px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--danger,#b91c1c)}
.db-perime-total small{display:block;margin-top:3px;font-size:11px;font-weight:500;color:var(--encre-douce)}
.db-perime-liste{list-style:none;margin:0;padding:2px 18px}
.db-perime-ligne{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px 14px;align-items:center;padding:12px 0;border-top:1px solid var(--trait,#e5e7eb)}
.db-perime-ligne:first-child{border-top:none}
.db-perime-nom{margin:0;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.db-perime-meta{margin:2px 0 0;font-size:12px;color:var(--encre-douce)}
.db-hz-tete{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.db-hz-tete h2{margin:0;font-size:16px}
.db-hz-tete span{font-size:13px;color:var(--encre-douce);font-variant-numeric:tabular-nums}
.db-seg{display:flex;gap:3px;height:10px;margin-bottom:14px}
.db-seg span{display:block;min-width:8px;border-radius:999px;background:var(--n)}
.db-hz-grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.db-hz{display:flex;flex-direction:column;gap:3px;width:100%;margin:0;text-align:left;font:inherit;color:inherit;background:var(--surface,#fff);border:1px solid var(--trait,#e5e7eb);border-top:3px solid var(--n);border-radius:14px;padding:14px 16px;transition:box-shadow .15s}
button.db-hz:not(:disabled){cursor:pointer}
button.db-hz:not(:disabled):hover{box-shadow:0 6px 18px rgba(17,24,39,.08)}
.db-hz:focus-visible{outline:2px solid var(--n);outline-offset:2px}
.db-hz:disabled{opacity:.55}
.db-hz-delai{margin:0;font-size:13px;font-weight:600;color:var(--n)}
.db-hz-nombre{margin:2px 0 0;font-size:26px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.db-hz-nombre small{font-size:13px;font-weight:500;color:var(--encre-douce)}
.db-hz-valeur{margin:0;font-size:12px;color:var(--encre-douce)}
.db-hz-voir{display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-size:13px;font-weight:600;color:var(--n)}
.db-ok{display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid var(--trait,#e5e7eb);border-radius:14px;background:var(--surface,#fff);font-size:14px;color:var(--encre-douce)}
.db-ok-icone{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:34px;height:34px;border-radius:10px;background:#dcfce7;color:#15803d}
.db-modal-sous{margin:-4px 0 14px;font-size:13px;color:var(--encre-douce)}
.db-modal-table{overflow-x:auto;margin-bottom:16px}
.db-modal-table table{margin-bottom:0 !important}
@media (prefers-reduced-motion:reduce){.db-hz{transition:none}}
@media (max-width:560px){
  .db-perime-ligne{grid-template-columns:minmax(0,1fr) auto}
  .db-perime-ligne .btn{grid-column:1 / -1}
  .db-perime-total{text-align:left}
}
@media (max-width:860px){
  .db-grille,.db-cols{grid-template-columns:1fr}
  .db-barre-ligne{grid-template-columns:minmax(0,1fr) auto}
  .db-barre-piste{grid-column:1 / -1;order:3}
}
`;

// ---------------------------------------------------------------------------
// Tableau de bord du comptable (sans autre rôle) : rappels fiscaux, chiffres du mois en cours
// et graphiques sur 12 mois, toutes boutiques cumulées. Style sobre et dense (préfixe cb-),
// couleurs reprises du thème du client (--accent, --trait, --surface…).
// ---------------------------------------------------------------------------
const CSS_COMPTABLE = `
.cb-periode{margin:-6px 0 16px;font-size:13px;color:var(--encre-douce)}
.cb-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0 0 16px;background:var(--surface,#fff);border:1px solid var(--trait,#e5e7eb);border-radius:10px;overflow:hidden}
.cb-kpi{display:flex;flex-direction:column;gap:3px;min-width:0;padding:14px 16px;border-left:1px solid var(--trait,#e5e7eb)}
.cb-kpi:first-child{border-left:none}
.cb-kpi-label{margin:0;font-size:12.5px;font-weight:600;color:var(--encre-douce)}
.cb-kpi-val{margin:0;font-size:21px;font-weight:700;line-height:1.2;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cb-kpi-val small{font-size:12px;font-weight:500;color:var(--encre-douce)}
.cb-neg{color:var(--danger,#b91c1c)}
.cb-var{font-size:12px;color:var(--encre-douce);font-variant-numeric:tabular-nums}
.cb-var--haut{color:var(--vif,#157347)}
.cb-var--bas{color:var(--danger,#b42318)}
.cb-detail{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:12px;color:var(--encre-douce);font-variant-numeric:tabular-nums}
.cb-detail span{white-space:nowrap}
.cb-grille{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:16px;margin-bottom:24px}
.cb-carte{background:var(--surface,#fff);border:1px solid var(--trait,#e5e7eb);border-radius:10px;padding:14px 16px;min-width:0}
.cb-carte-tete{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--trait,#e5e7eb)}
.cb-carte-tete h2{margin:0;font-size:14.5px}
.cb-carte-tete span{font-size:12.5px;color:var(--encre-douce);font-variant-numeric:tabular-nums}
.cb-legende{display:flex;gap:14px;margin:0 0 8px;font-size:12px;color:var(--encre-douce)}
.cb-legende i{display:inline-block;width:10px;height:10px;margin-right:5px;border-radius:2px;vertical-align:-1px}
.cb-chart{position:relative;height:190px;margin-top:4px}
.cb-plot{position:absolute;left:44px;right:0;top:6px;height:150px}
.cb-grid{position:absolute;left:0;right:0;height:0;border-top:1px solid var(--trait,#e5e7eb)}
.cb-grid span{position:absolute;left:-44px;width:38px;transform:translateY(-50%);text-align:right;font-size:10.5px;color:var(--encre-douce);font-variant-numeric:tabular-nums}
.cb-cols{position:absolute;left:44px;right:0;top:6px;height:174px;display:flex;gap:6px}
.cb-col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;outline:none;cursor:default}
.cb-paire{height:150px;display:flex;align-items:flex-end;justify-content:center;gap:2px}
.cb-barre{width:42%;max-width:16px;min-height:2px;border-radius:3px 3px 0 0}
.cb-barre--ca{background:var(--accent)}
.cb-barre--ch{background:var(--soleil,#f2a81d)}
.cb-col:hover .cb-paire,.cb-col:focus-visible .cb-paire{filter:brightness(.92)}
.cb-col:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-radius:4px}
.cb-col--courant .cb-etiq{color:var(--accent);font-weight:700}
.cb-etiq{height:24px;line-height:24px;text-align:center;font-size:11px;color:var(--encre-douce);white-space:nowrap}
.cb-tip{position:absolute;z-index:5;top:0;transform:translateX(-50%);min-width:150px;padding:8px 10px;border-radius:8px;background:var(--encre,#0f2747);color:#fff;font-size:12px;line-height:1.4;box-shadow:0 6px 18px rgba(0,0,0,.25);pointer-events:none}
.cb-tip strong{display:block;text-transform:capitalize}
.cb-tip div{display:flex;justify-content:space-between;gap:14px;font-variant-numeric:tabular-nums}
.cb-vide{position:absolute;left:44px;right:0;top:0;height:150px;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--encre-douce);pointer-events:none}
.cb-rep{display:flex;flex-direction:column;gap:10px}
.cb-rep-ligne{min-width:0}
.cb-rep-haut{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:13px}
.cb-rep-nom{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb-rep-val{white-space:nowrap;font-weight:600;font-variant-numeric:tabular-nums}
.cb-rep-val span{margin-left:6px;font-weight:400;color:var(--encre-douce)}
.cb-rep-piste{height:6px;margin-top:4px;border-radius:3px;background:var(--fond,#f3f4f6);overflow:hidden}
.cb-rep-rempli{height:100%;border-radius:3px;background:var(--accent)}
.cb-sk{height:21px;margin:3px 0;border-radius:4px;background:var(--fond,#f3f4f6)}
.cb-note{margin:0;font-size:13px;color:var(--encre-douce)}
@media (max-width:900px){.cb-grille{grid-template-columns:1fr}}
@media (max-width:760px){
  .cb-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .cb-kpi:nth-child(3){border-left:none}
  .cb-kpi:nth-child(n+3){border-top:1px solid var(--trait,#e5e7eb)}
}
@media (max-width:420px){
  .cb-kpis{grid-template-columns:1fr}
  .cb-kpi{border-left:none;border-top:1px solid var(--trait,#e5e7eb)}
  .cb-kpi:first-child{border-top:none}
}
`;

const MOIS_COURTS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const moisCourt = (cle) => MOIS_COURTS[Number(cle.split('-')[1]) - 1];
const HAUTEUR_CB = 150;

function variationPct(courant, precedent) {
  const c = Number(courant) || 0;
  const p = Number(precedent) || 0;
  if (p === 0) return null;
  return Math.round(((c - p) / Math.abs(p)) * 100);
}

function VariationMois({ courant, precedent }) {
  const v = variationPct(courant, precedent);
  if (v === null) return <span className="cb-var">Pas de référence le mois précédent</span>;
  if (v === 0) return <span className="cb-var">Stable par rapport au mois précédent</span>;
  return (
    <span className={'cb-var ' + (v > 0 ? 'cb-var--haut' : 'cb-var--bas')}>
      {v > 0 ? '▲ +' : '▼ '}{v} % par rapport au mois précédent
    </span>
  );
}

function ChiffresMois({ data }) {
  const { revenue, result, treasury, vat } = data.kpis;
  const comptesTreso = treasury.accounts.filter((c) => Math.round(c.balance) !== 0);
  return (
    <div className="cb-kpis">
      <div className="cb-kpi">
        <p className="cb-kpi-label">Chiffre d'affaires</p>
        <p className="cb-kpi-val">{fcfa(revenue.current)} <small>FCFA</small></p>
        <VariationMois courant={revenue.current} precedent={revenue.previous} />
      </div>
      <div className="cb-kpi">
        <p className="cb-kpi-label">Résultat</p>
        <p className={'cb-kpi-val' + (result.current < 0 ? ' cb-neg' : '')}>{fcfa(result.current)} <small>FCFA</small></p>
        <VariationMois courant={result.current} precedent={result.previous} />
      </div>
      <div className="cb-kpi">
        <p className="cb-kpi-label">Trésorerie</p>
        <p className={'cb-kpi-val' + (treasury.total < 0 ? ' cb-neg' : '')}>{fcfa(treasury.total)} <small>FCFA</small></p>
        <div className="cb-detail">
          {comptesTreso.length === 0
            ? <span>Aucun solde</span>
            : comptesTreso.map((c) => <span key={c.code}>{c.label} {fcfa(c.balance)}</span>)}
        </div>
      </div>
      <div className="cb-kpi">
        <p className="cb-kpi-label">{vat.net < 0 ? 'Crédit de TVA' : 'TVA à reverser'}</p>
        <p className="cb-kpi-val">{fcfa(vat.net < 0 ? vat.credit : vat.toPay)} <small>FCFA</small></p>
        <div className="cb-detail">
          <span>Collectée {fcfa(vat.collected)}</span>
          <span>Déductible {fcfa(vat.deductible)}</span>
        </div>
      </div>
    </div>
  );
}

function GraphiqueMensuel({ mois, moisCourant }) {
  const [survol, setSurvol] = useState(null);
  const max = Math.max(1, ...mois.map((m) => Math.max(m.revenue, m.charges, 0)));
  const vide = mois.every((m) => m.revenue === 0 && m.charges === 0);
  const haut = (v) => (v > 0 ? Math.max(2, Math.round((v / max) * HAUTEUR_CB)) : 2);
  const tip = survol !== null ? mois[survol] : null;
  return (
    <div className="cb-chart">
      <div className="cb-plot" aria-hidden="true">
        {[0, 0.5, 1].map((r) => (
          <div key={r} className="cb-grid" style={{ bottom: `${r * 100}%` }}>
            {!vide && <span>{r === 0 ? '0' : abreger(max * r)}</span>}
          </div>
        ))}
      </div>
      {vide && <div className="cb-vide">Aucune écriture sur les 12 derniers mois</div>}
      <div className="cb-cols" onMouseLeave={() => setSurvol(null)}>
        {mois.map((m, i) => (
          <div
            key={m.month}
            tabIndex={0}
            role="img"
            aria-label={`${formatMois(m.month)} : chiffre d'affaires ${fcfa(m.revenue)} FCFA, charges ${fcfa(m.charges)} FCFA, résultat ${fcfa(m.result)} FCFA`}
            className={'cb-col' + (m.month === moisCourant ? ' cb-col--courant' : '')}
            onMouseEnter={() => setSurvol(i)}
            onFocus={() => setSurvol(i)}
            onBlur={() => setSurvol(null)}
          >
            <div className="cb-paire">
              <div className="cb-barre cb-barre--ca" style={{ height: haut(m.revenue) }} />
              <div className="cb-barre cb-barre--ch" style={{ height: haut(m.charges) }} />
            </div>
            <span className="cb-etiq">{moisCourt(m.month)}</span>
          </div>
        ))}
        {tip && (
          <div className="cb-tip" style={{ left: `${Math.min(86, Math.max(14, ((survol + 0.5) / mois.length) * 100))}%` }}>
            <strong>{formatMois(tip.month)}</strong>
            <div><span>CA</span><span>{fcfa(tip.revenue)}</span></div>
            <div><span>Charges</span><span>{fcfa(tip.charges)}</span></div>
            <div><span>Résultat</span><span>{fcfa(tip.result)}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

function RepartitionCharges({ lignes, total }) {
  if (!lignes || lignes.length === 0) return <p className="cb-note">Aucune charge sur les 12 derniers mois.</p>;
  const max = Math.max(1, ...lignes.map((l) => l.total));
  return (
    <div className="cb-rep">
      {lignes.map((l) => (
        <div key={l.code} className="cb-rep-ligne">
          <div className="cb-rep-haut">
            <span className="cb-rep-nom" title={l.label}>{l.label}</span>
            <span className="cb-rep-val">
              {fcfa(l.total)}<span>{total > 0 ? Math.round((l.total / total) * 100) : 0} %</span>
            </span>
          </div>
          <div className="cb-rep-piste">
            <div className="cb-rep-rempli" style={{ width: `${Math.max(2, (l.total / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Un comptable (sans autre rôle) n'a ni stock ni ventes : son tableau de bord montre les rappels
// fiscaux, les chiffres du mois en cours et l'évolution sur 12 mois (toutes boutiques cumulées).
function DashboardComptable() {
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(true);

  function charger() {
    api.getAccountingDashboard()
      .then((d) => { setData(d); setErreur(''); })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);
  useLiveEvent('activity:created', () => charger());

  return (
    <>
      <style>{CSS_COMPTABLE}</style>
      <div className="entete-page"><h1>Tableau de bord</h1></div>
      <p className="cb-periode">
        {data ? `Chiffres de ${formatMois(data.month)}` : 'Mois en cours'} · toutes boutiques cumulées
      </p>

      <RappelsFiscaux lien="/fiscalite" />

      {erreur && !data && <div className="erreur">Chiffres indisponibles : {erreur}</div>}

      {chargement && !data ? (
        <div className="cb-kpis" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="cb-kpi"><div className="cb-sk" style={{ width: '55%' }} /><div className="cb-sk" style={{ width: '80%' }} /></div>
          ))}
        </div>
      ) : data && (
        <>
          <ChiffresMois data={data} />
          <div className="cb-grille">
            <div className="cb-carte">
              <div className="cb-carte-tete">
                <h2>Chiffre d'affaires et charges</h2>
                <span>12 derniers mois</span>
              </div>
              <div className="cb-legende">
                <span><i style={{ background: 'var(--accent)' }} />Chiffre d'affaires</span>
                <span><i style={{ background: 'var(--soleil,#f2a81d)' }} />Charges</span>
              </div>
              <GraphiqueMensuel mois={data.months} moisCourant={data.month} />
            </div>
            <div className="cb-carte">
              <div className="cb-carte-tete">
                <h2>Répartition des charges</h2>
                <span>{fcfa(data.chargesTotal)} FCFA</span>
              </div>
              <RepartitionCharges lignes={data.chargeBreakdown} total={data.chargesTotal} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function DashboardPage() {
  const { aRole } = useAuth();
  const comptableSeul = aRole('comptable') && !aRole('manager', 'gerant', 'vendeur', 'caissier');
  return comptableSeul ? <DashboardComptable /> : <DashboardCommerce />;
}

// ---------------------------------------------------------------------------
// Onglet « Résultat » (manager) : chiffre d'affaires, bénéfice, annulé, par période.
// ---------------------------------------------------------------------------
const CSS_RESULTAT = `
.rs-periodes{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:16px}
.rs-chip{padding:6px 12px;border-radius:999px;border:1.5px solid var(--trait,#e5e7eb);background:var(--surface,#fff);color:inherit;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.rs-chip:hover{border-color:var(--accent)}
.rs-chip.actif{background:var(--accent);border-color:var(--accent);color:#fff}
.rs-dates{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:-4px 0 16px;font-size:13px;color:var(--encre-douce)}
.rs-dates input{padding:6px 8px;border:1.5px solid var(--trait,#e5e7eb);border-radius:8px;font:inherit;background:var(--surface,#fff);color:inherit}
.rs-legende{display:flex;gap:14px;font-size:12px;color:var(--encre-douce);margin-bottom:10px}
.rs-legende i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.rs-duo{display:flex;flex-direction:column;gap:4px;flex:1}
.rs-duo .db-barre-piste{margin:0}
.rs-duo .rs-benef{opacity:.55}
.rs-table-wrap{overflow-x:auto}
.rs-table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.rs-table th,.rs-table td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--trait,#e5e7eb);white-space:nowrap}
.rs-table th:first-child,.rs-table td:first-child{text-align:left}
.rs-table th{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--encre-douce)}
.rs-table tfoot td{font-weight:700;border-bottom:none}
.rs-neg{color:var(--danger,#b91c1c)}
.rs-sous{display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--trait,#e5e7eb)}
.rs-sous button{padding:8px 14px;border:none;border-bottom:2.5px solid transparent;background:none;color:var(--encre-douce);font:inherit;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:-1px}
.rs-sous button.actif{color:var(--accent);border-bottom-color:var(--accent)}
.rs-pct{font-size:12px;color:var(--encre-douce);margin-left:6px}
`;

function jourLocal(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const jj = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${jj}`;
}

const PERIODES_RESULTAT = [
  { id: 'aujourdhui', label: "Aujourd'hui" },
  { id: '7jours', label: '7 jours' },
  { id: 'mois', label: 'Ce mois' },
  { id: 'moisDernier', label: 'Mois dernier' },
  { id: 'annee', label: 'Cette année' },
  { id: 'perso', label: 'Personnalisé' },
];

function bornesPeriode(id) {
  const auj = new Date();
  auj.setHours(12, 0, 0, 0);
  const y = auj.getFullYear();
  const m = auj.getMonth();
  if (id === 'aujourdhui') return [jourLocal(auj), jourLocal(auj)];
  if (id === '7jours') {
    const d = new Date(auj);
    d.setDate(d.getDate() - 6);
    return [jourLocal(d), jourLocal(auj)];
  }
  if (id === 'mois') return [jourLocal(new Date(y, m, 1, 12)), jourLocal(auj)];
  if (id === 'moisDernier') return [jourLocal(new Date(y, m - 1, 1, 12)), jourLocal(new Date(y, m, 0, 12))];
  if (id === 'annee') return [jourLocal(new Date(y, 0, 1, 12)), jourLocal(auj)];
  return null;
}

function ResultatOnglet({ warehouseId, boutiqueNom }) {
  const [periode, setPeriode] = useState('mois');
  const [bornes, setBornes] = useState(() => bornesPeriode('mois'));
  const [donnees, setDonnees] = useState(null);
  const [charges, setCharges] = useState(null);
  const [sousOnglet, setSousOnglet] = useState('resultat');
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const [du, au] = bornes;

  function choisir(id) {
    setPeriode(id);
    const b = bornesPeriode(id);
    if (b) setBornes(b);
  }

  useEffect(() => {
    if (!du || !au) return;
    if (du > au) {
      setErreur('La date de début doit précéder la date de fin.');
      return;
    }
    let annule = false;
    setChargement(true);
    setErreur('');
    Promise.all([
      api.getResult(du, au, warehouseId || undefined),
      api.getCharges(du, au, warehouseId || undefined),
    ])
      .then(([r, c]) => { if (!annule) { setDonnees(r); setCharges(c); } })
      .catch((err) => { if (!annule) setErreur(err.message); })
      .finally(() => { if (!annule) setChargement(false); });
    return () => { annule = true; };
  }, [du, au, warehouseId]);

  const mois = donnees?.byMonth || [];
  const maxMois = Math.max(1, ...mois.map((m) => Math.max(m.revenue, m.profit, 0)));
  const marge = donnees && donnees.revenue > 0 ? Math.round((donnees.profit / donnees.revenue) * 100) : null;
  const totalCharges = charges ? charges.total : 0;
  const beneficeNet = donnees ? donnees.profit - totalCharges : 0;
  const chargesParMois = Object.fromEntries((charges?.byMonth || []).map((m) => [m.month, m.total]));
  const moisNet = [...new Set([...mois.map((m) => m.month), ...Object.keys(chargesParMois)])].sort().map((cle) => {
    const m = mois.find((x) => x.month === cle);
    const benefice = m ? m.profit : 0;
    const ch = chargesParMois[cle] || 0;
    return { month: cle, benefice, charges: ch, net: benefice - ch };
  });
  const maxNature = Math.max(1, ...(charges?.byNature || []).map((n) => n.total));

  return (
    <>
      <style>{CSS_RESULTAT}</style>

      <div className="rs-sous" role="tablist" aria-label="Résultat">
        <button type="button" role="tab" aria-selected={sousOnglet === 'resultat'} className={sousOnglet === 'resultat' ? 'actif' : ''} onClick={() => setSousOnglet('resultat')}>
          Chiffre d'affaires &amp; bénéfice
        </button>
        <button type="button" role="tab" aria-selected={sousOnglet === 'charges'} className={sousOnglet === 'charges' ? 'actif' : ''} onClick={() => setSousOnglet('charges')}>
          Charges
        </button>
      </div>

      <div className="rs-periodes" role="group" aria-label="Période">
        {PERIODES_RESULTAT.map((p) => (
          <button key={p.id} type="button" className={`rs-chip${periode === p.id ? ' actif' : ''}`} onClick={() => choisir(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="rs-dates">
        <label>Du <input type="date" value={du} max={au} onChange={(e) => { setPeriode('perso'); setBornes([e.target.value, au]); }} /></label>
        <label>au <input type="date" value={au} min={du} onChange={(e) => { setPeriode('perso'); setBornes([du, e.target.value]); }} /></label>
        {boutiqueNom && <span>· Boutique : {boutiqueNom}</span>}
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {chargement && !donnees ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : donnees && sousOnglet === 'charges' && charges ? (
        <div style={{ opacity: chargement ? 0.6 : 1 }}>
          <div className="db-kpis">
            <div className="db-kpi db-kpi--hero">
              <span className="db-kpi-icone"><IconValeur /></span>
              <p className="db-kpi-label">Charges</p>
              <p className="db-kpi-valeur">{fcfa(charges.total)} <small>FCFA</small></p>
              <p className="db-kpi-sous">{charges.count} opération(s)</p>
            </div>
            <div className="db-kpi">
              <span className="db-kpi-icone"><IconVentes /></span>
              <p className="db-kpi-label">Bénéfice net</p>
              <p className={`db-kpi-valeur${beneficeNet < 0 ? ' rs-neg' : ''}`}>{fcfa(beneficeNet)} <small>FCFA</small></p>
              <p className="db-kpi-sous">Bénéfice {fcfa(donnees.profit)} − charges {fcfa(charges.total)}</p>
            </div>
          </div>

          {charges.byNature.length === 0 ? (
            <p className="etat-vide">Aucune charge sur cette période.</p>
          ) : (
            <div className="db-carte" style={{ marginBottom: 20 }}>
              <div className="db-carte-tete">
                <h2>Répartition par nature</h2>
              </div>
              <div className="db-barres">
                {charges.byNature.map((n) => (
                  <div key={n.label} className="db-barre-ligne">
                    <p className="db-barre-nom">{n.label}</p>
                    <div className="db-barre-piste">
                      <div className="db-barre-rempli" style={{ width: `${Math.max(2, (n.total / maxNature) * 100)}%` }} />
                    </div>
                    <p className="db-barre-montant">
                      {fcfa(n.total)} FCFA
                      <span className="rs-pct">{charges.total > 0 ? Math.round((n.total / charges.total) * 100) : 0} %</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {moisNet.length > 0 && (
            <div className="db-carte">
              <div className="db-carte-tete">
                <h2>Tableau mensuel</h2>
              </div>
              <div className="rs-table-wrap">
                <table className="rs-table">
                  <thead>
                    <tr>
                      <th>Mois</th>
                      <th>Bénéfice</th>
                      <th>Charges</th>
                      <th>Bénéfice net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...moisNet].reverse().map((m) => (
                      <tr key={m.month}>
                        <td>{formatMois(m.month)}</td>
                        <td>{fcfa(m.benefice)}</td>
                        <td>{fcfa(m.charges)}</td>
                        <td className={m.net < 0 ? 'rs-neg' : ''}>{fcfa(m.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td>{fcfa(donnees.profit)}</td>
                      <td>{fcfa(charges.total)}</td>
                      <td className={beneficeNet < 0 ? 'rs-neg' : ''}>{fcfa(beneficeNet)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p style={{ fontSize: 12, color: 'var(--encre-douce)', margin: '10px 0 0' }}>
                Montants en FCFA, charges hors taxe. Comptés : sorties de caisse (avec ou sans nature) et salaires payés. Non comptés : factures à payer plus tard, transferts, remboursements de retours, paiements à l'État.
              </p>
            </div>
          )}
        </div>
      ) : donnees && (
        <div style={{ opacity: chargement ? 0.6 : 1 }}>
          <div className="db-kpis">
            <div className="db-kpi db-kpi--hero">
              <span className="db-kpi-icone"><IconValeur /></span>
              <p className="db-kpi-label">Chiffre d'affaires</p>
              <p className="db-kpi-valeur">{fcfa(donnees.revenue)} <small>FCFA</small></p>
              <p className="db-kpi-sous">{donnees.ordersCount} vente(s) encaissée(s)</p>
            </div>
            <div className="db-kpi">
              <span className="db-kpi-icone"><IconVentes /></span>
              <p className="db-kpi-label">Bénéfice</p>
              <p className={`db-kpi-valeur${donnees.profit < 0 ? ' rs-neg' : ''}`}>{fcfa(donnees.profit)} <small>FCFA</small></p>
              {marge !== null && <p className="db-kpi-sous">Marge : {marge} %</p>}
            </div>
          </div>

          {donnees.itemsSansCout > 0 && (
            <p style={{ fontSize: 13, color: 'var(--texte-doux, #6b7280)', marginTop: -8, marginBottom: 20 }}>
              {donnees.itemsSansCout} ligne(s) de vente n'ont pas de prix d'achat : le bénéfice est surestimé tant que les prix d'achat ne sont pas renseignés sur les produits.
            </p>
          )}

          {mois.length === 0 ? (
            <p className="etat-vide">Aucune vente sur cette période.</p>
          ) : (
            <>
              <div className="db-carte" style={{ marginBottom: 20 }}>
                <div className="db-carte-tete">
                  <h2>Par mois</h2>
                </div>
                <div className="rs-legende">
                  <span><i style={{ background: 'var(--accent)' }} />Chiffre d'affaires</span>
                  <span><i style={{ background: 'var(--accent)', opacity: 0.55 }} />Bénéfice</span>
                </div>
                <div className="db-barres">
                  {mois.map((m) => (
                    <div key={m.month} className="db-barre-ligne">
                      <p className="db-barre-nom">{formatMois(m.month)}</p>
                      <div className="rs-duo">
                        <div className="db-barre-piste">
                          <div className="db-barre-rempli" style={{ width: `${Math.max(2, (Math.max(m.revenue, 0) / maxMois) * 100)}%` }} />
                        </div>
                        <div className="db-barre-piste">
                          <div className="db-barre-rempli rs-benef" style={{ width: `${Math.max(2, (Math.max(m.profit, 0) / maxMois) * 100)}%` }} />
                        </div>
                      </div>
                      <p className="db-barre-montant">{fcfa(m.revenue)} FCFA</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="db-carte">
                <div className="db-carte-tete">
                  <h2>Tableau mensuel</h2>
                </div>
                <div className="rs-table-wrap">
                  <table className="rs-table">
                    <thead>
                      <tr>
                        <th>Mois</th>
                        <th>CA</th>
                        <th>Annulé</th>
                        <th>Bénéfice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...mois].reverse().map((m) => (
                        <tr key={m.month}>
                          <td>{formatMois(m.month)}</td>
                          <td>{fcfa(m.revenue)}</td>
                          <td>{m.cancelledCount > 0 ? `${fcfa(m.cancelled)} (${m.cancelledCount})` : '—'}</td>
                          <td className={m.profit < 0 ? 'rs-neg' : ''}>{fcfa(m.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Total</td>
                        <td>{fcfa(donnees.revenue)}</td>
                        <td>{donnees.cancelledCount > 0 ? `${fcfa(donnees.cancelled)} (${donnees.cancelledCount})` : '—'}</td>
                        <td className={donnees.profit < 0 ? 'rs-neg' : ''}>{fcfa(donnees.profit)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p style={{ fontSize: 12, color: 'var(--encre-douce)', margin: '10px 0 0' }}>
                  Montants en FCFA. Annulé : montant et (nombre) de commandes annulées, classées selon leur date de création.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function DashboardCommerce() {
  const { user, merchant, aRole } = useAuth();
  const navigate = useNavigate();
  // Une personne peut cumuler des rôles (ex. vendeur + caissier) : on regarde tous ses rôles, pas seulement le principal.
  const vueEquipe = aRole('manager', 'gerant');
  const estCaissier = !vueEquipe && aRole('caissier');
  const estVendeur = !vueEquipe && aRole('vendeur');
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
  const [jourSurvole, setJourSurvole] = useState(null);
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
    const duJour = orders.filter((o) => new Date(o.created_at).toDateString() === cle);
    const total = duJour.reduce((sum, o) => sum + Number(o.total_amount), 0);
    return {
      cle,
      total,
      nb: duJour.length,
      estAujourdhui: i === 6,
      label: i === 6 ? 'Auj.' : d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''),
      titre: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
    };
  });
  const max7 = Math.max(1, ...jours7.map((j) => j.total));
  const total7 = jours7.reduce((sum, j) => sum + j.total, 0);
  const moyenne7 = total7 / 7;
  const hier7 = jours7[5].total;
  const evolutionJour = hier7 > 0 ? Math.round(((jours7[6].total - hier7) / hier7) * 100) : null;
  const HAUTEUR_GRAPHIQUE = 140;
  const alertesStock = [...enRupture, ...enFaible];
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
        {estManager && (
          <button className={onglet === 'resultat' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('resultat')}>
            Résultat
          </button>
        )}
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

            {/* Vendeur + caissier : on ajoute aussi les factures renvoyées et le bouton de vente du vendeur. */}
            {estVendeur && (
              <>
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
              </>
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
            {estPharmacie && lotsPerimes && lotsPerimes.count > 0 && (
              <section className="db-perime db-niveau--urgent" role="alert">
                <header className="db-perime-tete">
                  <span className="db-perime-icone"><IconAlerte /></span>
                  <div className="db-perime-titre">
                    <h2>{lotsPerimes.count} lot{lotsPerimes.count > 1 ? 's' : ''} périmé{lotsPerimes.count > 1 ? 's' : ''} encore en stock</h2>
                    <p>Ces produits ne peuvent plus être vendus. Détruisez-les pour les sortir du stock.</p>
                  </div>
                  <p className="db-perime-total">
                    {fcfa(lotsPerimes.totalValue)} FCFA
                    <small>à retirer du stock</small>
                  </p>
                </header>
                <ul className="db-perime-liste">
                  {lotsPerimes.lots.map((l) => (
                    <li key={l.lot_id} className="db-perime-ligne">
                      <div style={{ minWidth: 0 }}>
                        <p className="db-perime-nom">{l.product_name}</p>
                        <p className="db-perime-meta">
                          Lot {l.lot_number || '—'} · {Math.round(Number(l.quantity))} unité(s) · périmé le {new Date(l.expiry_date).toLocaleDateString('fr-FR')}
                        </p>
                      </div>
                      <span className="db-chip">{l.days_expired} j de retard</span>
                      <button className="btn btn-principal" disabled={destructionEnCours === l.lot_id} onClick={() => detruireLotPerime(l)}>
                        {destructionEnCours === l.lot_id ? 'Destruction…' : 'Détruire'}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
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
                <p className="db-chart-resume">
                  Moyenne <strong>{fcfa(Math.round(moyenne7))} FCFA</strong> / jour
                  {evolutionJour !== null && (
                    <>
                      {' '}· Aujourd'hui{' '}
                      <strong className={evolutionJour >= 0 ? 'db-chart-up' : 'db-chart-down'}>
                        {evolutionJour >= 0 ? '+' : ''}{evolutionJour} %
                      </strong>{' '}vs hier
                    </>
                  )}
                </p>
                <div className="db-chart">
                  <div className="db-chart-plot" aria-hidden="true">
                    {[0, 0.5, 1].map((r) => (
                      <div key={r} className="db-chart-ligne" style={{ bottom: `${r * 100}%` }}>
                        {total7 > 0 && <span>{r === 0 ? '0' : abreger(max7 * r)}</span>}
                      </div>
                    ))}
                    {total7 > 0 && (
                      <div className="db-chart-moy" style={{ bottom: `${Math.min(100, (moyenne7 / max7) * 100)}%` }}>
                        <span>Moy. {abreger(moyenne7)}</span>
                      </div>
                    )}
                  </div>
                  {total7 === 0 && <div className="db-chart-vide">Aucune vente sur les 7 derniers jours</div>}
                  <div className="db-histo" onMouseLeave={() => setJourSurvole(null)}>
                    {jours7.map((j, i) => (
                      <div
                        key={j.cle}
                        tabIndex={0}
                        role="img"
                        aria-label={`${j.titre} : ${fcfa(j.total)} FCFA, ${j.nb} vente(s)`}
                        className={'db-histo-col' + (j.estAujourdhui ? ' db-histo-col--jour' : '') + (j.total === 0 ? ' db-histo-col--vide' : '')}
                        onMouseEnter={() => setJourSurvole(i)}
                        onFocus={() => setJourSurvole(i)}
                        onBlur={() => setJourSurvole(null)}
                      >
                        <span className="db-histo-val">{j.total > 0 ? abreger(j.total) : ''}</span>
                        <div className="db-histo-barre" style={{ height: j.total > 0 ? Math.max(4, Math.round((j.total / max7) * HAUTEUR_GRAPHIQUE)) : 3 }} />
                        <span className="db-histo-label">{j.label}</span>
                      </div>
                    ))}
                    {jourSurvole !== null && (
                      <div
                        className="db-chart-tip"
                        style={{
                          left: `${((jourSurvole + 0.5) / 7) * 100}%`,
                          bottom: 26 + (jours7[jourSurvole].total > 0 ? Math.max(4, Math.round((jours7[jourSurvole].total / max7) * HAUTEUR_GRAPHIQUE)) : 3) + 22,
                        }}
                      >
                        <strong>{jours7[jourSurvole].titre}</strong>
                        <span>{fcfa(jours7[jourSurvole].total)} FCFA</span>
                        <span>{jours7[jourSurvole].nb} vente(s)</span>
                      </div>
                    )}
                  </div>
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
              <div className="db-hz-tete">
                <h2>Périmés imminents</h2>
                {!lotsBientotPerimes.every((h) => h.count === 0) && (
                  <span>
                    {lotsBientotPerimes.reduce((t, h) => t + h.count, 0)} lot(s) à surveiller · {fcfa(lotsBientotPerimes.reduce((t, h) => t + (Number(h.totalValue) || 0), 0))} FCFA en jeu
                  </span>
                )}
              </div>
              {lotsBientotPerimes.every((h) => h.count === 0) ? (
                <div className="db-ok">
                  <span className="db-ok-icone"><IconCheck /></span>
                  Aucun lot ne périme dans les 12 prochains mois.
                </div>
              ) : (
                <>
                  <div className="db-seg" aria-hidden="true">
                    {lotsBientotPerimes
                      .filter((h) => h.count > 0)
                      .map((h) => (
                        <span key={h.horizon} className={'db-niveau--' + infoHorizon(h.horizon).niveau} style={{ flex: h.count }} />
                      ))}
                  </div>
                  <div className="db-hz-grille">
                    {lotsBientotPerimes.map((h) => {
                      const info = infoHorizon(h.horizon);
                      return (
                        <button
                          key={h.horizon}
                          type="button"
                          className={'db-hz db-niveau--' + info.niveau}
                          disabled={h.count === 0}
                          onClick={() => setHorizonOuvert(h)}
                        >
                          <p className="db-hz-delai">{info.titre}</p>
                          <p className="db-hz-nombre">{h.count} <small>lot{h.count > 1 ? 's' : ''}</small></p>
                          <p className="db-hz-valeur">{h.count > 0 ? `${fcfa(h.totalValue)} FCFA en jeu` : 'Rien à signaler'}</p>
                          {h.count > 0 && (
                            <span className="db-hz-voir">Voir le détail <IconChevron /></span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
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

      {onglet === 'resultat' && estManager && (
        <ResultatOnglet
          warehouseId={warehouseId}
          boutiqueNom={warehouses.find((w) => w.id === warehouseId)?.name || ''}
        />
      )}

      {onglet === 'activite' && (
        <>
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
            <h2>Périmés : {infoHorizon(horizonOuvert.horizon).titre.toLowerCase()}</h2>
            <p className="db-modal-sous">
              {horizonOuvert.count} lot{horizonOuvert.count > 1 ? 's' : ''} · {fcfa(horizonOuvert.totalValue)} FCFA en jeu
            </p>
            <div className="db-modal-table">
              <table className="registre">
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
                  {horizonOuvert.lots.map((l) => {
                    const j = joursRestants(l.expiry_date);
                    return (
                      <tr key={l.lot_id}>
                        <td>{l.product_name}</td>
                        <td>{l.lot_number || '—'}</td>
                        <td>
                          {new Date(l.expiry_date).toLocaleDateString('fr-FR')}
                          <br />
                          <span className={'db-chip db-niveau--' + niveauDelai(j)}>{libelleDelai(j)}</span>
                        </td>
                        <td className="chiffre">{Math.round(Number(l.quantity))}</td>
                        <td className="chiffre">{Math.round(Number(l.quantity) * Number(l.unit_price)).toLocaleString('fr-FR')} FCFA</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
