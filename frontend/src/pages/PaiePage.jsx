import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useModulesAccess } from '../hooks/useModulesAccess';
import { StylesModernes } from '../components/StylesModernes';
import { PageModuleNonActive } from '../components/ModuleNonActive';
import { ImpotsTab } from './ComptabilitePage';
import { ActionsMois, AlertesPaie, EmployesTab, AbsencesHeuresTab, AvancesTab, DocumentsRhTab, EtatsTab, ReglagesPeriodeSection } from './PaiePlus';

const TYPES_RETENUE = [
  { value: 'avance', label: 'Avance sur salaire', court: 'Avance' },
  { value: 'absence', label: 'Absence non rémunérée', court: 'Absence' },
  { value: 'pret', label: 'Remboursement de prêt', court: 'Prêt' },
  { value: 'autre', label: 'Autre retenue', court: 'Autre retenue' },
];
const PRIMES_SUGGEREES = ['Transport', 'Logement', 'Ancienneté', 'Rendement', 'Panier'];

const METHODES = [
  { value: 'especes', label: 'Espèces' },
  { value: 'virement', label: 'Virement bancaire' },
  { value: 'wave', label: 'Wave' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'cheque', label: 'Chèque' },
];

function libelleMethode(value) {
  return METHODES.find((m) => m.value === value)?.label || value || '—';
}

const NOMS_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
function formatMois(moisStr) {
  const [annee, mois] = moisStr.split('-');
  return `${NOMS_MOIS[Number(mois) - 1]} ${annee}`;
}

function initialesMembre(nom) {
  return (nom || '?').split(' ').filter(Boolean).map((mot) => mot[0]).slice(0, 2).join('').toUpperCase();
}

function IconEquipe() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 19c0-3.6 2.9-5.8 6.5-5.8s6.5 2.2 6.5 5.8" />
      <path d="M16 8.4a3 3 0 1 1 3.6 2.9" />
      <path d="M21.5 19c0-2.7-1.7-4.6-4-5.4" />
    </svg>
  );
}

