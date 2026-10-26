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
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

const dateFr = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');

function delaiCourt(a) {
  if (a.joursRestants < 0) return `${-a.joursRestants} j`;
  if (a.joursRestants === 0) return "aujourd'hui";
  return `dans ${a.joursRestants} j`;
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
      <h2 style={{ fontSize: 12.5, margin: '0 0 5px' }}>Rappels fiscaux</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                borderRadius: 8, cursor: lien ? 'pointer' : 'default',
                border: `1px solid color-mix(in srgb, ${c.bord} 25%, transparent)`,
                borderLeft: `3px solid ${c.bord}`,
                background: `color-mix(in srgb, ${c.bord} 6%, var(--surface, var(--carte, #fff)))`,
                color: 'var(--encre, inherit)',
              }}
            >
              <span
                style={{
                  flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, borderRadius: 6,
                  background: `color-mix(in srgb, ${c.bord} 16%, transparent)`, color: c.bord,
                }}
              >
                <IconeEcheance />
              </span>
              <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 11.5, lineHeight: 1.3 }}>
                <strong>{a.label}</strong>
                <span style={{ marginLeft: 6, opacity: 0.7 }}>{a.periode} · avant le {dateFr(a.limite)}</span>
              </span>
              <span
                style={{
                  flex: '0 0 auto', whiteSpace: 'nowrap', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                  color: c.bord, background: `color-mix(in srgb, ${c.bord} 14%, transparent)`,
                }}
              >
                {c.texte} · {delaiCourt(a)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
