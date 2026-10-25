import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

// Rappels des déclarations fiscales à déposer (TVA, retenues sur salaires, BRS), calculés par le serveur
// à partir des échéances et des dépôts déjà enregistrés. N'affiche rien s'il n'y a rien à signaler ou si
// le module comptabilité n'est pas activé.
// `lien` : page ouverte au clic (la page Fiscalité) ; sans lien, le rappel est purement informatif.

const COULEURS = {
  retard: { bord: 'var(--danger, #b91c1c)', texte: 'En retard' },
  urgent: { bord: '#c2410c', texte: 'Urgent' },
  proche: { bord: '#a16207', texte: 'À venir' },
};

// Petite icône calendrier : toujours posée AU-DESSUS du texte, dans une pastille de la couleur du statut.
function IconeEcheance() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

const dateFr = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');

function delai(a) {
  if (a.joursRestants < 0) return `échéance dépassée de ${-a.joursRestants} jour${-a.joursRestants > 1 ? 's' : ''}`;
  if (a.joursRestants === 0) return "échéance aujourd'hui";
  return `dans ${a.joursRestants} jour${a.joursRestants > 1 ? 's' : ''}`;
}

export function RappelsFiscaux({ lien }) {
  const navigate = useNavigate();
  const [alertes, setAlertes] = useState([]);

  useEffect(() => {
    let actif = true;
    api.getFiscalAlerts()
      .then((d) => { if (actif) setAlertes(d?.enabled ? d.alertes || [] : []); })
      .catch(() => { if (actif) setAlertes([]); });
    return () => { actif = false; };
  }, []);

  if (alertes.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>Rappels fiscaux</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {alertes.map((a) => {
          const c = COULEURS[a.statut] || COULEURS.proche;
          return (
            <div
              key={a.id}
              role={lien ? 'button' : undefined}
              tabIndex={lien ? 0 : undefined}
              onClick={lien ? () => navigate(lien) : undefined}
              onKeyDown={lien ? (e) => { if (e.key === 'Enter') navigate(lien); } : undefined}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: '14px 16px',
                borderRadius: 14, cursor: lien ? 'pointer' : 'default',
                border: `1px solid color-mix(in srgb, ${c.bord} 30%, transparent)`,
                borderTop: `3px solid ${c.bord}`,
                background: `color-mix(in srgb, ${c.bord} 8%, var(--surface, var(--carte, #fff)))`,
                color: 'var(--encre, inherit)',
              }}
            >
              <span
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 10,
                  background: `color-mix(in srgb, ${c.bord} 16%, transparent)`, color: c.bord,
                }}
              >
                <IconeEcheance />
              </span>
              <span style={{ fontSize: 14, lineHeight: 1.35 }}>
                <strong>{a.label}</strong>
                <span style={{ display: 'block', fontSize: 12.5, opacity: 0.75 }}>{a.periode}</span>
              </span>
              <span style={{ fontSize: 12.5, opacity: 0.85 }}>À déposer avant le {dateFr(a.limite)} ({delai(a)})</span>
              <span
                style={{
                  marginTop: 'auto', padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                  color: c.bord, background: `color-mix(in srgb, ${c.bord} 14%, transparent)`,
                }}
              >
                {c.texte}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