function IconCadenas() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function SalairesTab() {
  const [, setSearchParams] = useSearchParams();
  const [mois, setMois] = useState(null);
  const [moisMax, setMoisMax] = useState(null);
  const [employes, setEmployes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  // Fiche de paie : salaire de base + primes + retenues + récapitulatif.
  const [employeBulletin, setEmployeBulletin] = useState(null);
  const [salaireSaisi, setSalaireSaisi] = useState('');
  const [methodeSaisie, setMethodeSaisie] = useState('especes');
  const [partsSaisies, setPartsSaisies] = useState(1);
  const [ipresSaisi, setIpresSaisi] = useState(false);
  const [cssSaisi, setCssSaisi] = useState(false);
  const [primes, setPrimes] = useState([]); // { label, amount, fixe }
  const [retenues, setRetenues] = useState([]); // { type, label, amount }
  const [bulletinCalcule, setBulletinCalcule] = useState(null);
  const [ficheModifiee, setFicheModifiee] = useState(false);
  const [chargementBulletin, setChargementBulletin] = useState(false);

  const [employePaiement, setEmployePaiement] = useState(null);
  const [rectifier, setRectifier] = useState(false);
  const [motifRectif, setMotifRectif] = useState('');
  const [montantPaiement, setMontantPaiement] = useState('');
  const [methodePaiement, setMethodePaiement] = useState('especes');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [envoiBulletinsEnCours, setEnvoiBulletinsEnCours] = useState(false);
  const [resultatEnvoiBulletins, setResultatEnvoiBulletins] = useState(null);

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

  function ouvrirPaiement(emp) {
    setEmployePaiement(emp);
    setMethodePaiement(emp.payment_method || 'especes');
    setMontantPaiement(emp.payslip_net);
  }

  async function ouvrirBulletin(emp) {
    setEmployeBulletin(emp);
    setBulletinCalcule(null);
    setRectifier(false);
    setMotifRectif('');
    setFicheModifiee(false);
    setErreur('');
    setSalaireSaisi(emp.monthly_salary ? Math.round(Number(emp.monthly_salary)) : '');
    setMethodeSaisie(emp.payment_method || 'especes');
    setPartsSaisies(emp.parts_fiscales || 1);
    setIpresSaisi(emp.ipres_enabled === true);
    setCssSaisi(emp.css_enabled === true);
    setPrimes([]);
    setRetenues([]);
    setChargementBulletin(true);
    try {
      const fixes = Array.isArray(emp.recurring_bonuses) ? emp.recurring_bonuses : [];
      const [primesMois, retenuesMois] = await Promise.all([
        api.getSalaryBonuses(emp.id, mois),
        api.getSalaryDeductions(emp.id, mois),
      ]);
      let bulletinExistant = null;
      try {
        bulletinExistant = await api.getPayslip(emp.id, mois);
      } catch {
        bulletinExistant = null;
      }

      if (primesMois.length > 0) {
        // Primes déjà saisies pour ce mois ; "Chaque mois" coché si elles correspondent à une prime fixe.
        setPrimes(
          primesMois.map((p) => ({
            label: p.label,
            amount: Number(p.amount),
            fixe: fixes.some((f) => f.label === p.label && Number(f.amount) === Number(p.amount)),
          }))
        );
      } else if (!bulletinExistant) {
        // Rien de saisi et pas encore de bulletin : on reprend les primes fixes du mois précédent.
        setPrimes(fixes.map((p) => ({ label: p.label, amount: Number(p.amount), fixe: true })));
      }
      setRetenues(retenuesMois.map((d) => ({ type: d.type, label: d.label, amount: Number(d.amount) })));
      setBulletinCalcule(bulletinExistant);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargementBulletin(false);
    }
  }

  function ajouterPrime(label = '') {
    setPrimes((p) => [...p, { label, amount: '', fixe: false }]);
    setFicheModifiee(true);
  }

  function modifierPrime(index, champ, valeur) {
    setPrimes((p) => p.map((prime, i) => (i === index ? { ...prime, [champ]: valeur } : prime)));
    setFicheModifiee(true);
  }

  function retirerPrime(index) {
    setPrimes((p) => p.filter((_, i) => i !== index));
    setFicheModifiee(true);
  }

  function ajouterRetenue(type) {
    setRetenues((r) => [...r, { type, label: '', amount: '' }]);
    setFicheModifiee(true);
  }

  function modifierRetenue(index, champ, valeur) {
    setRetenues((r) => r.map((retenue, i) => (i === index ? { ...retenue, [champ]: valeur } : retenue)));
    setFicheModifiee(true);
  }

  function retirerRetenue(index) {
    setRetenues((r) => r.filter((_, i) => i !== index));
    setFicheModifiee(true);
  }

  async function genererBulletin(e) {
    e.preventDefault();
    if (!salaireSaisi || Number(salaireSaisi) <= 0) {
      setErreur('Renseigne le salaire de base.');
      return;
    }
    setEnvoiEnCours(true);
    setErreur('');
    try {
      const primesValides = primes
        .filter((p) => p.label.trim() && Number(p.amount))
        .map((p) => ({ label: p.label.trim(), amount: Number(p.amount), fixe: Boolean(p.fixe) }));
      const retenuesValides = retenues
        .filter((d) => Number(d.amount) > 0)
        .map((d) => ({ type: d.type, label: d.label.trim(), amount: Number(d.amount) }));

      // 1) Salaire de base, mode de paiement, parts fiscales et primes "chaque mois".
      await api.setSalary(employeBulletin.id, {
        monthlySalary: Number(salaireSaisi),
        paymentMethod: methodeSaisie,
        partsFiscales: Number(partsSaisies) || 1,
        ipresEnabled: ipresSaisi,
        cssEnabled: cssSaisi,
        recurringBonuses: primesValides.filter((p) => p.fixe).map(({ label, amount }) => ({ label, amount })),
      });
      // 2) Calcul et enregistrement du bulletin du mois.
      const donnees = {
        month: mois,
        bonuses: primesValides.map(({ label, amount }) => ({ label, amount })),
        deductions: retenuesValides,
      };
      // Rectificatif : nouvelle version, l'ancien bulletin reste consultable (mois non payé uniquement).
      const resultat = rectifier && bulletinCalcule
        ? await api.rectifyPayslip(employeBulletin.id, mois, { ...donnees, reason: motifRectif })
        : await api.generatePayslip(employeBulletin.id, donnees);
      setBulletinCalcule(resultat);
      setFicheModifiee(false);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function envoyerBulletins() {
    setEnvoiBulletinsEnCours(true);
    setErreur('');
    setResultatEnvoiBulletins(null);
    try {
      const resultat = await api.sendPayslips(mois);
      setResultatEnvoiBulletins(resultat);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiBulletinsEnCours(false);
    }
  }

  async function confirmerPaiement(e) {
    e.preventDefault();
    setEnvoiEnCours(true);
    try {
      await api.paySalary(employePaiement.id, {
        month: mois,
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

  // Estimation affichée dans la fiche avant le calcul exact par le serveur.
  const fcfaFiche = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
  const sommePrimes = primes.reduce((t, p) => t + (Number(p.amount) || 0), 0);
  const sommeAbsences = retenues.filter((d) => d.type === 'absence').reduce((t, d) => t + (Number(d.amount) || 0), 0);
  const sommeAutres = retenues.filter((d) => d.type !== 'absence').reduce((t, d) => t + (Number(d.amount) || 0), 0);
  const brutEstime = (Number(salaireSaisi) || 0) + sommePrimes - sommeAbsences;

  function recapLigne(libelle, montant, { signe = '', fort = false, doux = false, separe = false } = {}) {
    return (
      <div className={'md-recap-ligne' + (fort ? ' md-recap-ligne--fort' : '') + (doux ? ' md-recap-ligne--doux' : '') + (separe ? ' md-recap-ligne--separe' : '')}>
        <span>{libelle}</span>
        <span className="chiffre">{signe ? `${signe} ` : ''}{fcfaFiche(montant)} FCFA</span>
      </div>
    );
  }

  // Synthèse du mois affiché.
  const employesPayes = employes.filter((emp) => Boolean(emp.paid_at));
  const montantPaye = employesPayes.reduce((somme, emp) => somme + Number(emp.paid_amount || 0), 0);
  const resteAPayer = employes.length - employesPayes.length;
  const employesNonPayes = employes.filter((emp) => !emp.paid_at);
  // Montant des bulletins déjà calculés mais pas encore payés (net à payer).
  const montantRestant = employesNonPayes.reduce((somme, emp) => somme + Number(emp.payslip_net || 0), 0);
  const nbSansBulletin = employesNonPayes.filter((emp) => !emp.payslip_net).length;

  return (
    <>
      <div className="md-kpis">
        <div className="md-kpi md-kpi--hero">
          <span className="md-kpi-icone"><IconEquipe /></span>
          <p className="md-kpi-label">Masse salariale</p>
          <p className="md-kpi-valeur">{Math.round(montantPaye).toLocaleString('fr-FR')} <small>FCFA</small></p>
          <p className="md-kpi-sous">total des montants payés · {employesPayes.length} / {employes.length} employé(s)</p>
        </div>
        <div className={'md-kpi' + (resteAPayer > 0 ? ' md-kpi--alerte' : '')}>
          <span className="md-kpi-icone"><IconCadenas /></span>
          <p className="md-kpi-label">Reste à payer</p>
          <p className="md-kpi-valeur">{Math.round(montantRestant).toLocaleString('fr-FR')} <small>FCFA</small></p>
          <p className="md-kpi-sous">{resteAPayer} employé(s) non payé(s){nbSansBulletin > 0 ? ` · ${nbSansBulletin} bulletin(s) à préparer` : ''}</p>
        </div>
      </div>

      <div className="md-outils">
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
        <button
          type="button"
          className="btn btn-principal"
          disabled={envoiBulletinsEnCours || employes.every((emp) => !emp.payslip_net)}
          onClick={envoyerBulletins}
        >
          {envoiBulletinsEnCours ? 'Envoi en cours…' : 'Envoyer les bulletins par mail'}
        </button>
      </div>

      {resultatEnvoiBulletins && (
        <div style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 14 }}>
          <p>
            {resultatEnvoiBulletins.sent.length} bulletin(s) envoyé(s) par mail.
            {resultatEnvoiBulletins.accounts.length > 0 && ` ${resultatEnvoiBulletins.accounts.length} salarié(s) sans mail renseigné (bulletin disponible sur leur compte "Mes bulletins").`}
            {resultatEnvoiBulletins.toPrint.length > 0 && ` ${resultatEnvoiBulletins.toPrint.length} à imprimer (pas de compte ni de mail).`}
            {resultatEnvoiBulletins.errors.length > 0 && ` ${resultatEnvoiBulletins.errors.length} échec(s) d'envoi.`}
          </p>
          {resultatEnvoiBulletins.errors.length > 0 && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--erreur, #c0392b)' }}>
              {resultatEnvoiBulletins.errors.map((e) => (
                <li key={e.id}>{e.name} : {e.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ActionsMois mois={mois} onChange={charger} />

      {erreur && <div className="erreur">{erreur}</div>}

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : employes.length === 0 ? (
        <p className="etat-vide">Aucun employé actif.</p>
      ) : (
        <div className="md-liste">
          {employes.map((emp) => {
            const paye = Boolean(emp.paid_at);
            return (
              <div key={emp.id} className={'md-ligne' + (!paye ? ' md-ligne--prioritaire' : '')}>
                <div className="md-avatar">{initialesMembre(emp.name)}</div>

                <div className="md-bloc">
                  <p className="md-titre">{emp.name}</p>
                  <p className="md-sous" style={{ textTransform: 'capitalize' }}>
                    {emp.role} ·{' '}
                    <span style={{ textTransform: 'none' }}>
                      {emp.monthly_salary
                        ? `${Math.round(emp.monthly_salary).toLocaleString('fr-FR')} FCFA (${libelleMethode(emp.payment_method)})`
                        : 'salaire non configuré'}
                    </span>
                  </p>
                </div>

                <div className="md-bloc md-bloc--montant">
                  <span className={`tampon ${paye ? 'tampon-sarcelle' : emp.payslip_net ? 'tampon-laiton' : 'tampon-brique'}`}>
                    {paye ? 'Payé' : emp.payslip_net ? 'Bulletin prêt' : 'À préparer'}
                  </span>
                  <p className="md-sous">
                    {paye
                      ? `Le ${new Date(emp.paid_at).toLocaleDateString('fr-FR')} · ${Math.round(emp.paid_amount).toLocaleString('fr-FR')} FCFA via ${libelleMethode(emp.paid_method)}`
                      : emp.payslip_net
                        ? `Net à payer : ${Math.round(Number(emp.payslip_net)).toLocaleString('fr-FR')} FCFA`
                        : `Pour ${formatMois(mois)}`}
                  </p>
                </div>

                <div className="md-actions">
                  <button className={'btn' + (!emp.payslip_net ? ' btn-principal' : '')} onClick={() => ouvrirBulletin(emp)}>
                    Fiche de paie
                  </button>
                  <button
                    className="btn"
                    disabled={!emp.payslip_net}
                    onClick={() => api.previewPayslipPdf(emp.id, mois).catch((err) => setErreur(err.message))}
                  >
                    PDF
                  </button>
                  <button className={'btn' + (emp.payslip_net && !paye ? ' btn-principal' : '')} disabled={!emp.payslip_net || paye} onClick={() => ouvrirPaiement(emp)}>
                    {paye ? 'Payé' : 'Payer'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {employeBulletin && (
        <div className="modale-fond" onClick={() => setEmployeBulletin(null)}>
          <div className="modale md-fiche" onClick={(e) => e.stopPropagation()}>
            <div className="md-fiche-tete">
              <div className="md-avatar">{initialesMembre(employeBulletin.name)}</div>
              <div>
                <h2>Fiche de paie</h2>
                <p className="md-sous">{employeBulletin.name} · {formatMois(mois)}</p>
              </div>
            </div>

            {employeBulletin.paid_at && (
              <div className="md-info">
                Ce mois est déjà payé : le bulletin est verrouillé (consultation et PDF uniquement).
              </div>
            )}

            {chargementBulletin ? (
              <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
            ) : (
              <form onSubmit={genererBulletin}>
                {/* 1. Salaire de base */}
                <section className="md-fiche-section">
                  <h3><span className="md-etape">1</span> Salaire de base</h3>
                  <div className="md-fiche-grille">
                    <div className="champ-groupe">
                      <label className="etiquette" htmlFor="fp-base">Salaire mensuel (FCFA)</label>
                      <input
                        id="fp-base"
                        type="number"
                        min="1"
                        className="champ"
                        value={salaireSaisi}
                        onChange={(e) => { setSalaireSaisi(e.target.value); setFicheModifiee(true); }}
                        required
                      />
                    </div>
                    <div className="champ-groupe">
                      <label className="etiquette" htmlFor="fp-methode">Mode de paiement</label>
                      <select
                        id="fp-methode"
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
                      <label className="etiquette" htmlFor="fp-parts">Parts fiscales</label>
                      <input
                        id="fp-parts"
                        type="number"
                        min="1"
                        step="0.5"
                        className="champ"
                        value={partsSaisies}
                        onChange={(e) => { setPartsSaisies(e.target.value); setFicheModifiee(true); }}
                      />
                    </div>
                  </div>
                  <p className="md-aide">
                    Parts fiscales : 1 = célibataire sans enfant. Elles augmentent avec la situation familiale et réduisent l'IRPP (quotient familial).
                  </p>
                  <div className="champ-groupe" style={{ marginTop: 10 }}>
                    <label className="etiquette" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={ipresSaisi}
                        onChange={(e) => { setIpresSaisi(e.target.checked); setFicheModifiee(true); }}
                      />
                      Cotise à l'IPRES (retraite)
                    </label>
                    <label className="etiquette" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 6 }}>
                      <input
                        type="checkbox"
                        checked={cssSaisi}
                        onChange={(e) => { setCssSaisi(e.target.checked); setFicheModifiee(true); }}
                      />
                      Affilié à la CSS (prestations familiales / accidents du travail)
                    </label>
                    <p className="md-aide" style={{ marginTop: 6 }}>
                      Cochez seulement ce qui s'applique à ce salarié : une part non cochée n'est pas calculée sur son bulletin.
                    </p>
                  </div>
                </section>

                {/* 2. Primes et indemnités */}
                <section className="md-fiche-section">
                  <h3><span className="md-etape">2</span> Primes et indemnités <small>+ ajoutées au brut</small></h3>
                  {primes.length === 0 && <p className="md-aide">Aucune prime ce mois-ci.</p>}
                  {primes.map((prime, i) => (
                    <div key={i} className="md-fiche-ligne md-fiche-ligne--prime">
                      <input
                        type="text"
                        className="champ"
                        placeholder="Libellé (ex. prime de transport)"
                        value={prime.label}
                        onChange={(e) => modifierPrime(i, 'label', e.target.value)}
                      />
                      <input
                        type="number"
                        className="champ"
                        placeholder="Montant"
                        value={prime.amount}
                        onChange={(e) => modifierPrime(i, 'amount', e.target.value)}
                      />
                      <label className="md-case" title="Reprise automatiquement chaque mois">
                        <input type="checkbox" checked={Boolean(prime.fixe)} onChange={(e) => modifierPrime(i, 'fixe', e.target.checked)} />
                        Chaque mois
                      </label>
                      <button type="button" className="btn" onClick={() => retirerPrime(i)} aria-label="Retirer cette prime">×</button>
                    </div>
                  ))}
                  <div className="md-puces" style={{ marginTop: 8 }}>
                    {PRIMES_SUGGEREES.map((nom) => (
                      <button key={nom} type="button" className="md-puce" onClick={() => ajouterPrime(nom)}>+ {nom}</button>
                    ))}
                    <button type="button" className="md-puce" onClick={() => ajouterPrime('')}>+ Autre prime</button>
                  </div>
                </section>

                {/* 3. Retenues */}
                <section className="md-fiche-section">
                  <h3><span className="md-etape">3</span> Retenues <small>− déduites du salaire</small></h3>
                  {retenues.length === 0 && <p className="md-aide">Aucune retenue ce mois-ci.</p>}
                  {retenues.map((retenue, i) => (
                    <div key={i} className="md-fiche-ligne md-fiche-ligne--retenue">
                      <select className="champ" value={retenue.type} onChange={(e) => modifierRetenue(i, 'type', e.target.value)}>
                        {TYPES_RETENUE.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        className="champ"
                        placeholder="Précision (ex. 2 jours d'absence)"
                        value={retenue.label}
                        onChange={(e) => modifierRetenue(i, 'label', e.target.value)}
                      />
                      <input
                        type="number"
                        min="0"
                        className="champ"
                        placeholder="Montant"
                        value={retenue.amount}
                        onChange={(e) => modifierRetenue(i, 'amount', e.target.value)}
                      />
                      <button type="button" className="btn" onClick={() => retirerRetenue(i)} aria-label="Retirer cette retenue">×</button>
                    </div>
                  ))}
                  <div className="md-puces" style={{ marginTop: 8 }}>
                    {TYPES_RETENUE.map((t) => (
                      <button key={t.value} type="button" className="md-puce" onClick={() => ajouterRetenue(t.value)}>+ {t.court}</button>
                    ))}
                  </div>
                  <p className="md-aide">
                    Une absence réduit le brut : cotisations et impôt sont recalculés. Une avance, un prêt ou une autre retenue est déduite du net, après les impôts.
                  </p>
                </section>

                {/* 4. Récapitulatif */}
                <section className="md-fiche-section">
                  <h3><span className="md-etape">4</span> Récapitulatif</h3>
                  {bulletinCalcule ? (
                    <div className="md-recap">
                      {recapLigne('Salaire de base', bulletinCalcule.base_salary)}
                      {Number(bulletinCalcule.bonuses_total) !== 0 && recapLigne('Primes et indemnités', bulletinCalcule.bonuses_total, { signe: '+' })}
                      {recapLigne('Salaire brut', Number(bulletinCalcule.base_salary) + Number(bulletinCalcule.bonuses_total || 0), { fort: true, separe: true })}
                      {Number(bulletinCalcule.absences_total) > 0 && recapLigne('Absences non rémunérées', bulletinCalcule.absences_total, { signe: '−' })}
                      {recapLigne('IPRES (retraite)', bulletinCalcule.ipres_salarial, { signe: '−', doux: true })}
                      {Number(bulletinCalcule.css_salarial) > 0 && recapLigne('CSS', bulletinCalcule.css_salarial, { signe: '−', doux: true })}
                      {recapLigne('Impôt sur le revenu (IRPP)', bulletinCalcule.irpp, { signe: '−', doux: true })}
                      {recapLigne('TRIMF', bulletinCalcule.trimf, { signe: '−', doux: true })}
                      {Number(bulletinCalcule.deductions_total) > 0 && recapLigne('Avances, prêts et autres retenues', bulletinCalcule.deductions_total, { signe: '−' })}
                      <div className="md-recap-net">
                        <span>Net à payer</span>
                        <strong>{fcfaFiche(bulletinCalcule.net_a_payer)} FCFA</strong>
                      </div>
                      {ficheModifiee && (
                        <p className="md-aide" style={{ color: 'var(--danger)', marginTop: 8 }}>
                          La fiche a été modifiée : clique sur « Recalculer et enregistrer » pour mettre à jour ces chiffres.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="md-recap">
                      {recapLigne('Salaire de base', Number(salaireSaisi) || 0)}
                      {sommePrimes !== 0 && recapLigne('Primes et indemnités', sommePrimes, { signe: '+' })}
                      {recapLigne('Salaire brut', (Number(salaireSaisi) || 0) + sommePrimes, { fort: true, separe: true })}
                      {sommeAbsences > 0 && recapLigne('Absences non rémunérées', sommeAbsences, { signe: '−' })}
                      {sommeAutres > 0 && recapLigne('Avances, prêts et autres retenues', sommeAutres, { signe: '−' })}
                      <p className="md-aide" style={{ marginTop: 8 }}>
                        Estimation avant cotisations et impôt. Clique sur « Calculer » pour obtenir le net exact.
                      </p>
                    </div>
                  )}
                </section>

                {bulletinCalcule && !employeBulletin.paid_at && (
                  <div className="champ-groupe">
                    <label className="etiquette">
                      <input type="checkbox" checked={rectifier} onChange={(e) => setRectifier(e.target.checked)} />
                      {' '}Conserver l'ancienne version (bulletin rectificatif{bulletinCalcule.number ? `, ${bulletinCalcule.number}` : ''})
                    </label>
                    {rectifier && (
                      <input className="champ" placeholder="Motif de la rectification" value={motifRectif} onChange={(e) => setMotifRectif(e.target.value)} />
                    )}
                  </div>
                )}

                <div className="actions-modale">
                  <button type="button" className="btn" onClick={() => setEmployeBulletin(null)}>Fermer</button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => { const id = employeBulletin.id; setEmployeBulletin(null); setSearchParams({ onglet: 'simulation', employe: id }); }}
                  >
                    Simuler
                  </button>
                  {bulletinCalcule && (
                    <button
                      type="button"
                      className="btn"
                      disabled={ficheModifiee}
                      onClick={() => api.previewPayslipPdf(employeBulletin.id, mois).catch((err) => setErreur(err.message))}
                    >
                      Voir / imprimer le PDF
                    </button>
                  )}
                  <button type="submit" className="btn btn-principal" disabled={envoiEnCours || Boolean(employeBulletin.paid_at)}>
                    {envoiEnCours ? 'Calcul…' : bulletinCalcule ? 'Recalculer et enregistrer' : 'Calculer et enregistrer'}
                  </button>
                </div>
              </form>
            )}
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
            <p style={{ fontSize: 12, color: 'var(--succes, #1a7f37)', marginBottom: 12 }}>
              Montant verrouillé sur le net du bulletin de paie généré.
            </p>
            <form onSubmit={confirmerPaiement}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="paiement-montant">Montant versé (FCFA)</label>
                <input
                  id="paiement-montant"
                  type="number"
                  className="champ"
                  value={montantPaiement}
                  readOnly
                  disabled
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

function versPourcentage(valeurDecimale) {
  return valeurDecimale === null || valeurDecimale === undefined ? '' : Number(valeurDecimale) * 100;
}
function versDecimal(valeurPourcentage) {
  return valeurPourcentage === '' || valeurPourcentage === null ? 0 : Number(valeurPourcentage) / 100;
}

function ReglagesPaieTab() {
  const [chargement, setChargement] = useState(true);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState('');

  const [abattementTaux, setAbattementTaux] = useState('');
  const [abattementPlafond, setAbattementPlafond] = useState('');
  const [ipresTauxSalarial, setIpresTauxSalarial] = useState('');
  const [ipresTauxPatronal, setIpresTauxPatronal] = useState('');
  const [ipresPlafondMensuel, setIpresPlafondMensuel] = useState('');
  const [cssTauxSalarial, setCssTauxSalarial] = useState('');
  const [cssTauxPatronal, setCssTauxPatronal] = useState('');
  const [cssPlafondMensuel, setCssPlafondMensuel] = useState('');
  const [cfceTaux, setCfceTaux] = useState('');
  const [trenchesIrpp, setTranchesIrpp] = useState([]);
  const [paliersTrimf, setPaliersTrimf] = useState([]);

  useEffect(() => {
    api
      .getPayrollSettings()
      .then((r) => {
        setAbattementTaux(versPourcentage(r.abattement_taux));
        setAbattementPlafond(r.abattement_plafond_annuel);
        setIpresTauxSalarial(versPourcentage(r.ipres_taux_salarial));
        setIpresTauxPatronal(versPourcentage(r.ipres_taux_patronal));
        setIpresPlafondMensuel(r.ipres_plafond_mensuel ?? '');
        setCssTauxSalarial(versPourcentage(r.css_taux_salarial));
        setCssTauxPatronal(versPourcentage(r.css_taux_patronal));
        setCssPlafondMensuel(r.css_plafond_mensuel ?? '');
        setCfceTaux(versPourcentage(r.cfce_taux));
        setTranchesIrpp(r.bareme_irpp.map((t) => ({ jusqua: t.jusqua ?? '', taux: t.taux * 100 })));
        setPaliersTrimf(r.trimf_bareme.map((p) => ({ jusqua: p.jusqua ?? '', montant: p.montant })));
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  function modifierTranche(index, champ, valeur) {
    setTranchesIrpp((liste) => liste.map((t, i) => (i === index ? { ...t, [champ]: valeur } : t)));
  }
  function ajouterTranche() {
    setTranchesIrpp((liste) => [...liste, { jusqua: '', taux: 0 }]);
  }
  function retirerTranche(index) {
    setTranchesIrpp((liste) => liste.filter((_, i) => i !== index));
  }

  function modifierPalier(index, champ, valeur) {
    setPaliersTrimf((liste) => liste.map((p, i) => (i === index ? { ...p, [champ]: valeur } : p)));
  }
  function ajouterPalier() {
    setPaliersTrimf((liste) => [...liste, { jusqua: '', montant: 0 }]);
  }
  function retirerPalier(index) {
    setPaliersTrimf((liste) => liste.filter((_, i) => i !== index));
  }

  async function enregistrer(e) {
    e.preventDefault();
    setErreur('');
    setSucces('');
    setEnvoiEnCours(true);
    try {
      await api.updatePayrollSettings({
        abattement_taux: versDecimal(abattementTaux),
        abattement_plafond_annuel: Number(abattementPlafond) || 0,
        ipres_taux_salarial: versDecimal(ipresTauxSalarial),
        ipres_taux_patronal: versDecimal(ipresTauxPatronal),
        ipres_plafond_mensuel: ipresPlafondMensuel === '' ? null : Number(ipresPlafondMensuel),
        css_taux_salarial: versDecimal(cssTauxSalarial),
        css_taux_patronal: versDecimal(cssTauxPatronal),
        css_plafond_mensuel: cssPlafondMensuel === '' ? null : Number(cssPlafondMensuel),
        cfce_taux: versDecimal(cfceTaux),
        bareme_irpp: trenchesIrpp.map((t) => ({
          jusqua: t.jusqua === '' ? null : Number(t.jusqua),
          taux: versDecimal(t.taux),
        })),
        trimf_bareme: paliersTrimf.map((p) => ({
          jusqua: p.jusqua === '' ? null : Number(p.jusqua),
          montant: Number(p.montant) || 0,
        })),
      });
      setSucces('Réglages enregistrés.');
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  if (chargement) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--encre-douce)', maxWidth: 640, marginBottom: 20 }}>
        Ces taux et barèmes déterminent le calcul brut → net des bulletins de paie. Les valeurs de
        départ sont indicatives — fais-les valider par un comptable ou sur impotsetdomaines.gouv.sn
        avant de t'en servir pour payer réellement tes employés.
      </p>

      {erreur && <div className="erreur">{erreur}</div>}
      {succes && <p style={{ color: 'var(--succes, #1a7f37)', fontSize: 13, marginBottom: 12 }}>{succes}</p>}

      <form onSubmit={enregistrer}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Abattement forfaitaire</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Taux (%)</label>
            <input type="number" step="0.01" className="champ" value={abattementTaux} onChange={(e) => setAbattementTaux(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Plafond annuel (FCFA)</label>
            <input type="number" className="champ" value={abattementPlafond} onChange={(e) => setAbattementPlafond(e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>IPRES (retraite)</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Part salariale (%)</label>
            <input type="number" step="0.01" className="champ" value={ipresTauxSalarial} onChange={(e) => setIpresTauxSalarial(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Part patronale (%)</label>
            <input type="number" step="0.01" className="champ" value={ipresTauxPatronal} onChange={(e) => setIpresTauxPatronal(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Plafond mensuel (FCFA, vide = aucun)</label>
            <input type="number" className="champ" value={ipresPlafondMensuel} onChange={(e) => setIpresPlafondMensuel(e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>CSS (prestations familiales / AT)</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Part salariale (%)</label>
            <input type="number" step="0.01" className="champ" value={cssTauxSalarial} onChange={(e) => setCssTauxSalarial(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Part patronale (%)</label>
            <input type="number" step="0.01" className="champ" value={cssTauxPatronal} onChange={(e) => setCssTauxPatronal(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Plafond mensuel (FCFA, vide = aucun)</label>
            <input type="number" className="champ" value={cssPlafondMensuel} onChange={(e) => setCssPlafondMensuel(e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>CFCE (patronal)</h2>
        <div className="champ-groupe" style={{ maxWidth: 200, marginBottom: 18 }}>
          <label className="etiquette">Taux (%)</label>
          <input type="number" step="0.01" className="champ" value={cfceTaux} onChange={(e) => setCfceTaux(e.target.value)} />
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Barème IRPP (tranches annuelles progressives)</h2>
        {trenchesIrpp.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <input
              type="number"
              className="champ"
              placeholder="Jusqu'à (FCFA/an) — vide = illimité"
              value={t.jusqua}
              onChange={(e) => modifierTranche(i, 'jusqua', e.target.value)}
              style={{ flex: 2 }}
            />
            <input
              type="number"
              step="0.01"
              className="champ"
              placeholder="Taux (%)"
              value={t.taux}
              onChange={(e) => modifierTranche(i, 'taux', e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn" onClick={() => retirerTranche(i)}>×</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={ajouterTranche} style={{ marginBottom: 22 }}>+ Ajouter une tranche</button>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Barème TRIMF (paliers mensuels forfaitaires)</h2>
        {paliersTrimf.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <input
              type="number"
              className="champ"
              placeholder="Jusqu'à (FCFA/mois) — vide = illimité"
              value={p.jusqua}
              onChange={(e) => modifierPalier(i, 'jusqua', e.target.value)}
              style={{ flex: 2 }}
            />
            <input
              type="number"
              className="champ"
              placeholder="Montant (FCFA)"
              value={p.montant}
              onChange={(e) => modifierPalier(i, 'montant', e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn" onClick={() => retirerPalier(i)}>×</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={ajouterPalier} style={{ marginBottom: 22 }}>+ Ajouter un palier</button>

        <div>
          <button type="submit" className="btn btn-principal" disabled={envoiEnCours}>
            {envoiEnCours ? 'Enregistrement…' : 'Enregistrer les réglages'}
          </button>
        </div>
      </form>
    </>
  );
}

const ETAPES_CYCLE = [
  { id: 'saisie', label: 'Saisie' },
  { id: 'bulletins', label: 'Bulletins' },
  { id: 'controle', label: 'Contrôle' },
  { id: 'declarations', label: 'Déclarations' },
  { id: 'virement', label: 'Virement' },
  { id: 'ecritures', label: 'Écritures' },
];

// Bandeau « Cycle du mois » : reprend le design SAGFA360 (fond marine, étapes numérotées, cartes de
// chiffres). Les statuts des 2 premières et de « Virement » sont calculés depuis /payroll/preview-month
// (bulletins générés, salaires payés) ; « Contrôle », « Déclarations » et « Écritures » sont déduits de
// l'avancement des étapes précédentes en attendant un lien direct avec la Fiscalité/Comptabilité.
function CycleDuMoisTab({ onAllerSalaries }) {
  const [mois, setMois] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [filtre, setFiltre] = useState('');
  const [enCours, setEnCours] = useState(false);

  function charger() {
    setChargement(true);
    api.previewPayrollMonth(mois)
      .then(setDonnees)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }
  useEffect(charger, [mois]);

  async function validerToutLaPaie() {
    if (!window.confirm('Générer les bulletins manquants de tous les salariés pour ce mois ?')) return;
    setEnCours(true);
    try {
      await api.generateAllPayslips(mois);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  if (chargement && !donnees) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;
  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!donnees) return null;

  const { employees, totals, count } = donnees;
  const genFraction = count > 0 ? totals.generated / count : 0;
  const paidFraction = count > 0 ? totals.paid / count : 0;
  const statutEtape = (id) => {
    if (id === 'saisie') return 'fait';
    if (id === 'bulletins') return genFraction >= 1 ? 'fait' : genFraction > 0 ? 'en_cours' : 'a_faire';
    if (id === 'controle') return genFraction >= 1 ? 'fait' : 'a_faire';
    if (id === 'virement') return paidFraction >= 1 ? 'fait' : paidFraction > 0 ? 'en_cours' : 'a_faire';
    // Déclarations et Écritures : pas encore reliées à la Fiscalité/Comptabilité — proxy sur le virement.
    return paidFraction >= 1 ? 'fait' : 'a_faire';
  };
  const CIBLE_ONGLET = { saisie: 'salaires', bulletins: 'salaires', controle: 'salaires', declarations: null, virement: 'salaires', ecritures: null };

  const employesFiltres = employees.filter((e) => !filtre || e.name.toLowerCase().includes(filtre.toLowerCase()));
  const aValider = count - totals.generated;

  const cartes = [
    { label: 'Masse salariale brute', valeur: totals.gross },
    { label: 'Net à payer', valeur: totals.net },
    { label: 'Charges patronales', valeur: totals.employerCost - totals.gross },
    { label: 'Coût employeur', valeur: totals.employerCost },
    { label: 'À reverser', valeur: totals.irpp + totals.trimf + totals.cfce + totals.ipresTotal + totals.cssTotal },
    { label: 'Bulletins', valeur: `${totals.generated} / ${count}`, brut: true },
  ];
  const cartesCotisations = [
    { label: 'IR', valeur: totals.irpp },
    { label: 'TRIMF', valeur: totals.trimf },
    { label: 'IPRES', valeur: totals.ipresTotal },
    { label: 'CSS', valeur: totals.cssTotal },
    { label: 'CFCE', valeur: totals.cfce },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <input type="month" value={mois} onChange={(e) => setMois(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={onAllerSalaries}>Salariés</button>
          <button type="button" className="btn" onClick={() => window.print()}>Imprimer tout</button>
          <button type="button" className="btn btn-principal" disabled={enCours || aValider === 0} onClick={validerToutLaPaie}>
            {enCours ? 'Génération…' : aValider > 0 ? `Valider toute la paie (${aValider})` : 'Tout est validé'}
          </button>
        </div>
      </div>

      <div
        style={{
          background: 'var(--marine, var(--encre))', color: '#fff', borderRadius: 'var(--rayon, 14px)',
          padding: 'var(--space-md, 18px) var(--space-lg, 24px)', marginBottom: 'var(--space-lg, 24px)',
        }}
      >
        <p style={{ margin: 0, fontSize: 11, letterSpacing: '0.06em', opacity: 0.75 }}>
          CYCLE DU MOIS · {formatMois(mois)}
        </p>
        <p style={{ margin: '2px 0 14px', fontWeight: 700, fontSize: 'var(--fs-lg, 18px)' }}>
          {aValider > 0 ? `${aValider} bulletin(s) à valider` : 'Tous les bulletins sont validés'}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          {ETAPES_CYCLE.map((etape, i) => {
            const statut = statutEtape(etape.id);
            const cible = CIBLE_ONGLET[etape.id];
            return (
              <button
                key={etape.id}
                type="button"
                disabled={!cible}
                onClick={() => cible && onAllerSalaries()}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
                  color: statut === 'fait' ? '#fff' : 'rgba(255,255,255,0.55)', cursor: cible ? 'pointer' : 'default',
                  fontSize: 'var(--fs-sm)', fontWeight: statut === 'fait' ? 700 : 500, padding: 0,
                }}
              >
                <span
                  style={{
                    width: 18, height: 18, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10.5, background: statut === 'fait' ? 'var(--soleil, #e8b400)' : statut === 'en_cours' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)',
                    color: statut === 'fait' ? 'var(--marine, #0f2747)' : '#fff',
                  }}
                >
                  {i + 1}
                </span>
                {etape.label}
                {i < ETAPES_CYCLE.length - 1 && <span style={{ opacity: 0.35, margin: '0 2px' }}>—</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="ligne-stats">
        {cartes.map((c) => (
          <div key={c.label} className="stat">
            <p style={{ margin: '0 0 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--encre-douce)' }}>{c.label}</p>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 'var(--fs-md)', fontFamily: 'var(--font-chiffres)' }}>
              {c.brut ? c.valeur : `${fmt(c.valeur)} F`}
            </p>
          </div>
        ))}
      </div>
      <div className="ligne-stats">
        {cartesCotisations.map((c) => (
          <div key={c.label} className="stat">
            <p style={{ margin: '0 0 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--encre-douce)' }}>{c.label}</p>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 'var(--fs-md)', fontFamily: 'var(--font-chiffres)' }}>{fmt(c.valeur)} F</p>
          </div>
        ))}
      </div>

      <input
        placeholder="Filtrer les salariés…" value={filtre} onChange={(e) => setFiltre(e.target.value)}
        style={{ width: '100%', marginBottom: 14 }}
      />
      <div className="grille-resume-equipe">
        {employesFiltres.map((e) => (
          <div key={e.id} className="carte-resume-membre">
            <span className="avatar">{initialesMembre(e.name)}</span>
            <div style={{ minWidth: 0 }}>
              <p className="carte-resume-membre-nom">{e.name}</p>
              <p className="carte-resume-membre-detail">
                Brut {fmt(e.gross)} F
                {e.error && <span style={{ color: '#b3261e' }}> · {e.error}</span>}
              </p>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <p className="carte-resume-membre-total">{fmt(e.net)} F</p>
              <span
                style={{
                  fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  background: e.paid ? 'rgba(19,122,75,0.12)' : e.hasPayslip ? 'rgba(161,92,0,0.12)' : 'rgba(128,128,128,0.15)',
                  color: e.paid ? '#137a4b' : e.hasPayslip ? '#a15c00' : 'var(--encre-douce)',
                }}
              >
                {e.paid ? 'Payé' : e.hasPayslip ? 'À valider' : 'À générer'}
              </span>
            </div>
          </div>
        ))}
        {employesFiltres.length === 0 && <p style={{ color: 'var(--encre-douce)' }}>Aucun salarié ne correspond.</p>}
      </div>
    </div>
  );
}

function fmt(n) {
  return Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}

// « Simulation de bulletin » : net souhaité → sursalaire, sans toucher au mois réel (aucune écriture,
// aucun bulletin créé). S'appuie sur le nouvel endpoint POST /payroll/:userId/simulate.
function SimulationBulletinTab() {
  const [employes, setEmployes] = useState([]);
  const [mois, setMois] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [searchParams] = useSearchParams();
  const [employeId, setEmployeId] = useState(() => searchParams.get('employe') || '');
  const [netSouhaite, setNetSouhaite] = useState('');
  const [resultat, setResultat] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    api.getEmployees('actif').then(setEmployes).catch(() => {});
  }, []);

  async function calculer(e) {
    e.preventDefault();
    setErreur('');
    setResultat(null);
    if (!employeId) { setErreur('Choisissez un salarié.'); return; }
    setEnCours(true);
    try {
      const r = await api.simulatePayslip(employeId, mois, Number(netSouhaite));
      setResultat(r);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  const r = resultat?.resultat;

  return (
    <div>
      <p style={{ color: 'var(--encre-douce)', fontSize: 13.5, marginTop: 0, maxWidth: 640 }}>
        Simule le sursalaire (prime) à ajouter pour atteindre un net à payer précis, à partir du salaire de
        base et des primes déjà configurées du salarié ce mois-ci. Rien n'est enregistré tant que le
        bulletin n'est pas généré depuis l'onglet Salariés.
      </p>
      <form onSubmit={calculer} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Salarié *</label>
          <select value={employeId} onChange={(e) => setEmployeId(e.target.value)} required>
            <option value="">Choisir un salarié</option>
            {employes.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Mois</label>
          <input type="month" value={mois} onChange={(e) => setMois(e.target.value)} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Net à payer souhaité (FCFA) *</label>
          <input type="number" min="0" value={netSouhaite} onChange={(e) => setNetSouhaite(e.target.value)} required />
        </div>
        <button type="submit" className="btn btn-principal" disabled={enCours}>
          {enCours ? 'Calcul…' : 'Calculer le sursalaire'}
        </button>
        {r && (
          <button type="button" className="btn" onClick={() => window.print()}>Imprimer la simulation</button>
        )}
      </form>
      {erreur && <div className="erreur">{erreur}</div>}
      {r && resultat.sursalaire === 0 && r.net_a_payer > Number(netSouhaite) && (
        <p style={{ color: '#a15c00', fontSize: 13 }}>
          Le net actuel ({fmt(r.net_a_payer)} FCFA) dépasse déjà le net souhaité : aucun sursalaire n'est nécessaire.
        </p>
      )}

      {r && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 280px', gap: 20 }}>
          <div className="carte-activite">
            <p className="carte-activite-titre">Gains</p>
            <table style={{ width: '100%', fontSize: 13.5, borderCollapse: 'collapse' }}>
              <tbody>
                <tr><td style={{ padding: '6px 0' }}>Salaire de base</td><td style={{ textAlign: 'right' }}>{fmt(r.base_salary)}</td></tr>
                {r.bonuses_detail.map((b, i) => (
                  <tr key={i}><td style={{ padding: '6px 0' }}>{b.label}</td><td style={{ textAlign: 'right' }}>{fmt(b.amount)}</td></tr>
                ))}
                <tr style={{ borderTop: '1px solid var(--trait)', fontWeight: 700 }}>
                  <td style={{ padding: '8px 0' }}>Total salaire brut</td><td style={{ textAlign: 'right' }}>{fmt(r.gross_salary)} FCFA</td>
                </tr>
              </tbody>
            </table>
            <p className="carte-activite-titre" style={{ marginTop: 18 }}>Retenues salariales</p>
            <table style={{ width: '100%', fontSize: 13.5, borderCollapse: 'collapse' }}>
              <tbody>
                <tr><td style={{ padding: '6px 0' }}>Impôt sur le revenu (IR)</td><td style={{ textAlign: 'right' }}>−{fmt(r.irpp)}</td></tr>
                <tr><td style={{ padding: '6px 0' }}>IPRES — Régime général</td><td style={{ textAlign: 'right' }}>−{fmt(r.ipres_salarial)}</td></tr>
                <tr><td style={{ padding: '6px 0' }}>CSS</td><td style={{ textAlign: 'right' }}>−{fmt(r.css_salarial)}</td></tr>
                <tr><td style={{ padding: '6px 0' }}>TRIMF</td><td style={{ textAlign: 'right' }}>−{fmt(r.trimf)}</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ background: 'var(--marine, var(--encre))', color: '#fff', borderRadius: 'var(--rayon, 14px)', padding: 20, height: 'fit-content' }}>
            <p style={{ margin: 0, fontSize: 11, letterSpacing: '0.06em', opacity: 0.75 }}>NET À PAYER SIMULÉ</p>
            <p style={{ margin: '4px 0 2px', fontWeight: 700, fontSize: 'var(--fs-2xl)', fontFamily: 'var(--font-chiffres)' }}>{fmt(r.net_a_payer)}</p>
            <p style={{ margin: '0 0 16px', fontSize: 12, opacity: 0.75 }}>FCFA · {formatMois(mois)}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.15)' }}>
              <span>Brut</span><span>{fmt(r.gross_salary)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0' }}>
              <span>Retenues salariales</span><span>−{fmt(r.irpp + r.ipres_salarial + r.css_salarial + r.trimf)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0' }}>
              <span>Charges patronales</span><span>{fmt(r.ipres_patronal + r.css_patronal + r.cfce)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', fontWeight: 700 }}>
              <span>Coût employeur</span><span>{fmt(r.cout_total_employeur)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Gestion de la paie : séparée de la page Équipe. Réservée au manager et au comptable, et seulement si
// l'owner a activé le module Paie pour ce commerçant.
export function PaiePage() {
  const { user, aRole } = useAuth();
  const { loaded, payroll, accounting, fiscalite } = useModulesAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  // L'onglet d'ouverture suit ?onglet=... (sidebar, sous-menu Paie) ; « cycle » reste la page d'accueil par défaut.
  const [onglet, setOnglet] = useState(() => searchParams.get('onglet') || 'cycle');
  useEffect(() => {
    const demande = searchParams.get('onglet');
    if (demande && demande !== onglet) setOnglet(demande);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  function choisirOnglet(id) {
    setOnglet(id);
    setSearchParams({ onglet: id }, { replace: true });
  }
  // Le paiement des cotisations s'appuie sur la comptabilité et le module Fiscalité (activés par l'owner).
  const cotisationsDisponibles = Boolean(accounting && fiscalite);

  if (!user || !aRole('manager', 'comptable')) return <Navigate to="/" replace />;
  if (!loaded) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;
  if (!payroll) return <PageModuleNonActive nom="Paie" />;

  return (
    <>
      <StylesModernes />
      <div className="entete-page">
        <h1>Paie</h1>
      </div>

      <div className="onglets" style={{ marginBottom: 20 }}>
        <button className={onglet === 'cycle' ? 'onglet actif' : 'onglet'} onClick={() => choisirOnglet('cycle')}>
          Cycle du mois
        </button>
        <button className={onglet === 'salaires' ? 'onglet actif' : 'onglet'} onClick={() => choisirOnglet('salaires')}>
          Salariés
        </button>
        <button className={onglet === 'simulation' ? 'onglet actif' : 'onglet'} onClick={() => choisirOnglet('simulation')}>
          Simulation
        </button>
        <button className={onglet === 'employes' ? 'onglet actif' : 'onglet'} onClick={() => choisirOnglet('employes')}>Employés</button>
        <button className={onglet === 'absences' ? 'onglet actif' : 'onglet'} onClick={() => choisirOnglet('absences')}>Absences et heures</button>
        <button className={onglet === 'avances' ? 'onglet actif' : 'onglet'} onClick={() => choisirOnglet('avances')}>Avances</button>
        <button className={onglet === 'documents' ? 'onglet actif' : 'onglet'} onClick={() => choisirOnglet('documents')}>Documents RH</button>
        <button className={onglet === 'etats' ? 'onglet actif' : 'onglet'} onClick={() => choisirOnglet('etats')}>États</button>
        <button className={onglet === 'reglages-paie' ? 'onglet actif' : 'onglet'} onClick={() => choisirOnglet('reglages-paie')}>
          Réglages paie
        </button>
        {cotisationsDisponibles && (
          <button className={onglet === 'cotisations' ? 'onglet actif' : 'onglet'} onClick={() => choisirOnglet('cotisations')}>
            Cotisations CSS / IPRES
          </button>
        )}
      </div>

      <AlertesPaie />
      {onglet === 'cycle' && <CycleDuMoisTab onAllerSalaries={() => choisirOnglet('salaires')} />}
      {onglet === 'salaires' && <SalairesTab />}
      {onglet === 'simulation' && <SimulationBulletinTab />}
      {onglet === 'employes' && <EmployesTab />}
      {onglet === 'absences' && <AbsencesHeuresTab />}
      {onglet === 'avances' && <AvancesTab />}
      {onglet === 'documents' && <DocumentsRhTab />}
      {onglet === 'etats' && <EtatsTab />}
      {onglet === 'reglages-paie' && (
        <>
          <ReglagesPaieTab />
          <ReglagesPeriodeSection />
        </>
      )}
      {onglet === 'cotisations' && cotisationsDisponibles && <ImpotsTab mode="cotisations" />}
    </>
  );
}

export default PaiePage;
