import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiClinique } from '../../api/clinique';

const TAILLE_MAX = 1572864; // 1,5 Mo, comme côté serveur
const TYPES_ACCEPTES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const LIGNE_VIDE = { parametre: '', valeur: '', unite: '', reference: '' };

export function LaboratoireCliniquePage() {
  const { aRole } = useAuth();
  const estLaborantin = aRole('laborantin');
  const estMedecin = aRole('medecin');
  const [type, setType] = useState('laboratoire');
  const [liste, setListe] = useState([]);
  const [selection, setSelection] = useState(null);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  const charger = useCallback(() => {
    apiClinique.getExamensATraiter(type).then(setListe).catch((err) => setErreur(err.message));
  }, [type]);

  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(t);
  }, [message]);

  return (
    <div className="page-clinique">
      <h1>Laboratoire et imagerie</h1>
      {erreur && <div className="erreur">{erreur}</div>}
      {message && <div className="succes">{message}</div>}

      <nav className="onglets">
        {[{ id: 'laboratoire', label: 'Laboratoire' }, { id: 'imagerie', label: 'Imagerie' }].map((o) => (
          <button key={o.id} type="button" className={'onglet' + (type === o.id ? ' actif' : '')} onClick={() => { setType(o.id); setSelection(null); }}>
            {o.label}
          </button>
        ))}
      </nav>

      {estMedecin && <NouvelleDemande type={type} onErreur={setErreur} onMessage={setMessage} onCree={charger} />}

      <h2>À traiter</h2>
      {liste.length === 0 && <p className="souligne">Aucun examen en attente.</p>}
      <table className="tableau">
        <thead><tr><th>Patient</th><th>Examen</th><th>Demandé le</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          {liste.map((r) => (
            <tr key={r.id}>
              <td>{r.patient_name}</td>
              <td>{r.libelle}</td>
              <td>{new Date(r.created_at).toLocaleDateString('fr-FR')}</td>
              <td>{r.statut_resultat ? (r.statut_resultat === 'saisi' ? 'Saisi, à valider' : r.statut_resultat) : 'À saisir'}</td>
              <td><button type="button" className="btn btn-principal" onClick={() => setSelection(r)}>Ouvrir</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      {selection && (
        <Resultat
          demande={selection}
          estLaborantin={estLaborantin}
          estMedecin={estMedecin}
          onFermer={() => { setSelection(null); charger(); }}
          onErreur={setErreur}
          onMessage={setMessage}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Demande d'examen (médecin) : choix du patient, de l'examen
// ---------------------------------------------------------------------
function NouvelleDemande({ type, onErreur, onMessage, onCree }) {
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState([]);
  const [patient, setPatient] = useState(null);
  const [libelle, setLibelle] = useState('');
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setResultats([]); return undefined; }
    const t = setTimeout(() => apiClinique.rechercherPatients(q.trim()).then(setResultats).catch((err) => onErreur(err.message)), 250);
    return () => clearTimeout(t);
  }, [q, onErreur]);

  async function demander(e) {
    e.preventDefault();
    if (!patient || !libelle.trim()) return onErreur('Patient et examen requis.');
    try {
      await apiClinique.demanderExamen(patient.id, { type, libelle: libelle.trim() });
      onMessage(`Demande « ${libelle.trim()} » enregistrée pour ${patient.full_name}.`);
      setPatient(null); setLibelle(''); setQ(''); setOuvert(false);
      onCree();
    } catch (err) {
      onErreur(err.message);
    }
  }

  if (!ouvert) {
    return <button type="button" className="btn" onClick={() => setOuvert(true)}>+ Nouvelle demande d'examen</button>;
  }

  return (
    <form onSubmit={demander} className="carte" style={{ marginBottom: 16 }}>
      <h2>Nouvelle demande</h2>
      {patient ? (
        <p>Patient : <strong>{patient.full_name}</strong> <button type="button" className="btn" onClick={() => setPatient(null)}>Changer</button></p>
      ) : (
        <>
          <input className="champ" placeholder="Nom ou téléphone du patient" value={q} onChange={(e) => setQ(e.target.value)} />
          <table className="tableau"><tbody>
            {resultats.map((p) => (
              <tr key={p.id}>
                <td>{p.full_name}</td>
                <td><button type="button" className="btn" onClick={() => { setPatient(p); setQ(''); }}>Choisir</button></td>
              </tr>
            ))}
          </tbody></table>
        </>
      )}
      <div className="champ-groupe">
        <label className="etiquette" htmlFor="libelle-examen">Examen demandé</label>
        <input id="libelle-examen" className="champ" placeholder={type === 'imagerie' ? 'Ex. Échographie abdominale' : 'Ex. Numération formule sanguine'} value={libelle} onChange={(e) => setLibelle(e.target.value)} />
      </div>
      <button type="submit" className="btn btn-principal">Enregistrer la demande</button>{' '}
      <button type="button" className="btn" onClick={() => setOuvert(false)}>Annuler</button>
    </form>
  );
}

// ---------------------------------------------------------------------
// Résultat : saisie (laborantin), validation et publication (médecin), pièces jointes
// ---------------------------------------------------------------------
function Resultat({ demande, estLaborantin, estMedecin, onFermer, onErreur, onMessage }) {
  const [lignes, setLignes] = useState([{ ...LIGNE_VIDE }]);
  const [interpretation, setInterpretation] = useState('');
  const [statut, setStatut] = useState(demande.statut_resultat || null);
  const chargement = false;

  function majLigne(i, champ, valeur) {
    setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, [champ]: valeur } : l)));
  }

  async function enregistrer() {
    const valides = lignes.filter((l) => l.parametre.trim() && String(l.valeur).trim());
    if (valides.length === 0) return onErreur('Saisissez au moins un paramètre avec sa valeur.');
    try {
      if (statut) {
        await apiClinique.corrigerResultat(demande.id, { valeurs: valides, interpretation });
      } else {
        await apiClinique.saisirResultat(demande.id, { valeurs: valides, interpretation });
        setStatut('saisi');
      }
      onMessage('Résultat enregistré.');
    } catch (err) {
      onErreur(err.message);
    }
  }

  async function valider() {
    if (!window.confirm('Valider ce résultat ? Son contenu ne pourra plus être modifié.')) return;
    try {
      await apiClinique.validerResultat(demande.id);
      setStatut('valide');
      onMessage('Résultat validé.');
    } catch (err) {
      onErreur(err.message);
    }
  }

  async function publier() {
    if (!window.confirm('Publier ce résultat sur le portail du patient ?')) return;
    try {
      await apiClinique.publierResultat(demande.id);
      setStatut('publie');
      onMessage('Résultat publié sur le portail.');
    } catch (err) {
      onErreur(err.message);
    }
  }

  const modifiable = !statut || statut === 'saisi';

  return (
    <section className="carte" style={{ marginTop: 20, maxWidth: 720 }}>
      <button type="button" className="btn" onClick={onFermer}>← Retour à la liste</button>
      <h2>{demande.libelle} — {demande.patient_name}</h2>
      <p>Statut : <strong>{statut ? { saisi: 'Saisi', valide: 'Validé', publie: 'Publié' }[statut] : 'À saisir'}</strong></p>

      {estLaborantin && modifiable && (
        <>
          {lignes.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr', gap: 6, marginBottom: 6 }}>
              <input className="champ" placeholder="Paramètre" value={l.parametre} onChange={(e) => majLigne(i, 'parametre', e.target.value)} />
              <input className="champ" placeholder="Valeur" value={l.valeur} onChange={(e) => majLigne(i, 'valeur', e.target.value)} />
              <input className="champ" placeholder="Unité" value={l.unite} onChange={(e) => majLigne(i, 'unite', e.target.value)} />
              <input className="champ" placeholder="Valeurs de référence" value={l.reference} onChange={(e) => majLigne(i, 'reference', e.target.value)} />
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setLignes([...lignes, { ...LIGNE_VIDE }])}>+ Paramètre</button>
          <div className="champ-groupe" style={{ marginTop: 10 }}>
            <label className="etiquette" htmlFor="interp">Commentaire</label>
            <textarea id="interp" className="champ" value={interpretation} onChange={(e) => setInterpretation(e.target.value)} />
          </div>
          <button type="button" className="btn btn-principal" onClick={enregistrer}>Enregistrer le résultat</button>
        </>
      )}

      {estMedecin && statut === 'saisi' && (
        <button type="button" className="btn btn-principal" onClick={valider}>Valider le résultat</button>
      )}
      {estMedecin && statut === 'valide' && (
        <button type="button" className="btn btn-principal" onClick={publier}>Publier sur le portail</button>
      )}
      {statut === 'publie' && <p className="souligne">Visible du patient sur son portail.</p>}

      <PiecesJointes patientId={demande.patient_id} demandeId={demande.id} onErreur={onErreur} onMessage={onMessage} />
    </section>
  );
}

