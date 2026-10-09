import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Écrans complémentaires du module Paie : employés (avec ou sans compte), absences et heures
// supplémentaires, avances et prêts, documents RH, états, actions de fin de mois et réglages de période.
// Mêmes classes CSS que PaiePage.jsx.

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

function Champ({ label, children }) {
  return (
    <div className="champ-groupe">
      <label className="etiquette">{label}</label>
      {children}
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
// Actions du mois (onglet Salaires) : génération en masse, masse salariale, paiement groupé, envoi, exports
// ---------------------------------------------------------------------------
export function ActionsMois({ mois, onChange }) {
  const boutiques = useBoutiques();
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [apercu, setApercu] = useState(null);
  const [paiement, setPaiement] = useState(false);
  const [boutique, setBoutique] = useState('');
  const [retour, setRetour] = useState(null);

  async function lancer(action) {
    setOccupe(true);
    setErreur('');
    setMessage('');
    try {
      await action();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setOccupe(false);
    }
  }

  const genererTout = () => lancer(async () => {
    const r = await api.generateAllPayslips(mois);
    setMessage(`${r.generated.length} bulletin(s) généré(s), ${r.skipped.length} ignoré(s)${r.errors.length ? `, ${r.errors.length} en erreur : ${r.errors.map((e) => `${e.name} (${e.error})`).join(' ; ')}` : ''}.`);
    onChange();
  });

  const voirApercu = () => lancer(async () => setApercu(await api.previewPayrollMonth(mois)));

  const payerTout = () => lancer(async () => {
    const r = await api.payAllSalaries({ month: mois, warehouseId: boutique });
    setPaiement(false);
    setMessage(`${r.paid.length} salaire(s) payé(s) pour ${fcfa(r.total)} FCFA.${r.withoutPayslip.length ? ` Sans bulletin : ${r.withoutPayslip.join(', ')}.` : ''}`);
    onChange();
  });

  const envoyer = () => lancer(async () => {
    const r = await api.sendPayslips(mois);
    setRetour(r);
    onChange();
  });

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="md-outils" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn btn-principal" disabled={occupe} onClick={genererTout}>Générer tous les bulletins</button>
        <button className="btn" disabled={occupe} onClick={voirApercu}>Masse salariale du mois</button>
        <button className="btn" disabled={occupe} onClick={() => setPaiement(true)}>Payer tout</button>
        <button className="btn" disabled={occupe} onClick={envoyer}>Envoyer les bulletins</button>
        <button className="btn" disabled={occupe} onClick={() => lancer(() => api.printPayslipsPdf(mois))}>Imprimer (sans e-mail)</button>
        <button className="btn" disabled={occupe} onClick={() => lancer(() => api.downloadSalaryExport(mois, 'virement'))}>Export virements</button>
        <button className="btn" disabled={occupe} onClick={() => lancer(() => api.downloadSalaryExport(mois, 'mobile'))}>Export mobile money</button>
      </div>

      {erreur && <div className="erreur" style={{ marginTop: 8 }}>{erreur}</div>}
      {message && <div className="md-info" style={{ marginTop: 8 }}>{message}</div>}

      {retour && (
        <div className="md-info" style={{ marginTop: 8 }}>
          <p>{retour.sent.length} bulletin(s) envoyé(s) par e-mail.</p>
          {retour.toPrint.length > 0 && <p>À imprimer (ni compte ni e-mail) : {retour.toPrint.map((e) => e.name).join(', ')}.</p>}
          {retour.accounts.length > 0 && <p>À télécharger par l'employé depuis son compte : {retour.accounts.map((e) => e.name).join(', ')}.</p>}
          {retour.errors.length > 0 && <p className="erreur">Échecs : {retour.errors.map((e) => `${e.name} (${e.error})`).join(' ; ')}</p>}
          <button className="btn" onClick={() => setRetour(null)}>Fermer</button>
        </div>
      )}

      {apercu && (
        <div className="md-fiche-section" style={{ marginTop: 12 }}>
          <h3>Masse salariale — {formatMois(apercu.month)}</h3>
          <div className="md-liste">
            {apercu.employees.map((l) => (
              <div key={l.id} className="md-ligne">
                <div className="md-bloc"><p className="md-titre">{l.name}</p>
                  <p className="md-sous">{l.error ? l.error : `${l.paid ? 'Payé' : l.hasPayslip ? 'Bulletin généré' : 'Estimation'}${l.number ? ` · ${l.number}` : ''}`}</p></div>
                <div className="md-bloc md-bloc--montant">
                  <p className="md-sous">Brut {fcfa(l.gross)} · Net {fcfa(l.net)} · Coût employeur {fcfa(l.employerCost)} FCFA</p>
                </div>
              </div>
            ))}
          </div>
          <p className="md-titre" style={{ marginTop: 8 }}>
            Total : brut {fcfa(apercu.totals.gross)} · net {fcfa(apercu.totals.net)} · coût employeur {fcfa(apercu.totals.employerCost)} FCFA
          </p>
          <button className="btn" onClick={() => setApercu(null)}>Fermer</button>
        </div>
      )}

      {paiement && (
        <div className="modale-fond" onClick={() => setPaiement(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Payer tous les salaires — {formatMois(mois)}</h2>
            <p className="md-aide">Chaque employé est payé selon le mode de sa fiche, au montant exact de son bulletin. Les sorties d'argent sont prises sur la caisse de la boutique choisie, dont le solde est vérifié avant tout paiement.</p>
            <Champ label="Boutique dont la caisse paie">
              <select className="champ" value={boutique} onChange={(e) => setBoutique(e.target.value)}>
                <option value="">— Choisir —</option>
                {boutiques.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Champ>
            {erreur && <div className="erreur">{erreur}</div>}
            <div className="actions-modale">
              <button className="btn" onClick={() => setPaiement(false)}>Annuler</button>
              <button className="btn btn-principal" disabled={!boutique || occupe} onClick={payerTout}>{occupe ? 'Paiement…' : 'Payer tout'}</button>
            </div>
          </div>
        </div>
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
  const [fiche, setFiche] = useState(null); // { id|null, ...champs }
  const [historique, setHistorique] = useState([]);
  const [nouveauSalaire, setNouveauSalaire] = useState({ monthlySalary: '', effectiveFrom: aujourdhui(), note: '' });
  const [enCours, setEnCours] = useState(false);

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

  // Simulateur net → brut : le serveur calcule le net pour un brut ; on cherche le brut qui donne le net voulu.
  const [simu, setSimu] = useState({ netVoulu: '', resultat: null, enCours: false });
  async function simuler() {
    const cible = Number(simu.netVoulu);
    if (!(cible > 0) || !fiche?.id) return;
    setSimu((s) => ({ ...s, enCours: true, resultat: null }));
    try {
      const r = await api.getPayrollSettings();
      const brut = trouverBrut(cible, r, fiche);
      setSimu((s) => ({ ...s, enCours: false, resultat: brut }));
    } catch (err) {
      setErreur(err.message);
      setSimu((s) => ({ ...s, enCours: false }));
    }
  }

  return (
    <>
      <div className="md-outils" style={{ gap: 8 }}>
        <div className="champ-groupe" style={{ marginBottom: 0 }}>
          <label className="etiquette">Afficher</label>
          <select className="champ" value={statut} onChange={(e) => setStatut(e.target.value)}>
            <option value="actif">Employés actifs</option>
            <option value="archive">Archivés</option>
            <option value="tous">Tous</option>
          </select>
        </div>
        <button className="btn btn-principal" onClick={() => ouvrir(null)}>Nouvel employé</button>
      </div>
      {erreur && !fiche && <div className="erreur">{erreur}</div>}

      {chargement ? <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p> : liste.length === 0 ? (
        <p className="etat-vide">Aucun employé.</p>
      ) : (
        <div className="md-liste">
          {liste.map((emp) => (
            <div key={emp.id} className="md-ligne">
              <div className="md-avatar">{initiales(emp.full_name)}</div>
              <div className="md-bloc">
                <p className="md-titre">{emp.full_name}</p>
                <p className="md-sous">
                  {[emp.job_title, emp.contract_type && emp.contract_type.toUpperCase(), emp.has_account ? 'Compte' : 'Sans compte', emp.status === 'archive' ? 'Archivé' : null].filter(Boolean).join(' · ')}
                  {emp.monthly_salary ? ` · ${fcfa(emp.monthly_salary)} FCFA` : ' · salaire non configuré'}
                </p>
              </div>
              <div className="md-actions">
                <button className="btn" onClick={() => ouvrir(emp)}>Fiche</button>
                {emp.status === 'actif'
                  ? <button className="btn" onClick={() => changerStatut(emp, true)}>Archiver</button>
                  : <button className="btn" onClick={() => changerStatut(emp, false)}>Réactiver</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {fiche && (
        <div className="modale-fond" onClick={() => setFiche(null)}>
          <div className="modale md-fiche" onClick={(e) => e.stopPropagation()}>
            <h2>{fiche.id ? "Fiche de l'employé" : 'Nouvel employé'}</h2>
            <p className="md-aide">Données personnelles : visibles par le manager uniquement. Une adresse e-mail permet l'envoi du bulletin par e-mail.</p>
            <form onSubmit={enregistrer}>
              <Champ label="Nom complet"><input className="champ" required value={fiche.fullName} onChange={(e) => maj('fullName', e.target.value)} /></Champ>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}><Champ label="Téléphone"><input className="champ" value={fiche.phone} onChange={(e) => maj('phone', e.target.value)} /></Champ></div>
                <div style={{ flex: 1 }}><Champ label="E-mail"><input type="email" className="champ" value={fiche.email} onChange={(e) => maj('email', e.target.value)} /></Champ></div>
              </div>
              <Champ label="Adresse"><input className="champ" value={fiche.address} onChange={(e) => maj('address', e.target.value)} /></Champ>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}><Champ label="Poste"><input className="champ" value={fiche.jobTitle} onChange={(e) => maj('jobTitle', e.target.value)} /></Champ></div>
                <div style={{ flex: 1 }}>
                  <Champ label="Contrat">
                    <select className="champ" value={fiche.contractType} onChange={(e) => maj('contractType', e.target.value)}>
                      {CONTRATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </Champ>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}><Champ label="Date d'embauche"><input type="date" className="champ" value={fiche.hireDate} onChange={(e) => maj('hireDate', e.target.value)} /></Champ></div>
                <div style={{ flex: 1 }}><Champ label="Date de fin (CDD, départ)"><input type="date" className="champ" value={fiche.endDate} onChange={(e) => maj('endDate', e.target.value)} /></Champ></div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}><Champ label="N° IPRES"><input className="champ" value={fiche.ipresNumber} onChange={(e) => maj('ipresNumber', e.target.value)} /></Champ></div>
                <div style={{ flex: 1 }}><Champ label="N° CSS"><input className="champ" value={fiche.cssNumber} onChange={(e) => maj('cssNumber', e.target.value)} /></Champ></div>
              </div>
              <Champ label="Boutique de rattachement">
                <select className="champ" value={fiche.warehouseId} onChange={(e) => maj('warehouseId', e.target.value)}>
                  <option value="">— Aucune —</option>
                  {boutiques.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </Champ>
              {!fiche.id && (
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}><Champ label="Salaire de base mensuel (FCFA)"><input type="number" className="champ" value={fiche.monthlySalary} onChange={(e) => maj('monthlySalary', e.target.value)} /></Champ></div>
                  <div style={{ flex: 1 }}>
                    <Champ label="Mode de paiement">
                      <select className="champ" value={fiche.paymentMethod} onChange={(e) => maj('paymentMethod', e.target.value)}>
                        {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </Champ>
                  </div>
                </div>
              )}
              {erreur && <div className="erreur">{erreur}</div>}
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setFiche(null)}>Fermer</button>
                <button type="submit" className="btn btn-principal" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
              </div>
            </form>

            {fiche.id && (
              <section className="md-fiche-section" style={{ marginTop: 16 }}>
                <h3>Historique des salaires</h3>
                {historique.length === 0 ? <p className="md-sous">Aucun salaire enregistré.</p> : (
                  <ul className="md-puces">
                    {historique.map((h) => (
                      <li key={h.id}>{h.effective_from} — {fcfa(h.monthly_salary)} FCFA{h.note ? ` (${h.note})` : ''}</li>
                    ))}
                  </ul>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <Champ label="Nouveau salaire (FCFA)"><input type="number" className="champ" value={nouveauSalaire.monthlySalary} onChange={(e) => setNouveauSalaire((s) => ({ ...s, monthlySalary: e.target.value }))} /></Champ>
                  <Champ label="À compter du"><input type="date" className="champ" value={nouveauSalaire.effectiveFrom} onChange={(e) => setNouveauSalaire((s) => ({ ...s, effectiveFrom: e.target.value }))} /></Champ>
                  <button type="button" className="btn" disabled={!nouveauSalaire.monthlySalary} onClick={ajouterSalaire}>Ajouter</button>
                </div>

                <h3 style={{ marginTop: 16 }}>Simulateur net → brut</h3>
                <p className="md-aide">Indique le net souhaité : le brut correspondant est estimé avec vos réglages de paie (parts fiscales, IPRES/CSS de la fiche, hors primes et retenues).</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <Champ label="Net souhaité (FCFA)"><input type="number" className="champ" value={simu.netVoulu} onChange={(e) => setSimu((s) => ({ ...s, netVoulu: e.target.value, resultat: null }))} /></Champ>
                  <button type="button" className="btn" disabled={simu.enCours} onClick={simuler}>Estimer</button>
                </div>
                {simu.resultat && <p className="md-titre">Brut estimé : {fcfa(simu.resultat)} FCFA</p>}
              </section>
            )}
          </div>
        </div>
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
  const [abs, setAbs] = useState({ employeeId: '', type: 'non_payee', startDate: '', days: '', note: '' });
  const [hs, setHs] = useState({ employeeId: '', date: '', hours: '', category: '', note: '' });

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
    setErreur('');
    try {
      await api.addAbsence(abs.employeeId, { type: abs.type, startDate: abs.startDate, days: Number(abs.days), note: abs.note });
      setAbs((a) => ({ ...a, days: '', note: '' }));
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }
  async function ajouterHeures(e) {
    e.preventDefault();
    setErreur('');
    try {
      await api.addOvertime(hs.employeeId, { date: hs.date, hours: Number(hs.hours), category: hs.category, note: hs.note });
      setHs((h) => ({ ...h, hours: '', note: '' }));
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }
  const supprimer = (action, id) => action(id).then(charger).catch((err) => setErreur(err.message));

  const choixEmploye = (valeur, onChange) => (
    <select className="champ" required value={valeur} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Employé —</option>
      {employes.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
    </select>
  );

  return (
    <>
      <div className="md-outils">
        <Champ label="Mois"><input type="month" className="champ" value={mois} onChange={(e) => setMois(e.target.value)} /></Champ>
      </div>
      {erreur && <div className="erreur">{erreur}</div>}
      <p className="md-aide">Les absences non payées et les heures supplémentaires saisies ici sont reprises automatiquement à la génération du bulletin. Une absence compte pour le mois de sa date de début ; un mois déjà payé ne peut plus être modifié.</p>

      <section className="md-fiche-section">
        <h3>Absences et congés — {formatMois(mois)}</h3>
        <form onSubmit={ajouterAbsence} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Champ label="Employé">{choixEmploye(abs.employeeId, (v) => setAbs((a) => ({ ...a, employeeId: v })))}</Champ>
          <Champ label="Type">
            <select className="champ" value={abs.type} onChange={(e) => setAbs((a) => ({ ...a, type: e.target.value }))}>
              {TYPES_ABSENCE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Champ>
          <Champ label="Date de début"><input type="date" required className="champ" value={abs.startDate} onChange={(e) => setAbs((a) => ({ ...a, startDate: e.target.value }))} /></Champ>
          <Champ label="Jours"><input type="number" step="0.5" min="0.5" required className="champ" style={{ width: 90 }} value={abs.days} onChange={(e) => setAbs((a) => ({ ...a, days: e.target.value }))} /></Champ>
          <Champ label="Note"><input className="champ" value={abs.note} onChange={(e) => setAbs((a) => ({ ...a, note: e.target.value }))} /></Champ>
          <button className="btn btn-principal">Ajouter</button>
        </form>
        {absences.length === 0 ? <p className="etat-vide">Aucune absence ce mois-ci.</p> : (
          <div className="md-liste">
            {absences.map((a) => (
              <div key={a.id} className="md-ligne">
                <div className="md-bloc">
                  <p className="md-titre">{a.full_name}</p>
                  <p className="md-sous">{TYPES_ABSENCE.find((t) => t.value === a.absence_type)?.label || a.absence_type} · {a.start_date} · {Number(a.days)} jour(s){a.note ? ` · ${a.note}` : ''}</p>
                </div>
                <div className="md-actions"><button className="btn" onClick={() => supprimer(api.deleteAbsence, a.id)}>Supprimer</button></div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="md-fiche-section" style={{ marginTop: 24 }}>
        <h3>Heures supplémentaires — {formatMois(mois)}</h3>
        {majorations.length === 0 && <div className="md-info">Aucune majoration n'est configurée : ajoute-les dans Réglages paie avant de saisir des heures supplémentaires.</div>}
        <form onSubmit={ajouterHeures} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Champ label="Employé">{choixEmploye(hs.employeeId, (v) => setHs((h) => ({ ...h, employeeId: v })))}</Champ>
          <Champ label="Date"><input type="date" required className="champ" value={hs.date} onChange={(e) => setHs((h) => ({ ...h, date: e.target.value }))} /></Champ>
          <Champ label="Heures"><input type="number" step="0.25" min="0.25" required className="champ" style={{ width: 90 }} value={hs.hours} onChange={(e) => setHs((h) => ({ ...h, hours: e.target.value }))} /></Champ>
          <Champ label="Majoration">
            <select className="champ" required value={hs.category} onChange={(e) => setHs((h) => ({ ...h, category: e.target.value }))}>
              <option value="">— Choisir —</option>
              {majorations.map((m) => <option key={m.code} value={m.code}>{m.label} (x{m.rate})</option>)}
            </select>
          </Champ>
          <button className="btn btn-principal" disabled={majorations.length === 0}>Ajouter</button>
        </form>
        {heures.length === 0 ? <p className="etat-vide">Aucune heure supplémentaire ce mois-ci.</p> : (
          <div className="md-liste">
            {heures.map((h) => (
              <div key={h.id} className="md-ligne">
                <div className="md-bloc">
                  <p className="md-titre">{h.full_name}</p>
                  <p className="md-sous">{h.work_date} · {Number(h.hours)} h · {majorations.find((m) => m.code === h.category)?.label || h.category}</p>
                </div>
                <div className="md-actions"><button className="btn" onClick={() => supprimer(api.deleteOvertime, h.id)}>Supprimer</button></div>
              </div>
            ))}
          </div>
        )}
      </section>
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

  const reste = liste.filter((a) => a.status === 'en_cours').reduce((s, a) => s + Number(a.balance), 0);

  return (
    <>
      <div className="md-outils" style={{ gap: 8 }}>
        <Champ label="Afficher">
          <select className="champ" value={statut} onChange={(e) => setStatut(e.target.value)}>
            <option value="en_cours">En cours</option>
            <option value="solde">Soldées</option>
            <option value="tous">Toutes</option>
          </select>
        </Champ>
        <button className="btn btn-principal" onClick={() => { setErreur(''); setForm({ ...AVANCE_VIDE }); }}>Nouvelle avance</button>
      </div>
      {erreur && !form && <div className="erreur">{erreur}</div>}
      <p className="md-aide">L'avance est une sortie de caisse. Elle est ensuite retenue automatiquement sur les bulletins, selon le mode choisi, sans jamais rendre le net négatif. Reste à rembourser : <strong>{fcfa(reste)} FCFA</strong>.</p>

      {liste.length === 0 ? <p className="etat-vide">Aucune avance.</p> : (
        <div className="md-liste">
          {liste.map((a) => (
            <div key={a.id} className="md-ligne">
              <div className="md-bloc">
                <p className="md-titre">{a.full_name} · {a.kind === 'pret' ? 'Prêt' : 'Avance'} de {fcfa(a.amount)} FCFA</p>
                <p className="md-sous">
                  Le {a.advance_date} · {a.repay_mode === 'unique' ? 'retenue unique' : a.repay_mode === 'echelonne' ? `${a.installments} mensualités` : 'montant libre'} de {fcfa(a.monthly_amount)} FCFA dès {a.start_month}
                </p>
              </div>
              <div className="md-bloc md-bloc--montant">
                <span className={`tampon ${a.status === 'solde' ? 'tampon-sarcelle' : 'tampon-laiton'}`}>{a.status === 'solde' ? 'Soldée' : 'En cours'}</span>
                <p className="md-sous">Reste : {fcfa(a.balance)} FCFA</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div className="modale-fond" onClick={() => setForm(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle avance ou prêt</h2>
            <form onSubmit={enregistrer}>
              <Champ label="Employé">
                <select className="champ" required value={form.employeeId} onChange={(e) => maj('employeeId', e.target.value)}>
                  <option value="">— Employé —</option>
                  {employes.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </Champ>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <Champ label="Nature">
                    <select className="champ" value={form.kind} onChange={(e) => maj('kind', e.target.value)}>
                      <option value="avance">Avance sur salaire</option>
                      <option value="pret">Prêt</option>
                    </select>
                  </Champ>
                </div>
                <div style={{ flex: 1 }}><Champ label="Montant (FCFA)"><input type="number" min="1" required className="champ" value={form.amount} onChange={(e) => maj('amount', e.target.value)} /></Champ></div>
              </div>
              <Champ label="Date de versement"><input type="date" required className="champ" value={form.advanceDate} onChange={(e) => maj('advanceDate', e.target.value)} /></Champ>
              <Champ label="Remboursement">
                <select className="champ" value={form.repayMode} onChange={(e) => maj('repayMode', e.target.value)}>
                  <option value="unique">Retenue unique sur un bulletin</option>
                  <option value="echelonne">Échelonné sur plusieurs mois</option>
                  <option value="libre">Montant mensuel libre</option>
                </select>
              </Champ>
              {form.repayMode === 'echelonne' && (
                <Champ label="Nombre de mensualités"><input type="number" min="2" max="60" className="champ" value={form.installments} onChange={(e) => maj('installments', e.target.value)} /></Champ>
              )}
              {form.repayMode === 'libre' && (
                <Champ label="Montant retenu chaque mois (FCFA)"><input type="number" min="1" className="champ" value={form.monthlyAmount} onChange={(e) => maj('monthlyAmount', e.target.value)} /></Champ>
              )}
              <Champ label="Première retenue (mois, vide = mois suivant)"><input type="month" className="champ" value={form.startMonth} onChange={(e) => maj('startMonth', e.target.value)} /></Champ>
              <Champ label="Versée par">
                <select className="champ" value={form.paymentMethod} onChange={(e) => maj('paymentMethod', e.target.value)}>
                  {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Champ>
              {MODES_CAISSE.includes(form.paymentMethod) && (
                <Champ label="Boutique dont la caisse paie">
                  <select className="champ" required value={form.warehouseId} onChange={(e) => maj('warehouseId', e.target.value)}>
                    <option value="">— Choisir —</option>
                    {boutiques.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </Champ>
              )}
              <Champ label="Note"><input className="champ" value={form.note} onChange={(e) => maj('note', e.target.value)} /></Champ>
              {erreur && <div className="erreur">{erreur}</div>}
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setForm(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Verser et enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Documents RH : modèles modifiables, émission en PDF, journal
// ---------------------------------------------------------------------------
export function DocumentsRhTab() {
  const [modeles, setModeles] = useState([]);
  const [champs, setChamps] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [journal, setJournal] = useState([]);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [emission, setEmission] = useState({ employeeId: '', type: 'attestation_travail', lieu: '', dureeEssai: '', dureeHebdomadaire: '', motifCdd: '' });
  const [edition, setEdition] = useState(null); // { type, title, body }
  const [texte, setTexte] = useState(null);

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

  return (
    <>
      <div className="md-info">Les modèles fournis sont des points de départ, à faire valider par un professionnel du droit du travail avant tout usage officiel. Les mentions « [à compléter] » signalent une information manquante sur la fiche.</div>
      {erreur && <div className="erreur" style={{ marginTop: 8 }}>{erreur}</div>}
      {message && <div className="md-info" style={{ marginTop: 8 }}>{message}</div>}

      <section className="md-fiche-section" style={{ marginTop: 16 }}>
        <h3>Émettre un document</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Champ label="Employé">
            <select className="champ" value={emission.employeeId} onChange={(e) => setEmission((s) => ({ ...s, employeeId: e.target.value }))}>
              <option value="">— Employé —</option>
              {employes.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.status === 'archive' ? ' (archivé)' : ''}</option>)}
            </select>
          </Champ>
          <Champ label="Document">
            <select className="champ" value={emission.type} onChange={(e) => setEmission((s) => ({ ...s, type: e.target.value }))}>
              {Object.entries(TYPES_DOC).map(([valeur, label]) => <option key={valeur} value={valeur}>{label}</option>)}
            </select>
          </Champ>
          <Champ label="Lieu de signature"><input className="champ" value={emission.lieu} onChange={(e) => setEmission((s) => ({ ...s, lieu: e.target.value }))} /></Champ>
          {emission.type.startsWith('contrat') && (
            <>
              <Champ label="Période d'essai"><input className="champ" placeholder="ex. 3 mois" value={emission.dureeEssai} onChange={(e) => setEmission((s) => ({ ...s, dureeEssai: e.target.value }))} /></Champ>
              <Champ label="Durée hebdomadaire"><input className="champ" placeholder="ex. 40 heures" value={emission.dureeHebdomadaire} onChange={(e) => setEmission((s) => ({ ...s, dureeHebdomadaire: e.target.value }))} /></Champ>
            </>
          )}
          {emission.type === 'contrat_cdd' && (
            <Champ label="Motif du CDD"><input className="champ" value={emission.motifCdd} onChange={(e) => setEmission((s) => ({ ...s, motifCdd: e.target.value }))} /></Champ>
          )}
          <button className="btn" disabled={!emission.employeeId} onClick={relire}>Relire le texte</button>
          <button className="btn btn-principal" disabled={!emission.employeeId} onClick={emettre}>Émettre en PDF</button>
        </div>
        {texte && (
          <div className="md-fiche-section" style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>
            <h3>{texte.title}</h3>
            <p>{texte.text}</p>
            <button className="btn" onClick={() => setTexte(null)}>Fermer</button>
          </div>
        )}
      </section>

      <section className="md-fiche-section" style={{ marginTop: 16 }}>
        <h3>Modèles</h3>
        <div className="md-liste">
          {modeles.map((m) => (
            <div key={m.type} className="md-ligne">
              <div className="md-bloc"><p className="md-titre">{TYPES_DOC[m.type] || m.title}</p><p className="md-sous">{m.custom ? 'Modèle personnalisé' : 'Modèle par défaut'}</p></div>
              <div className="md-actions">
                <button className="btn" onClick={() => setEdition({ type: m.type, title: m.title, body: m.body, custom: m.custom })}>Modifier</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="md-fiche-section" style={{ marginTop: 16 }}>
        <h3>Documents émis</h3>
        {journal.length === 0 ? <p className="etat-vide">Aucun document émis.</p> : (
          <div className="md-liste">
            {journal.map((d) => (
              <div key={d.id} className="md-ligne">
                <div className="md-bloc"><p className="md-titre">{d.title} — {d.employee_name}</p>
                  <p className="md-sous">{new Date(d.issued_at).toLocaleDateString('fr-FR')}{d.issued_by_name ? ` · ${d.issued_by_name}` : ''}</p></div>
                <div className="md-actions"><button className="btn" onClick={() => api.openHrDocument(d.id).catch((err) => setErreur(err.message))}>PDF</button></div>
              </div>
            ))}
          </div>
        )}
      </section>

      {edition && (
        <div className="modale-fond" onClick={() => setEdition(null)}>
          <div className="modale md-fiche" onClick={(e) => e.stopPropagation()}>
            <h2>Modèle — {TYPES_DOC[edition.type]}</h2>
            <p className="md-aide">Champs disponibles (à écrire entre doubles accolades) : {champs.map((c) => `{{${c.code}}}`).join(', ')}</p>
            <Champ label="Titre"><input className="champ" value={edition.title} onChange={(e) => setEdition((s) => ({ ...s, title: e.target.value }))} /></Champ>
            <Champ label="Texte"><textarea className="champ" rows={16} value={edition.body} onChange={(e) => setEdition((s) => ({ ...s, body: e.target.value }))} /></Champ>
            <div className="actions-modale">
              {edition.custom && <button className="btn" onClick={() => reinitialiser(edition.type)}>Modèle par défaut</button>}
              <button className="btn" onClick={() => setEdition(null)}>Annuler</button>
              <button className="btn btn-principal" onClick={sauverModele}>Enregistrer</button>
            </div>
          </div>
        </div>
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

  const Ligne = ({ titre, aide, kind, params }) => (
    <div className="md-ligne">
      <div className="md-bloc"><p className="md-titre">{titre}</p><p className="md-sous">{aide}</p></div>
      <div className="md-actions">
        <button className="btn" onClick={() => ouvrir(kind, params, 'pdf')}>PDF</button>
        <button className="btn" onClick={() => ouvrir(kind, params, 'csv')}>Excel (CSV)</button>
      </div>
    </div>
  );

  return (
    <>
      <div className="md-outils" style={{ gap: 12 }}>
        <Champ label="Mois"><input type="month" className="champ" value={mois} onChange={(e) => setMois(e.target.value)} /></Champ>
        <Champ label="Année"><input type="number" className="champ" style={{ width: 100 }} value={annee} onChange={(e) => setAnnee(e.target.value)} /></Champ>
      </div>
      {erreur && <div className="erreur">{erreur}</div>}
      <div className="md-liste">
        <Ligne titre={`Livre de paie — ${formatMois(mois)}`} aide="Tous les bulletins du mois, ligne par ligne, avec les totaux." kind="livre" params={{ month: mois }} />
        <Ligne titre={`Cotisations IPRES et CSS — ${formatMois(mois)}`} aide="Parts salariales et patronales par employé, avec les numéros employeur et salariés." kind="cotisations" params={{ month: mois }} />
        <Ligne titre={`Récapitulatif annuel par employé — ${annee}`} aide="Brut, cotisations, impôts, net et coût employeur sur l'année." kind="annuel" params={{ year: annee }} />
        <Ligne titre={`Masse salariale — ${annee}`} aide="Évolution mois par mois : brut, net, charges patronales, coût employeur." kind="masse-salariale" params={{ year: annee }} />
      </div>

      {masse && masse.lignes.length > 0 && (
        <section className="md-fiche-section" style={{ marginTop: 16 }}>
          <h3>Tableau de bord {annee}</h3>
          <div className="md-liste">
            {masse.lignes.map((l) => (
              <div key={l.mois} className="md-ligne">
                <div className="md-bloc"><p className="md-titre">{formatMois(l.mois)}</p><p className="md-sous">{l.effectif} bulletin(s)</p></div>
                <div className="md-bloc md-bloc--montant"><p className="md-sous">Brut {fcfa(l.gross_salary)} · Net {fcfa(l.net_a_payer)} · Coût employeur {fcfa(l.cout_total_employeur)} FCFA</p></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Réglages de période : base de jours, heures par jour, majorations d'heures supplémentaires, numéros employeur
// (venant s'ajouter à l'onglet Réglages paie existant)
// ---------------------------------------------------------------------------
export function ReglagesPeriodeSection() {
  const [chargement, setChargement] = useState(true);
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
    }
  }

  if (chargement) return null;
  const majMajoration = (i, champ, valeur) => setMajorations((l) => l.map((m, j) => (j === i ? { ...m, [champ]: valeur } : m)));

  return (
    <form onSubmit={enregistrer} className="md-fiche-section" style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Absences, heures supplémentaires et numéros employeur</h2>
      <p className="md-aide">Aucune valeur légale n'est imposée : renseigne ce qui s'applique à ton entreprise, après validation par un professionnel.</p>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}><Champ label="Base de jours (retenue d'absence)"><input type="number" min="20" max="31" className="champ" value={baseJours} onChange={(e) => setBaseJours(e.target.value)} /></Champ></div>
        <div style={{ flex: 1 }}><Champ label="Heures par jour (taux horaire)"><input type="number" step="0.25" className="champ" value={heuresParJour} onChange={(e) => setHeuresParJour(e.target.value)} /></Champ></div>
      </div>
      <h3 style={{ marginTop: 8 }}>Majorations d'heures supplémentaires</h3>
      {majorations.map((m, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <Champ label="Code"><input className="champ" value={m.code} onChange={(e) => majMajoration(i, 'code', e.target.value)} /></Champ>
          <Champ label="Libellé"><input className="champ" value={m.label} onChange={(e) => majMajoration(i, 'label', e.target.value)} /></Champ>
          <Champ label="Coefficient (1,15 = +15 %)"><input type="number" step="0.01" className="champ" value={m.rate} onChange={(e) => majMajoration(i, 'rate', e.target.value)} /></Champ>
          <button type="button" className="btn" onClick={() => setMajorations((l) => l.filter((_, j) => j !== i))}>Retirer</button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => setMajorations((l) => [...l, { code: '', label: '', rate: '' }])}>Ajouter une majoration</button>
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <div style={{ flex: 1 }}><Champ label="N° employeur IPRES"><input className="champ" value={numIpres} onChange={(e) => setNumIpres(e.target.value)} /></Champ></div>
        <div style={{ flex: 1 }}><Champ label="N° employeur CSS"><input className="champ" value={numCss} onChange={(e) => setNumCss(e.target.value)} /></Champ></div>
      </div>
      {erreur && <div className="erreur">{erreur}</div>}
      {succes && <div className="md-info">{succes}</div>}
      <button type="submit" className="btn btn-principal">Enregistrer</button>
    </form>
  );
}
