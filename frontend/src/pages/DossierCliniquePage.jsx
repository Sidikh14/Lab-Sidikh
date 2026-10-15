import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { apiClinique } from '../../api/clinique';

const GROUPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const TYPES_DOCUMENT = [
  { id: 'ordonnance', label: 'Ordonnance' },
  { id: 'certificat', label: 'Certificat médical' },
  { id: 'arret_travail', label: 'Arrêt de travail' },
  { id: 'compte_rendu', label: 'Compte rendu' },
];

export function DossierCliniquePage() {
  const { patientId } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { aRole } = useAuth();
  const estMedecin = aRole('medecin');
  const peutVoirDossier = aRole('medecin', 'infirmier', 'sage_femme');

  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [onglet, setOnglet] = useState(params.get('onglet') || 'dossier');
  const consultationInitiale = params.get('consultation');

  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(t);
  }, [message]);

  if (!patientId) return <RechercheDossier onChoisir={(id) => navigate(`/clinique/dossiers/${id}`)} />;
  if (!peutVoirDossier) {
    return <p className="erreur">Le dossier médical est réservé aux médecins et au personnel soignant.</p>;
  }

  return (
    <div className="page-clinique">
      <header className="entete-page">
        <button type="button" className="btn" onClick={() => navigate('/clinique/dossiers')}>← Autres patients</button>
        <h1>Dossier patient</h1>
      </header>

      <nav className="onglets">
        {[
          { id: 'dossier', label: 'Dossier léger' },
          { id: 'consultations', label: 'Consultations' },
          { id: 'documents', label: 'Documents' },
        ].map((o) => (
          <button key={o.id} type="button" className={'onglet' + (onglet === o.id ? ' actif' : '')} onClick={() => setOnglet(o.id)}>
            {o.label}
          </button>
        ))}
      </nav>

      {erreur && <div className="erreur">{erreur}</div>}
      {message && <div className="succes">{message}</div>}

      {onglet === 'dossier' && <DossierLeger patientId={patientId} onErreur={setErreur} onMessage={setMessage} />}
      {onglet === 'consultations' && (
        <Consultations patientId={patientId} estMedecin={estMedecin} consultationInitiale={consultationInitiale} onErreur={setErreur} onMessage={setMessage} />
      )}
      {onglet === 'documents' && (
        <Documents patientId={patientId} estMedecin={estMedecin} onErreur={setErreur} onMessage={setMessage} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Recherche d'un patient pour ouvrir son dossier
// ---------------------------------------------------------------------
function RechercheDossier({ onChoisir }) {
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState([]);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    if (q.trim().length < 2) { setResultats([]); return undefined; }
    const t = setTimeout(() => {
      apiClinique.rechercherPatients(q.trim()).then(setResultats).catch((err) => setErreur(err.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="page-clinique">
      <h1>Dossiers patients</h1>
      {erreur && <div className="erreur">{erreur}</div>}
      <div className="champ-groupe">
        <label className="etiquette" htmlFor="recherche">Nom ou téléphone</label>
        <input id="recherche" className="champ" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <table className="tableau">
        <tbody>
          {resultats.map((p) => (
            <tr key={p.id}>
              <td>{p.full_name}</td>
              <td>{p.phone || '—'}</td>
              <td><button type="button" className="btn btn-principal" onClick={() => onChoisir(p.id)}>Ouvrir</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// Dossier léger
// ---------------------------------------------------------------------
function DossierLeger({ patientId, onErreur, onMessage }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState({ allergies: '', antecedents: '', groupeSanguin: '', notesGenerales: '' });

  useEffect(() => {
    apiClinique.getDossier(patientId)
      .then((x) => {
        setD(x);
        setForm({
          allergies: x.allergies || '',
          antecedents: x.antecedents || '',
          groupeSanguin: x.groupe_sanguin || '',
          notesGenerales: x.notes_generales || '',
        });
      })
      .catch((err) => onErreur(err.message));
  }, [patientId, onErreur]);

  async function enregistrer(e) {
    e.preventDefault();
    try {
      await apiClinique.sauverDossier(patientId, { ...form, groupeSanguin: form.groupeSanguin || null });
      onMessage('Dossier enregistré.');
    } catch (err) {
      onErreur(err.message);
    }
  }

  if (!d) return <p>Chargement…</p>;

  return (
    <form onSubmit={enregistrer} style={{ maxWidth: 560 }}>
      <h2>{d.full_name}</h2>
      {d.urgence && <div className="erreur">Dossier ouvert en urgence : l'accès a été signalé au manager.</div>}
      <div className="champ-groupe">
        <label className="etiquette" htmlFor="allergies">Allergies</label>
        <textarea id="allergies" className="champ" value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} />
      </div>
      <div className="champ-groupe">
        <label className="etiquette" htmlFor="antecedents">Antécédents</label>
        <textarea id="antecedents" className="champ" value={form.antecedents} onChange={(e) => setForm({ ...form, antecedents: e.target.value })} />
      </div>
      <div className="champ-groupe">
        <label className="etiquette" htmlFor="groupe">Groupe sanguin</label>
        <select id="groupe" className="champ" value={form.groupeSanguin} onChange={(e) => setForm({ ...form, groupeSanguin: e.target.value })}>
          <option value="">Non renseigné</option>
          {GROUPES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div className="champ-groupe">
        <label className="etiquette" htmlFor="notes">Notes générales</label>
        <textarea id="notes" className="champ" value={form.notesGenerales} onChange={(e) => setForm({ ...form, notesGenerales: e.target.value })} />
      </div>
      <button type="submit" className="btn btn-principal">Enregistrer</button>
    </form>
  );
}

// ---------------------------------------------------------------------
// Consultations : liste, brouillon, signature, addenda
// ---------------------------------------------------------------------
function Consultations({ patientId, estMedecin, consultationInitiale, onErreur, onMessage }) {
  const [liste, setListe] = useState([]);
  const [ouverte, setOuverte] = useState(null); // consultation en cours d'édition
  const [nouveau, setNouveau] = useState(false);

  const charger = useCallback(() => {
    apiClinique.getConsultations(patientId).then(setListe).catch((err) => onErreur(err.message));
  }, [patientId, onErreur]);

  useEffect(() => { charger(); }, [charger]);

  // Ouverture directe d'une consultation (depuis l'agenda du médecin), une seule fois.
  const ouvertureFaite = useRef(false);
  useEffect(() => {
    if (!consultationInitiale || liste.length === 0 || ouvertureFaite.current) return;
    ouvertureFaite.current = true;
    const trouvee = liste.find((c) => c.id === consultationInitiale);
    if (trouvee) setOuverte(trouvee);
  }, [liste, consultationInitiale]);

  if (ouverte) {
    return (
      <Consultation
        patientId={patientId}
        consultation={ouverte}
        estMedecin={estMedecin}
        onFermer={() => { setOuverte(null); charger(); }}
        onErreur={onErreur}
        onMessage={onMessage}
      />
    );
  }

  return (
    <section>
      <button type="button" className="btn btn-principal" onClick={() => setNouveau(true)}>Nouvelle consultation</button>

      {nouveau && (
        <NouvelleConsultation
          patientId={patientId}
          onCree={(c) => { setNouveau(false); setOuverte(c); }}
          onAnnuler={() => setNouveau(false)}
          onErreur={onErreur}
        />
      )}

      {liste.length === 0 && <p className="souligne">Aucune consultation.</p>}
      <table className="tableau">
        <thead><tr><th>Date</th><th>Praticien</th><th>Motif</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          {liste.map((c) => (
            <tr key={c.id}>
              <td>{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
              <td>{c.praticien}</td>
              <td>{c.motif || '—'}</td>
              <td>{c.status === 'signee' ? `Signée le ${new Date(c.signed_at).toLocaleDateString('fr-FR')}` : 'Brouillon'}</td>
              <td><button type="button" className="btn" onClick={() => setOuverte(c)}>Ouvrir</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function NouvelleConsultation({ patientId, onCree, onAnnuler, onErreur }) {
  const [form, setForm] = useState({ motif: '', tension: '', pouls: '', temperature: '', poids: '' });

  async function creer(e) {
    e.preventDefault();
    try {
      const constantes = {};
      if (form.tension) constantes.tension = form.tension;
      if (form.pouls) constantes.pouls = Number(form.pouls);
      if (form.temperature) constantes.temperature = Number(form.temperature);
      if (form.poids) constantes.poids = Number(form.poids);
      const c = await apiClinique.ouvrirConsultation(patientId, { motif: form.motif, constantes });
      onCree({ ...c, motif: form.motif, constantes, examen: '', diagnostic: '', actes: [], status: 'brouillon' });
    } catch (err) {
      onErreur(err.message);
    }
  }

  return (
    <form onSubmit={creer} className="carte" style={{ maxWidth: 520, marginTop: 12 }}>
      <div className="champ-groupe">
        <label className="etiquette" htmlFor="motif">Motif de consultation</label>
        <input id="motif" className="champ" value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })} />
      </div>
      <div className="champ-groupe"><label className="etiquette" htmlFor="tension">Tension</label>
        <input id="tension" className="champ" placeholder="12/8" value={form.tension} onChange={(e) => setForm({ ...form, tension: e.target.value })} /></div>
      <div className="champ-groupe"><label className="etiquette" htmlFor="pouls">Pouls</label>
        <input id="pouls" className="champ" value={form.pouls} onChange={(e) => setForm({ ...form, pouls: e.target.value })} /></div>
      <div className="champ-groupe"><label className="etiquette" htmlFor="temp">Température (°C)</label>
        <input id="temp" className="champ" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} /></div>
      <div className="champ-groupe"><label className="etiquette" htmlFor="poids">Poids (kg)</label>
        <input id="poids" className="champ" value={form.poids} onChange={(e) => setForm({ ...form, poids: e.target.value })} /></div>
      <button type="submit" className="btn btn-principal">Ouvrir le brouillon</button>{' '}
      <button type="button" className="btn" onClick={onAnnuler}>Annuler</button>
    </form>
  );
}

function Consultation({ patientId, consultation, estMedecin, onFermer, onErreur, onMessage }) {
  const [c, setC] = useState(consultation);
  const [actes, setActes] = useState(consultation.actes || []);
  const [addendum, setAddendum] = useState('');
  const signee = c.status === 'signee';

  async function enregistrer() {
    try {
      await apiClinique.sauverConsultation(patientId, c.id, {
        motif: c.motif,
        examen: c.examen,
        diagnostic: c.diagnostic,
        actes: actes.map((a) => ({ libelle: a.libelle, quantite: Number(a.quantite) || 1 })),
      });
      onMessage('Brouillon enregistré.');
    } catch (err) {
      onErreur(err.message);
    }
  }

  async function signer() {
    if (!window.confirm('Signer la consultation ? Elle ne pourra plus être modifiée (un addendum restera possible).')) return;
    try {
      await enregistrer();
      const r = await apiClinique.signerConsultation(patientId, c.id);
      setC({ ...c, status: 'signee', signed_at: r.signed_at });
      onMessage('Consultation signée.');
    } catch (err) {
      onErreur(err.message);
    }
  }

  async function envoyerAddendum() {
    if (!addendum.trim()) return;
    try {
      await apiClinique.ajouterAddendum(patientId, c.id, addendum.trim());
      setAddendum('');
      onMessage('Addendum ajouté.');
    } catch (err) {
      onErreur(err.message);
    }
  }

  return (
    <section style={{ maxWidth: 640 }}>
      <button type="button" className="btn" onClick={onFermer}>← Retour aux consultations</button>
      <h2>Consultation {signee ? '(signée)' : '(brouillon)'}</h2>

      <div className="champ-groupe"><label className="etiquette" htmlFor="c-motif">Motif</label>
        <input id="c-motif" className="champ" disabled={signee} value={c.motif || ''} onChange={(e) => setC({ ...c, motif: e.target.value })} /></div>
      <div className="champ-groupe"><label className="etiquette" htmlFor="c-examen">Examen clinique</label>
        <textarea id="c-examen" className="champ" disabled={signee} value={c.examen || ''} onChange={(e) => setC({ ...c, examen: e.target.value })} /></div>
      <div className="champ-groupe"><label className="etiquette" htmlFor="c-diag">Diagnostic</label>
        <textarea id="c-diag" className="champ" disabled={signee} value={c.diagnostic || ''} onChange={(e) => setC({ ...c, diagnostic: e.target.value })} /></div>

      <h3>Actes réalisés</h3>
      {actes.map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input className="champ" disabled={signee} value={a.libelle} onChange={(e) => setActes(actes.map((x, j) => j === i ? { ...x, libelle: e.target.value } : x))} />
          <input className="champ" style={{ width: 80 }} disabled={signee} value={a.quantite} onChange={(e) => setActes(actes.map((x, j) => j === i ? { ...x, quantite: e.target.value } : x))} />
          {!signee && <button type="button" className="btn" onClick={() => setActes(actes.filter((_, j) => j !== i))}>Retirer</button>}
        </div>
      ))}
      {!signee && <button type="button" className="btn" onClick={() => setActes([...actes, { libelle: '', quantite: 1 }])}>+ Ajouter un acte</button>}

      {!signee && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={enregistrer}>Enregistrer le brouillon</button>
          {estMedecin && <button type="button" className="btn btn-principal" onClick={signer}>Signer</button>}
        </div>
      )}
      {!signee && !estMedecin && (
        <p className="souligne">Seul le médecin peut signer la consultation.</p>
      )}

      {signee && (
        <div style={{ marginTop: 20 }}>
          <h3>Addendum</h3>
          <textarea className="champ" placeholder="Complément daté et signé" value={addendum} onChange={(e) => setAddendum(e.target.value)} />
          <button type="button" className="btn" onClick={envoyerAddendum} disabled={!addendum.trim()}>Ajouter l'addendum</button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Documents médicaux : émission (médecin) et PDF
// ---------------------------------------------------------------------
function Documents({ patientId, estMedecin, onErreur, onMessage }) {
  const [docs, setDocs] = useState([]);
  const [type, setType] = useState('ordonnance');
  const [lignes, setLignes] = useState([{ designation: '', posologie: '', duree: '', quantite: 1 }]);
  const [texte, setTexte] = useState('');

  const charger = useCallback(() => {
    apiClinique.getDocuments(patientId).then(setDocs).catch((err) => onErreur(err.message));
  }, [patientId, onErreur]);

  useEffect(() => { charger(); }, [charger]);

  async function emettre(e) {
    e.preventDefault();
    const contenu = type === 'ordonnance'
      ? { lignes: lignes.filter((l) => l.designation.trim()).map((l) => ({ ...l, quantite: Number(l.quantite) || 1 })) }
      : { texte };
    try {
      const doc = await apiClinique.emettreDocument(patientId, { type, contenu });
      onMessage(`Document ${doc.numero} émis.`);
      setLignes([{ designation: '', posologie: '', duree: '', quantite: 1 }]);
      setTexte('');
      charger();
    } catch (err) {
      onErreur(err.message);
    }
  }

  async function ouvrir(d) {
    try {
      await apiClinique.ouvrirPdfDocument(patientId, d.id);
    } catch (err) {
      onErreur(err.message);
    }
  }

  return (
    <section style={{ maxWidth: 640 }}>
      {estMedecin && (
        <form onSubmit={emettre} className="carte" style={{ marginBottom: 20 }}>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="type-doc">Type de document</label>
            <select id="type-doc" className="champ" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES_DOCUMENT.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>

          {type === 'ordonnance' ? (
            <>
              {lignes.map((l, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 80px', gap: 6, marginBottom: 6 }}>
                  <input className="champ" placeholder="Médicament" value={l.designation} onChange={(e) => setLignes(lignes.map((x, j) => j === i ? { ...x, designation: e.target.value } : x))} />
                  <input className="champ" placeholder="Posologie" value={l.posologie} onChange={(e) => setLignes(lignes.map((x, j) => j === i ? { ...x, posologie: e.target.value } : x))} />
                  <input className="champ" placeholder="Durée" value={l.duree} onChange={(e) => setLignes(lignes.map((x, j) => j === i ? { ...x, duree: e.target.value } : x))} />
                  <input className="champ" placeholder="Qté" value={l.quantite} onChange={(e) => setLignes(lignes.map((x, j) => j === i ? { ...x, quantite: e.target.value } : x))} />
                </div>
              ))}
              <button type="button" className="btn" onClick={() => setLignes([...lignes, { designation: '', posologie: '', duree: '', quantite: 1 }])}>+ Ligne</button>
            </>
          ) : (
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="texte-doc">Texte du document</label>
              <textarea id="texte-doc" className="champ" value={texte} onChange={(e) => setTexte(e.target.value)} />
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-principal">Émettre le document</button>
          </div>
        </form>
      )}

      {docs.length === 0 && <p className="souligne">Aucun document émis.</p>}
      <table className="tableau">
        <thead><tr><th>Numéro</th><th>Type</th><th>Date</th><th></th></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>{d.numero}</td>
              <td>{TYPES_DOCUMENT.find((t) => t.id === d.type)?.label || d.type}</td>
              <td>{new Date(d.created_at).toLocaleDateString('fr-FR')}</td>
              <td><button type="button" className="btn" onClick={() => ouvrir(d)}>PDF</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
