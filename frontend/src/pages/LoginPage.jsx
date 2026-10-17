import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// ---------------------------------------------------------------------------
// Icônes
// ---------------------------------------------------------------------------
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
// Aperçu par secteur (illustratif : ce ne sont pas des données réelles)
// ---------------------------------------------------------------------------
const SECTEURS = [
  {
    nom: 'Grossiste',
    Icone: IconSecteurGrossiste,
    barres: [38, 52, 44, 70, 58, 82, 64],
    kpi: '+18 %',
    kpiLibelle: 'ventes cette semaine',
    puce: 'Livraison reçue',
  },
  {
    nom: 'Pharmacie',
    Icone: IconSecteurPharmacie,
    barres: [60, 48, 66, 40, 72, 34, 56],
    kpi: '3 lots',
    kpiLibelle: 'à surveiller',
    puce: 'Péremption dans 30 jours',
  },
  {
    nom: 'Électroménager',
    Icone: IconSecteurElectromenager,
    barres: [30, 44, 40, 58, 52, 76, 88],
    kpi: '12',
    kpiLibelle: 'garanties en cours',
    puce: 'Retour SAV',
  },
  {
    nom: 'Restauration',
    Icone: IconSecteurRestauration,
    barres: [24, 36, 62, 86, 74, 58, 80],
    kpi: '14 / 18',
    kpiLibelle: 'tables occupées',
    puce: 'Commande en cuisine',
  },
];

const DUREE_SECTEUR_MS = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function salutation() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Bonjour';
  if (h >= 12 && h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

// ---------------------------------------------------------------------------
// Outils : mouvement réduit, pointeur partagé, champ de lumière (canvas), inclinaison 3D
// ---------------------------------------------------------------------------

// « Mouvement réduit » : préférence du système, ou mode économie de données activé.
function useMouvementReduit() {
  const lire = () => {
    if (typeof window === 'undefined') return false;
    const systeme = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const economie = Boolean(navigator.connection && navigator.connection.saveData);
    return systeme || economie;
  };
  const [reduit, setReduit] = useState(lire);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const maj = () => setReduit(lire());
    mq.addEventListener('change', maj);
    return () => mq.removeEventListener('change', maj);
  }, []);
  return reduit;
}

// Position du pointeur dans la fenêtre, partagée entre toutes les animations (pas de re-rendu React).
function usePointeur() {
  const ref = useRef({ x: 0, y: 0, t: 0 });
  useEffect(() => {
    const bouger = (e) => {
      ref.current.x = e.clientX;
      ref.current.y = e.clientY;
      ref.current.t = performance.now();
    };
    window.addEventListener('pointermove', bouger, { passive: true });
    return () => window.removeEventListener('pointermove', bouger);
  }, []);
  return ref;
}

const PALETTES = {
  sombre: {
    couleurs: ['#f2a81d', '#8fb4ee', '#ffffff'],
    poids: [0.22, 0.38, 1],
    lumieres: ['rgba(242, 168, 29, ', 'rgba(31, 95, 191, '],
    lien: '255, 255, 255',
    curseur: '242, 168, 29',
    alpha: 0.95,
  },
  clair: {
    couleurs: ['#1f5fbf', '#f2a81d', '#0f2747'],
    poids: [0.5, 0.75, 1],
    lumieres: ['rgba(31, 95, 191, ', 'rgba(242, 168, 29, '],
    lien: '31, 95, 191',
    curseur: '31, 95, 191',
    alpha: 0.6,
  },
};

