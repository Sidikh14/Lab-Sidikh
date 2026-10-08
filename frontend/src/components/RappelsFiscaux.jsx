import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

// Rappels des déclarations fiscales à déposer (TVA, retenues sur salaires, BRS), calculés par le serveur
// à partir des échéances et des dépôts déjà enregistrés. N'affiche rien s'il n'y a rien à signaler ou si
// le module comptabilité n'est pas activé.
// `lien` : page ouverte au clic (la page Fiscalité) ; sans lien, le rappel est purement informatif.

const COULEURS = {
  retard: { fond: 'var(--danger-clair, #fef2f2)', bord: 'var(--danger, #b91c1c)', texte: 'En retard' },
  urgent: { fond: '#fff7ed', bord: '#c2410c', texte: 'Urgent' },
  proche: { fond: '#fefce8', bord: '#a16207', texte: 'À venir' },
};

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
      <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Rappels fiscaux</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {alertes.map((a) => {
          const c = COULEURS[a.statut] || COULEURS.proche;
          return (
            <div
              key={a.id}
              role={lien ? 'button' : undefined}
              tabIndex={lien ? 0 : undefined}
              onClick={lien ? () => navigate(lien) : undefined}
              onKeyDown={lien ? (e) => { if (e.key === 'Enter') navigate(lien); } : undefined}
              style={{ background: c.fond, borderLeft: `4px solid ${c.bord}`, borderRadius: 8, padding: '10px 14px', cursor: lien ? 'pointer' : 'default', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
            >
              <span style={{ fontSize: 13.5 }}>
                <strong>{a.label}</strong> — {a.periode}
                <span style={{ display: 'block', fontSize: 12.5, opacity: 0.8 }}>À déposer avant le {dateFr(a.limite)} ({delai(a)})</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: c.bord, alignSelf: 'center' }}>{c.texte}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
