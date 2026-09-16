import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const MOYENS_PAIEMENT = [
  { value: 'especes', label: 'Espèces' },
  { value: 'wave', label: 'Wave' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'virement', label: 'Virement' },
];

function dateAujourdHui() {
  return new Date().toISOString().slice(0, 10);
}

function IconEspeces() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconTelephone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

export function CaissePage() {
  const { user } = useAuth();
  // Le caissier ne doit voir ni le solde théorique par moyen de paiement, ni
  // l'écart à la clôture : il saisit juste son solde réel compté et valide.
  // Tout le détail (théorique, écart) reste réservé à manager/gérant.
  const estCaissier = user?.role === 'caissier';

  const [onglet, setOnglet] = useState('cloture');
  const [erreur, setErreur] = useState('');

  // --- Soldes actuels par moyen de paiement (haut de page) ---
  const [soldes, setSoldes] = useState(null);
  const [chargementSoldes, setChargementSoldes] = useState(true);

  useEffect(() => {
    if (estCaissier) {
      setChargementSoldes(false);
      return;
    }
    api
      .getCashBalances()
      .then(setSoldes)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementSoldes(false));
  }, [estCaissier]);

  function soldeDe(method) {
    return soldes?.find((s) => s.method === method)?.balance ?? 0;
  }

  // --- Clôture du jour ---
  const [dateCloture, setDateCloture] = useState(dateAujourdHui());
  const [resume, setResume] = useState(null);
  const [chargementResume, setChargementResume] = useState(true);
  const [soldesReels, setSoldesReels] = useState({});
  const [enregistrementCloture, setEnregistrementCloture] = useState(false);

  function chargerResume() {
    setChargementResume(true);
    api
      .getCashSummary(dateCloture)
      .then((data) => {
        setResume(data);
        const initial = {};
        data.methods.forEach((m) => {
          initial[m.method] = m.closing ? String(m.closing.actual_balance) : '';
        });
        setSoldesReels(initial);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementResume(false));
  }

  useEffect(chargerResume, [dateCloture]);

  async function handleCloturer(e) {
    e.preventDefault();
    const entries = Object.entries(soldesReels)
      .filter(([, valeur]) => valeur !== '')
      .map(([paymentMethod, valeur]) => ({ paymentMethod, actualBalance: Number(valeur) }));

    if (entries.length === 0) {
      setErreur('Saisissez au moins un solde réel compté.');
      return;
    }

    setEnregistrementCloture(true);
    try {
      await api.createCashClosing({ date: dateCloture, entries });
      chargerResume();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementCloture(false);
    }
  }

  // --- Sorties de caisse ---
  const [nouvelleSortie, setNouvelleSortie] = useState({
    paymentMethod: 'especes',
    amount: '',
    reason: '',
    expenseDate: dateAujourdHui(),
  });
  const [sorties, setSorties] = useState([]);
  const [chargementSorties, setChargementSorties] = useState(true);
  const [enregistrementSortie, setEnregistrementSortie] = useState(false);
  const [periodeSorties, setPeriodeSorties] = useState({ from: dateAujourdHui(), to: dateAujourdHui() });

  function chargerSorties() {
    setChargementSorties(true);
    api
      .getCashExpenses(periodeSorties.from, periodeSorties.to)
      .then(setSorties)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementSorties(false));
  }

  useEffect(() => {
    if (onglet === 'sorties') chargerSorties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet, periodeSorties]);

  async function handleAjouterSortie(e) {
    e.preventDefault();
    if (!Number(nouvelleSortie.amount) || !nouvelleSortie.reason) {
      setErreur('Montant et motif sont requis.');
      return;
    }
    setEnregistrementSortie(true);
    try {
      await api.createCashExpense({
        ...nouvelleSortie,
        amount: Number(nouvelleSortie.amount),
      });
      setNouvelleSortie({ paymentMethod: 'especes', amount: '', reason: '', expenseDate: dateAujourdHui() });
      chargerSorties();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementSortie(false);
    }
  }

  // --- Relevés ---
  const [releveMoyen, setReleveMoyen] = useState('especes');
  const [periodeReleve, setPeriodeReleve] = useState({ from: dateAujourdHui(), to: dateAujourdHui() });
  const [mouvementsReleve, setMouvementsReleve] = useState([]);
  const [chargementReleve, setChargementReleve] = useState(false);

  function chargerReleve() {
    setChargementReleve(true);
    api
      .getCashMovements(releveMoyen, periodeReleve.from, periodeReleve.to)
      .then(setMouvementsReleve)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementReleve(false));
  }

  useEffect(() => {
    if (onglet === 'releves') chargerReleve();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet]);

  return (
    <>
      <div className="entete-page">
        <h1>Caisse</h1>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {!estCaissier && (
        <div className="ligne-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 24 }}>
          <div className="stat">
            <span className="stat-icone"><IconEspeces /></span>
            <span className="etiquette">Solde en caisse (espèces)</span>
            <span className="valeur">{chargementSoldes ? '…' : `${Math.round(soldeDe('especes')).toLocaleString('fr-FR')} FCFA`}</span>
          </div>
          <div className="stat">
            <span className="stat-icone"><IconTelephone /></span>
            <span className="etiquette">Solde Wave</span>
            <span className="valeur">{chargementSoldes ? '…' : `${Math.round(soldeDe('wave')).toLocaleString('fr-FR')} FCFA`}</span>
          </div>
          <div className="stat">
            <span className="stat-icone"><IconTelephone /></span>
            <span className="etiquette">Solde Orange Money</span>
            <span className="valeur">{chargementSoldes ? '…' : `${Math.round(soldeDe('orange_money')).toLocaleString('fr-FR')} FCFA`}</span>
          </div>
        </div>
      )}

      <div className="onglets" style={{ marginBottom: 20 }}>
        <button className={`onglet ${onglet === 'cloture' ? 'onglet-actif' : ''}`} onClick={() => setOnglet('cloture')}>
          Clôture du jour
        </button>
        <button className={`onglet ${onglet === 'sorties' ? 'onglet-actif' : ''}`} onClick={() => setOnglet('sorties')}>
          Sorties de caisse
        </button>
        <button className={`onglet ${onglet === 'releves' ? 'onglet-actif' : ''}`} onClick={() => setOnglet('releves')}>
          Relevés
        </button>
      </div>

      {onglet === 'cloture' && (
        <>
          <div className="champ-groupe" style={{ maxWidth: 220, marginBottom: 20 }}>
            <label className="etiquette" htmlFor="c-date">Date</label>
            <input id="c-date" type="date" className="champ" value={dateCloture} onChange={(e) => setDateCloture(e.target.value)} />
          </div>

          {chargementResume ? (
            <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
          ) : (
            <form onSubmit={handleCloturer}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                {resume.methods.map((m) => {
                  const soldeReel = soldesReels[m.method];
                  const ecart = !estCaissier && soldeReel !== '' && soldeReel !== undefined ? Number(soldeReel) - m.theoretical : null;
                  return (
                    <div
                      key={m.method}
                      style={{
                        border: '1px solid var(--trait)',
                        borderRadius: 'var(--rayon-petit)',
                        padding: 16,
                        display: 'grid',
                        gridTemplateColumns: estCaissier ? '1fr auto' : '1fr auto auto',
                        gap: 16,
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <p style={{ fontWeight: 600, marginBottom: 4 }}>{m.label}</p>
                        {!estCaissier && (
                          <>
                            <p style={{ fontSize: 12, color: 'var(--encre-douce)' }}>
                              Encaissements {Math.round(m.entrees).toLocaleString('fr-FR')} · Sorties {Math.round(m.sortiesTotal).toLocaleString('fr-FR')}
                            </p>
                            <p style={{ fontSize: 13, marginTop: 4 }}>
                              Solde théorique : <strong className="chiffre">{Math.round(m.theoretical).toLocaleString('fr-FR')} FCFA</strong>
                            </p>
                          </>
                        )}
                      </div>
                      <div style={{ width: 160 }}>
                        <label className="etiquette" htmlFor={`solde-${m.method}`}>Solde réel compté</label>
                        <input
                          id={`solde-${m.method}`}
                          type="number"
                          className="champ"
                          value={soldeReel ?? ''}
                          onChange={(e) => setSoldesReels({ ...soldesReels, [m.method]: e.target.value })}
                        />
                      </div>
                      {!estCaissier && (
                        <div style={{ width: 140, textAlign: 'right' }}>
                          {ecart !== null && (
                            <span
                              className={`tampon ${ecart === 0 ? 'tampon-sarcelle' : 'tampon-brique'}`}
                              title="Écart = réel - théorique"
                            >
                              {ecart === 0 ? 'Aucun écart' : `${ecart > 0 ? '+' : ''}${Math.round(ecart).toLocaleString('fr-FR')} FCFA`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button type="submit" className="btn btn-principal" disabled={enregistrementCloture}>
                {enregistrementCloture ? 'Enregistrement…' : 'Enregistrer la clôture'}
              </button>
            </form>
          )}
        </>
      )}

      {onglet === 'sorties' && (
        <>
          <div className="modale" style={{ maxWidth: 480, marginBottom: 24, padding: 20 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Nouvelle sortie de caisse</h2>
            <form onSubmit={handleAjouterSortie}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="s-moyen">Moyen de paiement</label>
                <select
                  id="s-moyen"
                  className="champ"
                  value={nouvelleSortie.paymentMethod}
                  onChange={(e) => setNouvelleSortie({ ...nouvelleSortie, paymentMethod: e.target.value })}
                >
                  {MOYENS_PAIEMENT.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="s-montant">Montant (FCFA)</label>
                <input
                  id="s-montant"
                  type="number"
                  className="champ"
                  value={nouvelleSortie.amount}
                  onChange={(e) => setNouvelleSortie({ ...nouvelleSortie, amount: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="s-motif">Motif</label>
                <input
                  id="s-motif"
                  className="champ"
                  placeholder="Ex : transport, loyer, imprévu…"
                  value={nouvelleSortie.reason}
                  onChange={(e) => setNouvelleSortie({ ...nouvelleSortie, reason: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="s-date">Date</label>
                <input
                  id="s-date"
                  type="date"
                  className="champ"
                  value={nouvelleSortie.expenseDate}
                  onChange={(e) => setNouvelleSortie({ ...nouvelleSortie, expenseDate: e.target.value })}
                />
              </div>
              <button type="submit" className="btn btn-principal" disabled={enregistrementSortie}>
                {enregistrementSortie ? 'Enregistrement…' : 'Enregistrer la sortie'}
              </button>
            </form>
          </div>

          <div className="barre-filtres" style={{ marginBottom: 16 }}>
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="sp-debut">Du</label>
              <input id="sp-debut" type="date" className="champ" value={periodeSorties.from} onChange={(e) => setPeriodeSorties({ ...periodeSorties, from: e.target.value })} />
            </div>
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="sp-fin">Au</label>
              <input id="sp-fin" type="date" className="champ" value={periodeSorties.to} onChange={(e) => setPeriodeSorties({ ...periodeSorties, to: e.target.value })} />
            </div>
          </div>

          {chargementSorties ? (
            <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
          ) : sorties.length === 0 ? (
            <p className="etat-vide">Aucune sortie de caisse sur cette période.</p>
          ) : (
            <table className="registre">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Motif</th>
                  <th>Moyen</th>
                  <th>Enregistré par</th>
                  <th>Montant</th>
                </tr>
              </thead>
              <tbody>
                {sorties.map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.expense_date).toLocaleDateString('fr-FR')}</td>
                    <td>{s.reason}</td>
                    <td>{MOYENS_PAIEMENT.find((m) => m.value === s.payment_method)?.label || s.payment_method}</td>
                    <td>{s.user_name}</td>
                    <td className="chiffre">{Math.round(s.amount).toLocaleString('fr-FR')} FCFA</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {onglet === 'releves' && (
        <>
          <div className="barre-filtres" style={{ marginBottom: 16 }}>
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="r-moyen">Moyen de paiement</label>
              <select id="r-moyen" className="champ" value={releveMoyen} onChange={(e) => setReleveMoyen(e.target.value)}>
                {MOYENS_PAIEMENT.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="rp-debut">Du</label>
              <input id="rp-debut" type="date" className="champ" value={periodeReleve.from} onChange={(e) => setPeriodeReleve({ ...periodeReleve, from: e.target.value })} />
            </div>
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="rp-fin">Au</label>
              <input id="rp-fin" type="date" className="champ" value={periodeReleve.to} onChange={(e) => setPeriodeReleve({ ...periodeReleve, to: e.target.value })} />
            </div>
            <button className="btn btn-principal" style={{ alignSelf: 'flex-end' }} onClick={chargerReleve}>
              Afficher
            </button>
            <button
              className="btn"
              style={{ alignSelf: 'flex-end' }}
              onClick={() => api.downloadCashMovementsPdf(releveMoyen, periodeReleve.from, periodeReleve.to).catch((err) => setErreur(err.message))}
            >
              Exporter PDF
            </button>
          </div>

          {chargementReleve ? (
            <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
          ) : mouvementsReleve.length === 0 ? (
            <p className="etat-vide">Aucun mouvement pour ce moyen de paiement sur cette période.</p>
          ) : (
            <table className="registre">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Mouvement</th>
                  <th>Montant</th>
                </tr>
              </thead>
              <tbody>
                {mouvementsReleve.map((m) => {
                  const montantSigne = m.sens === 'entree' ? Number(m.amount) : -Number(m.amount);
                  let libelle = '';
                  if (m.type === 'encaissement') {
                    const numero = m.order_seq ? `CMD-${new Date(m.order_created_at).getFullYear()}-${String(m.order_seq).padStart(4, '0')}` : '';
                    libelle = `Encaissement ${numero}${m.client_name ? ` — ${m.client_name}` : ''}`;
                  }
                  else if (m.type === 'reglement_credit') libelle = `Règlement créance${m.client_name ? ` — ${m.client_name}` : ''}`;
                  else if (m.type === 'achat_stock') libelle = `Achat stock — ${m.product_name}${m.supplier_name ? ` (${m.supplier_name})` : ''}`;
                  else if (m.type === 'reglement_fournisseur') libelle = `Règlement fournisseur — ${m.supplier_name}`;
                  else if (m.type === 'sortie') libelle = `Sortie de caisse — ${m.reason}`;
                  return (
                    <tr key={`${m.type}-${m.id}`}>
                      <td>{new Date(m.date).toLocaleDateString('fr-FR')}</td>
                      <td>{libelle}</td>
                      <td className="chiffre" style={{ color: montantSigne < 0 ? 'var(--danger, #b3423a)' : undefined }}>
                        {montantSigne >= 0 ? '+' : ''}{Math.round(montantSigne).toLocaleString('fr-FR')} FCFA
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