function fabriquerLumiere(debut, alpha) {
  const lumiere = document.createElement('canvas');
  lumiere.width = 192;
  lumiere.height = 192;
  const c = lumiere.getContext('2d');
  const g = c.createRadialGradient(96, 96, 0, 96, 96, 96);
  g.addColorStop(0, `${debut}${alpha})`);
  g.addColorStop(0.55, `${debut}${(alpha * 0.35).toFixed(3)})`);
  g.addColorStop(1, `${debut}0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, 192, 192);
  return lumiere;
}

function fabriquerSprite(couleur) {
  const sprite = document.createElement('canvas');
  sprite.width = 48;
  sprite.height = 48;
  const c = sprite.getContext('2d');
  const g = c.createRadialGradient(24, 24, 0, 24, 24, 24);
  g.addColorStop(0, couleur);
  g.addColorStop(0.22, `${couleur}cc`);
  g.addColorStop(1, `${couleur}00`);
  c.fillStyle = g;
  c.fillRect(0, 0, 48, 48);
  return sprite;
}

// Champ de particules et de lumière : profondeur (parallaxe), répulsion autour du curseur,
// traits de lumière vers le curseur, onde de choc au clic. La qualité baisse toute seule si
// l'appareil est lent, et l'animation s'arrête quand l'onglet est caché ou hors écran.
function useChampLumineux(canvasRef, pointeur, { palette, densite = 1, liens = true, reduit }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas ? canvas.getContext('2d') : null;
    if (!canvas || !ctx) return undefined;
    const pal = PALETTES[palette];
    const sprites = pal.couleurs.map(fabriquerSprite);
    const lumieres = [fabriquerLumiere(pal.lumieres[0], 0.2), fabriquerLumiere(pal.lumieres[1], 0.22)];
    const etat = {
      l: 1, h: 1, rect: canvas.getBoundingClientRect(), particules: [], ondes: [],
      qualite: 1, ema: 16, images: 0, dernier: 0, lueur: null, raf: 0, visible: true, px: null, py: null,
    };

    const choisirSprite = () => {
      const r = Math.random();
      return pal.poids.findIndex((p) => r <= p);
    };

    const dimensionner = () => {
      const r = canvas.getBoundingClientRect();
      etat.rect = r;
      etat.l = Math.max(1, r.width);
      etat.h = Math.max(1, r.height);
      const dpr = Math.min(window.devicePixelRatio || 1, etat.qualite < 0.75 ? 1 : 2);
      canvas.width = Math.round(etat.l * dpr);
      canvas.height = Math.round(etat.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const surface = etat.l * etat.h;
      const n = Math.round(Math.min(150, surface / (palette === 'sombre' ? 8000 : 26000)) * densite * etat.qualite);
      etat.particules = Array.from({ length: n }, () => ({
        x: Math.random() * etat.l,
        y: Math.random() * etat.h,
        z: 0.25 + Math.random() * 0.75,
        bx: (Math.random() - 0.5) * 0.22,
        by: (Math.random() - 0.5) * 0.22,
        vx: 0,
        vy: 0,
        s: choisirSprite(),
        phase: Math.random() * 6.28,
      }));
      etat.px = new Float32Array(n);
      etat.py = new Float32Array(n);
      if (!etat.lueur) etat.lueur = { x: etat.l / 2, y: etat.h / 2 };
    };

    const majRect = () => { etat.rect = canvas.getBoundingClientRect(); };

    const dessiner = (t, k) => {
      const { l, h, rect, particules } = etat;
      const p = pointeur.current;
      const maintenant = performance.now();
      let cx = l * (0.5 + 0.34 * Math.sin(t / 2900));
      let cy = h * (0.5 + 0.3 * Math.sin(t / 3700 + 1.3));
      let actif = false;
      if (p.t && maintenant - p.t < 2500) {
        const x = p.x - rect.left;
        const y = p.y - rect.top;
        if (x > -120 && x < l + 120 && y > -120 && y < h + 120) { cx = x; cy = y; actif = true; }
      }
      const lu = etat.lueur;
      const lisse = Math.min(1, 0.07 * k);
      lu.x += (cx - lu.x) * lisse;
      lu.y += (cy - lu.y) * lisse;

      ctx.clearRect(0, 0, l, h);
      ctx.globalCompositeOperation = 'lighter';

      // Lumières douces qui suivent le curseur (une chaude, une froide à l'opposé)
      const R = Math.max(l, h) * 0.55;
      ctx.drawImage(lumieres[0], lu.x - R, lu.y - R, R * 2, R * 2);
      const x2 = l - lu.x * 0.8;
      const y2 = h - lu.y * 0.8;
      ctx.drawImage(lumieres[1], x2 - R * 0.9, y2 - R * 0.9, R * 1.8, R * 1.8);

      // Particules
      const decalX = lu.x - l / 2;
      const decalY = lu.y - h / 2;
      const rayon = 170;
      const rayon2 = rayon * rayon;
      const { px: posX, py: posY } = etat;
      for (let i = 0; i < particules.length; i += 1) {
        const q = particules[i];
        const dx = q.x - cx;
        const dy = q.y - cy;
        const d2 = dx * dx + dy * dy;
        let proche = 0;
        if (d2 < rayon2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          proche = 1 - d / rayon;
          const f = proche * 0.6 * k * (actif ? 1 : 0.4);
          q.vx += (dx / d) * f;
          q.vy += (dy / d) * f;
        }
        q.vx += (q.bx - q.vx) * 0.02 * k;
        q.vy += (q.by - q.vy) * 0.02 * k;
        q.x += q.vx * k * (0.6 + q.z) * 2;
        q.y += q.vy * k * (0.6 + q.z) * 2;
        if (q.x < -20) q.x = l + 20; else if (q.x > l + 20) q.x = -20;
        if (q.y < -20) q.y = h + 20; else if (q.y > h + 20) q.y = -20;

        const ox = q.x - decalX * 0.07 * q.z;
        const oy = q.y - decalY * 0.07 * q.z;
        posX[i] = ox;
        posY[i] = oy;
        const scint = 0.55 + 0.45 * Math.sin(t / 900 + q.phase);
        ctx.globalAlpha = Math.min(1, pal.alpha * scint * (0.4 + 0.6 * q.z) * (1 + proche));
        const taille = (7 + 17 * q.z) * (1 + proche * 0.9);
        ctx.drawImage(sprites[q.s], ox - taille / 2, oy - taille / 2, taille, taille);
      }
      ctx.globalAlpha = 1;

      // Fils entre particules proches (constellation)
      if (liens && etat.qualite >= 0.75) {
        ctx.lineWidth = 0.7;
        const max = 118;
        for (let i = 0; i < particules.length; i += 1) {
          for (let j = i + 1; j < particules.length; j += 1) {
            const dx = posX[i] - posX[j];
            if (dx > max || dx < -max) continue;
            const dy = posY[i] - posY[j];
            const d2 = dx * dx + dy * dy;
            if (d2 < max * max) {
              ctx.strokeStyle = `rgba(${pal.lien}, ${(1 - Math.sqrt(d2) / max) * 0.2})`;
              ctx.beginPath();
              ctx.moveTo(posX[i], posY[i]);
              ctx.lineTo(posX[j], posY[j]);
              ctx.stroke();
            }
          }
        }
      }

      // Traits de lumière entre le curseur et les particules proches
      ctx.lineWidth = 0.9;
      for (let i = 0; i < particules.length; i += 1) {
        const dx = posX[i] - lu.x;
        const dy = posY[i] - lu.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 165 * 165) {
          ctx.strokeStyle = `rgba(${pal.curseur}, ${(1 - Math.sqrt(d2) / 165) * 0.5})`;
          ctx.beginPath();
          ctx.moveTo(lu.x, lu.y);
          ctx.lineTo(posX[i], posY[i]);
          ctx.stroke();
        }
      }

      // Ondes de choc
      ctx.lineWidth = 2;
      etat.ondes = etat.ondes.filter((o) => maintenant - o.t0 < 900);
      etat.ondes.forEach((o) => {
        const age = maintenant - o.t0;
        ctx.strokeStyle = `rgba(${pal.curseur}, ${(1 - age / 900) * 0.55})`;
        ctx.beginPath();
        ctx.arc(o.x, o.y, age * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.globalCompositeOperation = 'source-over';
    };

    const image = (t) => {
      etat.raf = requestAnimationFrame(image);
      const dt = Math.min(50, etat.dernier ? t - etat.dernier : 16);
      etat.dernier = t;
      etat.ema = etat.ema * 0.96 + dt * 0.04;
      etat.images += 1;
      // Appareil lent : on allège (moins de particules, pas de fils) au lieu de saccader
      if (etat.images % 90 === 0 && etat.ema > 28 && etat.qualite > 0.5) {
        etat.qualite -= 0.25;
        dimensionner();
      }
      dessiner(t, dt / 16.7);
    };

    const relancer = () => {
      cancelAnimationFrame(etat.raf);
      etat.dernier = 0;
      if (reduit) {
        dessiner(0, 1);
      } else if (etat.visible && !document.hidden) {
        etat.raf = requestAnimationFrame(image);
      }
    };

    const clic = (e) => {
      if (reduit) return;
      const x = e.clientX - etat.rect.left;
      const y = e.clientY - etat.rect.top;
      if (x < 0 || y < 0 || x > etat.l || y > etat.h) return;
      etat.ondes.push({ x, y, t0: performance.now() });
      etat.particules.forEach((q) => {
        const dx = q.x - x;
        const dy = q.y - y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < 300) {
          const f = (1 - d / 300) * 5;
          q.vx += (dx / d) * f;
          q.vy += (dy / d) * f;
        }
      });
    };

    dimensionner();
    relancer();

    const observateurTaille = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { dimensionner(); relancer(); }) : null;
    if (observateurTaille) observateurTaille.observe(canvas);
    const observateurVue = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entree]) => { etat.visible = entree.isIntersecting; relancer(); })
      : null;
    if (observateurVue) observateurVue.observe(canvas);
    const surVisibilite = () => relancer();
    document.addEventListener('visibilitychange', surVisibilite);
    window.addEventListener('scroll', majRect, { passive: true, capture: true });
    window.addEventListener('pointerdown', clic, { passive: true });

    return () => {
      cancelAnimationFrame(etat.raf);
      if (observateurTaille) observateurTaille.disconnect();
      if (observateurVue) observateurVue.disconnect();
      document.removeEventListener('visibilitychange', surVisibilite);
      window.removeEventListener('scroll', majRect, true);
      window.removeEventListener('pointerdown', clic);
    };
  }, [canvasRef, pointeur, palette, densite, liens, reduit]);
}

// Inclinaison 3D de la scène : suit le pointeur, et se balance toute seule au repos (téléphone compris).
function useInclinaison(ref, pointeur, reduit) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (reduit) {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      return undefined;
    }
    let raf = 0;
    let rx = 0;
    let ry = 0;
    const borne = (v) => Math.max(-1, Math.min(1, v));
    const boucle = (t) => {
      raf = requestAnimationFrame(boucle);
      const r = el.getBoundingClientRect();
      const p = pointeur.current;
      let nx = Math.sin(t / 2600) * 0.5;
      let ny = Math.cos(t / 3100) * 0.35;
      if (p.t && performance.now() - p.t < 2500) {
        nx = borne((p.x - (r.left + r.width / 2)) / Math.max(320, window.innerWidth * 0.4));
        ny = borne((p.y - (r.top + r.height / 2)) / Math.max(240, window.innerHeight * 0.45));
      }
      rx += (-ny * 15 - rx) * 0.08;
      ry += (nx * 22 - ry) * 0.08;
      el.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
      el.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
    };
    raf = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(raf);
  }, [ref, pointeur, reduit]);
}

// ---------------------------------------------------------------------------
// Styles (propres à cet écran). Les nouveaux éléments ont leurs propres classes « lp- » ; les
// animations des éléments existants passent par `translate` / `scale`, jamais par `transform`.
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
  .ecran-connexion-partage .panneau-marque,
  .ecran-connexion-partage .panneau-formulaire { isolation: isolate; }

  .ecran-connexion-partage .lp-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    pointer-events: none;
  }

  /* Entrée en cascade : un seul moment orchestré au chargement */
  .ecran-connexion-partage .lp-entree {
    animation: lp-entree 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) both;
    animation-delay: var(--d, 0s);
  }
  @keyframes lp-entree {
    from { opacity: 0; translate: 0 18px; }
    to { opacity: 1; translate: 0 0; }
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
    inset: -12px;
    border-radius: 50%;
    z-index: -1;
    background: radial-gradient(circle, rgba(242, 168, 29, 0.6), transparent 70%);
    animation: lp-pulse 3.4s ease-in-out infinite;
  }
  @keyframes lp-pulse {
    0%, 100% { opacity: 0.45; scale: 0.9; }
    50% { opacity: 1; scale: 1.18; }
  }

  /* Titre : reflet de lumière qui traverse le mot accentué */
  .ecran-connexion-partage .titre-marque-accent {
    background: linear-gradient(100deg, #f2a81d 30%, #fff1c9 48%, #f2a81d 66%);
    background-size: 260% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    animation: lp-brillance 5.5s ease-in-out infinite;
  }
  @keyframes lp-brillance {
    0% { background-position: 120% 0; }
    60%, 100% { background-position: -80% 0; }
  }

  /* Scène 3D : trois couches à des profondeurs différentes, inclinées par le pointeur */
  .ecran-connexion-partage .lp-scene {
    position: relative;
    z-index: 1;
    height: 236px;
    max-width: 540px;
    margin: 26px 0 10px;
    perspective: 1100px;
  }
  .ecran-connexion-partage .lp-plateau {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
    will-change: transform;
  }
  .ecran-connexion-partage .lp-couche {
    position: absolute;
    border-radius: 18px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05));
    box-shadow: 0 26px 50px rgba(2, 10, 30, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    animation: lp-flotte 6s ease-in-out infinite alternate;
  }
  @media (min-width: 900px) {
    .ecran-connexion-partage .lp-couche { backdrop-filter: blur(10px); }
  }
  .ecran-connexion-partage .lp-couche--fond {
    left: 0; top: 6%; width: 56%; height: 80%;
    padding: 18px 18px 14px;
    transform: translateZ(-70px);
  }
  .ecran-connexion-partage .lp-couche--milieu {
    left: 42%; top: 24%; width: 52%; height: 58%;
    padding: 16px 18px;
    background: linear-gradient(145deg, rgba(15, 39, 71, 0.92), rgba(23, 76, 156, 0.7));
    text-shadow: 0 1px 8px rgba(2, 10, 30, 0.6);
    display: flex; flex-direction: column; justify-content: center; gap: 2px;
    transform: translateZ(20px);
    animation-duration: 7s; animation-delay: -2s;
  }
  .ecran-connexion-partage .lp-couche--avant {
    left: 6%; bottom: 2%;
    display: flex; align-items: center; gap: 10px;
    padding: 11px 16px;
    border-radius: 999px;
    transform: translateZ(95px);
    animation-duration: 5s; animation-delay: -1s;
  }
  .ecran-connexion-partage .lp-anneau {
    position: absolute;
    right: 4%; top: 2%;
    width: 78px; height: 78px;
    border-radius: 50%;
    border: 2px solid rgba(242, 168, 29, 0.7);
    box-shadow: 0 0 26px rgba(242, 168, 29, 0.45), inset 0 0 18px rgba(242, 168, 29, 0.25);
    transform: translateZ(130px);
    animation: lp-flotte 4.5s ease-in-out infinite alternate, lp-tourne 14s linear infinite;
  }
  .ecran-connexion-partage .lp-anneau::after {
    content: '';
    position: absolute;
    inset: 9px;
    border-radius: 50%;
    border: 1px dashed rgba(255, 255, 255, 0.45);
  }
  @keyframes lp-flotte { from { translate: 0 0; } to { translate: 0 -11px; } }
  @keyframes lp-tourne { to { rotate: 360deg; } }

  .ecran-connexion-partage .lp-barres {
    display: flex;
    align-items: flex-end;
    gap: 7px;
    height: 100%;
  }
  .ecran-connexion-partage .lp-barres i {
    flex: 1;
    height: calc(var(--h) * 1%);
    border-radius: 6px 6px 3px 3px;
    background: linear-gradient(180deg, #f2a81d, #1f5fbf);
    transform-origin: bottom;
    animation: lp-barre 0.75s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    animation-delay: calc(var(--k) * 60ms);
  }
  @keyframes lp-barre { from { transform: scaleY(0); opacity: 0; } to { transform: scaleY(1); opacity: 1; } }

  .ecran-connexion-partage .lp-apercu {
    font-size: 10.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    opacity: 0.55;
  }
  .ecran-connexion-partage .lp-kpi {
    font-size: 34px;
    font-weight: 800;
    line-height: 1.05;
    animation: lp-detail 0.55s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .ecran-connexion-partage .lp-kpi-lib {
    font-size: 12.5px;
    opacity: 0.75;
    animation: lp-detail 0.55s cubic-bezier(0.2, 0.7, 0.2, 1) 0.08s both;
  }
  .ecran-connexion-partage .lp-puce-icone {
    display: inline-flex;
    width: 30px; height: 30px;
    align-items: center; justify-content: center;
    border-radius: 50%;
    color: var(--soleil);
    background: rgba(242, 168, 29, 0.2);
  }
  .ecran-connexion-partage .lp-puce-texte {
    font-size: 13px;
    font-weight: 600;
    animation: lp-detail 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) 0.15s both;
  }
  @keyframes lp-detail {
    from { opacity: 0; translate: 0 9px; }
    to { opacity: 1; translate: 0 0; }
  }

  /* Choix du secteur : pastilles qui s'étendent pour dire leur nom */
  .ecran-connexion-partage .lp-secteurs {
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    margin-top: 14px;
  }
  .ecran-connexion-partage .lp-chip {
    appearance: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    gap: 0;
    height: 44px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.06);
    transition: gap 0.35s ease, background 0.25s ease, border-color 0.25s ease, translate 0.25s ease;
  }
  .ecran-connexion-partage .lp-chip:hover { translate: 0 -2px; border-color: rgba(242, 168, 29, 0.5); }
  .ecran-connexion-partage .lp-chip:focus-visible { outline: 2px solid var(--soleil); outline-offset: 2px; }
  .ecran-connexion-partage .lp-chip--actif {
    gap: 8px;
    background: rgba(242, 168, 29, 0.16);
    border-color: rgba(242, 168, 29, 0.65);
  }
  .ecran-connexion-partage .lp-chip-icone { display: inline-flex; color: var(--soleil); }
  .ecran-connexion-partage .lp-chip-nom {
    max-width: 0;
    opacity: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: 13.5px;
    font-weight: 700;
    transition: max-width 0.4s ease, opacity 0.3s ease;
  }
  .ecran-connexion-partage .lp-chip--actif .lp-chip-nom { max-width: 150px; opacity: 1; }
  .ecran-connexion-partage .lp-progression {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 2px;
    background: var(--soleil);
    transform-origin: left center;
    animation: lp-progression ${DUREE_SECTEUR_MS}ms linear forwards;
  }
  @keyframes lp-progression { from { transform: scaleX(0); } to { transform: scaleX(1); } }

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
  .ecran-connexion-partage .lp-erreur { animation: lp-detail 0.35s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
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
  .ecran-connexion-partage .btn-connexion [aria-hidden='true'] { display: inline-block; transition: translate 0.25s ease; }
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

  @media (max-width: 640px) {
    .ecran-connexion-partage .lp-scene { height: 210px; }
    .ecran-connexion-partage .lp-kpi { font-size: 28px; }
    .ecran-connexion-partage .lp-couche--milieu { left: 38%; width: 60%; }
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
  const pointeur = usePointeur();

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

  const canvasMarque = useRef(null);
  const canvasFormulaire = useRef(null);
  const scene = useRef(null);
  const minuteurs = useRef([]);

  const salut = useMemo(salutation, []);
  const emailValide = EMAIL_RE.test(email.trim());
  const secteur = SECTEURS[secteurActif];

  useChampLumineux(canvasMarque, pointeur, { palette: 'sombre', densite: 1, liens: true, reduit });
  useChampLumineux(canvasFormulaire, pointeur, { palette: 'clair', densite: 0.8, liens: false, reduit });
  useInclinaison(scene, pointeur, reduit);

  function programmer(fn, delai) {
    const id = setTimeout(fn, delai);
    minuteurs.current.push(id);
    return id;
  }

  useEffect(() => () => { minuteurs.current.forEach(clearTimeout); }, []);

  // Les secteurs défilent tout seuls (en pause au survol et au clavier)
  useEffect(() => {
    if (reduit || pauseSecteurs) return undefined;
    const id = setTimeout(() => setSecteurActif((i) => (i + 1) % SECTEURS.length), DUREE_SECTEUR_MS);
    return () => clearTimeout(id);
  }, [secteurActif, pauseSecteurs, reduit]);

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

  return (
    <div className="ecran-connexion-partage">
      <style>{STYLES}</style>
      <div className="panneau-marque">
        <div className="fond-motif" aria-hidden="true" />
        <div className="fond-halo" aria-hidden="true" />
        <canvas ref={canvasMarque} className="lp-canvas" aria-hidden="true" />

        <div className="marque-entete lp-entree" style={{ '--d': '0s' }}>
          <span className="lp-logo-halo">
            <img className="logo-badge" src="/amaterasu-emblem.svg" alt="" width="40" height="40" />
          </span>
          <span className="nom-marque">Amaterasu</span>
        </div>

        <h1 className="titre-marque lp-entree" style={{ '--d': '0.12s', marginTop: 30 }}>
          La gestion<br />
          <span className="titre-marque-accent">qui s'éclaire.</span>
        </h1>
        <p className="tagline-marque lp-entree" style={{ '--d': '0.2s' }}>
          Stock, ventes, clients : tout au même endroit.
        </p>

        <div
          className="lp-entree"
          style={{ '--d': '0.3s' }}
          onMouseEnter={() => setPauseSecteurs(true)}
          onMouseLeave={() => setPauseSecteurs(false)}
          onFocus={() => setPauseSecteurs(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setPauseSecteurs(false);
          }}
        >
          <div className="lp-scene" ref={scene} aria-hidden="true">
            <div className="lp-plateau">
              <div className="lp-couche lp-couche--fond">
                <div className="lp-barres" key={`barres-${secteur.nom}`}>
                  {secteur.barres.map((h, k) => <i key={k} style={{ '--h': h, '--k': k }} />)}
                </div>
              </div>
              <div className="lp-couche lp-couche--milieu">
                <span className="lp-apercu">Aperçu</span>
                <span className="lp-kpi" key={`kpi-${secteur.nom}`}>{secteur.kpi}</span>
                <span className="lp-kpi-lib" key={`lib-${secteur.nom}`}>{secteur.kpiLibelle}</span>
              </div>
              <div className="lp-couche lp-couche--avant">
                <span className="lp-puce-icone"><secteur.Icone /></span>
                <span className="lp-puce-texte" key={`puce-${secteur.nom}`}>{secteur.puce}</span>
              </div>
              <div className="lp-anneau" />
            </div>
          </div>

          <div className="lp-secteurs" role="group" aria-label="Aperçu par secteur">
            {SECTEURS.map(({ nom, Icone }, i) => (
              <button
                key={nom}
                type="button"
                className={'lp-chip' + (i === secteurActif ? ' lp-chip--actif' : '')}
                aria-label={nom}
                aria-pressed={i === secteurActif}
                onClick={() => setSecteurActif(i)}
              >
                <span className="lp-chip-icone"><Icone /></span>
                <span className="lp-chip-nom">{nom}</span>
                {i === secteurActif && !pauseSecteurs && !reduit && (
                  <span key={`progression-${secteurActif}`} className="lp-progression" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panneau-formulaire">
        <div className="fond-motif fond-motif--clair" aria-hidden="true" />
        <div className="fond-halo fond-halo--clair" aria-hidden="true" />
        <canvas ref={canvasFormulaire} className="lp-canvas" aria-hidden="true" />

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
