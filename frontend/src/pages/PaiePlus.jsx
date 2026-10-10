import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Écrans complémentaires du module Paie, écrits avec la même structure et les mêmes classes que
// PaiePage.jsx : lignes à 4 blocs (avatar, texte, statut, boutons), cartes KPI, fenêtres « md-fiche »
// avec sections numérotées, champs en grille.

const NOMS_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
function formatMois(moisStr) {
  if (!moisStr) return '';
  const [annee, mois] = moisStr.split('-');
  return `${NOMS_MOIS[Number(mois) - 1]} ${annee}`;
}
function moisActuel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function aujourdhui() {
  return new Date().toISOString().slice(0, 10);
}
const fcfa = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');

const CONTRATS = [
  { value: 'cdi', label: 'CDI' },
  { value: 'cdd', label: 'CDD' },
  { value: 'stage', label: 'Stage' },
  { value: 'apprentissage', label: 'Apprentissage' },
  { value: 'journalier', label: 'Journalier' },
  { value: 'autre', label: 'Autre' },
];
const MODES = [
  { value: 'especes', label: 'Espèces' },
  { value: 'wave', label: 'Wave' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'virement', label: 'Virement' },
];
const MODES_CAISSE = ['especes', 'wave', 'orange_money'];
const TYPES_ABSENCE = [
  { value: 'non_payee', label: 'Absence non payée' },
  { value: 'maladie', label: 'Maladie (non payée)' },
  { value: 'payee', label: 'Absence payée' },
  { value: 'conge', label: 'Congé' },
];
const TYPES_DOC = {
  attestation_travail: 'Attestation de travail',
  certificat_travail: 'Certificat de travail',
  contrat_cdi: 'Contrat CDI',
  contrat_cdd: 'Contrat CDD',
};

function initiales(nom) {
  return String(nom || '?').split(/\s+/).map((m) => m[0]).slice(0, 2).join('').toUpperCase();
}

