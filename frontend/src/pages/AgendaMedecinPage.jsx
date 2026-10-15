import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { apiClinique } from '../../api/clinique';

const LIBELLE_STATUT = {
  planifie: 'Planifié', arrive: 'Arrivé', en_consultation: 'En consultation',
  termine: 'Terminé', annule: 'Annulé', absent: 'Absent',
};

function enTexteDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${j}`;
}

function heure(date) {
  return new Date(date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function AgendaMedecinPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [jour, setJour] = useState(() => enTexteDate(new Date()));
  const [rdv, setRdv] = useState([]);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [enCours, setEnCours] = useState(null);

  const charger = useCallback(() => {
    if (!user?.id) return;
    apiClinique.getAgendaPraticien(jour, user.id)
      .then(setRdv)
      .catch((err) => setErreur(err.message));
  }, [jour, user?.id]);

  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(t);
  }, [message]);

  // Ouvre la consultation liée au rendez-vous : un brouillon est créé, puis le dossier s'ouvre dessus.
  async function ouvrirConsultation(r) {
    setEnCours(r.id);
    setErreur('');
    try {
      const c = await apiClinique.ouvrirConsultation(r.client_id, { motif: r.motif || undefined, appointmentId: r.id });
      navigate(`/clinique/dossiers/${r.client_id}?onglet=consultations&consultation=${c.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnCours(null);
    }
  }

  async function cloturer(r) {
    try {
      await apiClinique.changerStatutRdv(r.id, 'termine');
      setMessage(`Rendez-vous de ${r.client_name} clôturé.`);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <div className="page-clinique">
      <h1>Mon agenda</h1>
      <div className="champ-groupe" style={{ maxWidth: 220 }}>
        <label className="etiquette" htmlFor="jour-agenda">Jour</label>
        <input id="jour-agenda" type="date" className="champ" value={jour} onChange={(e) => setJour(e.target.value)} />
      </div>
      {erreur && <div className="erreur">{erreur}</div>}
      {message && <div className="succes">{message}</div>}

      {rdv.length === 0 && <p className="souligne">Aucun rendez-vous ce jour.</p>}
      <table className="tableau">
        <thead><tr><th>Heure</th><th>Patient</th><th>Motif</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          {rdv.map((r) => (
            <tr key={r.id}>
              <td>{heure(r.starts_at)}</td>
              <td>{r.client_name}</td>
              <td>{r.motif || '—'}</td>
              <td>{LIBELLE_STATUT[r.status] || r.status}</td>
              <td className="actions">
                {(r.status === 'planifie' || r.status === 'arrive') && (
                  <button type="button" className="btn btn-principal" disabled={enCours === r.id} onClick={() => ouvrirConsultation(r)}>
                    {enCours === r.id ? 'Ouverture…' : 'Ouvrir la consultation'}
                  </button>
                )}
                {r.status === 'en_consultation' && (
                  <>
                    <button type="button" className="btn" onClick={() => navigate(`/clinique/dossiers/${r.client_id}?onglet=consultations`)}>Reprendre</button>
                    <button type="button" className="btn" onClick={() => cloturer(r)}>Clôturer</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
