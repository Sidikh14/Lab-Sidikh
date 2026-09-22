import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLiveEvent } from '../offline/liveEvents';

const MOYENS_PAIEMENT = [
  { value: 'especes', label: 'Espèces' },
  { value: 'wave', label: 'Wave' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'cheque', label: 'Chèque' },
];

// Pour le relevé uniquement : en plus d'un moyen de paiement précis, on
// peut choisir "Tous" pour voir toutes les transactions de la période
// confondues.
const MOYENS_PAIEMENT_RELEVE = [{ value: 'tous', label: 'Tous les moyens' }, ...MOYENS_PAIEMENT];

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
  const estManager = user?.role === 'manager';

  const [onglet, setOnglet] = useState('cloture');
  const [erreur, setErreur] = useState('');

  // Boutique active — même sélecteur et même clé localStorage que les
  // autres pages ; les rôles assignés utilisent directement la leur.
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState(() => (estManager ? localStorage.getItem('boutiqueActiveId') || '' : ''));
  const [chargementBoutiques, setChargementBoutiques] = useState(estManager);
  const activeWarehouseId = estManager ? warehouseId : user?.warehouseId;

  useEffect(() => {
    if (!estManager) return;
    api.getWarehouses()
      .then((liste) => {
        setWarehouses(liste);
        const actives = liste.filter((w) => w.is_active);
        setWarehouseId((avant) => {
          if (avant && actives.some((w) => w.id === avant)) return avant;
          return actives[0]?.id || '';
        });
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementBoutiques(false));
  }, [estManager]);

  useEffect(() => {
    if (estManager && warehouseId) localStorage.setItem('boutiqueActiveId', warehouseId);
  }, [estManager, warehouseId]);

  // --- Rafraîchissement temps réel ---
  // Toute vente encaissée, sortie/entrée de caisse ou clôture ailleurs (même
  // par un autre membre de l'équipe) déclenche activity:created en SSE.
  // On rafraîchit l'onglet actif plutôt que de laisser des chiffres périmés
  // à l'écran, comme le font déjà le Dashboard et Ventes & caisse.
  const [refreshKey, setRefreshKey] = useState(0);
  useLiveEvent('activity:created', () => setRefreshKey((k) => k + 1));

  // --- Soldes actuels par moyen de paiement (haut de page) ---
  const [soldes, setSoldes] = useState(null);
  const [chargementSoldes, setChargementSoldes] = useState(true);

  useEffect(() => {
    if (estCaissier) {
      setChargementSoldes(false);
      return;
    }
    if (!activeWarehouseId) return;
    api
      .getCashBalances(activeWarehouseId)
      .then(setSoldes)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementSoldes(false));
  }, [estCaissier, activeWarehouseId, refreshKey]);

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
    if (!activeWarehouseId) return;
    setChargementResume(true);
    api
      .getCashSummary(dateCloture, activeWarehouseId)
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

  useEffect(chargerResume, [dateCloture, activeWarehouseId, refreshKey]);

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
      await api.createCashClosing({ date: dateCloture, entries, warehouseId: activeWarehouseId });
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
    if (!activeWarehouseId) return;
    setChargementSorties(true);
    api
      .getCashExpenses(periodeSorties.from, periodeSorties.to, undefined, activeWarehouseId)
      .then(setSorties)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementSorties(false));
  }

  useEffect(() => {
    if (onglet === 'sorties') chargerSorties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet, periodeSorties, activeWarehouseId, refreshKey]);

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
        warehouseId: activeWarehouseId,
      });
      setNouvelleSortie({ paymentMethod: 'especes', amount: '', reason: '', expenseDate: dateAujourdHui() });
      chargerSorties();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementSortie(false);
    }
  }

  // --- Entrées de caisse (symétrique des sorties) ---
  const [nouvelleEntree, setNouvelleEntree] = useState({
    paymentMethod: 'especes',
    amount: '',
    reason: '',
    expenseDate: dateAujourdHui(),
  });
  const [entrees, setEntrees] = useState([]);
  const [chargementEntrees, setChargementEntrees] = useState(true);
  const [enregistrementEntree, setEnregistrementEntree] = useState(false);
  const [periodeEntrees, setPeriodeEntrees] = useState({ from: dateAujourdHui(), to: dateAujourdHui() });

  function chargerEntrees() {
    if (!activeWarehouseId) return;
    setChargementEntrees(true);
    api
      .getCashDeposits(periodeEntrees.from, periodeEntrees.to, undefined, activeWarehouseId)
      .then(setEntrees)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementEntrees(false));
  }

  useEffect(() => {
    if (onglet === 'entrees') chargerEntrees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet, periodeEntrees, activeWarehouseId, refreshKey]);

  async function handleAjouterEntree(e) {
    e.preventDefault();
    if (!Number(nouvelleEntree.amount) || !nouvelleEntree.reason) {
      setErreur('Montant et motif sont requis.');
      return;
    }
    setEnregistrementEntree(true);
    try {
      await api.createCashDeposit({
        ...nouvelleEntree,
        amount: Number(nouvelleEntree.amount),
        warehouseId: activeWarehouseId,
      });
      setNouvelleEntree({ paymentMethod: 'especes', amount: '', reason: '', expenseDate: dateAujourdHui() });
      chargerEntrees();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementEntree(false);
    }
  }

  // --- Relevés ---
  const [releveMoyen, setReleveMoyen] = useState('especes');
  const [releveCaissier, setReleveCaissier] = useState('tous');
  const [periodeReleve, setPeriodeReleve] = useState({ from: dateAujourdHui(), to: dateAujourdHui() });
  const [mouvementsReleve, setMouvementsReleve] = useState([]);
  const [chargementReleve, setChargementReleve] = useState(false);
  const [caissiers, setCaissiers] = useState([]);

  function chargerReleve() {
    if (!activeWarehouseId) return;
    setChargementReleve(true);
    api
      .getCashMovements(releveMoyen, periodeReleve.from, periodeReleve.to, releveCaissier, activeWarehouseId)
      .then(setMouvementsReleve)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementReleve(false));
  }

  useEffect(() => {
    if (onglet === 'releves') chargerReleve();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet, releveCaissier, activeWarehouseId, refreshKey]);

  useEffect(() => {
    if (onglet === 'releves' && activeWarehouseId) {
      api.getCashCashiers(activeWarehouseId).then(setCaissiers).catch((err) => setErreur(err.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet, activeWarehouseId]);

  return (
    <>
      <div className="entete-page">
        <h1>Caisse</h1>
        {estManager && warehouses.length > 0 && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px 5px 11px',
              borderRadius: 999,
              border: '1px solid var(--trait)',
              background: 'var(--accent-clair)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M3 9l1.5-5h15L21 9" />
              <path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
              <path d="M9 20v-6h6v6" />
            </svg>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--accent)',
                outline: 'none',
                cursor: 'pointer',
                appearance: 'none',
                WebkitAppearance: 'none',
                padding: 0,
                maxWidth: 130,
              }}
            >
              {warehouses.filter((w) => w.is_active).map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {estManager && !chargementBoutiques && warehouses.length === 0 && (
        <p className="etat-vide">Aucune boutique n'a encore été créée. Créez-en une avant de gérer la caisse.</p>
      )}

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
        <button className={`onglet ${onglet === 'entrees' ? 'onglet-actif' : ''}`} onClick={() => setOnglet('entrees')}>
          Entrées de caisse
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
          ) : !resume ? (
            <p style={{ color: 'var(--encre-douce)' }}>Aucune donnée pour cette date.</p>
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

      {onglet === 'entrees' && (
        <>
          <div className="modale" style={{ maxWidth: 480, marginBottom: 24, padding: 20 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Nouvelle entrée de caisse</h2>
            <form onSubmit={handleAjouterEntree}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="e-moyen">Moyen de paiement</label>
                <select
                  id="e-moyen"
                  className="champ"
                  value={nouvelleEntree.paymentMethod}
                  onChange={(e) => setNouvelleEntree({ ...nouvelleEntree, paymentMethod: e.target.value })}
                >
                  {MOYENS_PAIEMENT.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="e-montant">Montant (FCFA)</label>
                <input
                  id="e-montant"
                  type="number"
                  className="champ"
                  value={nouvelleEntree.amount}
                  onChange={(e) => setNouvelleEntree({ ...nouvelleEntree, amount: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="e-motif">Motif</label>
                <input
                  id="e-motif"
                  className="champ"
                  placeholder="Ex : chèque encaissé à la banque, apport…"
                  value={nouvelleEntree.reason}
                  onChange={(e) => setNouvelleEntree({ ...nouvelleEntree, reason: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="e-date">Date</label>
                <input
                  id="e-date"
                  type="date"
                  className="champ"
                  value={nouvelleEntree.expenseDate}
                  onChange={(e) => setNouvelleEntree({ ...nouvelleEntree, expenseDate: e.target.value })}
                />
              </div>
              <button type="submit" className="btn btn-principal" disabled={enregistrementEntree}>
                {enregistrementEntree ? 'Enregistrement…' : "Enregistrer l'entrée"}
              </button>
            </form>
          </div>

          <div className="barre-filtres" style={{ marginBottom: 16 }}>
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="ep-debut">Du</label>
              <input id="ep-debut" type="date" className="champ" value={periodeEntrees.from} onChange={(e) => setPeriodeEntrees({ ...periodeEntrees, from: e.target.value })} />
            </div>
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="ep-fin">Au</label>
              <input id="ep-fin" type="date" className="champ" value={periodeEntrees.to} onChange={(e) => setPeriodeEntrees({ ...periodeEntrees, to: e.target.value })} />
            </div>
          </div>

          {chargementEntrees ? (
            <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
          ) : entrees.length === 0 ? (
            <p className="etat-vide">Aucune entrée de caisse sur cette période.</p>
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
                {entrees.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.expense_date).toLocaleDateString('fr-FR')}</td>
                    <td>{e.reason}</td>
                    <td>{MOYENS_PAIEMENT.find((m) => m.value === e.payment_method)?.label || e.payment_method}</td>
                    <td>{e.user_name}</td>
                    <td className="chiffre">{Math.round(e.amount).toLocaleString('fr-FR')} FCFA</td>
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
                {MOYENS_PAIEMENT_RELEVE.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="r-caissier">Par caissier</label>
              <select id="r-caissier" className="champ" value={releveCaissier} onChange={(e) => setReleveCaissier(e.target.value)}>
                <option value="tous">Tous les membres</option>
                {caissiers.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
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
              onClick={() => api.downloadCashMovementsPdf(releveMoyen, periodeReleve.from, periodeReleve.to, releveCaissier, activeWarehouseId).catch((err) => setErreur(err.message))}
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
                  {releveMoyen === 'tous' && <th>Moyen</th>}
                  <th>Par</th>
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
                  else if (m.type === 'entree_manuelle') libelle = `Entrée de caisse — ${m.reason}`;
                  return (
                    <tr key={`${m.type}-${m.id}`}>
                      <td>{new Date(m.date).toLocaleDateString('fr-FR')}</td>
                      <td>{libelle}</td>
                      {releveMoyen === 'tous' && (
                        <td>{MOYENS_PAIEMENT.find((mp) => mp.value === m.payment_method)?.label || m.payment_method || '—'}</td>
                      )}
                      <td>{m.user_name || '—'}</td>
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
