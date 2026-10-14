import { useEffect, useMemo, useRef, useState } from 'react';

// Sélecteur de boutique moderne (manager) : pastille cliquable + liste déroulante.
// Remplace l'ancien <select> natif des pages Caisse, Pilotage, Ventes et Stock.
//
// Props :
//   warehouses : liste des boutiques ({ id, name, is_active })
//   value      : id de la boutique active
//   onChange   : (id) => void
//   libelle    : mot affiché ("Boutique", "Pharmacie"…), "Boutique" par défaut

const CSS = `
.sb{position:relative;display:inline-block}
.sb-bouton{display:inline-flex;align-items:center;gap:10px;padding:6px 12px 6px 7px;min-height:40px;max-width:100%;
  border:1.5px solid var(--trait,#e5e7eb);border-radius:14px;background:var(--surface,#fff);color:inherit;font:inherit;cursor:pointer;
  transition:border-color .12s ease,box-shadow .12s ease}
.sb-bouton:hover{border-color:var(--accent,#6d4cff)}
.sb-bouton:focus-visible{outline:3px solid var(--accent,#6d4cff);outline-offset:2px}
.sb.ouvert .sb-bouton{border-color:var(--accent,#6d4cff);box-shadow:0 0 0 3px var(--accent-transparent,rgba(109,76,255,.16))}
.sb-pastille{width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;
  background:var(--accent-transparent,rgba(109,76,255,.14));color:var(--accent,#6d4cff)}
.sb-texte{display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;min-width:0;text-align:left}
.sb-etiquette{font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--encre-douce,#6b7280)}
.sb-nom{font-size:14px;font-weight:700;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-fleche{flex-shrink:0;color:var(--encre-douce,#6b7280);transition:transform .15s ease}
.sb.ouvert .sb-fleche{transform:rotate(180deg)}
.sb-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:60;min-width:240px;max-width:min(320px,86vw);
  padding:6px;border:1px solid var(--trait,#e5e7eb);border-radius:14px;background:var(--surface,#fff);
  box-shadow:0 18px 40px -12px rgba(15,35,70,.28);animation:sb-entree .12s ease-out}
@keyframes sb-entree{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.sb-recherche{width:100%;box-sizing:border-box;margin:2px 0 6px;padding:8px 10px;border:1.5px solid var(--trait,#e5e7eb);border-radius:9px;
  font:inherit;font-size:13px;background:transparent;color:inherit}
.sb-recherche:focus{outline:none;border-color:var(--accent,#6d4cff)}
.sb-liste{list-style:none;margin:0;padding:0;max-height:280px;overflow-y:auto}
.sb-option{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600}
.sb-option:hover,.sb-option:focus-visible{background:var(--accent-transparent,rgba(109,76,255,.1));outline:none}
.sb-option.actif{color:var(--accent,#6d4cff)}
.sb-initiale{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;font-weight:700;
  background:rgba(128,128,128,.14)}
.sb-option.actif .sb-initiale{background:var(--accent,#6d4cff);color:#fff}
.sb-option-nom{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-vide{padding:10px;font-size:13px;color:var(--encre-douce,#6b7280)}
@media (max-width:480px){.sb-nom{max-width:130px}.sb-menu{right:auto;left:0}}
`;

export function SelecteurBoutique({ warehouses = [], value, onChange, libelle = 'Boutique' }) {
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState('');
  const racine = useRef(null);
  const liste = useRef(null);

  const actives = useMemo(() => warehouses.filter((w) => w.is_active), [warehouses]);
  const active = actives.find((w) => w.id === value);
  const affichees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return q ? actives.filter((w) => (w.name || '').toLowerCase().includes(q)) : actives;
  }, [actives, recherche]);

  useEffect(() => {
    if (!ouvert) return undefined;
    const clicDehors = (e) => { if (racine.current && !racine.current.contains(e.target)) setOuvert(false); };
    const echap = (e) => { if (e.key === 'Escape') setOuvert(false); };
    document.addEventListener('mousedown', clicDehors);
    document.addEventListener('touchstart', clicDehors);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', clicDehors);
      document.removeEventListener('touchstart', clicDehors);
      document.removeEventListener('keydown', echap);
    };
  }, [ouvert]);

  useEffect(() => { if (!ouvert) setRecherche(''); }, [ouvert]);

  function choisir(id) {
    setOuvert(false);
    if (id !== value) onChange(id);
  }

  function touche(e, id) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choisir(id); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.nextElementSibling?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.currentTarget.previousElementSibling?.focus(); }
  }

  if (actives.length === 0) return null;

  return (
    <div ref={racine} className={`sb${ouvert ? ' ouvert' : ''}`}>
      <style>{CSS}</style>
      <button type="button" className="sb-bouton" aria-haspopup="listbox" aria-expanded={ouvert} onClick={() => setOuvert((v) => !v)}>
        <span className="sb-pastille" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l1.5-5h15L21 9" />
            <path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
            <path d="M9 20v-6h6v6" />
          </svg>
        </span>
        <span className="sb-texte">
          <span className="sb-etiquette">{libelle}</span>
          <span className="sb-nom">{active ? active.name : `Choisir…`}</span>
        </span>
        <svg className="sb-fleche" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {ouvert && (
        <div className="sb-menu">
          {actives.length > 6 && (
            <input className="sb-recherche" type="search" placeholder="Rechercher…" value={recherche} onChange={(e) => setRecherche(e.target.value)} autoFocus />
          )}
          <ul ref={liste} className="sb-liste" role="listbox" aria-label={libelle}>
            {affichees.map((w) => (
              <li
                key={w.id}
                role="option"
                aria-selected={w.id === value}
                tabIndex={0}
                className={`sb-option${w.id === value ? ' actif' : ''}`}
                onClick={() => choisir(w.id)}
                onKeyDown={(e) => touche(e, w.id)}
              >
                <span className="sb-initiale" aria-hidden="true">{(w.name || '?').trim().charAt(0).toUpperCase()}</span>
                <span className="sb-option-nom">{w.name}</span>
                {w.id === value && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </li>
            ))}
            {affichees.length === 0 && <li className="sb-vide">Aucun résultat</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