// ---------------------------------------------------------------------
// Pièces jointes : envoi en base64, contrôle de taille et de type côté client
// ---------------------------------------------------------------------
function PiecesJointes({ patientId, demandeId, onErreur, onMessage }) {
  const [fichiers, setFichiers] = useState([]);

  useEffect(() => {
    if (!patientId) return;
    apiClinique.getPiecesJointes(patientId).then(setFichiers).catch(() => {});
  }, [patientId]);

  async function ajouter(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !patientId) return;
    if (!TYPES_ACCEPTES.includes(f.type)) return onErreur('Format accepté : PDF, JPEG, PNG ou WebP.');
    if (f.size > TAILLE_MAX) return onErreur('Fichier trop volumineux : 1,5 Mo maximum.');
    try {
      const base64 = await new Promise((resolve, reject) => {
        const lecteur = new FileReader();
        lecteur.onload = () => resolve(String(lecteur.result).split(',')[1]);
        lecteur.onerror = () => reject(new Error('Lecture du fichier impossible.'));
        lecteur.readAsDataURL(f);
      });
      const piece = await apiClinique.ajouterPieceJointe(patientId, { fileName: f.name, contenuBase64: base64, requestId: demandeId });
      setFichiers((liste) => [piece, ...liste]);
      onMessage('Pièce jointe ajoutée.');
    } catch (err) {
      onErreur(err.message);
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <h3>Pièces jointes</h3>
      <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={ajouter} disabled={!patientId} />
      {!patientId && <p className="souligne">Les pièces jointes sont disponibles depuis le dossier du patient.</p>}
      <ul>
        {fichiers.map((p) => (
          <li key={p.id}>
            {p.file_name} ({Math.round(p.taille_octets / 1024)} Ko){' '}
            <button type="button" className="btn" onClick={() => apiClinique.ouvrirPieceJointe(patientId, p.id).catch((err) => onErreur(err.message))}>Ouvrir</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
