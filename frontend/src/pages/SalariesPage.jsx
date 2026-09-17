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

function moisActuel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const NOMS_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
function formatMois(moisStr) {
  const [annee, mois] = moisStr.split('-');
  return `${NOMS_MOIS[Number(mois) - 1]} ${annee}`;
}

export function SalariesPage() {
  const [mois, setMois] = useState(moisActuel());
  const [employes, setEmployes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const [employeConfig, setEmployeConfig] = useState(null);
  const [salaireSaisi, setSalaireSaisi] = useState('');
  const [methodeSaisie, setMethodeSaisie] = useState('especes');

  const [employePaiement, setEmployePaiement] = useState(null);
  const [montantPaiement, setMontantPaiement] = useState('');
  const [methodePaiement, setMethodePaiement] = useState('especes');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  function charger() {
    setChargement(true);
    setErreur('');
    api
      .getSalaries(mois)
      .then((data) => setEmployes(data.employees))
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, [mois]);

  function ouvrirConfig(emp) {
    setEmployeConfig(emp);
    setSalaireSaisi(emp.monthly_salary || '');
    setMethodeSaisie(emp.payment_method || 'especes');
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
      });
      setEmployeConfig(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  function ouvrirPaiement(emp) {
    setEmployePaiement(emp);
    setMontantPaiement(emp.monthly_salary || '');
    setMethodePaiement(emp.payment_method || 'especes');
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
            value={mois}
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
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setEmployeConfig(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={envoiEnCours}>Enregistrer</button>
              </div>
            </form>
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
