// Éléments d'interface communs aux pages Comptabilité et Fiscalité : barre de sections avec icônes
// (mêmes classes « onglets / onglet » que les pages Produits, Ventes…), cartes de chiffres clés
// et petites barres de comparaison pour la vue d'ensemble.

const TRACES = {
  vue: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5" rx="1.5" /><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /></>,
  journal: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" /><path d="M5 17a3 3 0 0 1 3-3h11" /><path d="M9 8h6M9 11h4" /></>,
  immobilisations: <><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 21v-4h6v4M8 7h2M14 7h2M8 11h2M14 11h2" /></>,
  financement: <><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" /></>,
  regularisations: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  rapprochement: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></>,
  balanceagee: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  cloture: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  plan: <><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
  grandlivre: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v17H6.5A2.5 2.5 0 0 0 4 22.5v-17z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v17h5.5a2.5 2.5 0 0 1 2.5 2.5v-17z" /></>,
  balance: <><path d="M12 4v16M6 20h12" /><path d="M5 8h14" /><path d="M5 8l-2.5 6a3 3 0 0 0 5 0L5 8zM19 8l-2.5 6a3 3 0 0 0 5 0L19 8z" /></>,
  resultat: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  bilan: <><path d="M12 3a9 9 0 1 0 9 9h-9V3z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5z" /></>,
  flux: <><path d="M4 8h13" /><path d="M13 4l4 4-4 4" /><path d="M20 16H7" /><path d="M11 12l-4 4 4 4" /></>,
  controles: <><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  ouverture: <><path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" /></>,
  declarations: <><path d="M6 3h9l4 4v14H6V3z" /><path d="M15 3v4h4" /><path d="M9 12h6M9 16h6" /></>,
  impots: <><circle cx="9" cy="9" r="5.5" /><path d="M14.5 10.5A5.5 5.5 0 1 1 10.5 14.5" /></>,
  profil: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M15 10h3M15 13h3" /></>,
};

export function Icone({ nom, taille = 16 }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {TRACES[nom] || TRACES.vue}
    </svg>
  );
}

// Même structure que les pages Produits / Ventes : conteneur « onglets », boutons « onglet » (+ « actif »).
export function BarreSections({ sections, actif, onChoisir }) {
  return (
    <div className="onglets" style={{ flexWrap: 'wrap', rowGap: 6 }}>
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          className={s.id === actif ? 'onglet actif' : 'onglet'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
          onClick={() => onChoisir(s.id)}
        >
          <Icone nom={s.id} />
          {s.label}
        </button>
      ))}
    </div>
  );
}

const BORDURE = '1px solid rgba(128,128,128,0.22)';

// Grille de cartes de chiffres clés. ton : 'bon' | 'alerte' | undefined.
export function GrilleKpi({ cartes }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, margin: '0 0 22px' }}>
      {cartes.map((c) => (
        <div key={c.label} style={{ border: BORDURE, borderRadius: 10, padding: '14px 16px', minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--encre-douce)', letterSpacing: '0.02em' }}>{c.label}</p>
          <p style={{ margin: '6px 0 2px', fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: c.ton === 'alerte' ? 'var(--brique, #b3402a)' : 'inherit' }}>
            {c.valeur}{c.unite ? <small style={{ fontSize: 12, fontWeight: 400, marginLeft: 4, color: 'var(--encre-douce)' }}>{c.unite}</small> : null}
          </p>
          {c.detail && <p style={{ margin: 0, fontSize: 12, color: 'var(--encre-douce)' }}>{c.detail}</p>}
        </div>
      ))}
    </div>
  );
}

// Barres horizontales de comparaison : lignes = [{ label, valeur, texte }].
export function BarresComparaison({ titre, lignes }) {
  const max = Math.max(1, ...lignes.map((l) => Math.abs(l.valeur)));
  return (
    <div style={{ border: BORDURE, borderRadius: 10, padding: '14px 16px', marginBottom: 22 }}>
      {titre && <h3 style={{ fontSize: 14, margin: '0 0 12px' }}>{titre}</h3>}
      {lignes.map((l) => (
        <div key={l.label} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ color: 'var(--encre-douce)' }}>{l.label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{l.texte}</span>
          </div>
          <div style={{ height: 7, borderRadius: 4, background: 'rgba(128,128,128,0.15)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(2, (Math.abs(l.valeur) / max) * 100)}%`, height: '100%', borderRadius: 4, background: l.valeur < 0 ? 'var(--brique, #b3402a)' : 'var(--accent, #1F3A5F)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
