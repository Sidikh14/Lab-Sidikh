import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// ---------------------------------------------------------------------------
// Icônes
// ---------------------------------------------------------------------------
function IconStock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </svg>
  );
}

function IconVentes() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6" />
    </svg>
  );
}

function IconFournisseurs() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="10" width="13" height="8" rx="1.3" />
      <path d="M16 13h3l2 2.5V18h-5" />
      <circle cx="7.5" cy="19.5" r="1.4" />
      <circle cx="17" cy="19.5" r="1.4" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2.2" />
      <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
    </svg>
  );
}

function IconCadenas() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function IconOeil({ ouvert }) {
  return ouvert ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c7 0 10.5 7 10.5 7a17.7 17.7 0 0 1-3.4 4.4M6.6 6.6C3.4 8.7 1.5 12 1.5 12s3.5 7 10.5 7a10.6 10.6 0 0 0 4-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function IconCoche() {
  return (
    <svg className="lp-coche" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function IconAttention() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v5M12 16.5h.01" />
      <path d="M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

function IconSecteurGrossiste() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="10.5" width="7.5" height="7.5" rx="1" />
      <rect x="13.5" y="10.5" width="7.5" height="7.5" rx="1" />
      <rect x="8.25" y="3" width="7.5" height="7.5" rx="1" />
    </svg>
  );
}

function IconSecteurPharmacie() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function IconSecteurElectromenager() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5.5" y="2.5" width="13" height="19" rx="2.2" />
      <path d="M5.5 10h13" />
      <path d="M9 6.2h0.01M9 14.5h0.01" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
}

function IconSecteurRestauration() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 3v7.5M4 3v5a2.5 2.5 0 0 0 5 0V3M6.5 10.5V21" />
      <path d="M17 21V3c-2.4 1.2-3.5 3.8-3.5 7v2.5H17" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Contenu de la vitrine
// ---------------------------------------------------------------------------
const SECTEURS_VITRINE = [
  {
    nom: 'Grossiste',
    tagline: 'Distribution & gros volumes',
    detail: 'Gros volumes, prix par palier et livraisons suivies de bout en bout.',
    tags: ['Prix par palier', 'Livraisons', 'Fournisseurs'],
    Icone: IconSecteurGrossiste,
  },
  {
    nom: 'Pharmacie',
    tagline: 'Lots & péremption',
    detail: 'Lots, dates de péremption, ordonnances et tiers payant, sous contrôle.',
    tags: ['Péremption', 'Ordonnances', 'Tiers payant'],
    Icone: IconSecteurPharmacie,
  },
  {
    nom: 'Électroménager',
    tagline: 'Références & garanties',
    detail: 'Références précises et garanties suivies pour chaque appareil vendu.',
    tags: ['Références', 'Garanties', 'Stock'],
    Icone: IconSecteurElectromenager,
  },
  {
    nom: 'Restauration',
    tagline: 'Menu QR, salle & cuisine',
    detail: 'Menu en QR code, plan de salle, cuisine et paiements au même endroit.',
    tags: ['QR code', 'Tables', 'Cuisine'],
    Icone: IconSecteurRestauration,
  },
];

const MOTS_TITRE = ["qui s'éclaire.", 'qui va vite.', "qui s'adapte.", 'qui simplifie.'];
const DUREE_SECTEUR_MS = 4200;
const DUREE_MOT_MS = 3200;

// ---------------------------------------------------------------------------
// Petits outils d'animation
// ---------------------------------------------------------------------------
function useMouvementReduit() {
  const lire = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [reduit, setReduit] = useState(lire);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const maj = () => setReduit(mq.matches);
    mq.addEventListener('change', maj);
    return () => mq.removeEventListener('change', maj);
  }, []);
  return reduit;
}

