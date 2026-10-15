import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiClinique } from '../../api/clinique';

const LIBELLE_ALERTE = {
  rdv_proche: 'Rendez-vous proches',
  resultat_pret: 'Résultats à publier',
  attente_longue: "Attentes longues",
  vaccin_du: 'Vaccins dus',
  seuil_stock: 'Stock bas',
  lot_peremption: 'Lots proches de la péremption',
};

function formatMontant(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`;
}

function premierDuMois() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function aujourdHuiTexte() {
  return new Date().toLocaleDateString('en-CA');
}

export function RapportsCliniquePage() {
  const { aRole } = useAuth();
  const peutAgir = aRole('gerant', 'manager');
  const [from, setFrom] = useState(premierDuMois());
  const [to, setTo] = useState(aujourdHuiTexte());
  const [activite, setActivite] = useState(null);
  const [recettes, setRecettes] = useState(null);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  const charger = useCallback(() => {
    setErreur('');
    Promise.all([apiClinique.getRapportActivite(from, to), apiClinique.getRapportRecettes(from, to)])
      .then(([a, r]) => { setActivite(a); setRecettes(r); })
      .catch((err) => setErreur(err.message));
  }, [from, to]);

  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(t);
  }, [message]);

  async function verifier() {
    try {
      const r = await apiClinique.verifierAlertes();
      const total = Object.values(r.creees).reduce((s, n) => s + n, 0);
      setMessage(total === 0
        ? 'Vérification faite : aucune nouvelle alerte.'
        : `Vérification faite : ${total} nouvelle(s) alerte(s) envoyée(s).`);
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <div className="page-clinique">
      <h1>Rapports et alertes</h1>
      {erreur && <div className="erreur">{erreur}</div>}
      {message && <div className="succes">{message}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="du">Du</label>
        <input id="du" type="date" className="champ" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <label htmlFor="au">Au</label>
        <input id="au" type="date" className="champ" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} />
        {peutAgir && (
          <button type="button" className="btn btn-principal" onClick={verifier}>Vérifier les alertes</button>
        )}
      </div>

      {activite && (
        <section style={{ marginTop: 20 }}>
          <h2>Activité</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div className="carte">
              <p className="souligne">Taux d'occupation des lits</p>
              <p style={{ fontSize: '1.6em' }}><strong>{activite.occupationLits.taux} %</strong></p>
              <p>{activite.occupationLits.occupes} occupé(s) sur {activite.occupationLits.disponibles}</p>
            </div>
            <div className="carte">
              <p className="souligne">Délai moyen d'attente</p>
              <p style={{ fontSize: '1.6em' }}>
                <strong>{activite.delaiAttente.minutesMoyennes !== null ? `${activite.delaiAttente.minutesMoyennes} min` : '—'}</strong>
              </p>
              <p>{activite.delaiAttente.ticketsAppeles} ticket(s) appelé(s)</p>
            </div>
            <div className="carte">
              <p className="souligne">Recettes de la période</p>
              <p style={{ fontSize: '1.6em' }}>
                <strong>{formatMontant(activite.recettesParModePaiement.reduce((s, r) => s + Number(r.total), 0))}</strong>
              </p>
            </div>
          </div>

          <h3 style={{ marginTop: 16 }}>Consultations par praticien</h3>
          {activite.consultationsParPraticien.length === 0 && <p className="souligne">Aucune consultation sur la période.</p>}
          {activite.consultationsParPraticien.length > 0 && (
            <table className="tableau">
              <thead><tr><th>Praticien</th><th>Consultations</th><th>Signées</th></tr></thead>
              <tbody>
                {activite.consultationsParPraticien.map((p) => (
                  <tr key={p.praticien}><td>{p.praticien}</td><td>{p.total}</td><td>{p.signees}</td></tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ marginTop: 16 }}>Recettes par mode de paiement</h3>
          <table className="tableau">
            <thead><tr><th>Mode</th><th>Ventes</th><th>Total</th></tr></thead>
            <tbody>
              {activite.recettesParModePaiement.map((r) => (
                <tr key={r.mode}><td>{r.mode}</td><td>{r.ventes}</td><td>{formatMontant(r.total)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {recettes && (
        <section style={{ marginTop: 24 }}>
          <h2>Actes facturés</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <h3>Par praticien</h3>
              <table className="tableau">
                <tbody>
                  {recettes.parPraticien.map((p) => (
                    <tr key={p.praticien}><td>{p.praticien}</td><td>{p.actes} acte(s)</td><td>{formatMontant(p.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3>Par catégorie</h3>
              <table className="tableau">
                <tbody>
                  {recettes.parCategorie.map((c) => (
                    <tr key={c.categorie}><td>{c.categorie}</td><td>{c.actes} acte(s)</td><td>{formatMontant(c.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p style={{ marginTop: 10 }}>
            Honoraires encore à reverser : <strong>{formatMontant(recettes.honorairesARevorser)}</strong>
          </p>
        </section>
      )}

      {peutAgir && <Honoraires onErreur={setErreur} onMessage={setMessage} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Honoraires à reverser : sélection et versement par lot (gérant, manager)
// ---------------------------------------------------------------------
function Honoraires({ onErreur, onMessage }) {
  const [donnees, setDonnees] = useState({ lignes: [], total: 0 });
  const [selection, setSelection] = useState([]);

  const charger = useCallback(() => {
    apiClinique.getHonoraires('du')
      .then((d) => { setDonnees(d); setSelection([]); })
      .catch((err) => onErreur(err.message));
  }, [onErreur]);

  useEffect(() => { charger(); }, [charger]);

  const totalSelection = donnees.lignes
    .filter((l) => selection.includes(l.id))
    .reduce((s, l) => s + Number(l.montant), 0);

  function basculer(id) {
    setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function verser() {
    if (selection.length === 0) return;
    if (!window.confirm(`Marquer ${selection.length} honoraire(s) comme versé(s), pour ${formatMontant(totalSelection)} ?`)) return;
    try {
      const r = await apiClinique.verserHonoraires(selection);
      onMessage(`${r.versees} honoraire(s) marqué(s) comme versé(s).`);
      charger();
    } catch (err) {
      onErreur(err.message);
    }
  }

  return (
    <section style={{ marginTop: 28 }}>
      <h2>Honoraires à reverser</h2>
      {donnees.lignes.length === 0 && <p className="souligne">Aucun honoraire en attente.</p>}
      {donnees.lignes.length > 0 && (
        <>
          <table className="tableau">
            <thead><tr><th></th><th>Praticien</th><th>Mode</th><th>Base</th><th>Montant</th><th>Date</th></tr></thead>
            <tbody>
              {donnees.lignes.map((l) => (
                <tr key={l.id}>
                  <td><input type="checkbox" checked={selection.includes(l.id)} onChange={() => basculer(l.id)} /></td>
                  <td>{l.praticien}</td>
                  <td>{l.mode === 'pourcentage' ? 'Pourcentage' : 'Par acte'}</td>
                  <td>{formatMontant(l.base_montant)}</td>
                  <td>{formatMontant(l.montant)}</td>
                  <td>{new Date(l.created_at).toLocaleDateString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 8 }}>
            Total à reverser : <strong>{formatMontant(donnees.total)}</strong>
            {selection.length > 0 && <> · Sélection : <strong>{formatMontant(totalSelection)}</strong></>}
          </p>
          <button type="button" className="btn btn-principal" onClick={verser} disabled={selection.length === 0}>
            Marquer la sélection comme versée
          </button>
        </>
      )}
    </section>
  );
}
