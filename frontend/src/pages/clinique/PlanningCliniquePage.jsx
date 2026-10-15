import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiClinique } from '../../api/clinique';

const ROLES_CLINIQUES = ['medecin', 'infirmier', 'sage_femme', 'laborantin', 'accueil', 'caissier'];
const TYPES = [
  { id: 'jour', label: 'Jour' },
  { id: 'nuit', label: 'Nuit' },
  { id: 'garde', label: 'Garde' },
  { id: 'astreinte', label: 'Astreinte' },
];
const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

// Date au format AAAA-MM-JJ, en local (évite le décalage UTC de toISOString).
function enTexteDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${j}`;
}

// Lundi de la semaine contenant la date donnée.
function lundiDe(date) {
  const d = new Date(date);
  const decalage = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - decalage);
  d.setHours(0, 0, 0, 0);
  return d;
}

function heure(date) {
  return new Date(date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatMontant(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`;
}

export function PlanningCliniquePage() {
  const { aRole } = useAuth();
  const peutGerer = aRole('gerant', 'manager');
  const peutVoirPrimes = aRole('gerant', 'manager', 'comptable');
  // Le comptable ne voit que les primes ; les soignants et l'accueil voient le planning sans le gérer.
  const peutVoirPlanning = aRole('medecin', 'infirmier', 'sage_femme', 'accueil', 'gerant', 'manager');

  const [lundi, setLundi] = useState(() => lundiDe(new Date()));
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState('');
  const [personnel, setPersonnel] = useState([]);
  const [creneaux, setCreneaux] = useState([]);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  const dimanche = useMemo(() => {
    const d = new Date(lundi);
    d.setDate(d.getDate() + 6);
    return d;
  }, [lundi]);

  const jours = useMemo(() => JOURS.map((nom, i) => {
    const d = new Date(lundi);
    d.setDate(d.getDate() + i);
    return { nom, date: d, cle: enTexteDate(d) };
  }), [lundi]);

  const charger = useCallback(() => {
    if (!peutVoirPlanning) return;
    apiClinique.getPlanning(enTexteDate(lundi), enTexteDate(dimanche), serviceId || undefined)
      .then(setCreneaux)
      .catch((err) => setErreur(err.message));
  }, [lundi, dimanche, serviceId, peutVoirPlanning]);

  useEffect(() => {
    Promise.all([apiClinique.getServices(), peutGerer ? apiClinique.getPersonnel() : Promise.resolve([])])
      .then(([svc, equipe]) => {
        setServices(svc.filter((s) => s.is_active));
        setPersonnel(equipe.filter((u) => u.is_active && (u.roles || []).some((r) => ROLES_CLINIQUES.includes(r))));
      })
      .catch((err) => setErreur(err.message));
  }, [peutGerer]);

  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(t);
  }, [message]);

  function semaine(delta) {
    const d = new Date(lundi);
    d.setDate(d.getDate() + delta * 7);
    setLundi(d);
  }

  async function supprimer(c) {
    if (!window.confirm('Retirer ce créneau du planning ?')) return;
    try {
      await apiClinique.supprimerCreneau(c.id);
      setMessage('Créneau retiré.');
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <div className="page-clinique">
      <h1>Planning et gardes</h1>
      {erreur && <div className="erreur">{erreur}</div>}
      {message && <div className="succes">{message}</div>}

      {peutVoirPlanning && (<>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => semaine(-1)}>← Semaine précédente</button>
        <strong>
          {lundi.toLocaleDateString('fr-FR')} → {dimanche.toLocaleDateString('fr-FR')}
        </strong>
        <button type="button" className="btn" onClick={() => semaine(1)}>Semaine suivante →</button>
        <select className="champ" style={{ width: 'auto' }} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">Tous les services</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <table className="tableau" style={{ marginTop: 12 }}>
        <thead><tr><th style={{ width: 110 }}>Jour</th><th>Créneaux</th></tr></thead>
        <tbody>
          {jours.map((j) => {
            const du = creneaux.filter((c) => enTexteDate(new Date(c.debut)) === j.cle);
            return (
              <tr key={j.cle}>
                <td>{j.nom} {j.date.getDate()}</td>
                <td>
                  {du.length === 0 && <span className="souligne">—</span>}
                  {du.map((c) => (
                    <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <span>{heure(c.debut)}–{heure(c.fin)}</span>
                      <strong>{c.personnel}</strong>
                      <span>{TYPES.find((t) => t.id === c.type)?.label || c.type}</span>
                      {c.service_name && <span className="souligne">{c.service_name}</span>}
                      {Number(c.prime) > 0 && <span>· prime {formatMontant(c.prime)}</span>}
                      {peutGerer && new Date(c.debut) > new Date() && (
                        <button type="button" className="btn" onClick={() => supprimer(c)}>Retirer</button>
                      )}
                    </div>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      </>)}

      {peutGerer && (
        <AjoutCreneau personnel={personnel} services={services} onErreur={setErreur} onMessage={setMessage} onFait={charger} />
      )}

      {peutVoirPrimes && <Primes />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Ajout d'un créneau (gérant, manager)
// ---------------------------------------------------------------------
function AjoutCreneau({ personnel, services, onErreur, onMessage, onFait }) {
  const [ouvert, setOuvert] = useState(false);
  const [form, setForm] = useState({ userId: '', serviceId: '', debut: '', fin: '', type: 'jour', prime: '' });

  async function ajouter(e) {
    e.preventDefault();
    if (!form.userId || !form.debut || !form.fin) return onErreur('Personnel, début et fin sont requis.');
    if (new Date(form.fin) <= new Date(form.debut)) return onErreur('La fin doit être après le début.');
    try {
      await apiClinique.creerCreneau({
        userId: form.userId,
        serviceId: form.serviceId || undefined,
        debut: new Date(form.debut).toISOString(),
        fin: new Date(form.fin).toISOString(),
        type: form.type,
        prime: Number(form.prime) || 0,
      });
      onMessage('Créneau ajouté.');
      setForm({ userId: '', serviceId: '', debut: '', fin: '', type: 'jour', prime: '' });
      setOuvert(false);
      onFait();
    } catch (err) {
      onErreur(err.message);
    }
  }

  if (!ouvert) return <button type="button" className="btn btn-principal" style={{ marginTop: 12 }} onClick={() => setOuvert(true)}>+ Ajouter un créneau</button>;

  return (
    <form onSubmit={ajouter} className="carte" style={{ marginTop: 16, maxWidth: 620 }}>
      <h2>Nouveau créneau</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <select className="champ" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
          <option value="">Personnel</option>
          {personnel.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <select className="champ" value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
          <option value="">Service (facultatif)</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="champ-groupe"><label className="etiquette" htmlFor="debut-creneau">Début</label>
          <input id="debut-creneau" className="champ" type="datetime-local" value={form.debut} onChange={(e) => setForm({ ...form, debut: e.target.value })} /></div>
        <div className="champ-groupe"><label className="etiquette" htmlFor="fin-creneau">Fin</label>
          <input id="fin-creneau" className="champ" type="datetime-local" value={form.fin} onChange={(e) => setForm({ ...form, fin: e.target.value })} /></div>
        <select className="champ" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <input className="champ" placeholder="Prime de garde (FCFA)" value={form.prime} onChange={(e) => setForm({ ...form, prime: e.target.value })} />
      </div>
      <button type="submit" className="btn btn-principal" style={{ marginTop: 8 }}>Enregistrer</button>{' '}
      <button type="button" className="btn" onClick={() => setOuvert(false)}>Annuler</button>
      <p className="souligne" style={{ marginTop: 6 }}>Une même personne ne peut pas avoir deux créneaux qui se chevauchent : le serveur refuse le second.</p>
    </form>
  );
}

// ---------------------------------------------------------------------
// Primes de garde du mois, à reprendre dans la paie
// ---------------------------------------------------------------------
function Primes() {
  const aujourdHui = new Date();
  const [mois, setMois] = useState(`${aujourdHui.getFullYear()}-${String(aujourdHui.getMonth() + 1).padStart(2, '0')}`);
  const [rapport, setRapport] = useState(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    apiClinique.getPrimesGarde(mois).then(setRapport).catch((err) => setErreur(err.message));
  }, [mois]);

  return (
    <section style={{ marginTop: 28 }}>
      <h2>Primes de garde</h2>
      <input type="month" className="champ" style={{ width: 'auto' }} value={mois} onChange={(e) => setMois(e.target.value)} />
      {erreur && <div className="erreur">{erreur}</div>}
      {rapport && (
        <>
          {rapport.personnel.length === 0 && <p className="souligne">Aucune prime sur ce mois.</p>}
          <table className="tableau">
            <thead><tr><th>Personnel</th><th>Créneaux primés</th><th>Total</th></tr></thead>
            <tbody>
              {rapport.personnel.map((p) => (
                <tr key={p.user_id}>
                  <td>{p.personnel}</td>
                  <td>{p.creneaux}</td>
                  <td>{formatMontant(p.total_primes)}</td>
                </tr>
              ))}
            </tbody>
            {rapport.personnel.length > 0 && (
              <tfoot><tr><td colSpan={2}><strong>Total du mois</strong></td><td><strong>{formatMontant(rapport.total)}</strong></td></tr></tfoot>
            )}
          </table>
        </>
      )}
    </section>
  );
}
