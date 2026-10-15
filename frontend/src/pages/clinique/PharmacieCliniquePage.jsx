import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiClinique } from '../../api/clinique';

function dateCourte(d) {
  return new Date(d).toLocaleDateString('fr-FR');
}

export function PharmacieCliniquePage() {
  const { aRole } = useAuth();
  const peutEntrer = aRole('gerant', 'manager');
  const peutSortir = aRole('medecin', 'infirmier', 'sage_femme', 'gerant', 'manager');
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState('');
  const [stock, setStock] = useState({ produits: [], lotsProchesPeremption: [] });
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  const charger = useCallback(() => {
    if (!serviceId) return;
    apiClinique.getStockPharmacie(serviceId).then(setStock).catch((err) => setErreur(err.message));
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

  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(t);
  }, [message]);

  return (
    <div className="page-clinique">
      <h1>Pharmacie interne</h1>
      <div className="champ-groupe">
        <label className="etiquette" htmlFor="svc-pharma">Service</label>
        <select id="svc-pharma" className="champ" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {erreur && <div className="erreur">{erreur}</div>}
      {message && <div className="succes">{message}</div>}

      {stock.lotsProchesPeremption.length > 0 && (
        <div className="erreur">
          {stock.lotsProchesPeremption.length} lot(s) périment dans les 60 jours : {stock.lotsProchesPeremption.map((l) => `${l.product_name} (${dateCourte(l.expiry_date)})`).join(', ')}.
        </div>
      )}

      <h2>Stock du service</h2>
      {stock.produits.length === 0 && <p className="souligne">Aucun produit suivi en stock.</p>}
      <table className="tableau">
        <thead><tr><th>Produit</th><th>Quantité</th><th>Seuil</th><th>Remarques</th></tr></thead>
        <tbody>
          {stock.produits.map((p) => (
            <tr key={p.id} className={p.seuil_alerte !== null && Number(p.quantite) <= Number(p.seuil_alerte) ? 'ligne-urgence' : ''}>
              <td>{p.name}</td>
              <td>{Number(p.quantite)}</td>
              <td>{p.seuil_alerte ?? '—'}</td>
              <td>
                {p.requires_prescription && 'Sur ordonnance '}
                {p.is_vital && '· Vital'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {peutEntrer && (
        <EntreeStock produits={stock.produits} serviceId={serviceId} onErreur={setErreur} onMessage={setMessage} onFait={charger} />
      )}

      {peutSortir && (
        <>
          <SortieConsommable produits={stock.produits} serviceId={serviceId} onErreur={setErreur} onMessage={setMessage} onFait={charger} />
          <RemisePatient produits={stock.produits} serviceId={serviceId} onErreur={setErreur} onMessage={setMessage} onFait={charger} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Entrée de stock : un lot à la fois (gérant, manager)
// ---------------------------------------------------------------------
function EntreeStock({ produits, serviceId, onErreur, onMessage, onFait }) {
  const [ouvert, setOuvert] = useState(false);
  const [form, setForm] = useState({ productId: '', lotNumber: '', expiryDate: '', quantity: '' });

  async function enregistrer(e) {
    e.preventDefault();
    if (!form.productId || !(Number(form.quantity) > 0)) return onErreur('Produit et quantité positive requis.');
    try {
      await apiClinique.enregistrerEntreeStock({
        productId: form.productId,
        warehouseId: serviceId,
        lotNumber: form.lotNumber.trim() || undefined,
        expiryDate: form.expiryDate || undefined,
        quantity: Number(form.quantity),
      });
      onMessage('Entrée de stock enregistrée.');
      setForm({ productId: '', lotNumber: '', expiryDate: '', quantity: '' });
      setOuvert(false);
      onFait();
    } catch (err) {
      onErreur(err.message);
    }
  }

  if (!ouvert) return <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => setOuvert(true)}>+ Entrée de stock</button>;

  return (
    <form onSubmit={enregistrer} className="carte" style={{ marginTop: 16, maxWidth: 560 }}>
      <h2>Entrée de stock</h2>
      <div className="champ-groupe"><label className="etiquette" htmlFor="ent-prod">Produit</label>
        <select id="ent-prod" className="champ" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
          <option value="">Choisir</option>
          {produits.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <input className="champ" placeholder="N° de lot" value={form.lotNumber} onChange={(e) => setForm({ ...form, lotNumber: e.target.value })} />
        <input className="champ" type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
        <input className="champ" placeholder="Quantité" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
      </div>
      <button type="submit" className="btn btn-principal" style={{ marginTop: 8 }}>Enregistrer l'entrée</button>{' '}
      <button type="button" className="btn" onClick={() => setOuvert(false)}>Annuler</button>
    </form>
  );
}

// ---------------------------------------------------------------------
// Consommable utilisé en salle (sans patient)
// ---------------------------------------------------------------------
function SortieConsommable({ produits, serviceId, onErreur, onMessage, onFait }) {
  const [form, setForm] = useState({ productId: '', quantity: '1', motif: '' });

  async function sortir(e) {
    e.preventDefault();
    if (!form.productId || !(Number(form.quantity) > 0)) return onErreur('Produit et quantité positive requis.');
    try {
      await apiClinique.sortirConsommable({ productId: form.productId, warehouseId: serviceId, quantity: Number(form.quantity), motif: form.motif.trim() || undefined });
      onMessage('Consommable sorti du stock.');
      setForm({ productId: '', quantity: '1', motif: '' });
      onFait();
    } catch (err) {
      onErreur(err.message);
    }
  }

  return (
    <form onSubmit={sortir} className="carte" style={{ marginTop: 16, maxWidth: 560 }}>
      <h2>Consommable en salle</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: 6 }}>
        <select className="champ" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
          <option value="">Choisir</option>
          {produits.map((p) => <option key={p.id} value={p.id}>{p.name} ({Number(p.quantite)})</option>)}
        </select>
        <input className="champ" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        <input className="champ" placeholder="Motif (facultatif)" value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })} />
      </div>
      <button type="submit" className="btn" style={{ marginTop: 8 }}>Sortir du stock</button>
    </form>
  );
}

// ---------------------------------------------------------------------
// Remise d'un médicament à un patient. Médicament sur ordonnance : une ordonnance du patient est obligatoire.
// ---------------------------------------------------------------------
function RemisePatient({ produits, serviceId, onErreur, onMessage, onFait }) {
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState([]);
  const [patient, setPatient] = useState(null);
  const [ordonnances, setOrdonnances] = useState([]);
  const [form, setForm] = useState({ productId: '', quantity: '1', documentId: '', motif: '' });
  const produit = produits.find((p) => p.id === form.productId);

  useEffect(() => {
    if (q.trim().length < 2) { setResultats([]); return undefined; }
    const t = setTimeout(() => apiClinique.rechercherPatients(q.trim()).then(setResultats).catch((err) => onErreur(err.message)), 250);
    return () => clearTimeout(t);
  }, [q, onErreur]);

  useEffect(() => {
    if (!patient) { setOrdonnances([]); return; }
    apiClinique.getDocuments(patient.id)
      .then((docs) => setOrdonnances(docs.filter((d) => d.type === 'ordonnance')))
      .catch((err) => onErreur(err.message));
  }, [patient, onErreur]);

  async function remettre(e) {
    e.preventDefault();
    if (!patient) return onErreur('Choisissez le patient.');
    if (!form.productId || !(Number(form.quantity) > 0)) return onErreur('Produit et quantité positive requis.');
    if (produit?.requires_prescription && !form.documentId) return onErreur('Ce médicament exige une ordonnance du patient.');
    try {
      await apiClinique.dispenserAuPatient(patient.id, {
        productId: form.productId,
        warehouseId: serviceId,
        quantity: Number(form.quantity),
        documentId: form.documentId || undefined,
        motif: form.motif.trim() || undefined,
      });
      onMessage(`Remise enregistrée pour ${patient.full_name}.`);
      setForm({ productId: '', quantity: '1', documentId: '', motif: '' });
      onFait();
    } catch (err) {
      onErreur(err.message);
    }
  }

  return (
    <form onSubmit={remettre} className="carte" style={{ marginTop: 16, maxWidth: 560 }}>
      <h2>Remise à un patient</h2>
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

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 6, marginTop: 8 }}>
        <select className="champ" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value, documentId: '' })}>
          <option value="">Choisir le médicament</option>
          {produits.map((p) => <option key={p.id} value={p.id}>{p.name}{p.requires_prescription ? ' (sur ordonnance)' : ''}</option>)}
        </select>
        <input className="champ" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
      </div>

      {produit?.requires_prescription && (
        <div className="champ-groupe" style={{ marginTop: 8 }}>
          <label className="etiquette" htmlFor="ord-rem">Ordonnance</label>
          <select id="ord-rem" className="champ" value={form.documentId} onChange={(e) => setForm({ ...form, documentId: e.target.value })}>
            <option value="">Choisir l'ordonnance</option>
            {ordonnances.map((o) => <option key={o.id} value={o.id}>{o.numero} — {dateCourte(o.created_at)}</option>)}
          </select>
          {patient && ordonnances.length === 0 && <p className="souligne">Aucune ordonnance pour ce patient. Émettez-la depuis le dossier.</p>}
        </div>
      )}

      <button type="submit" className="btn btn-principal" style={{ marginTop: 8 }} disabled={!patient}>Remettre</button>
    </form>
  );
}
