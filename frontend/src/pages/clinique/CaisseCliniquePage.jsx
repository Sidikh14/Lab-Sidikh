import { useEffect, useState, useMemo } from 'react';
import { apiClinique } from '../../api/clinique';

const MOYENS = [
  { id: 'especes', label: 'Espèces' },
  { id: 'wave', label: 'Wave' },
  { id: 'orange_money', label: 'Orange Money' },
  { id: 'cheque', label: 'Chèque' },
  { id: 'virement', label: 'Virement' },
];

const LIGNE_VIDE = { productId: '', praticienId: '', quantity: 1 };

function formatMontant(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`;
}

export function CaisseCliniquePage() {
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState('');
  const [actes, setActes] = useState([]);
  const [praticiens, setPraticiens] = useState([]);

  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState([]);
  const [patient, setPatient] = useState(null);

  const [lignes, setLignes] = useState([{ ...LIGNE_VIDE }]);
  const [moyen, setMoyen] = useState('especes');
  const [recu, setRecu] = useState('');

  const [erreur, setErreur] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [enCours, setEnCours] = useState(false);

  // Chargement initial : services, actes et praticiens.
  useEffect(() => {
    Promise.all([apiClinique.getServices(), apiClinique.getActes(), apiClinique.getPraticiens()])
      .then(([svc, ac, pr]) => {
        const actifs = svc.filter((s) => s.is_active);
        setServices(actifs);
        if (actifs[0]) setServiceId(actifs[0].id);
        setActes(ac.filter((a) => a.is_active));
        setPraticiens(pr);
      })
      .catch((err) => setErreur(err.message));
  }, []);

  // Recherche de patient.
  useEffect(() => {
    if (q.trim().length < 2) { setResultats([]); return undefined; }
    const t = setTimeout(() => {
      apiClinique.rechercherPatients(q.trim()).then(setResultats).catch((err) => setErreur(err.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const actesParId = useMemo(() => new Map(actes.map((a) => [a.id, a])), [actes]);

  const total = useMemo(() => lignes.reduce((somme, l) => {
    const acte = actesParId.get(l.productId);
    return somme + (acte ? Number(acte.unit_price) * (Number(l.quantity) || 0) : 0);
  }, 0), [lignes, actesParId]);

  const monnaie = moyen === 'especes' && recu !== '' ? Math.max(0, Number(recu) - total) : null;

  function majLigne(i, champ, valeur) {
    setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, [champ]: valeur } : l)));
  }

  function reinitialiser() {
    setPatient(null);
    setQ('');
    setLignes([{ ...LIGNE_VIDE }]);
    setRecu('');
    setMoyen('especes');
  }

  async function encaisser() {
    setErreur('');
    setConfirmation(null);
    if (!patient) return setErreur('Choisissez le patient.');
    if (!serviceId) return setErreur('Choisissez le service.');
    const lignesValides = lignes.filter((l) => l.productId);
    if (lignesValides.length === 0) return setErreur('Ajoutez au moins un acte.');
    if (lignesValides.some((l) => !(Number(l.quantity) > 0))) return setErreur('Quantité invalide.');
    if (moyen === 'especes' && recu !== '' && Number(recu) < total) return setErreur('Montant reçu insuffisant.');

    setEnCours(true);
    try {
      // 1. Création de la vente : chaque ligne porte le praticien qui a réalisé l'acte.
      const vente = await apiClinique.creerVente({
        clientId: patient.id,
        warehouseId: serviceId,
        items: lignesValides.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          praticienId: l.praticienId || null,
        })),
      });
      // 2. Encaissement immédiat.
      await apiClinique.encaisserVente(vente.id, {
        paymentMethod: moyen,
        amountReceived: moyen === 'especes' && recu !== '' ? Number(recu) : total,
      });
      setConfirmation({ numero: vente.order_number || `#${vente.order_seq || ''}`, total, patient: patient.full_name });
      reinitialiser();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="page-clinique" style={{ maxWidth: 760 }}>
      <h1>Caisse</h1>

      {erreur && <div className="erreur">{erreur}</div>}
      {confirmation && (
        <div className="succes">
          Vente {confirmation.numero} encaissée : {formatMontant(confirmation.total)} pour {confirmation.patient}.
        </div>
      )}

      <div className="champ-groupe">
        <label className="etiquette" htmlFor="svc-caisse">Service</label>
        <select id="svc-caisse" className="champ" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <section className="carte" style={{ marginBottom: 16 }}>
        <h2>Patient</h2>
        {patient ? (
          <p>
            <strong>{patient.full_name}</strong>{' '}
            <button type="button" className="btn" onClick={() => setPatient(null)}>Changer</button>
          </p>
        ) : (
          <>
            <input className="champ" placeholder="Nom ou téléphone" value={q} onChange={(e) => setQ(e.target.value)} />
            <table className="tableau">
              <tbody>
                {resultats.map((p) => (
                  <tr key={p.id}>
                    <td>{p.full_name}</td>
                    <td>{p.phone || '—'}</td>
                    <td><button type="button" className="btn btn-principal" onClick={() => { setPatient(p); setQ(''); }}>Choisir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="carte" style={{ marginBottom: 16 }}>
        <h2>Actes</h2>
        {actes.length === 0 && (
          <p className="souligne">Aucun acte au catalogue. Le gérant les crée dans « Tarifs ».</p>
        )}
        {lignes.map((l, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 80px 110px', gap: 6, marginBottom: 6 }}>
            <select className="champ" value={l.productId} onChange={(e) => majLigne(i, 'productId', e.target.value)}>
              <option value="">Choisir un acte</option>
              {actes.map((a) => (
                <option key={a.id} value={a.id}>{a.name} — {formatMontant(a.unit_price)}</option>
              ))}
            </select>
            <select className="champ" value={l.praticienId} onChange={(e) => majLigne(i, 'praticienId', e.target.value)}>
              <option value="">Praticien (facultatif)</option>
              {praticiens.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
            <input className="champ" value={l.quantity} onChange={(e) => majLigne(i, 'quantity', e.target.value)} />
            <div style={{ textAlign: 'right', alignSelf: 'center' }}>
              {formatMontant((actesParId.get(l.productId)?.unit_price || 0) * (Number(l.quantity) || 0))}
            </div>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setLignes([...lignes, { ...LIGNE_VIDE }])}>+ Ajouter un acte</button>
      </section>

      <section className="carte" style={{ marginBottom: 16 }}>
        <h2>Paiement</h2>
        <div className="champ-groupe">
          <label className="etiquette" htmlFor="moyen">Moyen de paiement</label>
          <select id="moyen" className="champ" value={moyen} onChange={(e) => setMoyen(e.target.value)}>
            {MOYENS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        {moyen === 'especes' && (
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="recu">Montant reçu</label>
            <input id="recu" className="champ" value={recu} onChange={(e) => setRecu(e.target.value)} />
            {monnaie !== null && <p>Monnaie à rendre : <strong>{formatMontant(monnaie)}</strong></p>}
          </div>
        )}
        <p style={{ fontSize: '1.2em' }}>Total : <strong>{formatMontant(total)}</strong></p>
        <button type="button" className="btn btn-principal" onClick={encaisser} disabled={enCours || total <= 0}>
          {enCours ? 'Encaissement…' : 'Encaisser'}
        </button>
      </section>
    </div>
  );
}
