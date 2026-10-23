// Composants partagés du thème SAGFA360 (en-tête de page, bandeau marine à étapes, cartes de chiffres,
// champs modernes). Le style vit dans app.css (classes « sg-… »).

export function IconeFeuille({ ton = 'feuille' }) {
  const couleurs = { feuille: '#2f6b5c', or: '#c7a45f', marine: '#12343b' };
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 14C2 7 6 2.5 14 2c0 7-3.5 11.5-10 11.5-.7 0-1.3 0-2 .5z" fill={couleurs[ton] || couleurs.feuille} />
    </svg>
  );
}

const trace = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
export const Icones = {
  calendrier: <svg viewBox="0 0 24 24" {...trace}><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" /></svg>,
  utilisateur: <svg viewBox="0 0 24 24" {...trace}><circle cx="12" cy="8" r="3.8" /><path d="M4.5 20c.6-3.8 3.7-6 7.5-6s6.9 2.2 7.5 6" /></svg>,
  calculette: <svg viewBox="0 0 24 24" {...trace}><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M8.5 7.5h7M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" /></svg>,
  imprimante: <svg viewBox="0 0 24 24" {...trace}><path d="M7 9V4h10v5M7 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2" /><rect x="7" y="14" width="10" height="6" rx="1" /></svg>,
  reglages: <svg viewBox="0 0 24 24" {...trace}><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></svg>,
  coche: <svg viewBox="0 0 24 24" {...trace}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.8 2.8L16 9.5" /></svg>,
};

// Fil d'Ariane + titre + actions à droite (« AMATERASU | FINANCE | 04. PAIE »).
export function EntetePage({ rubrique = 'Finance', numero, titre, children }) {
  return (
    <div className="sg-entete">
      <div>
        <div className="sg-fil">
          <span><strong>AMATERASU</strong></span>
          <span>{rubrique}</span>
          {numero && <span>{numero}</span>}
        </div>
        <h1>{titre}</h1>
      </div>
      {children && <div className="sg-actions">{children}</div>}
    </div>
  );
}

// Champ de sélection de mois / de liste, avec icône : remplace les <input type="month"> et <select> nus.
export function ChampMois({ value, onChange, ...reste }) {
  return (
    <span className="sg-champ">
      {Icones.calendrier}
      <input type="month" value={value} onChange={(e) => onChange(e.target.value)} {...reste} />
    </span>
  );
}

export function ChampListe({ value, onChange, icone = Icones.utilisateur, children, ...reste }) {
  return (
    <span className="sg-champ">
      {icone}
      <select value={value} onChange={(e) => onChange(e.target.value)} {...reste}>{children}</select>
    </span>
  );
}

export function Etiquette({ children }) {
  return <span className="sg-etiquette">{children}</span>;
}

// Bandeau marine : surtitre, titre, étapes numérotées (cliquables) et action à droite.
// etapes : [{ id, label, statut: 'fait' | 'actif' | 'a_faire', compte?: number, cliquable?: bool }]
export function BandeauMarine({ surtitre, titre, detail, etapes = [], onEtape, action }) {
  return (
    <div className="sg-bandeau">
      <p className="sg-surtitre">{surtitre}</p>
      <h2>{titre}{detail && <small>{detail}</small>}</h2>
      <div className="sg-bandeau-bas">
        <div className="sg-etapes">
          {etapes.map((e, i) => (
            <span key={e.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button
                type="button"
                className={`sg-etape ${e.statut === 'actif' ? 'actif' : e.statut === 'fait' ? 'fait' : ''}`}
                disabled={!onEtape || e.cliquable === false}
                onClick={() => onEtape && onEtape(e.id)}
              >
                <span className="sg-pastille">{i + 1}</span>
                {e.label}{e.compte !== undefined && ` · ${e.compte}`}
              </button>
              {i < etapes.length - 1 && <span className="sg-trait" style={{ width: 28 }} />}
            </span>
          ))}
        </div>
        {action && <div className="sg-bandeau-action">{action}</div>}
      </div>
    </div>
  );
}

// Rangée de chiffres dans une seule carte (séparateurs verticaux). cartes : [{ label, valeur, unite?, ton? }]
export function RangeeChiffres({ cartes }) {
  return (
    <div className="sg-chiffres">
      {cartes.map((c) => (
        <div key={c.label} className="sg-chiffre">
          <div className="sg-chiffre-label"><IconeFeuille ton={c.ton} />{c.label}</div>
          <p className="sg-chiffre-valeur">{c.valeur}{c.unite && <small>{c.unite}</small>}</p>
        </div>
      ))}
    </div>
  );
}
