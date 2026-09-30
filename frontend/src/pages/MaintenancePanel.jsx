import { useEffect, useState } from 'react';
import { api } from '../api/client';

const LIBELLES = {
  grossiste: 'Grossiste',
  pharmacie: 'Pharmacie',
  electromenager: 'Électroménager',
  textile: 'Textile',
};

function versChampLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Section owner : met un ou plusieurs secteurs en maintenance. Les
// utilisateurs de ces secteurs sont bloqués (connexion refusée, requêtes
// en cours coupées) et voient la page maintenance.html ; l'owner n'est
// jamais concerné.
export function MaintenancePanel() {
  const [ouvert, setOuvert] = useState(false);
  const [lignes, setLignes] = useState([]);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(null);

  async function charger() {
    try {
      const data = await api.getMaintenance();
      setLignes(
        data.map((l) => ({
          sector: l.sector,
          isEnabled: l.is_enabled,
          message: l.message || '',
          returnAt: versChampLocal(l.return_at),
        }))
      );
    } catch (err) {
      setErreur(err.message);
    }
  }

  useEffect(() => {
    charger();
  }, []);

  function modifier(sector, champ, valeur) {
    setLignes((ls) => ls.map((l) => (l.sector === sector ? { ...l, [champ]: valeur } : l)));
  }

  async function enregistrer(ligne, isEnabled) {
    if (isEnabled && !ligne.isEnabled && !window.confirm(
      `Bloquer tous les utilisateurs du secteur « ${LIBELLES[ligne.sector]} » maintenant ?`
    )) return;

    setEnCours(ligne.sector);
    setErreur('');
    try {
      await api.setMaintenance(ligne.sector, {
        isEnabled,
        message: ligne.message.trim() || null,
        returnAt: ligne.returnAt ? new Date(ligne.returnAt).toISOString() : null,
      });
      await charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(null);
    }
  }

  const nbActifs = lignes.filter((l) => l.isEnabled).length;

  return (
    <div className="carte-entite" style={{ marginBottom: 20, padding: 16 }}>
      <button
        type="button"
        className="btn"
        onClick={() => setOuvert((o) => !o)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between' }}
      >
        <span>Maintenance par secteur</span>
        <span>{nbActifs > 0 ? `${nbActifs} secteur(s) bloqué(s)` : 'Aucun blocage'}</span>
      </button>

      {ouvert && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {erreur && <div className="erreur">{erreur}</div>}
          {lignes.map((l) => (
            <div key={l.sector} style={{ borderTop: '1px solid var(--bordure, #ddd)', paddingTop: 12 }}>
              <strong>{LIBELLES[l.sector] || l.sector}</strong>
              {l.isEnabled && <span style={{ marginLeft: 8, color: '#b42318', fontSize: 13 }}>● en maintenance</span>}
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <input
                  className="champ"
                  type="text"
                  maxLength={300}
                  placeholder="Message affiché aux utilisateurs (facultatif)"
                  value={l.message}
                  onChange={(e) => modifier(l.sector, 'message', e.target.value)}
                />
                <input
                  className="champ"
                  type="datetime-local"
                  title="Heure de retour estimée"
                  value={l.returnAt}
                  onChange={(e) => modifier(l.sector, 'returnAt', e.target.value)}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {l.isEnabled ? (
                    <>
                      <button type="button" className="btn" disabled={enCours === l.sector} onClick={() => enregistrer(l, false)}>
                        Lever la maintenance
                      </button>
                      <button type="button" className="btn" disabled={enCours === l.sector} onClick={() => enregistrer(l, true)}>
                        Mettre à jour le message
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn" disabled={enCours === l.sector} onClick={() => enregistrer(l, true)}>
                      Activer la maintenance
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
