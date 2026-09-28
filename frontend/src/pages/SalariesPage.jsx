import { useEffect, useState } from 'react';
import { api } from '../api/client';

const METHODES = [
  { value: 'especes', label: 'Espèces' },
  { value: 'virement', label: 'Virement bancaire' },
  { value: 'wave', label: 'Wave' },
  { value: 'orange_money', label: 'Orange Money' },
];

function libelleMethode(value) {
  return METHODES.find((m) => m.value === value)?.label || value || '—';
}

const NOMS_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
function formatMois(moisStr) {
  const [annee, mois] = moisStr.split('-');
  return `${NOMS_MOIS[Number(mois) - 1]} ${annee}`;
}

export function SalariesPage() {
  const [mois, setMois] = useState(null);
  const [moisMax, setMoisMax] = useState(null);
  const [employes, setEmployes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const [employeConfig, setEmployeConfig] = useState(null);
  const [salaireSaisi, setSalaireSaisi] = useState('');
  const [methodeSaisie, setMethodeSaisie] = useState('especes');
  const [partsSaisies, setPartsSaisies] = useState('1');
  const [primesConfig, setPrimesConfig] = useState([]);

  // --- Primes fixes (page distincte du bouton "Configurer") ---
  const [employePrimesFixes, setEmployePrimesFixes] = useState(null);
  const [primesFixes, setPrimesFixes] = useState([]);

  const [employePaiement, setEmployePaiement] = useState(null);
  const [montantPaiement, setMontantPaiement] = useState('');
  const [methodePaiement, setMethodePaiement] = useState('especes');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const [paiementSourceNet, setPaiementSourceNet] = useState(false);
  const [employeBulletin, setEmployeBulletin] = useState(null);
  const [primes, setPrimes] = useState([]);
  const [bulletinCalcule, setBulletinCalcule] = useState(null);
  const [chargementBulletin, setChargementBulletin] = useState(false);

  // Le mois par défaut/maximal vient du serveur (pas de la date de l'appareil
  // de l'utilisateur) : on ne peut jamais consulter/payer un mois tant que
  // le mois en cours n'est pas entièrement soldé.
  useEffect(() => {
    api
      .getSalaryMaxMonth()
      .then((data) => {
        setMoisMax(data.maxMonth);
        setMois(data.maxMonth);
      })
      .catch((err) => setErreur(err.message));
  }, []);

  function charger() {
    if (!mois) return;
    setChargement(true);
    setErreur('');
    api
      .getSalaries(mois)
      .then((data) => setEmployes(data.employees))
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, [mois]);

  function ouvrirPrimesFixes(emp) {
    setEmployePrimesFixes(emp);
    setPrimesFixes(Array.isArray(emp.recurring_bonuses) ? emp.recurring_bonuses.map((p) => ({ label: p.label, amount: p.amount })) : []);
  }

  async function enregistrerPrimesFixes(e) {
    e.preventDefault();
    setEnvoiEnCours(true);
    setErreur('');
    try {
      await api.setSalary(employePrimesFixes.id, {
        monthlySalary: Number(employePrimesFixes.monthly_salary) || 0,
        paymentMethod: employePrimesFixes.payment_method || 'especes',
        partsFiscales: Number(employePrimesFixes.parts_fiscales) || 1,
        recurringBonuses: primesFixes
          .filter((p) => p.label && Number(p.amount))
          .map((p) => ({ label: p.label, amount: Number(p.amount) })),
      });
      setEmployePrimesFixes(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  function ouvrirConfig(emp) {
    setEmployeConfig(emp);
    setSalaireSaisi(emp.monthly_salary || '');
    setMethodeSaisie(emp.payment_method || 'especes');
    setPartsSaisies(String(emp.parts_fiscales || 1));
    setPrimesConfig(Array.isArray(emp.recurring_bonuses) ? emp.recurring_bonuses.map((p) => ({ label: p.label, amount: p.amount })) : []);
  }

  async function enregistrerConfig(e) {
    e.preventDefault();
    if (!salaireSaisi || Number(salaireSaisi) <= 0) {
      setErreur('Montant du salaire invalide.');
      return;
    }
    setEnvoiEnCours(true);
    try {
      await api.setSalary(employeConfig.id, {
        monthlySalary: Number(salaireSaisi),
        paymentMethod: methodeSaisie,
        partsFiscales: Number(partsSaisies) || 1,
        recurringBonuses: primesConfig
          .filter((p) => p.label && Number(p.amount))
          .map((p) => ({ label: p.label, amount: Number(p.amount) })),
      });
      setEmployeConfig(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function ouvrirPaiement(emp) {
    setEmployePaiement(emp);
    setMethodePaiement(emp.payment_method || 'especes');
    // Si un bulletin a déjà été généré pour ce mois, on propose le net calculé
    // plutôt que le brut — sinon on garde l'ancien comportement (brut libre).
    try {
      const bulletin = await api.getPayslip(emp.id, mois);
      setMontantPaiement(bulletin.net_a_payer);
      setPaiementSourceNet(true);
    } catch {
      setMontantPaiement(emp.monthly_salary || '');
      setPaiementSourceNet(false);
    }
  }

  async function ouvrirBulletin(emp) {
    setEmployeBulletin(emp);
    setBulletinCalcule(null);
    setChargementBulletin(true);
    try {
      const existantes = await api.getSalaryBonuses(emp.id, mois);
      if (existantes.length > 0) {
        setPrimes(existantes.map((p) => ({ label: p.label, amount: p.amount })));
      } else {
        // Rien de saisi pour ce mois : on reprend les primes/indemnités
        // configurées pour l'employé (bouton Configurer), sauf si un bulletin
        // existe déjà pour ce mois.
        let dejaGenere = false;
        try {
          await api.getPayslip(emp.id, mois);
          dejaGenere = true;
        } catch {
          dejaGenere = false;
        }
        const config = Array.isArray(emp.recurring_bonuses) ? emp.recurring_bonuses : [];
        setPrimes(dejaGenere ? [] : config.map((p) => ({ label: p.label, amount: p.amount })));
      }
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargementBulletin(false);
    }
  }

  function ajouterPrime() {
    setPrimes((p) => [...p, { label: '', amount: '' }]);
  }

  function modifierPrime(index, champ, valeur) {
    setPrimes((p) => p.map((prime, i) => (i === index ? { ...prime, [champ]: valeur } : prime)));
  }

  function retirerPrime(index) {
    setPrimes((p) => p.filter((_, i) => i !== index));
  }

  async function genererBulletin(e) {
    e.preventDefault();
    setEnvoiEnCours(true);
    setErreur('');
    try {
      const bonusesValides = primes
        .filter((p) => p.label && Number(p.amount))
        .map((p) => ({ label: p.label, amount: Number(p.amount) }));
      const resultat = await api.generatePayslip(employeBulletin.id, { month: mois, bonuses: bonusesValides });
      setBulletinCalcule(resultat);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function confirmerPaiement(e) {
    e.preventDefault();
    if (!montantPaiement || Number(montantPaiement) <= 0) {
      setErreur('Montant invalide.');
      return;
    }
    setEnvoiEnCours(true);
    try {
      await api.paySalary(employePaiement.id, {
        month: mois,
        amount: Number(montantPaiement),
        paymentMethod: methodePaiement,
      });
      setEmployePaiement(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  return (
    <>
      <div className="entete-page">
        <h1>Salaires</h1>
      </div>

      <div className="barre-filtres">
        <div className="champ-groupe" style={{ marginBottom: 0 }}>
          <label className="etiquette" htmlFor="mois-salaires">Mois</label>
          <input
            id="mois-salaires"
            type="month"
            className="champ"
            max={moisMax || undefined}
            value={mois || ''}
            onChange={(e) => setMois(e.target.value)}
          />
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : employes.length === 0 ? (
        <p className="etat-vide">Aucun employé actif.</p>
      ) : (
        <div className="liste-a-encaisser">
          {employes.map((emp) => {
            const paye = Boolean(emp.paid_at);
            return (
              <div key={emp.id} className="carte-a-encaisser">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className="carte-a-encaisser-numero">{emp.name}</p>
                  <p className="carte-a-encaisser-client">
                    {emp.role} · Salaire : {emp.monthly_salary ? `${Math.round(emp.monthly_salary).toLocaleString('fr-FR')} FCFA (${libelleMethode(emp.payment_method)})` : 'non configuré'}
                  </p>
                  {paye ? (
                    <p style={{ color: 'var(--succes, #1a7f37)', fontSize: 12, marginTop: 2 }}>
                      Payé le {new Date(emp.paid_at).toLocaleDateString('fr-FR')} — {Math.round(emp.paid_amount).toLocaleString('fr-FR')} FCFA via {libelleMethode(emp.paid_method)}
                    </p>
                  ) : (
                    <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 2 }}>
                      Non payé pour {formatMois(mois)}
                    </p>
                  )}
                </div>
                <button className="btn" onClick={() => ouvrirConfig(emp)}>Configurer</button>
                <button className="btn" onClick={() => ouvrirPrimesFixes(emp)}>Primes fixes</button>
                <button className="btn" disabled={!emp.monthly_salary} onClick={() => ouvrirBulletin(emp)}>
                  Bulletin
                </button>
                <button
                  className="btn btn-principal"
                  disabled={!emp.monthly_salary}
                  onClick={() => ouvrirPaiement(emp)}
                >
                  {paye ? 'Modifier le paiement' : 'Marquer comme payé'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {employeConfig && (
        <div className="modale-fond" onClick={() => setEmployeConfig(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Configurer le salaire — {employeConfig.name}</h2>
            <form onSubmit={enregistrerConfig}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="salaire-montant">Salaire mensuel (FCFA)</label>
                <input
                  id="salaire-montant"
                  type="number"
                  min="1"
                  className="champ"
                  value={salaireSaisi}
                  onChange={(e) => setSalaireSaisi(e.target.value)}
                  required
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="salaire-methode">Méthode de paiement</label>
                <select
                  id="salaire-methode"
                  className="champ"
                  value={methodeSaisie}
                  onChange={(e) => setMethodeSaisie(e.target.value)}
                >
                  {METHODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="salaire-parts">Parts fiscales (quotient familial)</label>
                <input
                  id="salaire-parts"
                  type="number"
                  min="1"
                  step="0.5"
                  className="champ"
                  value={partsSaisies}
                  onChange={(e) => setPartsSaisies(e.target.value)}
                />
                <p style={{ fontSize: 12, color: 'var(--encre-douce)', marginTop: 4 }}>
                  1 = célibataire sans enfant. Augmente selon la situation familiale déclarée par l'employé (mariage, enfants à charge…) — réduit l'impôt sur le revenu (IRPP) via le quotient familial.
                </p>
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setEmployeConfig(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={envoiEnCours}>Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {employePrimesFixes && (
        <div className="modale-fond" onClick={() => setEmployePrimesFixes(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Primes fixes — {employePrimesFixes.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
              Ces primes/indemnités sont reprises automatiquement à l'ouverture du bulletin de chaque mois. Modifie-les ici une fois pour toutes.
            </p>
            <form onSubmit={enregistrerPrimesFixes}>
              <div className="champ-groupe">
                {primesFixes.map((prime, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input
                      type="text"
                      className="champ"
                      placeholder="Libellé (ex. prime de transport)"
                      value={prime.label}
                      onChange={(e) => setPrimesFixes((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                      style={{ flex: 2 }}
                    />
                    <input
                      type="number"
                      className="champ"
                      placeholder="Montant"
                      value={prime.amount}
                      onChange={(e) => setPrimesFixes((l) => l.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn" onClick={() => setPrimesFixes((l) => l.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                <button type="button" className="btn" onClick={() => setPrimesFixes((l) => [...l, { label: '', amount: '' }])}>+ Ajouter une prime</button>
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setEmployePrimesFixes(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={envoiEnCours}>Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {employeBulletin && (
        <div className="modale-fond" onClick={() => setEmployeBulletin(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Bulletin de paie — {employeBulletin.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>{formatMois(mois)}</p>

            {chargementBulletin ? (
              <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
            ) : (
              <form onSubmit={genererBulletin}>
                <div className="champ-groupe">
                  <label className="etiquette">Primes / indemnités du mois</label>
                  {primes.map((prime, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <input
                        type="text"
                        className="champ"
                        placeholder="Libellé (ex. prime de transport)"
                        value={prime.label}
                        onChange={(e) => modifierPrime(i, 'label', e.target.value)}
                        style={{ flex: 2 }}
                      />
                      <input
                        type="number"
                        className="champ"
                        placeholder="Montant"
                        value={prime.amount}
                        onChange={(e) => modifierPrime(i, 'amount', e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button type="button" className="btn" onClick={() => retirerPrime(i)}>×</button>
                    </div>
                  ))}
                  <button type="button" className="btn" onClick={ajouterPrime}>+ Ajouter une prime</button>
                </div>

                <button type="submit" className="btn btn-principal" disabled={envoiEnCours} style={{ marginTop: 12 }}>
                  {envoiEnCours ? 'Calcul…' : 'Calculer et enregistrer le bulletin'}
                </button>
              </form>
            )}

            {bulletinCalcule && (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--bordure, #e5e5e5)' }}>
                <p className="carte-a-encaisser-client">Salaire brut : {Math.round(bulletinCalcule.gross_salary).toLocaleString('fr-FR')} FCFA</p>
                <p className="carte-a-encaisser-client">Retenues (IPRES, IRPP, TRIMF…) : {Math.round(bulletinCalcule.gross_salary - bulletinCalcule.net_a_payer).toLocaleString('fr-FR')} FCFA</p>
                <p className="carte-a-encaisser-client" style={{ fontWeight: 700 }}>
                  Net à payer : {Math.round(bulletinCalcule.net_a_payer).toLocaleString('fr-FR')} FCFA
                </p>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 10 }}
                  onClick={() => api.previewPayslipPdf(employeBulletin.id, mois).catch((err) => setErreur(err.message))}
                >
                  Voir / imprimer le PDF
                </button>
              </div>
            )}

            <div className="actions-modale">
              <button type="button" className="btn" onClick={() => setEmployeBulletin(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {employePaiement && (
        <div className="modale-fond" onClick={() => setEmployePaiement(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Paiement du salaire — {employePaiement.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
              {formatMois(mois)}
            </p>
            {paiementSourceNet ? (
              <p style={{ fontSize: 12, color: 'var(--succes, #1a7f37)', marginBottom: 12 }}>
                Montant proposé : net calculé depuis le bulletin de paie généré.
              </p>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>
                Aucun bulletin généré pour ce mois — montant proposé = salaire brut. Génère le bulletin d'abord pour proposer le net.
              </p>
            )}
            <form onSubmit={confirmerPaiement}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="paiement-montant">Montant versé (FCFA)</label>
                <input
                  id="paiement-montant"
                  type="number"
                  min="1"
                  className="champ"
                  value={montantPaiement}
                  onChange={(e) => setMontantPaiement(e.target.value)}
                  required
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="paiement-methode">Méthode de paiement</label>
                <select
                  id="paiement-methode"
                  className="champ"
                  value={methodePaiement}
                  onChange={(e) => setMethodePaiement(e.target.value)}
                >
                  {METHODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                {methodePaiement === 'virement' ? (
                  <p style={{ fontSize: 12, color: 'var(--encre-douce)', marginTop: 4 }}>
                    Le virement n'impacte pas la caisse, seulement le journal d'activité.
                  </p>
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--encre-douce)', marginTop: 4 }}>
                    Ce montant sera débité de la caisse {libelleMethode(methodePaiement)}.
                  </p>
                )}
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setEmployePaiement(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={envoiEnCours}>Confirmer le paiement</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