// Champ de formulaire (étiquette + saisie), comme dans PaiePage.
function Champ({ id, label, children, style }) {
  return (
    <div className="champ-groupe" style={style}>
      <label className="etiquette" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

// Ligne de liste : TOUJOURS quatre blocs (avatar, texte, statut/montant, boutons) pour que la
// mise en page de .md-ligne s'applique comme sur la page Salaires.
function Ligne({ sigle, titre, sous, tampon, detail, actions, prioritaire }) {
  return (
    <div className={'md-ligne' + (prioritaire ? ' md-ligne--prioritaire' : '')}>
      <div className="md-avatar">{sigle}</div>
      <div className="md-bloc">
        <p className="md-titre">{titre}</p>
        {sous && <p className="md-sous">{sous}</p>}
      </div>
      <div className="md-bloc md-bloc--montant">
        {tampon && <span className={`tampon ${tampon.classe}`}>{tampon.texte}</span>}
        {detail && <p className="md-sous">{detail}</p>}
      </div>
      <div className="md-actions">{actions}</div>
    </div>
  );
}

// Fenêtre « fiche » : en-tête avec avatar, comme la fiche de paie.
function Fenetre({ sigle, titre, sous, onClose, children }) {
  return (
    <div className="modale-fond" onClick={onClose}>
      <div className="modale md-fiche" onClick={(e) => e.stopPropagation()}>
        <div className="md-fiche-tete">
          <div className="md-avatar">{sigle}</div>
          <div>
            <h2>{titre}</h2>
            {sous && <p className="md-sous">{sous}</p>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Section({ numero, titre, children }) {
  return (
    <section className="md-fiche-section">
      <h3>{numero ? <span className="md-etape">{numero}</span> : null} {titre}</h3>
      {children}
    </section>
  );
}

function Kpi({ label, valeur, unite, sous, hero, alerte }) {
  return (
    <div className={'md-kpi' + (hero ? ' md-kpi--hero' : '') + (alerte ? ' md-kpi--alerte' : '')}>
      <p className="md-kpi-label">{label}</p>
      <p className="md-kpi-valeur">{valeur}{unite ? <> <small>{unite}</small></> : null}</p>
      {sous && <p className="md-kpi-sous">{sous}</p>}
    </div>
  );
}

function useBoutiques() {
  const [boutiques, setBoutiques] = useState([]);
  useEffect(() => {
    api.getWarehouses()
      .then((liste) => setBoutiques((Array.isArray(liste) ? liste : []).filter((w) => w.is_active !== false)))
      .catch(() => setBoutiques([]));
  }, []);
  return boutiques;
}

// ---------------------------------------------------------------------------
// Alertes de paie (bandeau en haut de la page)
// ---------------------------------------------------------------------------
export function AlertesPaie() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.getPayrollAlerts().then((d) => setItems(d.items || [])).catch(() => setItems([]));
  }, []);
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      {items.map((a, i) => (
        <div key={i} className={a.severity === 'info' ? 'md-info' : 'erreur'} style={{ marginBottom: 6 }}>{a.message}</div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action du mois (onglet Salaires) : « Payer tout »
// ---------------------------------------------------------------------------
export function ActionsMois({ mois, onChange }) {
  const boutiques = useBoutiques();
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [paiement, setPaiement] = useState(false);
  const [boutique, setBoutique] = useState('');

  async function payerTout() {
    setOccupe(true);
    setErreur('');
    setMessage('');
    try {
      const r = await api.payAllSalaries({ month: mois, warehouseId: boutique });
      setPaiement(false);
      setMessage(`${r.paid.length} salaire(s) payé(s) pour ${fcfa(r.total)} FCFA.${r.withoutPayslip.length ? ` Sans bulletin : ${r.withoutPayslip.join(', ')}.` : ''}`);
      onChange();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setOccupe(false);
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="md-outils">
        <button className="btn btn-principal" disabled={occupe} onClick={() => { setErreur(''); setPaiement(true); }}>Payer tout</button>
      </div>
      {erreur && !paiement && <div className="erreur" style={{ marginTop: 8 }}>{erreur}</div>}
      {message && <div className="md-info" style={{ marginTop: 8 }}>{message}</div>}

      {paiement && (
        <Fenetre sigle="€" titre="Payer tous les salaires" sous={formatMois(mois)} onClose={() => setPaiement(false)}>
          <div className="md-info">
            Chaque employé est payé selon le mode de sa fiche, au montant exact de son bulletin. Les sorties d'argent sont prises sur la caisse de la boutique choisie, dont le solde est vérifié avant tout paiement.
          </div>
          <Section numero="1" titre="Boutique dont la caisse paie">
            <Champ id="pt-boutique" label="Boutique">
              <select id="pt-boutique" className="champ" value={boutique} onChange={(e) => setBoutique(e.target.value)}>
                <option value="">— Choisir —</option>
                {boutiques.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Champ>
          </Section>
          {erreur && <div className="erreur">{erreur}</div>}
          <div className="actions-modale">
            <button type="button" className="btn" onClick={() => setPaiement(false)}>Annuler</button>
            <button type="button" className="btn btn-principal" disabled={!boutique || occupe} onClick={payerTout}>{occupe ? 'Paiement…' : 'Payer tout'}</button>
          </div>
        </Fenetre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Employés : liste, fiche complète, création sans compte, archivage, historique des salaires
// ---------------------------------------------------------------------------
const FICHE_VIDE = {
  fullName: '', phone: '', email: '', address: '', jobTitle: '', contractType: 'cdi', hireDate: '', endDate: '',
  ipresNumber: '', cssNumber: '', warehouseId: '', monthlySalary: '', paymentMethod: 'especes',
};

export function EmployesTab() {
  const boutiques = useBoutiques();
  const [statut, setStatut] = useState('actif');
  const [liste, setListe] = useState([]);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(true);
  const [fiche, setFiche] = useState(null);
  const [historique, setHistorique] = useState([]);
  const [nouveauSalaire, setNouveauSalaire] = useState({ monthlySalary: '', effectiveFrom: aujourdhui(), note: '' });
  const [enCours, setEnCours] = useState(false);
  const [simu, setSimu] = useState({ netVoulu: '', resultat: null, enCours: false });

  function charger() {
    setChargement(true);
    api.getEmployees(statut === 'tous' ? '' : statut)
      .then(setListe)
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }
  useEffect(charger, [statut]);

  async function ouvrir(emp) {
    setErreur('');
    setSimu({ netVoulu: '', resultat: null, enCours: false });
    if (!emp) {
      setFiche({ id: null, ...FICHE_VIDE });
      setHistorique([]);
      return;
    }
    try {
      const f = await api.getEmployee(emp.id);
      setFiche({
        id: f.id, fullName: f.full_name || '', phone: f.phone || '', email: f.email || '', address: f.address || '', jobTitle: f.job_title || '',
        contractType: f.contract_type || 'cdi', hireDate: f.hire_date || '', endDate: f.end_date || '', ipresNumber: f.ipres_number || '',
        cssNumber: f.css_number || '', warehouseId: f.warehouse_id || '', monthlySalary: f.monthly_salary ? Math.round(f.monthly_salary) : '',
        paymentMethod: f.payment_method || 'especes', status: f.status, hasAccount: Boolean(f.user_id),
        partsFiscales: f.parts_fiscales, ipresEnabled: f.ipres_enabled === true, cssEnabled: f.css_enabled === true,
      });
      setHistorique(await api.getEmployeeSalaryHistory(emp.id).catch(() => []));
      setNouveauSalaire({ monthlySalary: '', effectiveFrom: aujourdhui(), note: '' });
    } catch (e) {
      setErreur(e.message);
    }
  }

  const maj = (champ, valeur) => setFiche((f) => ({ ...f, [champ]: valeur }));

  async function enregistrer(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    try {
      const corps = { ...fiche, monthlySalary: fiche.monthlySalary === '' ? undefined : Number(fiche.monthlySalary) };
      if (fiche.id) await api.updateEmployee(fiche.id, corps);
      else await api.createEmployee(corps);
      setFiche(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  async function changerStatut(emp, archiver) {
    setErreur('');
    try {
      if (archiver) {
        if (!window.confirm(`Archiver ${emp.full_name} ? Son historique de paie est conservé.`)) return;
        await api.archiveEmployee(emp.id);
      } else {
        await api.restoreEmployee(emp.id);
      }
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function ajouterSalaire() {
    setErreur('');
    try {
      await api.addEmployeeSalaryHistory(fiche.id, { ...nouveauSalaire, monthlySalary: Number(nouveauSalaire.monthlySalary) });
      setHistorique(await api.getEmployeeSalaryHistory(fiche.id));
      setNouveauSalaire({ monthlySalary: '', effectiveFrom: aujourdhui(), note: '' });
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function simuler() {
    const cible = Number(simu.netVoulu);
    if (!(cible > 0)) return;
    setSimu((s) => ({ ...s, enCours: true, resultat: null }));
    try {
      const r = await api.getPayrollSettings();
      setSimu((s) => ({ ...s, enCours: false, resultat: trouverBrut(cible, r, fiche) }));
    } catch (err) {
      setErreur(err.message);
      setSimu((s) => ({ ...s, enCours: false }));
    }
  }

  const actifs = liste.filter((e) => e.status === 'actif');
  const masseBase = actifs.reduce((s, e) => s + Number(e.monthly_salary || 0), 0);

  return (
    <>
      <div className="md-kpis">
        <Kpi hero label="Employés" valeur={actifs.length} sous={`${liste.length - actifs.length} archivé(s) dans cette vue`} />
        <Kpi label="Masse salariale de base" valeur={fcfa(masseBase)} unite="FCFA" sous="salaires mensuels configurés (employés actifs)" />
      </div>

      <div className="md-outils">
        <div className="champ-groupe" style={{ marginBottom: 0 }}>
          <label className="etiquette" htmlFor="emp-statut">Afficher</label>
          <select id="emp-statut" className="champ" value={statut} onChange={(e) => setStatut(e.target.value)}>
            <option value="actif">Employés actifs</option>
            <option value="archive">Archivés</option>
            <option value="tous">Tous</option>
          </select>
        </div>
        <button className="btn btn-principal" onClick={() => ouvrir(null)}>Nouvel employé</button>
      </div>

      {erreur && !fiche && <div className="erreur">{erreur}</div>}

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : liste.length === 0 ? (
        <p className="etat-vide">Aucun employé.</p>
      ) : (
        <div className="md-liste">
          {liste.map((emp) => (
            <Ligne
              key={emp.id}
              sigle={initiales(emp.full_name)}
              titre={emp.full_name}
              sous={[emp.job_title, emp.contract_type && emp.contract_type.toUpperCase(), emp.has_account ? 'Avec compte' : 'Sans compte'].filter(Boolean).join(' · ')}
              tampon={emp.status === 'actif' ? { classe: 'tampon-sarcelle', texte: 'Actif' } : { classe: 'tampon-brique', texte: 'Archivé' }}
              detail={emp.monthly_salary ? `${fcfa(emp.monthly_salary)} FCFA / mois` : 'salaire non configuré'}
              actions={(
                <>
                  <button className="btn" onClick={() => ouvrir(emp)}>Fiche</button>
                  {emp.status === 'actif'
                    ? <button className="btn" onClick={() => changerStatut(emp, true)}>Archiver</button>
                    : <button className="btn" onClick={() => changerStatut(emp, false)}>Réactiver</button>}
                </>
              )}
            />
          ))}
        </div>
      )}

      {fiche && (
        <Fenetre
          sigle={initiales(fiche.fullName) || '+'}
          titre={fiche.id ? "Fiche de l'employé" : 'Nouvel employé'}
          sous={fiche.id ? fiche.fullName : 'Employé avec ou sans compte'}
          onClose={() => setFiche(null)}
        >
          <div className="md-info">Données personnelles visibles par le manager uniquement. Une adresse e-mail permet l'envoi du bulletin par e-mail.</div>

          <form id="form-employe" onSubmit={enregistrer}>
            <Section numero="1" titre="Identité">
              <div className="md-fiche-grille">
                <Champ id="ef-nom" label="Nom complet"><input id="ef-nom" className="champ" required value={fiche.fullName} onChange={(e) => maj('fullName', e.target.value)} /></Champ>
                <Champ id="ef-tel" label="Téléphone"><input id="ef-tel" className="champ" value={fiche.phone} onChange={(e) => maj('phone', e.target.value)} /></Champ>
                <Champ id="ef-mail" label="E-mail"><input id="ef-mail" type="email" className="champ" value={fiche.email} onChange={(e) => maj('email', e.target.value)} /></Champ>
                <Champ id="ef-adresse" label="Adresse"><input id="ef-adresse" className="champ" value={fiche.address} onChange={(e) => maj('address', e.target.value)} /></Champ>
              </div>
            </Section>

            <Section numero="2" titre="Poste et contrat">
              <div className="md-fiche-grille">
                <Champ id="ef-poste" label="Poste"><input id="ef-poste" className="champ" value={fiche.jobTitle} onChange={(e) => maj('jobTitle', e.target.value)} /></Champ>
                <Champ id="ef-contrat" label="Contrat">
                  <select id="ef-contrat" className="champ" value={fiche.contractType} onChange={(e) => maj('contractType', e.target.value)}>
                    {CONTRATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Champ>
                <Champ id="ef-embauche" label="Date d'embauche"><input id="ef-embauche" type="date" className="champ" value={fiche.hireDate} onChange={(e) => maj('hireDate', e.target.value)} /></Champ>
                <Champ id="ef-fin" label="Date de fin (CDD, départ)"><input id="ef-fin" type="date" className="champ" value={fiche.endDate} onChange={(e) => maj('endDate', e.target.value)} /></Champ>
                <Champ id="ef-ipres" label="N° IPRES"><input id="ef-ipres" className="champ" value={fiche.ipresNumber} onChange={(e) => maj('ipresNumber', e.target.value)} /></Champ>
                <Champ id="ef-css" label="N° CSS"><input id="ef-css" className="champ" value={fiche.cssNumber} onChange={(e) => maj('cssNumber', e.target.value)} /></Champ>
                <Champ id="ef-boutique" label="Boutique de rattachement">
                  <select id="ef-boutique" className="champ" value={fiche.warehouseId} onChange={(e) => maj('warehouseId', e.target.value)}>
                    <option value="">— Aucune —</option>
                    {boutiques.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </Champ>
              </div>
            </Section>

            {!fiche.id && (
              <Section numero="3" titre="Salaire">
                <div className="md-fiche-grille">
                  <Champ id="ef-salaire" label="Salaire mensuel (FCFA)"><input id="ef-salaire" type="number" min="1" className="champ" value={fiche.monthlySalary} onChange={(e) => maj('monthlySalary', e.target.value)} /></Champ>
                  <Champ id="ef-mode" label="Mode de paiement">
                    <select id="ef-mode" className="champ" value={fiche.paymentMethod} onChange={(e) => maj('paymentMethod', e.target.value)}>
                      {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </Champ>
                </div>
              </Section>
            )}
          </form>

          {fiche.id && (
            <>
              <Section numero="3" titre="Historique des salaires">
                {historique.length === 0 ? <p className="md-aide">Aucun salaire enregistré.</p> : (
                  <div className="md-recap">
                    {historique.map((h) => (
                      <div key={h.id} className="md-recap-ligne">
                        <span>{h.effective_from}{h.note ? ` · ${h.note}` : ''}</span>
                        <span className="chiffre">{fcfa(h.monthly_salary)} FCFA</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="md-fiche-grille" style={{ marginTop: 10 }}>
                  <Champ id="hs-montant" label="Nouveau salaire (FCFA)"><input id="hs-montant" type="number" min="1" className="champ" value={nouveauSalaire.monthlySalary} onChange={(e) => setNouveauSalaire((s) => ({ ...s, monthlySalary: e.target.value }))} /></Champ>
                  <Champ id="hs-date" label="À compter du"><input id="hs-date" type="date" className="champ" value={nouveauSalaire.effectiveFrom} onChange={(e) => setNouveauSalaire((s) => ({ ...s, effectiveFrom: e.target.value }))} /></Champ>
                </div>
                <button type="button" className="btn" disabled={!nouveauSalaire.monthlySalary} onClick={ajouterSalaire}>Ajouter ce salaire</button>
              </Section>

              <Section numero="4" titre="Simulateur net → brut">
                <p className="md-aide">Indiquez le net souhaité : le brut correspondant est estimé avec vos réglages de paie (parts fiscales et IPRES/CSS de la fiche, hors primes et retenues).</p>
                <div className="md-fiche-grille">
                  <Champ id="sim-net" label="Net souhaité (FCFA)"><input id="sim-net" type="number" min="1" className="champ" value={simu.netVoulu} onChange={(e) => setSimu((s) => ({ ...s, netVoulu: e.target.value, resultat: null }))} /></Champ>
                </div>
                <button type="button" className="btn" disabled={simu.enCours || !simu.netVoulu} onClick={simuler}>Estimer le brut</button>
                {simu.resultat ? <div className="md-info" style={{ marginTop: 10 }}>Brut estimé : <strong>{fcfa(simu.resultat)} FCFA</strong></div> : null}
              </Section>
            </>
          )}

          {erreur && <div className="erreur">{erreur}</div>}
          <div className="actions-modale">
            <button type="button" className="btn" onClick={() => setFiche(null)}>Fermer</button>
            <button type="submit" form="form-employe" className="btn btn-principal" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </Fenetre>
      )}
    </>
  );
}

// Recherche par dichotomie du brut dont le net (barème de la fiche) atteint la cible.
// Reprend la logique de payrollCalc.js côté navigateur, uniquement pour l'estimation du simulateur.
function trouverBrut(netCible, r, fiche) {
  const tranches = r.bareme_irpp || [];
  const paliers = r.trimf_bareme || [];
  const parts = Math.max(1, Number(fiche.partsFiscales) || 1);
  const net = (brut) => {
    const ipres = fiche.ipresEnabled ? Math.min(brut, Number(r.ipres_plafond_mensuel) || Infinity) * Number(r.ipres_taux_salarial || 0) : 0;
    const css = fiche.cssEnabled ? Math.min(brut, Number(r.css_plafond_mensuel) || Infinity) * Number(r.css_taux_salarial || 0) : 0;
    const annuel = brut * 12;
    const abattement = Math.min(annuel * Number(r.abattement_taux || 0), Number(r.abattement_plafond_annuel || 0));
    const imposable = Math.max(0, annuel - abattement) / parts;
    let impot = 0;
    let plancher = 0;
    for (const t of tranches) {
      const plafond = t.jusqua === null ? Infinity : Number(t.jusqua);
      if (imposable <= plancher) break;
      impot += (Math.min(imposable, plafond) - plancher) * Number(t.taux);
      plancher = plafond;
    }
    const irpp = (impot * parts) / 12;
    const palier = paliers.find((p) => p.jusqua === null || brut <= Number(p.jusqua));
    return brut - ipres - css - irpp - (palier ? Number(palier.montant) : 0);
  };
  let bas = netCible;
  let haut = netCible * 3 + 100000;
  for (let i = 0; i < 60; i += 1) {
    const milieu = (bas + haut) / 2;
    if (net(milieu) < netCible) bas = milieu;
    else haut = milieu;
  }
  return Math.round((bas + haut) / 2);
}


// ---------------------------------------------------------------------------
// Absences et heures supplémentaires
// ---------------------------------------------------------------------------
export function AbsencesHeuresTab() {
  const [mois, setMois] = useState(moisActuel());
  const [employes, setEmployes] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [heures, setHeures] = useState([]);
  const [majorations, setMajorations] = useState([]);
  const [erreur, setErreur] = useState('');
  const [modale, setModale] = useState(null); // 'absence' | 'heures'
  const [abs, setAbs] = useState({ employeeId: '', type: 'non_payee', startDate: '', days: '', note: '' });
  const [hs, setHs] = useState({ employeeId: '', date: '', hours: '', category: '', note: '' });
  const [enCours, setEnCours] = useState(false);

  function charger() {
    api.getAbsences(mois).then(setAbsences).catch((e) => setErreur(e.message));
    api.getOvertime(mois).then(setHeures).catch((e) => setErreur(e.message));
  }
  useEffect(charger, [mois]);
  useEffect(() => {
    api.getEmployees('actif').then(setEmployes).catch((e) => setErreur(e.message));
    api.getPayrollSettings().then((r) => setMajorations(Array.isArray(r.overtime_rates) ? r.overtime_rates : [])).catch(() => {});
  }, []);

  async function ajouterAbsence(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    try {
      await api.addAbsence(abs.employeeId, { type: abs.type, startDate: abs.startDate, days: Number(abs.days), note: abs.note });
      setModale(null);
      setAbs({ employeeId: '', type: 'non_payee', startDate: '', days: '', note: '' });
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }
  async function ajouterHeures(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    try {
      await api.addOvertime(hs.employeeId, { date: hs.date, hours: Number(hs.hours), category: hs.category, note: hs.note });
      setModale(null);
      setHs({ employeeId: '', date: '', hours: '', category: '', note: '' });
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }
  const supprimer = (action, id) => action(id).then(charger).catch((err) => setErreur(err.message));

  const joursNonPayes = absences.filter((a) => !a.is_paid).reduce((s, a) => s + Number(a.days), 0);
  const totalHeures = heures.reduce((s, h) => s + Number(h.hours), 0);
  const choixEmploye = (id, valeur, onChange) => (
    <select id={id} className="champ" required value={valeur} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Employé —</option>
      {employes.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
    </select>
  );

  return (
    <>
      <div className="md-kpis">
        <Kpi hero label="Jours d'absence non payés" valeur={joursNonPayes} sous={`retenus sur les bulletins de ${formatMois(mois)}`} />
        <Kpi label="Heures supplémentaires" valeur={totalHeures} unite="h" sous={`ajoutées aux bulletins de ${formatMois(mois)}`} />
      </div>

      <div className="md-outils">
        <div className="champ-groupe" style={{ marginBottom: 0 }}>
          <label className="etiquette" htmlFor="ah-mois">Mois</label>
          <input id="ah-mois" type="month" className="champ" value={mois} onChange={(e) => setMois(e.target.value)} />
        </div>
        <button className="btn btn-principal" onClick={() => { setErreur(''); setModale('absence'); }}>Nouvelle absence</button>
        <button className="btn" onClick={() => { setErreur(''); setModale('heures'); }}>Heures supplémentaires</button>
      </div>

      {erreur && !modale && <div className="erreur">{erreur}</div>}
      <div className="md-info">Les absences non payées et les heures supplémentaires saisies ici sont reprises automatiquement à la génération du bulletin. Une absence compte pour le mois de sa date de début. Un mois déjà payé ne peut plus être modifié.</div>

      <h2 style={{ fontSize: 16, margin: '18px 0 10px' }}>Absences et congés</h2>
      {absences.length === 0 ? <p className="etat-vide">Aucune absence ce mois-ci.</p> : (
        <div className="md-liste">
          {absences.map((a) => (
            <Ligne
              key={a.id}
              sigle={initiales(a.full_name)}
              titre={a.full_name}
              sous={`${a.start_date} · ${Number(a.days)} jour(s)${a.note ? ` · ${a.note}` : ''}`}
              tampon={a.is_paid ? { classe: 'tampon-sarcelle', texte: TYPES_ABSENCE.find((t) => t.value === a.absence_type)?.label || 'Payée' } : { classe: 'tampon-brique', texte: TYPES_ABSENCE.find((t) => t.value === a.absence_type)?.label || 'Non payée' }}
              actions={<button className="btn" onClick={() => supprimer(api.deleteAbsence, a.id)}>Supprimer</button>}
            />
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 16, margin: '22px 0 10px' }}>Heures supplémentaires</h2>
      {majorations.length === 0 && <div className="md-info">Aucune majoration n'est configurée : ajoutez-les dans Réglages paie avant de saisir des heures supplémentaires.</div>}
      {heures.length === 0 ? <p className="etat-vide">Aucune heure supplémentaire ce mois-ci.</p> : (
        <div className="md-liste">
          {heures.map((h) => (
            <Ligne
              key={h.id}
              sigle={initiales(h.full_name)}
              titre={h.full_name}
              sous={`${h.work_date}${h.note ? ` · ${h.note}` : ''}`}
              tampon={{ classe: 'tampon-laiton', texte: majorations.find((m) => m.code === h.category)?.label || h.category }}
              detail={`${Number(h.hours)} h`}
              actions={<button className="btn" onClick={() => supprimer(api.deleteOvertime, h.id)}>Supprimer</button>}
            />
          ))}
        </div>
      )}

      {modale === 'absence' && (
        <Fenetre sigle="AB" titre="Nouvelle absence" sous={`Pour ${formatMois(mois)} ou le mois de la date choisie`} onClose={() => setModale(null)}>
          <form onSubmit={ajouterAbsence}>
            <Section numero="1" titre="Absence">
              <div className="md-fiche-grille">
                <Champ id="ab-emp" label="Employé">{choixEmploye('ab-emp', abs.employeeId, (v) => setAbs((a) => ({ ...a, employeeId: v })))}</Champ>
                <Champ id="ab-type" label="Type">
                  <select id="ab-type" className="champ" value={abs.type} onChange={(e) => setAbs((a) => ({ ...a, type: e.target.value }))}>
                    {TYPES_ABSENCE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Champ>
                <Champ id="ab-date" label="Date de début"><input id="ab-date" type="date" required className="champ" value={abs.startDate} onChange={(e) => setAbs((a) => ({ ...a, startDate: e.target.value }))} /></Champ>
                <Champ id="ab-jours" label="Nombre de jours"><input id="ab-jours" type="number" step="0.5" min="0.5" required className="champ" value={abs.days} onChange={(e) => setAbs((a) => ({ ...a, days: e.target.value }))} /></Champ>
                <Champ id="ab-note" label="Note"><input id="ab-note" className="champ" value={abs.note} onChange={(e) => setAbs((a) => ({ ...a, note: e.target.value }))} /></Champ>
              </div>
            </Section>
            {erreur && <div className="erreur">{erreur}</div>}
            <div className="actions-modale">
              <button type="button" className="btn" onClick={() => setModale(null)}>Annuler</button>
              <button type="submit" className="btn btn-principal" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </form>
        </Fenetre>
      )}

      {modale === 'heures' && (
        <Fenetre sigle="HS" titre="Heures supplémentaires" sous="Majorées selon la catégorie choisie" onClose={() => setModale(null)}>
          <form onSubmit={ajouterHeures}>
            <Section numero="1" titre="Heures">
              <div className="md-fiche-grille">
                <Champ id="hs-emp" label="Employé">{choixEmploye('hs-emp', hs.employeeId, (v) => setHs((h) => ({ ...h, employeeId: v })))}</Champ>
                <Champ id="hs-jour" label="Date"><input id="hs-jour" type="date" required className="champ" value={hs.date} onChange={(e) => setHs((h) => ({ ...h, date: e.target.value }))} /></Champ>
                <Champ id="hs-nb" label="Nombre d'heures"><input id="hs-nb" type="number" step="0.25" min="0.25" required className="champ" value={hs.hours} onChange={(e) => setHs((h) => ({ ...h, hours: e.target.value }))} /></Champ>
                <Champ id="hs-cat" label="Majoration">
                  <select id="hs-cat" className="champ" required value={hs.category} onChange={(e) => setHs((h) => ({ ...h, category: e.target.value }))}>
                    <option value="">— Choisir —</option>
                    {majorations.map((m) => <option key={m.code} value={m.code}>{m.label} (x{m.rate})</option>)}
                  </select>
                </Champ>
                <Champ id="hs-note" label="Note"><input id="hs-note" className="champ" value={hs.note} onChange={(e) => setHs((h) => ({ ...h, note: e.target.value }))} /></Champ>
              </div>
            </Section>
            {erreur && <div className="erreur">{erreur}</div>}
            <div className="actions-modale">
              <button type="button" className="btn" onClick={() => setModale(null)}>Annuler</button>
              <button type="submit" className="btn btn-principal" disabled={enCours || majorations.length === 0}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </form>
        </Fenetre>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Avances et prêts
// ---------------------------------------------------------------------------
const AVANCE_VIDE = {
  employeeId: '', kind: 'avance', amount: '', advanceDate: aujourdhui(), repayMode: 'unique', installments: '3', monthlyAmount: '',
  startMonth: '', paymentMethod: 'especes', warehouseId: '', note: '',
};

export function AvancesTab() {
  const boutiques = useBoutiques();
  const [statut, setStatut] = useState('en_cours');
  const [liste, setListe] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [erreur, setErreur] = useState('');
  const [form, setForm] = useState(null);
  const [enCours, setEnCours] = useState(false);

  function charger() {
    api.getAdvances(statut === 'tous' ? '' : statut).then(setListe).catch((e) => setErreur(e.message));
  }
  useEffect(charger, [statut]);
  useEffect(() => { api.getEmployees('actif').then(setEmployes).catch(() => {}); }, []);

  const maj = (champ, valeur) => setForm((f) => ({ ...f, [champ]: valeur }));

  async function enregistrer(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    try {
      await api.addAdvance(form.employeeId, {
        kind: form.kind, amount: Number(form.amount), advanceDate: form.advanceDate, repayMode: form.repayMode,
        installments: form.repayMode === 'echelonne' ? Number(form.installments) : undefined,
        monthlyAmount: form.repayMode === 'libre' ? Number(form.monthlyAmount) : undefined,
        startMonth: form.startMonth || undefined, paymentMethod: form.paymentMethod,
        warehouseId: MODES_CAISSE.includes(form.paymentMethod) ? form.warehouseId : undefined, note: form.note,
      });
      setForm(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  const enCoursListe = liste.filter((a) => a.status === 'en_cours');
  const reste = enCoursListe.reduce((s, a) => s + Number(a.balance), 0);

  return (
    <>
      <div className="md-kpis">
        <Kpi hero label="Reste à rembourser" valeur={fcfa(reste)} unite="FCFA" sous={`${enCoursListe.length} avance(s) ou prêt(s) en cours`} />
      </div>

      <div className="md-outils">
        <div className="champ-groupe" style={{ marginBottom: 0 }}>
          <label className="etiquette" htmlFor="av-statut">Afficher</label>
          <select id="av-statut" className="champ" value={statut} onChange={(e) => setStatut(e.target.value)}>
            <option value="en_cours">En cours</option>
            <option value="solde">Soldées</option>
            <option value="tous">Toutes</option>
          </select>
        </div>
        <button className="btn btn-principal" onClick={() => { setErreur(''); setForm({ ...AVANCE_VIDE }); }}>Nouvelle avance</button>
      </div>

      {erreur && !form && <div className="erreur">{erreur}</div>}
      <div className="md-info">L'avance est une sortie de caisse. Elle est ensuite retenue automatiquement sur les bulletins, selon le mode choisi, sans jamais rendre le net négatif.</div>

      {liste.length === 0 ? <p className="etat-vide">Aucune avance.</p> : (
        <div className="md-liste">
          {liste.map((a) => (
            <Ligne
              key={a.id}
              sigle={initiales(a.full_name)}
              titre={`${a.full_name} · ${a.kind === 'pret' ? 'Prêt' : 'Avance'} de ${fcfa(a.amount)} FCFA`}
              sous={`Le ${a.advance_date} · ${a.repay_mode === 'unique' ? 'retenue unique' : a.repay_mode === 'echelonne' ? `${a.installments} mensualités` : 'montant libre'} de ${fcfa(a.monthly_amount)} FCFA dès ${a.start_month}`}
              tampon={a.status === 'solde' ? { classe: 'tampon-sarcelle', texte: 'Soldée' } : { classe: 'tampon-laiton', texte: 'En cours' }}
              detail={`Reste : ${fcfa(a.balance)} FCFA`}
            />
          ))}
        </div>
      )}

      {form && (
        <Fenetre sigle="AV" titre="Nouvelle avance ou prêt" sous="Sortie de caisse, puis retenue sur les bulletins" onClose={() => setForm(null)}>
          <form onSubmit={enregistrer}>
            <Section numero="1" titre="Avance">
              <div className="md-fiche-grille">
                <Champ id="av-emp" label="Employé">
                  <select id="av-emp" className="champ" required value={form.employeeId} onChange={(e) => maj('employeeId', e.target.value)}>
                    <option value="">— Employé —</option>
                    {employes.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                  </select>
                </Champ>
                <Champ id="av-nature" label="Nature">
                  <select id="av-nature" className="champ" value={form.kind} onChange={(e) => maj('kind', e.target.value)}>
                    <option value="avance">Avance sur salaire</option>
                    <option value="pret">Prêt</option>
                  </select>
                </Champ>
                <Champ id="av-montant" label="Montant (FCFA)"><input id="av-montant" type="number" min="1" required className="champ" value={form.amount} onChange={(e) => maj('amount', e.target.value)} /></Champ>
                <Champ id="av-date" label="Date de versement"><input id="av-date" type="date" required className="champ" value={form.advanceDate} onChange={(e) => maj('advanceDate', e.target.value)} /></Champ>
              </div>
            </Section>

            <Section numero="2" titre="Remboursement">
              <div className="md-fiche-grille">
                <Champ id="av-mode" label="Mode">
                  <select id="av-mode" className="champ" value={form.repayMode} onChange={(e) => maj('repayMode', e.target.value)}>
                    <option value="unique">Retenue unique sur un bulletin</option>
                    <option value="echelonne">Échelonné sur plusieurs mois</option>
                    <option value="libre">Montant mensuel libre</option>
                  </select>
                </Champ>
                {form.repayMode === 'echelonne' && (
                  <Champ id="av-nb" label="Nombre de mensualités"><input id="av-nb" type="number" min="2" max="60" className="champ" value={form.installments} onChange={(e) => maj('installments', e.target.value)} /></Champ>
                )}
                {form.repayMode === 'libre' && (
                  <Champ id="av-mensuel" label="Retenue mensuelle (FCFA)"><input id="av-mensuel" type="number" min="1" className="champ" value={form.monthlyAmount} onChange={(e) => maj('monthlyAmount', e.target.value)} /></Champ>
                )}
                <Champ id="av-debut" label="Première retenue (vide = mois suivant)"><input id="av-debut" type="month" className="champ" value={form.startMonth} onChange={(e) => maj('startMonth', e.target.value)} /></Champ>
              </div>
            </Section>

            <Section numero="3" titre="Versement">
              <div className="md-fiche-grille">
                <Champ id="av-pay" label="Versée par">
                  <select id="av-pay" className="champ" value={form.paymentMethod} onChange={(e) => maj('paymentMethod', e.target.value)}>
                    {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </Champ>
                {MODES_CAISSE.includes(form.paymentMethod) && (
                  <Champ id="av-boutique" label="Boutique dont la caisse paie">
                    <select id="av-boutique" className="champ" required value={form.warehouseId} onChange={(e) => maj('warehouseId', e.target.value)}>
                      <option value="">— Choisir —</option>
                      {boutiques.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </Champ>
                )}
                <Champ id="av-note" label="Note"><input id="av-note" className="champ" value={form.note} onChange={(e) => maj('note', e.target.value)} /></Champ>
              </div>
            </Section>

            {erreur && <div className="erreur">{erreur}</div>}
            <div className="actions-modale">
              <button type="button" className="btn" onClick={() => setForm(null)}>Annuler</button>
              <button type="submit" className="btn btn-principal" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Verser et enregistrer'}</button>
            </div>
          </form>
        </Fenetre>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Documents RH : modèles modifiables, émission en PDF, journal
// ---------------------------------------------------------------------------
const EMISSION_VIDE = { employeeId: '', type: 'attestation_travail', lieu: '', dureeEssai: '', dureeHebdomadaire: '', motifCdd: '' };

export function DocumentsRhTab() {
  const [modeles, setModeles] = useState([]);
  const [champs, setChamps] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [journal, setJournal] = useState([]);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [emission, setEmission] = useState(null);
  const [texte, setTexte] = useState(null);
  const [edition, setEdition] = useState(null);

  function charger() {
    api.getHrTemplates().then((d) => { setModeles(d.templates); setChamps(d.fields); }).catch((e) => setErreur(e.message));
    api.getHrIssued().then(setJournal).catch(() => {});
  }
  useEffect(() => {
    charger();
    api.getEmployees('tous').then(setEmployes).catch(() => {});
  }, []);

  const extra = () => ({ lieu: emission.lieu, dureeEssai: emission.dureeEssai, dureeHebdomadaire: emission.dureeHebdomadaire, motifCdd: emission.motifCdd });

  async function relire() {
    setErreur('');
    try {
      setTexte(await api.renderHrDocument({ employeeId: emission.employeeId, type: emission.type, extra: extra() }));
    } catch (err) {
      setErreur(err.message);
    }
  }
  async function emettre() {
    setErreur('');
    try {
      const { id } = await api.issueHrDocument({ employeeId: emission.employeeId, type: emission.type, extra: extra() });
      setMessage('Document émis et enregistré dans le journal.');
      setEmission(null);
      setTexte(null);
      charger();
      await api.openHrDocument(id);
    } catch (err) {
      setErreur(err.message);
    }
  }
  async function sauverModele() {
    setErreur('');
    try {
      await api.saveHrTemplate(edition.type, { title: edition.title, body: edition.body });
      setEdition(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }
  async function reinitialiser(type) {
    if (!window.confirm('Revenir au modèle par défaut ?')) return;
    await api.resetHrTemplate(type).catch((err) => setErreur(err.message));
    setEdition(null);
    charger();
  }
  const maj = (champ, valeur) => setEmission((s) => ({ ...s, [champ]: valeur, ...(champ === 'type' || champ === 'employeeId' ? {} : {}) }));

  return (
    <>
      <div className="md-kpis">
        <Kpi hero label="Documents émis" valeur={journal.length} sous="attestations, certificats et contrats" />
      </div>

      <div className="md-outils">
        <button className="btn btn-principal" onClick={() => { setErreur(''); setMessage(''); setTexte(null); setEmission({ ...EMISSION_VIDE }); }}>Émettre un document</button>
      </div>

      <div className="md-info">Les modèles fournis sont des points de départ, à faire valider par un professionnel du droit du travail avant tout usage officiel. Les mentions « [à compléter] » signalent une information manquante sur la fiche de l'employé.</div>
      {erreur && !emission && !edition && <div className="erreur">{erreur}</div>}
      {message && <div className="md-info">{message}</div>}

      <h2 style={{ fontSize: 16, margin: '18px 0 10px' }}>Modèles</h2>
      <div className="md-liste">
        {modeles.map((m) => (
          <Ligne
            key={m.type}
            sigle={(TYPES_DOC[m.type] || m.title).split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}
            titre={TYPES_DOC[m.type] || m.title}
            sous={m.title}
            tampon={m.custom ? { classe: 'tampon-laiton', texte: 'Personnalisé' } : { classe: 'tampon-sarcelle', texte: 'Par défaut' }}
            actions={<button className="btn" onClick={() => { setErreur(''); setEdition({ type: m.type, title: m.title, body: m.body, custom: m.custom }); }}>Modifier</button>}
          />
        ))}
      </div>

      <h2 style={{ fontSize: 16, margin: '22px 0 10px' }}>Documents émis</h2>
      {journal.length === 0 ? <p className="etat-vide">Aucun document émis.</p> : (
        <div className="md-liste">
          {journal.map((d) => (
            <Ligne
              key={d.id}
              sigle={initiales(d.employee_name)}
              titre={d.employee_name}
              sous={`${d.title} · ${new Date(d.issued_at).toLocaleDateString('fr-FR')}${d.issued_by_name ? ` · ${d.issued_by_name}` : ''}`}
              actions={<button className="btn" onClick={() => api.openHrDocument(d.id).catch((err) => setErreur(err.message))}>PDF</button>}
            />
          ))}
        </div>
      )}

      {emission && (
        <Fenetre sigle="DR" titre="Émettre un document" sous="Le texte exact émis est conservé dans le journal" onClose={() => setEmission(null)}>
          <Section numero="1" titre="Document">
            <div className="md-fiche-grille">
              <Champ id="dr-emp" label="Employé">
                <select id="dr-emp" className="champ" value={emission.employeeId} onChange={(e) => maj('employeeId', e.target.value)}>
                  <option value="">— Employé —</option>
                  {employes.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.status === 'archive' ? ' (archivé)' : ''}</option>)}
                </select>
              </Champ>
              <Champ id="dr-type" label="Document">
                <select id="dr-type" className="champ" value={emission.type} onChange={(e) => maj('type', e.target.value)}>
                  {Object.entries(TYPES_DOC).map(([valeur, label]) => <option key={valeur} value={valeur}>{label}</option>)}
                </select>
              </Champ>
              <Champ id="dr-lieu" label="Lieu de signature"><input id="dr-lieu" className="champ" value={emission.lieu} onChange={(e) => maj('lieu', e.target.value)} /></Champ>
              {emission.type.startsWith('contrat') && (
                <>
                  <Champ id="dr-essai" label="Période d'essai"><input id="dr-essai" className="champ" placeholder="ex. 3 mois" value={emission.dureeEssai} onChange={(e) => maj('dureeEssai', e.target.value)} /></Champ>
                  <Champ id="dr-heb" label="Durée hebdomadaire"><input id="dr-heb" className="champ" placeholder="ex. 40 heures" value={emission.dureeHebdomadaire} onChange={(e) => maj('dureeHebdomadaire', e.target.value)} /></Champ>
                </>
              )}
              {emission.type === 'contrat_cdd' && (
                <Champ id="dr-motif" label="Motif du CDD"><input id="dr-motif" className="champ" value={emission.motifCdd} onChange={(e) => maj('motifCdd', e.target.value)} /></Champ>
              )}
            </div>
          </Section>

          {texte && (
            <Section numero="2" titre={texte.title}>
              <p style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5 }}>{texte.text}</p>
            </Section>
          )}

          {erreur && <div className="erreur">{erreur}</div>}
          <div className="actions-modale">
            <button type="button" className="btn" onClick={() => setEmission(null)}>Fermer</button>
            <button type="button" className="btn" disabled={!emission.employeeId} onClick={relire}>Relire le texte</button>
            <button type="button" className="btn btn-principal" disabled={!emission.employeeId} onClick={emettre}>Émettre en PDF</button>
          </div>
        </Fenetre>
      )}

      {edition && (
        <Fenetre sigle="MD" titre="Modifier le modèle" sous={TYPES_DOC[edition.type]} onClose={() => setEdition(null)}>
          <div className="md-info">Champs disponibles (à écrire entre doubles accolades) : {champs.map((c) => `{{${c.code}}}`).join(', ')}</div>
          <Section numero="1" titre="Contenu">
            <Champ id="md-titre" label="Titre"><input id="md-titre" className="champ" value={edition.title} onChange={(e) => setEdition((s) => ({ ...s, title: e.target.value }))} /></Champ>
            <Champ id="md-texte" label="Texte"><textarea id="md-texte" className="champ" rows={14} value={edition.body} onChange={(e) => setEdition((s) => ({ ...s, body: e.target.value }))} /></Champ>
          </Section>
          {erreur && <div className="erreur">{erreur}</div>}
          <div className="actions-modale">
            {edition.custom && <button type="button" className="btn" onClick={() => reinitialiser(edition.type)}>Modèle par défaut</button>}
            <button type="button" className="btn" onClick={() => setEdition(null)}>Annuler</button>
            <button type="button" className="btn btn-principal" onClick={sauverModele}>Enregistrer</button>
          </div>
        </Fenetre>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// États : livre de paie, cotisations IPRES/CSS, récapitulatif annuel, masse salariale
// ---------------------------------------------------------------------------
export function EtatsTab() {
  const [mois, setMois] = useState(moisActuel());
  const [annee, setAnnee] = useState(String(new Date().getFullYear()));
  const [erreur, setErreur] = useState('');
  const [masse, setMasse] = useState(null);

  const ouvrir = (kind, params, format) => {
    setErreur('');
    api.openPayrollReport(kind, params, format).catch((e) => setErreur(e.message));
  };

  useEffect(() => {
    api.getPayrollReport('masse-salariale', { year: annee }).then(setMasse).catch(() => setMasse(null));
  }, [annee]);

  const etats = [
    { sigle: 'LP', titre: `Livre de paie — ${formatMois(mois)}`, sous: 'Tous les bulletins du mois, ligne par ligne, avec les totaux.', kind: 'livre', params: { month: mois } },
    { sigle: 'CO', titre: `Cotisations IPRES et CSS — ${formatMois(mois)}`, sous: 'Parts salariales et patronales par employé, avec les numéros.', kind: 'cotisations', params: { month: mois } },
    { sigle: 'RA', titre: `Récapitulatif annuel — ${annee}`, sous: "Brut, cotisations, impôts, net et coût employeur sur l'année.", kind: 'annuel', params: { year: annee } },
    { sigle: 'MS', titre: `Masse salariale — ${annee}`, sous: 'Évolution mois par mois : brut, net, charges patronales, coût employeur.', kind: 'masse-salariale', params: { year: annee } },
  ];
  const totalCout = masse?.totaux?.cout_total_employeur || 0;
  const totalNet = masse?.totaux?.net_a_payer || 0;

  return (
    <>
      <div className="md-kpis">
        <Kpi hero label={`Coût employeur ${annee}`} valeur={fcfa(totalCout)} unite="FCFA" sous="brut + charges patronales, bulletins générés" />
        <Kpi label={`Net versé ${annee}`} valeur={fcfa(totalNet)} unite="FCFA" sous="total des nets à payer" />
      </div>

      <div className="md-outils">
        <div className="champ-groupe" style={{ marginBottom: 0 }}>
          <label className="etiquette" htmlFor="et-mois">Mois</label>
          <input id="et-mois" type="month" className="champ" value={mois} onChange={(e) => setMois(e.target.value)} />
        </div>
        <div className="champ-groupe" style={{ marginBottom: 0 }}>
          <label className="etiquette" htmlFor="et-annee">Année</label>
          <input id="et-annee" type="number" className="champ" value={annee} onChange={(e) => setAnnee(e.target.value)} />
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="md-liste">
        {etats.map((e) => (
          <Ligne
            key={e.kind}
            sigle={e.sigle}
            titre={e.titre}
            sous={e.sous}
            actions={(
              <>
                <button className="btn" onClick={() => ouvrir(e.kind, e.params, 'pdf')}>PDF</button>
                <button className="btn" onClick={() => ouvrir(e.kind, e.params, 'csv')}>Excel (CSV)</button>
              </>
            )}
          />
        ))}
      </div>

      {masse && masse.lignes.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: '22px 0 10px' }}>Tableau de bord {annee}</h2>
          <div className="md-liste">
            {masse.lignes.map((l) => (
              <Ligne
                key={l.mois}
                sigle={l.mois.slice(5)}
                titre={formatMois(l.mois)}
                sous={`${l.effectif} bulletin(s) · brut ${fcfa(l.gross_salary)} FCFA`}
                tampon={{ classe: Number(l.paye) >= Number(l.net_a_payer) ? 'tampon-sarcelle' : 'tampon-laiton', texte: Number(l.paye) >= Number(l.net_a_payer) ? 'Payé' : 'À payer' }}
                detail={`Net ${fcfa(l.net_a_payer)} · coût employeur ${fcfa(l.cout_total_employeur)} FCFA`}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Réglages de période (à la suite de l'onglet Réglages paie) : même présentation que ce dernier.
// ---------------------------------------------------------------------------
export function ReglagesPeriodeSection() {
  const [chargement, setChargement] = useState(true);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState('');
  const [baseJours, setBaseJours] = useState('30');
  const [heuresParJour, setHeuresParJour] = useState('8');
  const [majorations, setMajorations] = useState([]);
  const [numIpres, setNumIpres] = useState('');
  const [numCss, setNumCss] = useState('');

  useEffect(() => {
    api.getPayrollSettings().then((r) => {
      setBaseJours(String(r.working_days_base ?? 30));
      setHeuresParJour(String(r.hours_per_day ?? 8));
      setMajorations(Array.isArray(r.overtime_rates) ? r.overtime_rates.map((m) => ({ code: m.code, label: m.label, rate: String(m.rate) })) : []);
      setNumIpres(r.employer_ipres_number || '');
      setNumCss(r.employer_css_number || '');
    }).catch((e) => setErreur(e.message)).finally(() => setChargement(false));
  }, []);

  async function enregistrer(e) {
    e.preventDefault();
    setEnvoiEnCours(true);
    setErreur('');
    setSucces('');
    try {
      await api.updatePayrollSettings({
        working_days_base: Number(baseJours),
        hours_per_day: Number(heuresParJour),
        overtime_rates: majorations.filter((m) => m.code.trim()).map((m) => ({ code: m.code.trim(), label: m.label.trim() || m.code.trim(), rate: Number(m.rate) })),
        employer_ipres_number: numIpres,
        employer_css_number: numCss,
      });
      setSucces('Réglages enregistrés.');
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  if (chargement) return null;
  const majMajoration = (i, champ, valeur) => setMajorations((l) => l.map((m, j) => (j === i ? { ...m, [champ]: valeur } : m)));

  return (
    <form onSubmit={enregistrer} style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Absences et heures supplémentaires</h2>
      <p className="md-aide" style={{ marginBottom: 10 }}>Aucune valeur légale n'est imposée : renseignez ce qui s'applique à votre entreprise, après validation par un professionnel.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
        <div className="champ-groupe" style={{ flex: 1 }}>
          <label className="etiquette">Base de jours (retenue d'absence)</label>
          <input type="number" min="20" max="31" className="champ" value={baseJours} onChange={(e) => setBaseJours(e.target.value)} />
        </div>
        <div className="champ-groupe" style={{ flex: 1 }}>
          <label className="etiquette">Heures par jour (taux horaire)</label>
          <input type="number" step="0.25" className="champ" value={heuresParJour} onChange={(e) => setHeuresParJour(e.target.value)} />
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Majorations d'heures supplémentaires</h2>
      {majorations.map((m, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
          <input type="text" className="champ" placeholder="Code (ex. h15)" value={m.code} onChange={(e) => majMajoration(i, 'code', e.target.value)} style={{ flex: 1 }} />
          <input type="text" className="champ" placeholder="Libellé (ex. Heures sup +15 %)" value={m.label} onChange={(e) => majMajoration(i, 'label', e.target.value)} style={{ flex: 2 }} />
          <input type="number" step="0.01" className="champ" placeholder="Coefficient (1,15 = +15 %)" value={m.rate} onChange={(e) => majMajoration(i, 'rate', e.target.value)} style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={() => setMajorations((l) => l.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => setMajorations((l) => [...l, { code: '', label: '', rate: '' }])} style={{ marginBottom: 22 }}>+ Ajouter une majoration</button>

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Numéros employeur</h2>
      <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
        <div className="champ-groupe" style={{ flex: 1 }}>
          <label className="etiquette">N° employeur IPRES</label>
          <input type="text" className="champ" value={numIpres} onChange={(e) => setNumIpres(e.target.value)} />
        </div>
        <div className="champ-groupe" style={{ flex: 1 }}>
          <label className="etiquette">N° employeur CSS</label>
          <input type="text" className="champ" value={numCss} onChange={(e) => setNumCss(e.target.value)} />
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}
      {succes && <p style={{ color: 'var(--succes, #1a7f37)', fontSize: 13, marginBottom: 12 }}>{succes}</p>}
      <div>
        <button type="submit" className="btn btn-principal" disabled={envoiEnCours}>{envoiEnCours ? 'Enregistrement…' : 'Enregistrer ces réglages'}</button>
      </div>
    </form>
  );
}
