import { useEffect, useState, useCallback } from 'react';
import { apiClinique } from '../../api/clinique';

const ONGLETS = [
  { id: 'agenda', label: 'Agenda du jour' },
  { id: 'file', label: "File d'attente" },
  { id: 'nouveau', label: 'Nouveau patient' },
];

const LIBELLE_STATUT = {
  planifie: 'Planifié', arrive: 'Arrivé', en_consultation: 'En consultation',
  termine: 'Terminé', annule: 'Annulé', absent: 'Absent',
};

const LIBELLE_PRIORITE = { urgence: 'Urgence', rdv: 'Rendez-vous', normale: 'Sans RDV' };

function heure(date) {
  return new Date(date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function AccueilCliniquePage() {
  const [onglet, setOnglet] = useState('agenda');
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState('');
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    apiClinique.getServices()
      .then((liste) => {
        const actifs = liste.filter((s) => s.is_active);
        setServices(actifs);
        if (actifs[0]) setServiceId(actifs[0].id);
      })
      .catch((err) => setErreur(err.message));
  }, []);

  // Tout message disparaît après quelques secondes.
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(t);
  }, [message]);

  return (
    <div className="page-clinique">
      <header className="entete-page">
        <h1>Accueil</h1>
        <div className="champ-groupe">
          <label className="etiquette" htmlFor="service">Service</label>
          <select id="service" className="champ" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </header>

      <nav className="onglets">
        {ONGLETS.map((o) => (
          <button key={o.id} type="button" className={'onglet' + (onglet === o.id ? ' actif' : '')} onClick={() => setOnglet(o.id)}>
            {o.label}
          </button>
        ))}
      </nav>

      {erreur && <div className="erreur">{erreur}</div>}
      {message && <div className="succes">{message}</div>}

      {onglet === 'agenda' && (
        <Agenda serviceId={serviceId} onErreur={setErreur} onMessage={setMessage} />
      )}
      {onglet === 'file' && (
        <File serviceId={serviceId} onErreur={setErreur} onMessage={setMessage} />
      )}
      {onglet === 'nouveau' && (
        <NouveauPatient serviceId={serviceId} onErreur={setErreur} onMessage={setMessage} onTicketPris={() => setOnglet('file')} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// AGENDA DU JOUR
// ---------------------------------------------------------------------
function Agenda({ serviceId, onErreur, onMessage }) {
  const [rdv, setRdv] = useState([]);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(() => {
    setChargement(true);
    apiClinique.getAgenda(undefined, serviceId || undefined)
      .then(setRdv)
      .catch((err) => onErreur(err.message))
      .finally(() => setChargement(false));
  }, [serviceId, onErreur]);

  useEffect(() => { charger(); }, [charger]);

  // Le patient arrive : on change le statut puis on lui prend un ticket « rendez-vous » (priorité sur les sans-RDV).
  async function marquerArrive(r) {
    try {
      await apiClinique.changerStatutRdv(r.id, 'arrive');
      await apiClinique.prendreTicket({ serviceId, clientId: r.client_id, appointmentId: r.id, priorite: 'rdv' });
      onMessage(`${r.client_name} est arrivé(e) et a pris un ticket.`);
      charger();
    } catch (err) {
      onErreur(err.message);
    }
  }

  async function changer(r, statut) {
    try {
      await apiClinique.changerStatutRdv(r.id, statut);
      charger();
    } catch (err) {
      onErreur(err.message);
    }
  }

  if (chargement) return <p>Chargement de l'agenda…</p>;
  if (rdv.length === 0) return <p className="souligne">Aucun rendez-vous aujourd'hui pour ce service.</p>;

  return (
    <table className="tableau">
      <thead>
        <tr><th>Heure</th><th>Patient</th><th>Praticien</th><th>Motif</th><th>Statut</th><th></th></tr>
      </thead>
      <tbody>
        {rdv.map((r) => (
          <tr key={r.id}>
            <td>{heure(r.starts_at)}</td>
            <td>{r.client_name}</td>
            <td>{r.practitioner_name || '—'}</td>
            <td>{r.motif || '—'}</td>
            <td>{LIBELLE_STATUT[r.status] || r.status}</td>
            <td className="actions">
              {r.status === 'planifie' && (
                <>
                  <button type="button" className="btn btn-principal" onClick={() => marquerArrive(r)}>Arrivé</button>
                  <button type="button" className="btn" onClick={() => changer(r, 'absent')}>Absent</button>
                  <button type="button" className="btn" onClick={() => changer(r, 'annule')}>Annuler</button>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------
// FILE D'ATTENTE ET APPEL AU GUICHET
// ---------------------------------------------------------------------
function File({ serviceId, onErreur, onMessage }) {
  const [tickets, setTickets] = useState([]);
  const [guichet, setGuichet] = useState('Guichet 1');

  const charger = useCallback(() => {
    if (!serviceId) return;
    apiClinique.getFile(serviceId).then(setTickets).catch((err) => onErreur(err.message));
  }, [serviceId, onErreur]);

  // Rafraîchissement régulier : la file bouge en permanence.
  useEffect(() => {
    charger();
    const t = setInterval(charger, 20000);
    return () => clearInterval(t);
  }, [charger]);

  async function appeler(t) {
    try {
      await apiClinique.appelerTicket(t.id, guichet);
      onMessage(`Ticket n° ${t.number} appelé au ${guichet}.`);
      charger();
    } catch (err) {
      onErreur(err.message);
    }
  }

  async function changer(t, statut) {
    try {
      await apiClinique.changerStatutTicket(t.id, statut);
      charger();
    } catch (err) {
      onErreur(err.message);
    }
  }

  return (
    <section>
      <div className="champ-groupe">
        <label className="etiquette" htmlFor="guichet">Guichet ou cabinet</label>
        <input id="guichet" className="champ" value={guichet} onChange={(e) => setGuichet(e.target.value)} />
      </div>

      {tickets.length === 0 && <p className="souligne">Aucun patient en attente.</p>}
      <table className="tableau">
        <thead>
          <tr><th>N°</th><th>Patient</th><th>Priorité</th><th>Arrivée</th><th>Statut</th><th></th></tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} className={t.priorite === 'urgence' ? 'ligne-urgence' : ''}>
              <td><strong>{t.number}</strong></td>
              <td>{t.client_name || 'Sans fiche'}</td>
              <td>{LIBELLE_PRIORITE[t.priorite]}</td>
              <td>{heure(t.created_at)}</td>
              <td>{t.status === 'appele' ? `Appelé (${t.guichet})` : t.status === 'en_cours' ? 'En cours' : 'En attente'}</td>
              <td className="actions">
                {(t.status === 'en_attente' || t.status === 'appele') && (
                  <button type="button" className="btn btn-principal" onClick={() => appeler(t)}>Appeler</button>
                )}
                {t.status === 'appele' && (
                  <button type="button" className="btn" onClick={() => changer(t, 'en_cours')}>Prise en charge</button>
                )}
                {(t.status === 'appele' || t.status === 'en_cours') && (
                  <button type="button" className="btn" onClick={() => changer(t, 'termine')}>Terminé</button>
                )}
                {t.status !== 'en_cours' && (
                  <button type="button" className="btn" onClick={() => changer(t, 'absent')}>Absent</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------
// NOUVEAU PATIENT (avec détection des doublons) ET TICKET SANS RENDEZ-VOUS
// ---------------------------------------------------------------------
function NouveauPatient({ serviceId, onErreur, onMessage, onTicketPris }) {
  const [form, setForm] = useState({ fullName: '', phone: '' });
  const [doublon, setDoublon] = useState(null);
  const [enCours, setEnCours] = useState(false);

  function maj(champ, valeur) {
    setForm((f) => ({ ...f, [champ]: valeur }));
    setDoublon(null);
  }

  async function prendreTicket(clientId) {
    await apiClinique.prendreTicket({ serviceId, clientId: clientId || null, priorite: 'normale' });
    onMessage('Ticket pris.');
    onTicketPris();
  }

  async function enregistrer(e) {
    e.preventDefault();
    onErreur('');
    if (!form.fullName.trim()) return onErreur('Le nom du patient est requis.');
    setEnCours(true);
    try {
      const patient = await apiClinique.creerPatient(form);
      onMessage(`${patient.full_name} enregistré(e).`);
      await prendreTicket(patient.id);
    } catch (err) {
      if (err.doublon) {
        setDoublon(err.doublon);
        onErreur('');
      } else {
        onErreur(err.message);
      }
    } finally {
      setEnCours(false);
    }
  }

  // Le patient existe déjà (même téléphone) : on rattache le passage à sa fiche, sans créer de doublon.
  async function utiliserExistant() {
    setEnCours(true);
    try {
      await prendreTicket(doublon.id);
    } catch (err) {
      onErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={enregistrer} style={{ maxWidth: 420 }}>
      <div className="champ-groupe">
        <label className="etiquette" htmlFor="nomPatient">Nom complet</label>
        <input id="nomPatient" className="champ" value={form.fullName} onChange={(e) => maj('fullName', e.target.value)} />
      </div>
      <div className="champ-groupe">
        <label className="etiquette" htmlFor="telPatient">Téléphone</label>
        <input id="telPatient" className="champ" value={form.phone} onChange={(e) => maj('phone', e.target.value)} />
      </div>

      {doublon && (
        <div className="carte">
          <p>Un patient avec ce numéro existe déjà : <strong>{doublon.full_name}</strong>.</p>
          <button type="button" className="btn btn-principal" onClick={utiliserExistant} disabled={enCours}>
            Utiliser cette fiche et prendre un ticket
          </button>
        </div>
      )}

      <button type="submit" className="btn btn-principal" disabled={enCours || !serviceId}>
        {enCours ? 'Enregistrement…' : 'Enregistrer et prendre un ticket'}
      </button>
    </form>
  );
}