// Compteur qui monte en douceur jusqu'à la valeur cible.
function useCompteur(cible, { delai = 0, duree = 1400, reduit = false } = {}) {
  const [valeur, setValeur] = useState(reduit ? cible : 0);
  const derniere = useRef(reduit ? cible : 0);
  useEffect(() => {
    if (reduit) {
      derniere.current = cible;
      setValeur(cible);
      return undefined;
    }
    const depart = derniere.current;
    const dureeReelle = depart === 0 ? duree : Math.min(duree, 450);
    let raf = 0;
    let debut = null;
    const minuteur = setTimeout(() => {
      const etape = (ts) => {
        if (debut === null) debut = ts;
        const p = Math.min(1, (ts - debut) / dureeReelle);
        const ease = 1 - (1 - p) ** 3;
        const v = Math.round(depart + (cible - depart) * ease);
        derniere.current = v;
        setValeur(v);
        if (p < 1) raf = requestAnimationFrame(etape);
      };
      raf = requestAnimationFrame(etape);
    }, depart === 0 ? delai : 0);
    return () => {
      clearTimeout(minuteur);
      cancelAnimationFrame(raf);
    };
  }, [cible, delai, duree, reduit]);
  return valeur;
}

function salutation() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Bonjour';
  if (h >= 12 && h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------------------------------------------------------------------------
// Styles (propres à cet écran). Les animations utilisent les propriétés individuelles
// `translate` / `scale`, pour ne jamais écraser un `transform` posé par la feuille globale.
// ---------------------------------------------------------------------------
const STYLES = `
  /* L'écran de connexion garde TOUJOURS la charte Amaterasu par défaut : même si la charte d'un
     commerçant est appliquée sur la page (juste après la connexion, session expirée…), elle ne
     change rien ici. */
  .ecran-connexion-partage {
    --marine: #0f2747;
    --encre: #0f2747;
    --accent: #1f5fbf;
    --accent-fonce: #174c9c;
    --accent-clair: #dce8fa;
    --soleil: #f2a81d;
  }

  /* Entrée en cascade : un seul moment orchestré au chargement */
  .ecran-connexion-partage .lp-entree {
    animation: lp-entree 0.75s cubic-bezier(0.2, 0.7, 0.2, 1) both;
    animation-delay: var(--d, 0s);
  }
  @keyframes lp-entree {
    from { opacity: 0; translate: 0 16px; }
    to { opacity: 1; translate: 0 0; }
  }

  /* Fond vivant du panneau de marque */
  .ecran-connexion-partage .lp-orbe {
    position: absolute;
    border-radius: 50%;
    filter: blur(38px);
    pointer-events: none;
    will-change: translate;
  }
  .ecran-connexion-partage .lp-orbe--1 {
    width: 340px; height: 340px; top: -90px; left: -70px;
    background: radial-gradient(circle, rgba(31, 95, 191, 0.6), transparent 68%);
    animation: lp-derive-1 16s ease-in-out infinite alternate;
  }
  .ecran-connexion-partage .lp-orbe--2 {
    width: 280px; height: 280px; bottom: -80px; right: -60px;
    background: radial-gradient(circle, rgba(242, 168, 29, 0.4), transparent 68%);
    animation: lp-derive-2 20s ease-in-out infinite alternate;
  }
  .ecran-connexion-partage .lp-orbe--3 {
    width: 220px; height: 220px; top: 42%; right: 12%;
    background: radial-gradient(circle, rgba(220, 232, 250, 0.22), transparent 68%);
    animation: lp-derive-3 24s ease-in-out infinite alternate;
  }
  .ecran-connexion-partage .lp-orbe--form {
    width: 360px; height: 360px; top: -120px; right: -100px;
    background: radial-gradient(circle, rgba(31, 95, 191, 0.16), transparent 68%);
    animation: lp-derive-2 22s ease-in-out infinite alternate;
  }
  @keyframes lp-derive-1 { from { translate: 0 0; } to { translate: 90px 60px; } }
  @keyframes lp-derive-2 { from { translate: 0 0; } to { translate: -80px -50px; } }
  @keyframes lp-derive-3 { from { translate: 0 0; } to { translate: -60px 70px; } }

  .ecran-connexion-partage .lp-lueur {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: var(--lueur, 0);
    transition: opacity 0.4s ease;
    background: radial-gradient(
      380px circle at var(--mx, 50%) var(--my, 50%),
      rgba(242, 168, 29, 0.16),
      rgba(31, 95, 191, 0.1) 45%,
      transparent 72%
    );
  }

  /* Emblème qui « s'éclaire » */
  .ecran-connexion-partage .lp-logo-halo {
    position: relative;
    display: inline-flex;
    isolation: isolate;
  }
  .ecran-connexion-partage .lp-logo-halo::before {
    content: '';
    position: absolute;
    inset: -10px;
    border-radius: 50%;
    z-index: -1;
    background: radial-gradient(circle, rgba(242, 168, 29, 0.55), transparent 70%);
    animation: lp-pulse 3.4s ease-in-out infinite;
  }
  @keyframes lp-pulse {
    0%, 100% { opacity: 0.45; scale: 0.9; }
    50% { opacity: 1; scale: 1.15; }
  }

  /* Mot du titre qui change */
  .ecran-connexion-partage .lp-mots {
    display: inline-grid;
    vertical-align: top;
  }
  .ecran-connexion-partage .lp-mot {
    grid-area: 1 / 1;
    opacity: 0;
    translate: 0 0.35em;
    transition: opacity 0.5s ease, translate 0.5s cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .ecran-connexion-partage .lp-mot--actif {
    opacity: 1;
    translate: 0 0;
  }

  /* Secteurs : cartes interactives qui se mettent en avant à tour de rôle */
  .secteurs-vitrine {
    margin: 30px 0 6px;
    position: relative;
    z-index: 1;
  }
  .secteurs-vitrine-titre {
    display: block;
    font-size: 13px;
    font-weight: 600;
    opacity: 0.7;
    margin-bottom: 14px;
  }
  .secteurs-grille {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .secteur-carte {
    appearance: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    padding: 12px 13px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.09);
    transition: border-color 0.25s ease, background 0.25s ease, translate 0.25s ease;
  }
  .secteur-carte:hover {
    border-color: rgba(242, 168, 29, 0.45);
    background: rgba(255, 255, 255, 0.08);
    translate: 0 -2px;
  }
  .secteur-carte:focus-visible {
    outline: 2px solid var(--soleil);
    outline-offset: 2px;
  }
  .secteur-carte--actif {
    border-color: rgba(242, 168, 29, 0.6);
    background: rgba(255, 255, 255, 0.1);
  }
  .secteur-carte-icone {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--soleil);
    background: rgba(242, 168, 29, 0.16);
    transition: scale 0.3s cubic-bezier(0.3, 1.5, 0.5, 1), rotate 0.3s ease, background 0.25s ease;
  }
  .secteur-carte--actif .secteur-carte-icone {
    scale: 1.1;
    rotate: -6deg;
    background: rgba(242, 168, 29, 0.28);
  }
  .secteur-carte-texte {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .secteur-carte-texte strong {
    font-size: 14px;
    font-weight: 700;
    line-height: 1.25;
  }
  .secteur-carte-texte span {
    font-size: 11.5px;
    opacity: 0.65;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .secteur-progression {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 2px;
    background: var(--soleil);
    transform-origin: left center;
    animation: lp-progression ${DUREE_SECTEUR_MS}ms linear forwards;
  }
  @keyframes lp-progression { from { transform: scaleX(0); } to { transform: scaleX(1); } }

  .secteur-detail {
    margin-top: 12px;
    min-height: 74px;
    padding: 12px 14px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px dashed rgba(255, 255, 255, 0.16);
  }
  .secteur-detail p {
    margin: 0 0 8px;
    font-size: 13px;
    line-height: 1.45;
    animation: lp-detail 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .secteur-detail ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .secteur-detail li {
    font-size: 11.5px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 999px;
    color: var(--soleil);
    background: rgba(242, 168, 29, 0.14);
    animation: lp-detail 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both;
    animation-delay: calc(var(--k, 0) * 70ms + 80ms);
  }
  @keyframes lp-detail {
    from { opacity: 0; translate: 0 8px; }
    to { opacity: 1; translate: 0 0; }
  }

  /* Cartes flottantes : elles respirent, et le chiffre des ventes bouge en direct */
  .ecran-connexion-partage .carte-flottante {
    animation: lp-flotte 6s ease-in-out infinite alternate;
    transition: scale 0.25s ease;
  }
  .ecran-connexion-partage .carte-flottante--2 { animation-duration: 7.5s; animation-delay: -2s; }
  .ecran-connexion-partage .carte-flottante--3 { animation-duration: 6.8s; animation-delay: -4s; }
  .ecran-connexion-partage .carte-flottante:hover { scale: 1.05; }
  @keyframes lp-flotte { from { translate: 0 0; } to { translate: 0 -12px; } }
  .ecran-connexion-partage .lp-bulle {
    position: absolute;
    top: -10px;
    right: 14px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    font-style: normal;
    color: var(--marine);
    background: var(--soleil);
    pointer-events: none;
    animation: lp-bulle 1.3s ease-out both;
  }
  @keyframes lp-bulle {
    0% { opacity: 0; translate: 0 8px; scale: 0.8; }
    18% { opacity: 1; translate: 0 0; scale: 1; }
    80% { opacity: 1; }
    100% { opacity: 0; translate: 0 -14px; }
  }

  /* Formulaire : réactions au focus, à la saisie et à l'erreur */
  .ecran-connexion-partage .champ-groupe .etiquette { transition: color 0.2s ease; }
  .ecran-connexion-partage .champ-groupe:focus-within .etiquette { color: var(--accent); }
  .ecran-connexion-partage .champ { transition: box-shadow 0.25s ease, border-color 0.25s ease; }
  .ecran-connexion-partage .champ:focus { box-shadow: 0 0 0 4px rgba(31, 95, 191, 0.15); }
  .ecran-connexion-partage .champ-avec-icone .champ-icone:first-child {
    transition: color 0.2s ease, scale 0.25s cubic-bezier(0.3, 1.5, 0.5, 1);
  }
  .ecran-connexion-partage .champ-avec-icone:focus-within .champ-icone:first-child {
    color: var(--accent);
    scale: 1.14;
  }
  .ecran-connexion-partage .lp-statut {
    position: absolute;
    top: 0; bottom: 0; right: 12px;
    display: flex;
    align-items: center;
    pointer-events: none;
  }
  .ecran-connexion-partage .lp-statut--ok { color: #157347; }
  .ecran-connexion-partage .lp-statut--alerte { color: #9c4a06; }
  .ecran-connexion-partage .lp-coche {
    stroke-dasharray: 26;
    stroke-dashoffset: 26;
    animation: lp-trace 0.4s ease forwards;
  }
  @keyframes lp-trace { to { stroke-dashoffset: 0; } }
  .ecran-connexion-partage .champ-icone--bouton svg { transition: rotate 0.3s ease, scale 0.2s ease; }
  .ecran-connexion-partage .champ-icone--bouton:hover svg { scale: 1.12; }
  .ecran-connexion-partage .champ-icone--bouton:active svg { rotate: 12deg; }

  .ecran-connexion-partage .lp-note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 2px 0;
    font-size: 12px;
    color: #9c4a06;
    animation: lp-detail 0.3s ease both;
  }
  .ecran-connexion-partage .lp-erreur {
    animation: lp-detail 0.35s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .ecran-connexion-partage .lp-secoue { animation: lp-secousse 0.45s ease; }
  @keyframes lp-secousse {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-8px); }
    40% { transform: translateX(7px); }
    60% { transform: translateX(-5px); }
    80% { transform: translateX(3px); }
  }

  /* Bouton : reflet, flèche qui avance, onde au clic, chargement */
  .ecran-connexion-partage .btn-connexion {
    position: relative;
    overflow: hidden;
    transition: scale 0.15s ease, box-shadow 0.25s ease, translate 0.2s ease;
  }
  .ecran-connexion-partage .btn-connexion:hover:not(:disabled) {
    translate: 0 -1px;
    box-shadow: 0 10px 24px rgba(31, 95, 191, 0.32);
  }
  .ecran-connexion-partage .btn-connexion:active:not(:disabled) { scale: 0.98; }
  .ecran-connexion-partage .btn-connexion::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.32) 50%, transparent 70%);
    translate: -120% 0;
    transition: translate 0.7s ease;
  }
  .ecran-connexion-partage .btn-connexion:hover:not(:disabled)::after { translate: 120% 0; }
  .ecran-connexion-partage .btn-connexion [aria-hidden='true'] {
    display: inline-block;
    transition: translate 0.25s ease;
  }
  .ecran-connexion-partage .btn-connexion:hover:not(:disabled) [aria-hidden='true'] { translate: 5px 0; }
  .ecran-connexion-partage .lp-onde {
    position: absolute;
    width: 12px; height: 12px;
    margin: -6px 0 0 -6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.55);
    pointer-events: none;
    animation: lp-onde 0.65s ease-out forwards;
  }
  @keyframes lp-onde { to { scale: 24; opacity: 0; } }
  .ecran-connexion-partage .lp-spinner {
    display: inline-block;
    width: 15px; height: 15px;
    margin-right: 8px;
    vertical-align: -2px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: lp-rotation 0.7s linear infinite;
  }
  @keyframes lp-rotation { to { rotate: 360deg; } }

  /* Connexion réussie : l'écran se referme sur un voile marine avant l'ouverture de l'espace */
  .ecran-connexion-partage .lp-succes {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    color: #fff;
    text-align: center;
    background: radial-gradient(circle at 50% 38%, #174c9c, #0f2747 70%);
    animation: lp-voile 0.45s ease both;
  }
  .ecran-connexion-partage .lp-succes strong { font-size: 20px; }
  .ecran-connexion-partage .lp-succes span { opacity: 0.75; font-size: 14px; }
  .ecran-connexion-partage .lp-succes-svg { width: 76px; height: 76px; margin-bottom: 6px; }
  .ecran-connexion-partage .lp-succes-cercle {
    fill: none; stroke: var(--soleil); stroke-width: 2.5;
    stroke-dasharray: 152; stroke-dashoffset: 152;
    animation: lp-trace-long 0.6s ease 0.1s forwards;
  }
  .ecran-connexion-partage .lp-succes-trait {
    fill: none; stroke: #fff; stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round;
    stroke-dasharray: 40; stroke-dashoffset: 40;
    animation: lp-trace-long 0.4s ease 0.55s forwards;
  }
  @keyframes lp-trace-long { to { stroke-dashoffset: 0; } }
  @keyframes lp-voile { from { opacity: 0; } to { opacity: 1; } }

  @media (max-width: 480px) {
    .secteurs-grille { grid-template-columns: 1fr; }
  }

  /* Pour les personnes qui préfèrent moins de mouvement : tout reste lisible, rien ne bouge */
  @media (prefers-reduced-motion: reduce) {
    .ecran-connexion-partage *,
    .ecran-connexion-partage *::before,
    .ecran-connexion-partage *::after {
      animation-duration: 0.01ms !important;
      animation-delay: 0s !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const reduit = useMouvementReduit();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [motDePasseVisible, setMotDePasseVisible] = useState(false);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);
  const [succes, setSucces] = useState(false);
  const [secoue, setSecoue] = useState(false);
  const [emailTouche, setEmailTouche] = useState(false);
  const [majusculesActives, setMajusculesActives] = useState(false);
  const [ondes, setOndes] = useState([]);

  const [secteurActif, setSecteurActif] = useState(0);
  const [pauseSecteurs, setPauseSecteurs] = useState(false);
  const [motActif, setMotActif] = useState(0);
  const [ventes, setVentes] = useState(48);
  const [bulleVente, setBulleVente] = useState(0);

  const panneauRef = useRef(null);
  const rafSouris = useRef(0);
  const minuteurs = useRef([]);

  const salut = useMemo(salutation, []);
  const emailValide = EMAIL_RE.test(email.trim());

  const stock = useCompteur(312, { delai: 700, reduit });
  const fournisseurs = useCompteur(12, { delai: 1000, reduit });
  const ventesAffichees = useCompteur(ventes, { delai: 850, reduit });

  function programmer(fn, delai) {
    const id = setTimeout(fn, delai);
    minuteurs.current.push(id);
    return id;
  }

  useEffect(() => () => {
    minuteurs.current.forEach(clearTimeout);
    cancelAnimationFrame(rafSouris.current);
  }, []);

  // Le mot du titre change doucement
  useEffect(() => {
    if (reduit) return undefined;
    const id = setInterval(() => setMotActif((i) => (i + 1) % MOTS_TITRE.length), DUREE_MOT_MS);
    return () => clearInterval(id);
  }, [reduit]);

  // Les secteurs se mettent en avant à tour de rôle (en pause au survol et au clavier)
  useEffect(() => {
    if (reduit || pauseSecteurs) return undefined;
    const id = setTimeout(() => setSecteurActif((i) => (i + 1) % SECTEURS_VITRINE.length), DUREE_SECTEUR_MS);
    return () => clearTimeout(id);
  }, [secteurActif, pauseSecteurs, reduit]);

  // Le compteur de ventes avance de temps en temps, comme une boutique qui travaille
  useEffect(() => {
    if (reduit) return undefined;
    let id;
    const prochain = () => {
      id = setTimeout(() => {
        setVentes((v) => v + 1);
        setBulleVente((b) => b + 1);
        prochain();
      }, 3500 + Math.random() * 3500);
    };
    prochain();
    return () => clearTimeout(id);
  }, [reduit]);

  function suivreSouris(e) {
    if (reduit) return;
    const el = panneauRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cancelAnimationFrame(rafSouris.current);
    rafSouris.current = requestAnimationFrame(() => {
      el.style.setProperty('--mx', `${x}px`);
      el.style.setProperty('--my', `${y}px`);
      el.style.setProperty('--lueur', '1');
    });
  }

  function quitterSouris() {
    panneauRef.current?.style.setProperty('--lueur', '0');
  }

  function secouer() {
    if (reduit) return;
    setSecoue(true);
    programmer(() => setSecoue(false), 500);
  }

  function ajouterOnde(e) {
    if (reduit) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const id = `${Date.now()}-${Math.random()}`;
    setOndes((liste) => [...liste, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    programmer(() => setOndes((liste) => liste.filter((o) => o.id !== id)), 700);
  }

  function verifierMajuscules(e) {
    setMajusculesActives(Boolean(e.getModifierState && e.getModifierState('CapsLock')));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErreur('');

    if (!email || !password) {
      setErreur('Renseignez votre email et votre mot de passe.');
      secouer();
      return;
    }

    setChargement(true);
    try {
      await login(email, password);
      setSucces(true);
      await new Promise((resolve) => { programmer(resolve, reduit ? 0 : 1300); });
      navigate('/');
    } catch (err) {
      setErreur(err.message);
      secouer();
    } finally {
      setChargement(false);
    }
  }

  const secteur = SECTEURS_VITRINE[secteurActif];

  return (
    <div className="ecran-connexion-partage">
      <style>{STYLES}</style>
      <div
        className="panneau-marque"
        ref={panneauRef}
        onPointerMove={suivreSouris}
        onPointerLeave={quitterSouris}
      >
        <div className="fond-motif" aria-hidden="true" />
        <div className="fond-halo" aria-hidden="true" />
        <div className="lp-orbe lp-orbe--1" aria-hidden="true" />
        <div className="lp-orbe lp-orbe--2" aria-hidden="true" />
        <div className="lp-orbe lp-orbe--3" aria-hidden="true" />
        <div className="lp-lueur" aria-hidden="true" />

        <div className="marque-entete lp-entree" style={{ '--d': '0s' }}>
          <span className="lp-logo-halo">
            <img className="logo-badge" src="/amaterasu-emblem.svg" alt="" width="40" height="40" />
          </span>
          <span className="nom-marque">Amaterasu</span>
        </div>

        <p className="eyebrow-marque lp-entree" style={{ '--d': '0.08s' }}>Plateforme de gestion commerçante</p>
        <h1 className="titre-marque lp-entree" style={{ '--d': '0.16s' }}>
          La gestion<br />
          <span className="titre-marque-accent lp-mots">
            {MOTS_TITRE.map((mot, i) => (
              <span
                key={mot}
                className={'lp-mot' + (i === motActif ? ' lp-mot--actif' : '')}
                aria-hidden={i !== motActif}
              >
                {mot}
              </span>
            ))}
          </span>
        </h1>
        <p className="tagline-marque lp-entree" style={{ '--d': '0.24s' }}>
          Pilotez votre stock, vos ventes, vos clients et vos fournisseurs
          depuis un espace unique, pensé pour aller vite.
        </p>

        <div
          className="secteurs-vitrine lp-entree"
          style={{ '--d': '0.32s' }}
          onMouseEnter={() => setPauseSecteurs(true)}
          onMouseLeave={() => setPauseSecteurs(false)}
          onFocus={() => setPauseSecteurs(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setPauseSecteurs(false);
          }}
        >
          <span className="secteurs-vitrine-titre">Un espace pensé pour votre activité</span>
          <div className="secteurs-grille">
            {SECTEURS_VITRINE.map(({ nom, tagline, Icone }, i) => (
              <button
                key={nom}
                type="button"
                className={'secteur-carte' + (i === secteurActif ? ' secteur-carte--actif' : '')}
                aria-pressed={i === secteurActif}
                onClick={() => setSecteurActif(i)}
              >
                <span className="secteur-carte-icone">
                  <Icone />
                </span>
                <span className="secteur-carte-texte">
                  <strong>{nom}</strong>
                  <span>{tagline}</span>
                </span>
                {i === secteurActif && !pauseSecteurs && !reduit && (
                  <span key={`progression-${secteurActif}`} className="secteur-progression" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
          <div className="secteur-detail" aria-live="polite">
            <p key={secteur.nom}>{secteur.detail}</p>
            <ul>
              {secteur.tags.map((tag, k) => (
                <li key={`${secteur.nom}-${tag}`} style={{ '--k': k }}>{tag}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="cartes-flottantes lp-entree" style={{ '--d': '0.5s' }}>
          <div className="carte-flottante carte-flottante--1">
            <span className="carte-flottante-icone"><IconStock /></span>
            <div>
              <strong>{stock}</strong>
              <span>produits en stock</span>
            </div>
          </div>
          <div className="carte-flottante carte-flottante--2">
            <span className="carte-flottante-icone"><IconVentes /></span>
            <div>
              <strong>{ventesAffichees}</strong>
              <span>ventes aujourd'hui</span>
            </div>
            {bulleVente > 0 && <b key={bulleVente} className="lp-bulle" aria-hidden="true">+1</b>}
          </div>
          <div className="carte-flottante carte-flottante--3">
            <span className="carte-flottante-icone"><IconFournisseurs /></span>
            <div>
              <strong>{fournisseurs}</strong>
              <span>fournisseurs</span>
            </div>
          </div>
        </div>
      </div>

      <div className="panneau-formulaire">
        <div className="fond-motif fond-motif--clair" aria-hidden="true" />
        <div className="fond-halo fond-halo--clair" aria-hidden="true" />
        <div className="lp-orbe lp-orbe--form" aria-hidden="true" />

        <div className="carte-connexion carte-connexion--plate lp-entree" style={{ '--d': '0.2s' }}>
          <span className="pastille-accueil">Connexion</span>
          <h2 style={{ fontSize: 26, margin: '14px 0 4px', fontWeight: 700 }}>{salut}, bon retour</h2>
          <p className="souligne">Connectez-vous à votre espace Amaterasu</p>

          {erreur && <div className="erreur lp-erreur" role="alert">{erreur}</div>}

          <form onSubmit={handleSubmit} className={secoue ? 'lp-secoue' : undefined} noValidate>
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="email">Email</label>
              <div className="champ-avec-icone">
                <span className="champ-icone"><IconMail /></span>
                <input
                  id="email"
                  type="email"
                  className="champ champ--avec-icone champ--avec-icone-droite"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouche(true)}
                  placeholder="nom@boutique.com"
                  autoComplete="email"
                  aria-invalid={emailTouche && email !== '' && !emailValide ? 'true' : undefined}
                />
                {emailValide && (
                  <span className="lp-statut lp-statut--ok" aria-hidden="true"><IconCoche /></span>
                )}
                {emailTouche && email !== '' && !emailValide && (
                  <span className="lp-statut lp-statut--alerte" aria-hidden="true"><IconAttention /></span>
                )}
              </div>
              {emailTouche && email !== '' && !emailValide && (
                <p className="lp-note">Vérifiez l'adresse : elle doit ressembler à nom@boutique.com.</p>
              )}
            </div>
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="password">Mot de passe</label>
              <div className="champ-avec-icone">
                <span className="champ-icone"><IconCadenas /></span>
                <input
                  id="password"
                  type={motDePasseVisible ? 'text' : 'password'}
                  className="champ champ--avec-icone champ--avec-icone-droite"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={verifierMajuscules}
                  onKeyUp={verifierMajuscules}
                  onBlur={() => setMajusculesActives(false)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="champ-icone champ-icone--bouton"
                  onClick={() => setMotDePasseVisible((v) => !v)}
                  aria-label={motDePasseVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  <IconOeil ouvert={motDePasseVisible} />
                </button>
              </div>
              {majusculesActives && (
                <p className="lp-note" role="status">
                  <IconAttention /> Verrouillage majuscules activé
                </p>
              )}
            </div>
            <button
              type="submit"
              className="btn btn-principal btn-connexion"
              disabled={chargement}
              onPointerDown={ajouterOnde}
            >
              {ondes.map((o) => (
                <span key={o.id} className="lp-onde" style={{ left: o.x, top: o.y }} aria-hidden="true" />
              ))}
              {chargement && <span className="lp-spinner" aria-hidden="true" />}
              {chargement ? 'Connexion…' : 'Se connecter'}
              {!chargement && <span aria-hidden="true">→</span>}
            </button>
          </form>

          <p className="pied-connexion">Amaterasu — gestion commerçante</p>
        </div>
      </div>

      {succes && (
        <div className="lp-succes" role="status">
          <svg className="lp-succes-svg" viewBox="0 0 52 52" aria-hidden="true">
            <circle className="lp-succes-cercle" cx="26" cy="26" r="24" />
            <path className="lp-succes-trait" d="M15 27l8 8 14-16" />
          </svg>
          <strong>Connexion réussie</strong>
          <span>Ouverture de votre espace…</span>
        </div>
      )}
    </div>
  );
}
