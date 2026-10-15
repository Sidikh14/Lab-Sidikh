import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiClinique } from '../../api/clinique';

const LIBELLE_LIT = { libre: 'Libre', occupe: 'Occupé', nettoyage: 'À nettoyer', hors_service: 'Hors service' };
const TRIAGE = [
  { niveau: 1, label: 'Immédiat', classe: 'triage-1' },
  { niveau: 2, label: 'Très urgent', classe: 'triage-2' },
  { niveau: 3, label: 'Urgent', classe: 'triage-3' },
  { niveau: 4, label: 'Peu urgent', classe: 'triage-4' },
  { niveau: 5, label: 'Non urgent', classe: 'triage-5' },
];
const MOYENS = ['especes', 'wave', 'orange_money', 'cheque', 'virement'];

function formatMontant(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`;
}

export function HospitalisationCliniquePage() {
  const { aRole } = useAuth();
  const peutAdmettre = aRole('accueil', 'medecin');
  const peutSoigner = aRole('infirmier', 'sage_femme', 'medecin');
  const peutGererLits = aRole('gerant', 'manager');
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState('');
  const [lits, setLits] = useState([]);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [sejourOuvert, setSejourOuvert] = useState(null);

  const chargerLits = useCallback(() => {
    if (!serviceId) return;
    apiClinique.getLits(serviceId).then(setLits).catch((err) => setErreur(err.message));
  }, [serviceId]);

  useEffect(() => {
    apiClinique.getServices()
      .then((svc) => {
        const actifs = svc.filter((s) => s.is_active);
        setServices(actifs);
        if (actifs[0]) setServiceId(actifs[0].id);
      })
      .catch((err) => setErreur(err.message));
  }, []);

  useEffect(() => { chargerLits(); }, [chargerLits]);

  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(t);
  }, [message]);

  async function changerLit(lit, statut) {
    try {
      await apiClinique.changerStatutLit(lit.id, statut);
      chargerLits();
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <div className="page-clinique">
      <h1>Hospitalisation et urgences</h1>
      <div className="champ-groupe">
        <label className="etiquette" htmlFor="svc-hosp">Service</label>
        <select id="svc-hosp" className="champ" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {erreur && <div className="erreur">{erreur}</div>}
      {message && <div className="succes">{message}</div>}

      <h2>Lits</h2>
      {lits.length === 0 && <p className="souligne">Aucun lit dans ce service.</p>}
      <table className="tableau">
        <thead><tr><th>Lit</th><th>Tarif / jour</th><th>Statut</th><th>Patient</th><th></th></tr></thead>
        <tbody>
          {lits.map((l) => (
            <tr key={l.id}>
              <td>{l.numero}</td>
              <td>{formatMontant(l.tarif_journalier)}</td>
              <td>{LIBELLE_LIT[l.statut]}</td>
              <td>{l.patient_name || '—'}</td>
              <td className="actions">
                {l.statut === 'nettoyage' && <button type="button" className="btn" onClick={() => changerLit(l, 'libre')}>Lit prêt</button>}
                {l.statut === 'libre' && peutGererLits && <button type="button" className="btn" onClick={() => changerLit(l, 'hors_service')}>Hors service</button>}
                {l.statut === 'hors_service' && <button type="button" className="btn" onClick={() => changerLit(l, 'libre')}>Remettre en service</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {peutAdmettre && (
        <Admission lits={lits.filter((l) => l.statut === 'libre')} serviceId={serviceId}
          onErreur={setErreur} onMessage={setMessage} onAdmis={chargerLits} />
      )}

      <h2>Séjours en cours</h2>
      {lits.filter((l) => l.statut === 'occupe' && l.admission_id).length === 0 && <p className="souligne">Aucun patient hospitalisé.</p>}
      <table className="tableau">
        <thead><tr><th>Patient</th><th>Lit</th><th>Depuis</th><th></th></tr></thead>
        <tbody>
          {lits.filter((l) => l.statut === 'occupe' && l.admission_id).map((l) => (
            <tr key={l.admission_id}>
              <td>{l.patient_name}</td>
              <td>{l.numero}</td>
              <td>{new Date(l.admitted_at).toLocaleString('fr-FR')}</td>
              <td className="actions">
                {peutSoigner && <button type="button" className="btn" onClick={() => setSejourOuvert({ ...l, vue: 'surveillance' })}>Surveillance</button>}
                {peutAdmettre && <button type="button" className="btn" onClick={() => setSejourOuvert({ ...l, vue: 'sortie' })}>Sortie</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {sejourOuvert && sejourOuvert.vue === 'surveillance' && (
        <Surveillance sejour={sejourOuvert} onFermer={() => setSejourOuvert(null)} onErreur={setErreur} onMessage={setMessage} />
      )}
      {sejourOuvert && sejourOuvert.vue === 'sortie' && (
        <Sortie sejour={sejourOuvert} onFermer={() => { setSejourOuvert(null); chargerLits(); }} onErreur={setErreur} onMessage={setMessage} />
      )}

      <Urgences onErreur={setErreur} onMessage={setMessage} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Admission : patient + lit libre + motif + caution
// ---------------------------------------------------------------------
function Admission({ lits, onErreur, onMessage, onAdmis }) {
  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState([]);
  const [patient, setPatient] = useState(null);
  const [form, setForm] = useState({ bedId: '', motif: '', cautionMontant: '', cautionMoyen: 'especes' });

  useEffect(() => {
    if (q.trim().length < 2) { setResultats([]); return undefined; }
    const t = setTimeout(() => apiClinique.rechercherPatients(q.trim()).then(setResultats).catch((err) => onErreur(err.message)), 250);
    return () => clearTimeout(t);
  }, [q, onErreur]);

  async function admettre(e) {
    e.preventDefault();
    if (!patient) return onErreur('Choisissez le patient.');
    if (!form.bedId) return onErreur('Choisissez un lit libre.');
    if (!form.motif.trim()) return onErreur("Le motif d'hospitalisation est requis.");
    try {
      await apiClinique.admettre(patient.id, {
        bedId: form.bedId,
        motif: form.motif.trim(),
        cautionMontant: Number(form.cautionMontant) || 0,
        cautionMoyen: Number(form.cautionMontant) > 0 ? form.cautionMoyen : undefined,
      });
      onMessage(`${patient.full_name} admis(e).`);
      setPatient(null); setForm({ bedId: '', motif: '', cautionMontant: '', cautionMoyen: 'especes' }); setOuvert(false);
      onAdmis();
    } catch (err) {
      onErreur(err.message);
    }
  }

  if (!ouvert) return <button type="button" className="btn btn-principal" onClick={() => setOuvert(true)}>+ Admettre un patient</button>;

  return (
    <form onSubmit={admettre} className="carte" style={{ marginTop: 16, maxWidth: 560 }}>
      <h2>Admission</h2>
      {patient ? (
        <p>Patient : <strong>{patient.full_name}</strong> <button type="button" className="btn" onClick={() => setPatient(null)}>Changer</button></p>
      ) : (
        <>
          <input className="champ" placeholder="Nom ou téléphone" value={q} onChange={(e) => setQ(e.target.value)} />
          <table className="tableau"><tbody>
            {resultats.map((p) => (
              <tr key={p.id}><td>{p.full_name}</td>
                <td><button type="button" className="btn" onClick={() => { setPatient(p); setQ(''); }}>Choisir</button></td></tr>
            ))}
          </tbody></table>
        </>
      )}
      <div className="champ-groupe"><label className="etiquette" htmlFor="lit-adm">Lit libre</label>
        <select id="lit-adm" className="champ" value={form.bedId} onChange={(e) => setForm({ ...form, bedId: e.target.value })}>
          <option value="">Choisir un lit</option>
          {lits.map((l) => <option key={l.id} value={l.id}>{l.numero} — {formatMontant(l.tarif_journalier)}/jour</option>)}
        </select></div>
      <div className="champ-groupe"><label className="etiquette" htmlFor="motif-adm">Motif d'hospitalisation</label>
        <textarea id="motif-adm" className="champ" value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })} /></div>
      <div className="champ-groupe"><label className="etiquette" htmlFor="caution">Caution versée (FCFA)</label>
        <input id="caution" className="champ" value={form.cautionMontant} onChange={(e) => setForm({ ...form, cautionMontant: e.target.value })} /></div>
      {Number(form.cautionMontant) > 0 && (
        <div className="champ-groupe"><label className="etiquette" htmlFor="moyen-caution">Moyen de paiement de la caution</label>
          <select id="moyen-caution" className="champ" value={form.cautionMoyen} onChange={(e) => setForm({ ...form, cautionMoyen: e.target.value })}>
            {MOYENS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select></div>
      )}
      <button type="submit" className="btn btn-principal">Admettre</button>{' '}
      <button type="button" className="btn" onClick={() => setOuvert(false)}>Annuler</button>
    </form>
  );
}

// ---------------------------------------------------------------------
// Surveillance infirmière : constantes et notes, historique
// ---------------------------------------------------------------------
function Surveillance({ sejour, onFermer, onErreur, onMessage }) {
  const [historique, setHistorique] = useState([]);
  const [form, setForm] = useState({ tension: '', pouls: '', temperature: '', notes: '' });

  const charger = useCallback(() => {
    apiClinique.getSurveillance(sejour.patient_id, sejour.admission_id).then(setHistorique).catch((err) => onErreur(err.message));
  }, [sejour, onErreur]);

  useEffect(() => { charger(); }, [charger]);

  async function ajouter(e) {
    e.preventDefault();
    const constantes = {};
    if (form.tension) constantes.tension = form.tension;
    if (form.pouls) constantes.pouls = Number(form.pouls);
    if (form.temperature) constantes.temperature = Number(form.temperature);
    if (!Object.keys(constantes).length && !form.notes.trim()) return onErreur('Saisissez une constante ou une note.');
    try {
      await apiClinique.ajouterSurveillance(sejour.patient_id, sejour.admission_id, { constantes, notes: form.notes.trim() || undefined });
      setForm({ tension: '', pouls: '', temperature: '', notes: '' });
      onMessage('Surveillance enregistrée.');
      charger();
    } catch (err) {
      onErreur(err.message);
    }
  }

  return (
    <section className="carte" style={{ marginTop: 16, maxWidth: 640 }}>
      <button type="button" className="btn" onClick={onFermer}>← Fermer</button>
      <h2>Surveillance — {sejour.patient_name}</h2>
      <form onSubmit={ajouter}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <input className="champ" placeholder="Tension (12/8)" value={form.tension} onChange={(e) => setForm({ ...form, tension: e.target.value })} />
          <input className="champ" placeholder="Pouls" value={form.pouls} onChange={(e) => setForm({ ...form, pouls: e.target.value })} />
          <input className="champ" placeholder="Température" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} />
        </div>
        <textarea className="champ" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ marginTop: 6 }} />
        <button type="submit" className="btn btn-principal" style={{ marginTop: 6 }}>Enregistrer</button>
      </form>
      <h3>Historique</h3>
      {historique.length === 0 && <p className="souligne">Aucune entrée.</p>}
      <ul>
        {historique.map((h, i) => (
          <li key={i}>
            {new Date(h.created_at).toLocaleString('fr-FR')} — {h.saisi_par} :{' '}
            {Object.entries(h.constantes || {}).map(([k, v]) => `${k} ${v}`).join(', ')}
            {h.notes ? ` · ${h.notes}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------
// Sortie : calcul du séjour, montant renvoyé à la caisse
// ---------------------------------------------------------------------
function Sortie({ sejour, onFermer, onErreur, onMessage }) {
  const [cautionRestituee, setCautionRestituee] = useState(false);
  const [resultat, setResultat] = useState(null);

  async function sortir() {
    if (!window.confirm(`Confirmer la sortie de ${sejour.patient_name} ?`)) return;
    try {
      const r = await apiClinique.sortirPatient(sejour.patient_id, sejour.admission_id, { cautionRestituee });
      setResultat(r);
      onMessage('Sortie enregistrée.');
    } catch (err) {
      onErreur(err.message);
    }
  }

  return (
    <section className="carte" style={{ marginTop: 16, maxWidth: 520 }}>
      <h2>Sortie — {sejour.patient_name}</h2>
      {!resultat ? (
        <>
          <label><input type="checkbox" checked={cautionRestituee} onChange={(e) => setCautionRestituee(e.target.checked)} /> Caution restituée</label>
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-principal" onClick={sortir}>Confirmer la sortie</button>{' '}
            <button type="button" className="btn" onClick={onFermer}>Annuler</button>
          </div>
        </>
      ) : (
        <>
          <p>Séjour de {resultat.nuits} nuit(s). Montant à encaisser : <strong>{formatMontant(resultat.montant_a_encaisser)}</strong>.</p>
          <p className="souligne">Encaissez ce montant à la caisse de la clinique, avec un acte « nuitée » au nombre de nuits.</p>
          <button type="button" className="btn" onClick={onFermer}>Terminer</button>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Urgences : accueil avec triage et salle d'attente triée
// ---------------------------------------------------------------------
function Urgences({ onErreur, onMessage }) {
  const { aRole } = useAuth();
  const peutAccueillir = aRole('accueil', 'medecin', 'infirmier', 'sage_femme');
  const peutSoigner = aRole('medecin', 'infirmier', 'sage_femme');
  const [salle, setSalle] = useState([]);
  const [form, setForm] = useState({ nomPatient: '', triageNiveau: 3, motif: '' });

  const charger = useCallback(() => {
    apiClinique.getSalleUrgences().then(setSalle).catch((err) => onErreur(err.message));
  }, [onErreur]);

  useEffect(() => {
    charger();
    const t = setInterval(charger, 30000);
    return () => clearInterval(t);
  }, [charger]);

  async function accueillir(e) {
    e.preventDefault();
    if (!form.nomPatient.trim()) return onErreur('Le nom du patient est requis.');
    try {
      await apiClinique.creerPassageUrgence({ nomPatient: form.nomPatient.trim(), triageNiveau: Number(form.triageNiveau), motif: form.motif.trim() || undefined });
      onMessage('Passage enregistré.');
      setForm({ nomPatient: '', triageNiveau: 3, motif: '' });
      charger();
    } catch (err) {
      onErreur(err.message);
    }
  }

  async function changer(u, statut) {
    try {
      await apiClinique.changerStatutUrgence(u.id, statut);
      charger();
    } catch (err) {
      onErreur(err.message);
    }
  }

  return (
    <section style={{ marginTop: 28 }}>
      <h2>Urgences</h2>

      {peutAccueillir && (
        <form onSubmit={accueillir} className="carte" style={{ maxWidth: 560, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr', gap: 6 }}>
            <input className="champ" placeholder="Nom du patient" value={form.nomPatient} onChange={(e) => setForm({ ...form, nomPatient: e.target.value })} />
            <select className="champ" value={form.triageNiveau} onChange={(e) => setForm({ ...form, triageNiveau: e.target.value })}>
              {TRIAGE.map((t) => <option key={t.niveau} value={t.niveau}>{t.niveau} — {t.label}</option>)}
            </select>
          </div>
          <input className="champ" placeholder="Motif (facultatif)" value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })} style={{ marginTop: 6 }} />
          <button type="submit" className="btn btn-principal" style={{ marginTop: 6 }}>Enregistrer le passage</button>
        </form>
      )}

      {salle.length === 0 && <p className="souligne">Salle d'urgences vide.</p>}
      <table className="tableau">
        <thead><tr><th>Triage</th><th>Patient</th><th>Motif</th><th>Arrivée</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          {salle.map((u) => {
            const t = TRIAGE.find((x) => x.niveau === u.triage_niveau);
            return (
              <tr key={u.id}>
                <td><span className={t?.classe}>{u.triage_niveau} · {t?.label}</span></td>
                <td>{u.nom_patient}</td>
                <td>{u.motif || '—'}</td>
                <td>{new Date(u.arrived_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
                <td>{u.statut}</td>
                <td className="actions">
                  {peutSoigner && u.statut === 'attente' && <button type="button" className="btn btn-principal" onClick={() => changer(u, 'en_soins')}>Prendre en charge</button>}
                  {peutSoigner && u.statut === 'en_soins' && <button type="button" className="btn" onClick={() => changer(u, 'observation')}>Observation</button>}
                  {peutSoigner && <button type="button" className="btn" onClick={() => changer(u, 'sorti')}>Sorti</button>}
                  {peutSoigner && <button type="button" className="btn" onClick={() => changer(u, 'transfere')}>Transféré</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
