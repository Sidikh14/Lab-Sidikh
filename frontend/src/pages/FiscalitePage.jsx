import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useModulesAccess } from '../hooks/useModulesAccess';
import { PageModuleNonActive } from '../components/ModuleNonActive';
import { BarreSections } from '../components/SectionsUi';
import { EntetePage, BandeauMarine, Etiquette } from '../components/SagfaUi';
import {
  ImpotsTab, ApercuPdf, exporterPdf, useDonnees,
  fmt, dateFr, aujourdhui, tableStyle, cellule, droite, enteteTable, boutonPetit,
} from './ComptabilitePage';

// Module Fiscalité : déclarations de la DGID préparées à partir de la comptabilité et de la paie,
// paiement des impôts (les cotisations CSS et IPRES se gèrent dans la page Paie), profil du contribuable.
// Visible seulement si l'owner a activé la fiscalité (et la comptabilité sur laquelle elle s'appuie).

const TYPES = [
  { id: 'tva', label: 'TVA' },
  { id: 'ir', label: 'IR sur salaires' },
  { id: 'trimf', label: 'TRIMF' },
  { id: 'cfce', label: 'CFCE' },
  { id: 'brs', label: 'RAS Tiers et loyers' },
  { id: 'cel', label: 'CEL valeur ajoutée' },
  { id: 'cel_vl', label: 'CEL valeur locative' },
];
// Icônes des cartes de choix de déclaration (SVG simples, sans dépendance).
const ICONES_TYPES = {
  tva: 'M5 19L19 5M7 8a1.6 1.6 0 100-3.2A1.6 1.6 0 007 8zm10 11.2a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2z',
  ir: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0',
  trimf: 'M4 11l8-7 8 7v9H4v-9zm5 9v-5h6v5',
  cfce: 'M4 20V9l6 3V9l6 3V5h4v15H4z',
  brs: 'M7 3h8l4 4v14H7V3zm8 0v4h4M10 12h6M10 16h6',
  cel: 'M4 20V4m0 16h16M8 16v-4m4 4V8m4 8v-6',
  cel_vl: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
};
function IconeType({ id }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONES_TYPES[id] || ICONES_TYPES.brs} />
    </svg>
  );
}

const STYLE_CARTES = `
.decl-cartes { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.decl-carte { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px 6px 7px; cursor: pointer;
  border: 1.5px solid rgba(128,128,128,0.25); border-radius: 10px; background: var(--surface, transparent); color: inherit; font: inherit;
  transition: box-shadow .12s ease, border-color .12s ease; }
.decl-carte:hover { border-color: var(--azur, #2f80ed); }
.decl-carte:focus-visible { outline: 3px solid var(--azur, #2f80ed); outline-offset: 2px; }
.decl-carte.actif { border-color: var(--azur, #2f80ed); box-shadow: 0 0 0 2px rgba(47,128,237,0.18); }
.decl-carte .decl-icone { width: 26px; height: 26px; border-radius: 7px; display: flex; align-items: center; justify-content: center;
  background: rgba(47,128,237,0.12); color: var(--azur, #2f80ed); flex-shrink: 0; }
.decl-carte .decl-icone svg { width: 15px; height: 15px; }
.decl-carte.actif .decl-icone { background: var(--azur, #2f80ed); color: #fff; }
.decl-carte .decl-texte { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.2; }
.decl-carte .decl-nom { font-weight: 600; font-size: 12.5px; }
.decl-statut { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 600; margin-top: 2px; }
.decl-statut::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.decl-statut.faire { color: #a15c00; }
.decl-statut.deposee { color: #137a4b; }
`;

const NOMS_TYPES = {
  tva: 'TVA', ir: 'IR RAS Salaires', trimf: 'TRIMF', cfce: 'CFCE', brs: 'RAS Tiers et loyers',
  cel: 'CEL sur la valeur ajoutée', cel_vl: 'CEL sur la valeur locative', vrs: 'Retenues sur salaires',
};
// Déclarations annuelles (choix d'une année) ; les autres sont mensuelles.
const TYPES_ANNUELS = ['cel', 'cel_vl'];
const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const libelleMois = (m) => (m && m.length === 7 ? `${NOMS_MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : m || '');

function moisPrecedent() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Comme sur le portail, une ligne à zéro reste vide.
const valeurLigne = (l) => {
  if (l.type === 'ouinon') return l.value ? 'OUI' : 'NON';
  if (l.value === null || l.value === undefined) return '';
  if (l.type === 'nombre') return String(l.value);
  return Math.round(l.value) === 0 && !l.afficherZero ? '' : fmt(l.value);
};

// Registre des sommes versées à des tiers (loyers, prestations) : sert de base à la déclaration BRS.
function RegistreBrs({ mois, lignes, onChange }) {
  const [form, setForm] = useState({ beneficiaryName: '', beneficiaryRef: '', nature: 'loyer', paidOn: aujourdhui(), grossHt: '' });
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  async function ajouter(e) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await api.createBrsEntry({ ...form, grossHt: Number(form.grossHt) });
      setForm({ ...form, beneficiaryName: '', beneficiaryRef: '', grossHt: '' });
      onChange();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  async function retirer(id) {
    try {
      await api.deleteBrsEntry(id);
      onChange();
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <div style={{ margin: '18px 0' }}>
      <h3 style={{ fontSize: 15, marginBottom: 6 }}>Registre des sommes versées à des tiers — {libelleMois(mois)}</h3>
      {erreur && <div className="erreur">{erreur}</div>}
      <form onSubmit={ajouter} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <input className="champ" style={{ flex: '2 1 160px' }} placeholder="Bénéficiaire" value={form.beneficiaryName} onChange={(e) => setForm({ ...form, beneficiaryName: e.target.value })} required />
        <input className="champ" style={{ flex: '1 1 110px' }} placeholder="NINEA / pièce" value={form.beneficiaryRef} onChange={(e) => setForm({ ...form, beneficiaryRef: e.target.value })} />
        <select className="champ" style={{ flex: '1 1 110px' }} value={form.nature} onChange={(e) => setForm({ ...form, nature: e.target.value })}>
          <option value="loyer">Loyer</option>
          <option value="prestation">Prestation</option>
        </select>
        <input type="date" className="champ" style={{ flex: '1 1 130px' }} value={form.paidOn} max={aujourdhui()} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} required />
        <input type="number" min="1" step="any" className="champ" style={{ flex: '1 1 120px' }} placeholder="Montant brut HT" value={form.grossHt} onChange={(e) => setForm({ ...form, grossHt: e.target.value })} required />
        <button type="submit" className="btn btn-principal" disabled={envoi}>Ajouter</button>
      </form>
      {lignes.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id}>
                  <td style={cellule}>{l.beneficiary_name}</td>
                  <td style={cellule}>{l.nature === 'loyer' ? 'Loyer' : 'Prestation'}</td>
                  <td style={cellule}>{dateFr(l.paid_on)}</td>
                  <td style={droite}>{fmt(l.gross_ht)}</td>
                  <td style={{ ...cellule, textAlign: 'right' }}>
                    <button type="button" className="btn btn-brique" style={boutonPetit} onClick={() => retirer(l.id)}>Retirer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DeclarationsTab() {
  const [type, setType] = useState('tva');
  const [mois, setMois] = useState(moisPrecedent());
  const [annee, setAnnee] = useState(String(new Date().getFullYear()));
  const [reglagesCel, setReglagesCel] = useState({ ca: '', va: '', exonere: false, faibleMarge: false, telecom: false, portuaire: false });
  const [reglagesCelAppliques, setReglagesCelAppliques] = useState({});
  const [reglagesVl, setReglagesVl] = useState({ loyer: '', mois: '', gratuit: '', percu: '', prepond: false, hotel: false });
  const [reglagesVlAppliques, setReglagesVlAppliques] = useState({});
  const [reglagesIr, setReglagesIr] = useState({ etrangers: '', salairesEtrangers: '' });
  const [reglagesIrAppliques, setReglagesIrAppliques] = useState({});
  const [version, setVersion] = useState(0);
  const [depot, setDepot] = useState(false);
  const [dateDepot, setDateDepot] = useState(aujourdhui());
  const [recepisse, setRecepisse] = useState('');
  const [erreurAction, setErreurAction] = useState('');
  const [enCours, setEnCours] = useState(false);

  const [donnees, erreur] = useDonnees(
    async () => {
      const params = type === 'cel_vl'
        ? {
          year: annee, loyer: reglagesVlAppliques.loyer || undefined, mois: reglagesVlAppliques.mois || undefined,
          gratuit: reglagesVlAppliques.gratuit || undefined, percu: reglagesVlAppliques.percu || undefined,
          prepond: reglagesVlAppliques.prepond ? '1' : undefined, hotel: reglagesVlAppliques.hotel ? '1' : undefined,
        }
        : type === 'ir'
          ? { month: mois, etrangers: reglagesIrAppliques.etrangers || undefined, salairesEtrangers: reglagesIrAppliques.salairesEtrangers || undefined }
        : type === 'cel'
        ? {
          year: annee,
          ca: reglagesCelAppliques.ca || undefined, va: reglagesCelAppliques.va || undefined,
          exonere: reglagesCelAppliques.exonere ? '1' : undefined, faibleMarge: reglagesCelAppliques.faibleMarge ? '1' : undefined,
          telecom: reglagesCelAppliques.telecom ? '1' : undefined, portuaire: reglagesCelAppliques.portuaire ? '1' : undefined,
        }
        : { month: mois };
      const [declaration, depots, registre] = await Promise.all([
        api.getTaxDeclaration(type, params),
        api.getTaxFilings(),
        type === 'brs' ? api.getBrsEntries(mois) : Promise.resolve([]),
      ]);
      return { declaration, depots, registre };
    },
    [type, mois, annee, reglagesCelAppliques, reglagesVlAppliques, reglagesIrAppliques, version]
  );

  useEffect(() => {
    setDepot(false);
    setRecepisse('');
    setErreurAction('');
  }, [type, mois, annee]);

  useEffect(() => {
    setReglagesCelAppliques({});
    setReglagesCel({ ca: '', va: '', exonere: false, faibleMarge: false, telecom: false, portuaire: false });
    setReglagesVlAppliques({});
    setReglagesVl({ loyer: '', mois: '', gratuit: '', percu: '', prepond: false, hotel: false });
  }, [annee]);

  useEffect(() => {
    setReglagesIrAppliques({});
    setReglagesIr({ etrangers: '', salairesEtrangers: '' });
  }, [mois]);

  const periode = TYPES_ANNUELS.includes(type) ? annee : mois;
  // Statut de chaque déclaration pour la période choisie (année pour les CEL, mois pour les autres).
  const depotsListe = donnees ? donnees.depots : null;
  const statutDe = (id) => (depotsListe && depotsListe.some((f) => f.kind === id && f.period === (TYPES_ANNUELS.includes(id) ? annee : mois)) ? 'deposee' : 'faire');
  // Pendant un changement de déclaration, on garde l'ancien contenu à l'écran jusqu'à l'arrivée du nouveau.
  const d = donnees && donnees.declaration.kind === type ? donnees.declaration : null;

  async function enregistrerDepot(e) {
    e.preventDefault();
    setErreurAction('');
    setEnCours(true);
    try {
      await api.createTaxFiling({
        kind: type, period: periode, filedOn: dateDepot, receiptNumber: recepisse || undefined,
        amountDue: d.amountDue, snapshot: d.snapshot,
      });
      setDepot(false);
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(err.message);
    } finally {
      setEnCours(false);
    }
  }

  async function supprimerDepot(id) {
    if (!window.confirm('Retirer ce dépôt de la liste ? La déclaration redeviendra « à déposer ».')) return;
    try {
      await api.deleteTaxFiling(id);
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(err.message);
    }
  }

  return (
    <div>
      {erreurAction && <div className="erreur">{erreurAction}</div>}

      <style>{STYLE_CARTES}</style>
      <div className="decl-cartes" role="tablist" aria-label="Choix de la déclaration">
        {TYPES.map((t) => {
          const st = depotsListe ? statutDe(t.id) : null;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === type} className={`decl-carte${t.id === type ? ' actif' : ''}`} onClick={() => setType(t.id)}>
              <span className="decl-icone"><IconeType id={t.id} /></span>
              <span className="decl-texte">
                <span className="decl-nom">{t.label}</span>
                  {st ? (
                    <span className={`decl-statut ${st}`}>{st === 'deposee' ? 'Déposée' : 'À faire'}</span>
                  ) : (
                    <span className="decl-statut" style={{ opacity: 0.5 }}>…</span>
                  )}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        {TYPES_ANNUELS.includes(type) ? (
          <div className="champ-groupe" style={{ margin: 0 }}>
            <label className="etiquette">Année d'imposition</label>
            <select className="champ" value={annee} onChange={(e) => setAnnee(e.target.value)}>
              {[0, 1, 2, 3].map((i) => String(new Date().getFullYear() - i)).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        ) : (
          <div className="champ-groupe" style={{ margin: 0 }}>
            <label className="etiquette">Mois concerné</label>
            <input type="month" className="champ" value={mois} max={aujourdhui().slice(0, 7)} onChange={(e) => e.target.value && setMois(e.target.value)} />
          </div>
        )}
      </div>

      {erreur && <div className="erreur">{erreur}</div>}
      {!d && !erreur && <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>}

      {d && (
        <div style={{ marginBottom: 26 }}>
          <h3 style={{ fontSize: 16, marginBottom: 4 }}>{d.title.toUpperCase()}</h3>
          <p style={{ color: 'var(--encre-douce)', fontSize: 13, margin: '0 0 10px' }}>
            Dépôt au plus tard le {dateFr(d.deadline)}{d.deadlinePay ? ` · paiement au plus tard le ${dateFr(d.deadlinePay)}` : ''}.
          </p>
          {d.provisoire && (
            <div className="erreur" style={{ marginBottom: 8 }}>
              Numéros de ligne provisoires : ils suivent la présentation de la DGID mais n'ont pas encore été alignés sur le formulaire officiel de cette déclaration.
            </div>
          )}
          {d.alertes.map((a) => <div key={a} className="erreur" style={{ marginBottom: 8 }}>{a}</div>)}

          <h4 style={{ fontSize: 13.5, margin: '14px 0 6px' }}>CONTRIBUABLE ET RENSEIGNEMENTS FISCAUX</h4>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <tbody>
                {d.header.map((r) => (
                  <tr key={r[0]}>
                    <td style={{ ...cellule, fontWeight: 600, width: '22%' }}>{r[0]}</td>
                    <td style={cellule}>{r[1]}</td>
                    <td style={{ ...cellule, fontWeight: 600, width: '22%' }}>{r[2]}</td>
                    <td style={cellule}>{r[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ color: 'var(--encre-douce)', fontSize: 12.5, margin: '10px 0 0' }}>{d.texte}</p>

          {type === 'ir' && d.inputs && (
            <div style={{ margin: '16px 0', padding: 12, border: '1px solid rgba(128,128,128,0.25)', borderRadius: 8 }}>
              <p style={{ margin: '0 0 8px', fontSize: 13.5, fontWeight: 600 }}>Salariés de nationalité étrangère (lignes 20 et 50)</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="champ-groupe" style={{ margin: 0 }}>
                  <label className="etiquette">Nombre d'étrangers</label>
                  <input type="number" min="0" className="champ" placeholder="0" value={reglagesIr.etrangers} onChange={(e) => setReglagesIr({ ...reglagesIr, etrangers: e.target.value })} />
                </div>
                <div className="champ-groupe" style={{ margin: 0 }}>
                  <label className="etiquette">Salaires versés aux étrangers</label>
                  <input type="number" min="0" className="champ" placeholder="0" value={reglagesIr.salairesEtrangers} onChange={(e) => setReglagesIr({ ...reglagesIr, salairesEtrangers: e.target.value })} />
                </div>
                <button type="button" className="btn" onClick={() => setReglagesIrAppliques(reglagesIr)}>Recalculer</button>
              </div>
            </div>
          )}

          {type === 'cel_vl' && d.inputs && (
            <div style={{ margin: '16px 0', padding: 12, border: '1px solid rgba(128,128,128,0.25)', borderRadius: 8 }}>
              <p style={{ margin: '0 0 8px', fontSize: 13.5, fontWeight: 600 }}>
                Loyer et locaux
                {d.inputs.loyerDetecte > 0 && ` — loyer repris des charges : ${fmt(d.inputs.loyerDetecte)} par mois`}
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="champ-groupe" style={{ margin: 0 }}>
                  <label className="etiquette">Loyer mensuel à verser</label>
                  <input type="number" min="0" className="champ" placeholder={String(d.inputs.loyerDetecte)} value={reglagesVl.loyer} onChange={(e) => setReglagesVl({ ...reglagesVl, loyer: e.target.value })} />
                </div>
                <div className="champ-groupe" style={{ margin: 0 }}>
                  <label className="etiquette">Mois d'activité (ligne 90)</label>
                  <input type="number" min="1" max="12" className="champ" placeholder="12" value={reglagesVl.mois} onChange={(e) => setReglagesVl({ ...reglagesVl, mois: e.target.value })} />
                </div>
                <div className="champ-groupe" style={{ margin: 0 }}>
                  <label className="etiquette">Loyer estimé, locaux gratuits (50)</label>
                  <input type="number" min="0" className="champ" value={reglagesVl.gratuit} onChange={(e) => setReglagesVl({ ...reglagesVl, gratuit: e.target.value })} />
                </div>
                <div className="champ-groupe" style={{ margin: 0 }}>
                  <label className="etiquette">Loyer perçu, loueur professionnel (70)</label>
                  <input type="number" min="0" className="champ" value={reglagesVl.percu} onChange={(e) => setReglagesVl({ ...reglagesVl, percu: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '10px 0' }}>
                {[['prepond', 'Société à prépondérance immobilière (30)'], ['hotel', 'Établissement hôtelier agréé (55)']].map(([cle, label]) => (
                  <label key={cle} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={reglagesVl[cle]} onChange={(e) => setReglagesVl({ ...reglagesVl, [cle]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--encre-douce)' }}>
                Les valeurs des terrains, constructions et agencements (lignes 5, 10, 15) sont reprises de vos immobilisations au 31 décembre {Number(annee) - 1}.
              </p>
              <button type="button" className="btn" onClick={() => setReglagesVlAppliques(reglagesVl)}>Recalculer</button>
            </div>
          )}

          {type === 'cel' && (
            <div style={{ margin: '16px 0', padding: 12, border: '1px solid rgba(128,128,128,0.25)', borderRadius: 8 }}>
              <p style={{ margin: '0 0 8px', fontSize: 13.5, fontWeight: 600 }}>Ajuster les données de l'exercice {Number(annee) - 1}</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="champ-groupe" style={{ margin: 0 }}>
                  <label className="etiquette">Chiffre d'affaires (ligne 5)</label>
                  <input type="number" className="champ" placeholder={String(d.inputs.caCompta)} value={reglagesCel.ca} onChange={(e) => setReglagesCel({ ...reglagesCel, ca: e.target.value })} />
                </div>
                <div className="champ-groupe" style={{ margin: 0 }}>
                  <label className="etiquette">Valeur ajoutée (ligne 10)</label>
                  <input type="number" className="champ" placeholder={String(d.inputs.vaCompta)} value={reglagesCel.va} onChange={(e) => setReglagesCel({ ...reglagesCel, va: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '10px 0' }}>
                {[['exonere', 'Exonérée de CEL (20)'], ['faibleMarge', 'Faible marge / prix réglementé (25)'], ['telecom', 'Réseau de télécom (30)'], ['portuaire', 'Installations portuaires (35)']].map(([cle, label]) => (
                  <label key={cle} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={reglagesCel[cle]} onChange={(e) => setReglagesCel({ ...reglagesCel, [cle]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
              <button type="button" className="btn" onClick={() => setReglagesCelAppliques(reglagesCel)}>Recalculer</button>
            </div>
          )}

          <h4 style={{ fontSize: 13.5, margin: '18px 0 6px' }}>ANNEXE FISCALE</h4>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={enteteTable}>Désignation</th>
                {d.lines.some((l) => l.annexe) && <th style={enteteTable}>Annexe</th>}
                <th style={{ ...enteteTable, textAlign: 'right', width: 70 }}>Ligne</th>
                <th style={{ ...enteteTable, textAlign: 'right', width: 150 }}>Montant</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.ligne}>
                  <td style={{ ...cellule, fontWeight: l.fort ? 600 : 400 }}>{l.label}</td>
                  {d.lines.some((x) => x.annexe) && <td style={{ ...cellule, fontSize: 12, color: 'var(--encre-douce)' }}>{l.annexe || ''}</td>}
                  <td style={{ ...droite, color: 'var(--encre-douce)' }}>{l.ligne}</td>
                  <td style={{ ...droite, fontWeight: l.fort ? 600 : 400 }}>{valeurLigne(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {d.annexes.map((x) => (
            <div key={x.titre} style={{ marginTop: 18, overflowX: 'auto' }}>
              <h4 style={{ fontSize: 13.5, margin: '0 0 6px' }}>{x.titre.toUpperCase()}</h4>
              <table style={tableStyle}>
                <thead>
                  <tr>{x.colonnes.map((c) => <th key={c.label} style={{ ...enteteTable, textAlign: c.align === 'right' ? 'right' : 'left' }}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {x.lignes.map((ligne, i) => {
                    const cells = Array.isArray(ligne) ? ligne : ligne.cells;
                    const fort = !Array.isArray(ligne) && ligne.fort;
                    return (
                      <tr key={i}>
                        {cells.map((c, j) => (
                          <td key={j} style={{ ...(x.colonnes[j]?.align === 'right' ? droite : cellule), fontWeight: fort ? 600 : 400 }}>{c}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {type === 'brs' && <RegistreBrs mois={mois} lignes={donnees.registre} onChange={() => setVersion((v) => v + 1)} />}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
            <button type="button" className="btn btn-principal" onClick={() => exporterPdf(d.pdf)}>Fiche PDF (aperçu)</button>
            {!d.filed && !depot && (
              <button type="button" className="btn" onClick={() => setDepot(true)}>J'ai déposé cette déclaration</button>
            )}
          </div>

          {d.filed && (
            <p style={{ marginTop: 12, fontSize: 13.5 }}>
              ✓ Déposée le {dateFr(d.filed.filed_on)}{d.filed.receipt_number ? ` · récépissé n° ${d.filed.receipt_number}` : ''}
            </p>
          )}

          {depot && (
            <form onSubmit={enregistrerDepot} style={{ marginTop: 14, maxWidth: 420 }}>
              <div className="champ-groupe">
                <label className="etiquette">Date du dépôt</label>
                <input type="date" className="champ" value={dateDepot} max={aujourdhui()} onChange={(e) => setDateDepot(e.target.value)} required />
              </div>
              <div className="champ-groupe">
                <label className="etiquette">Numéro de récépissé / quittance (facultatif)</label>
                <input type="text" className="champ" maxLength={60} value={recepisse} onChange={(e) => setRecepisse(e.target.value)} />
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setDepot(false)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer le dépôt'}</button>
              </div>
            </form>
          )}
        </div>
      )}

      {donnees && (
        <>
          <h3 style={{ fontSize: 15 }}>Déclarations déposées</h3>
          {donnees.depots.length === 0 ? (
            <p className="etat-vide">Aucune déclaration enregistrée.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={enteteTable}>Période</th>
                    <th style={enteteTable}>Déclaration</th>
                    <th style={{ ...enteteTable, textAlign: 'right' }}>Montant</th>
                    <th style={enteteTable}>Déposée le</th>
                    <th style={enteteTable}>Récépissé</th>
                    <th style={enteteTable} />
                  </tr>
                </thead>
                <tbody>
                  {donnees.depots.map((f) => (
                    <tr key={f.id}>
                      <td style={cellule}>{libelleMois(f.period)}</td>
                      <td style={cellule}>{NOMS_TYPES[f.kind] || f.kind}</td>
                      <td style={droite}>{fmt(f.amount_due)}</td>
                      <td style={cellule}>{dateFr(f.filed_on)}</td>
                      <td style={cellule}>{f.receipt_number || '—'}</td>
                      <td style={{ ...cellule, textAlign: 'right' }}>
                        <button type="button" className="btn btn-brique" style={boutonPetit} onClick={() => supprimerDepot(f.id)}>Retirer</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ProfilTab() {
  const [profil, setProfil] = useState(null);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    api.getTaxProfile().then(setProfil).catch((err) => setErreur(err.message));
  }, []);

  async function enregistrer(e) {
    e.preventDefault();
    setErreur('');
    setSucces('');
    setEnvoi(true);
    try {
      setProfil(await api.setTaxProfile(profil));
      setSucces('Profil fiscal enregistré.');
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  if (!profil) return erreur ? <div className="erreur">{erreur}</div> : <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;
  const maj = (champ) => (e) => setProfil({ ...profil, [champ]: e.target.value });

  return (
    <form onSubmit={enregistrer} style={{ maxWidth: 520 }}>
      {erreur && <div className="erreur">{erreur}</div>}
      {succes && <p style={{ color: 'var(--succes, #1a7f37)', fontSize: 13 }}>{succes}</p>}
      <div className="champ-groupe">
        <label className="etiquette">NINEA</label>
        <input
          type="text" className="champ" maxLength={20} value={profil.ninea} onChange={maj('ninea')}
          readOnly={profil.nineaSource === 'entreprise'}
        />
        <p style={{ color: 'var(--encre-douce)', fontSize: 12.5, margin: '4px 0 0' }}>
          {profil.nineaSource === 'entreprise'
            ? 'Repris de la page Entreprise (à modifier là-bas).'
            : 'Non trouvé dans la page Entreprise : renseignez-le là-bas pour qu\'il soit repris automatiquement.'}
        </p>
      </div>
      <div className="champ-groupe">
        <label className="etiquette">Raison sociale</label>
        <input type="text" className="champ" maxLength={200} value={profil.legalName} onChange={maj('legalName')} />
      </div>
      <div className="champ-groupe">
        <label className="etiquette">Adresse</label>
        <input
          type="text" className="champ" maxLength={300} value={profil.address} onChange={maj('address')}
          readOnly={profil.addressSource === 'entreprise'}
        />
        {profil.addressSource === 'entreprise' && (
          <p style={{ color: 'var(--encre-douce)', fontSize: 12.5, margin: '4px 0 0' }}>Reprise de la page Entreprise.</p>
        )}
      </div>
      <div className="champ-groupe">
        <label className="etiquette">Centre des services fiscaux de rattachement</label>
        <input type="text" className="champ" maxLength={200} value={profil.taxCenter} onChange={maj('taxCenter')} />
      </div>
      <div className="champ-groupe">
        <label className="etiquette">Régime d'imposition</label>
        <select className="champ" value={profil.regime} onChange={maj('regime')}>
          <option value="reel_simplifie">Réel simplifié</option>
          <option value="reel_normal">Réel normal</option>
          <option value="cgu">Contribution globale unique (CGU)</option>
        </select>
      </div>
      <div className="champ-groupe">
        <label className="etiquette">Forme de l'entreprise</label>
        <select className="champ" value={profil.legalForm} onChange={maj('legalForm')}>
          <option value="societe_is">Société (impôt sur les sociétés)</option>
          <option value="entreprise_individuelle">Entreprise individuelle (impôt sur le revenu)</option>
        </select>
      </div>
      <button type="submit" className="btn btn-principal" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</button>
    </form>
  );
}

// Prochaine date limite de dépôt des déclarations mensuelles : le 15 du mois en cours, ou du mois suivant si passée.
// État 1024 : rémunérations annuelles versées par salarié, calculées depuis les bulletins — reprend
// exactement le rapport « Récapitulatif annuel » déjà construit côté Paie (même endpoint), présenté ici
// dans la Fiscalité comme demandé. Aucun nouveau calcul : les chiffres sont ceux des bulletins validés.
function Etat1024Tab() {
  const [annee, setAnnee] = useState(String(new Date().getFullYear()));
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    setErreur('');
    Promise.resolve().then(() => api.getPayrollReport('annuel', { year: annee })).then(setDonnees).catch((e) => setErreur(e.message));
  }, [annee]);

  function exporter(format) {
    api.openPayrollReport('annuel', { year: annee }, format).catch((e) => setErreur(e.message));
  }

  const lignes = donnees?.lignes || [];
  const totaux = donnees?.totaux || {};

  return (
    <div>
      <div className="sg-form-ligne">
        <div>
          <Etiquette>Année</Etiquette>
          <input type="number" value={annee} onChange={(e) => setAnnee(e.target.value)} style={{ width: 100 }} />
        </div>
        <button type="button" className="btn" onClick={() => exporter('pdf')}>Exporter en PDF</button>
        <button type="button" className="btn" onClick={() => exporter('html')}>Aperçu</button>
      </div>
      {erreur && <div className="erreur">{erreur}</div>}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={enteteTable}>Employé</th>
            <th style={enteteTable}>Mois</th>
            <th style={enteteTable}>Brut annuel</th>
            <th style={enteteTable}>Cotisations sal.</th>
            <th style={enteteTable}>IRPP + TRIMF</th>
            <th style={enteteTable}>Net annuel</th>
            <th style={enteteTable}>Coût employeur</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.nom}>
              <td style={cellule}>{l.nom}</td>
              <td style={droite}>{l.mois}</td>
              <td style={droite}>{fmt(l.gross_salary)}</td>
              <td style={droite}>{fmt(l.cotisations_sal)}</td>
              <td style={droite}>{fmt(l.impots)}</td>
              <td style={droite}>{fmt(l.net_a_payer)}</td>
              <td style={droite}>{fmt(l.cout_total_employeur)}</td>
            </tr>
          ))}
          {lignes.length === 0 && (
            <tr><td style={cellule} colSpan={7}>Aucun bulletin validé pour {annee}.</td></tr>
          )}
        </tbody>
        {lignes.length > 0 && (
          <tfoot>
            <tr style={{ fontWeight: 700 }}>
              <td style={cellule}>TOTAL</td><td style={droite} />
              <td style={droite}>{fmt(totaux.gross_salary)}</td>
              <td style={droite}>{fmt(totaux.cotisations_sal)}</td>
              <td style={droite}>{fmt(totaux.impots)}</td>
              <td style={droite}>{fmt(totaux.net_a_payer)}</td>
              <td style={droite}>{fmt(totaux.cout_total_employeur)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const NATURES_IMPOT = [
  { value: 'is', label: 'IS / minimum forfaitaire' },
  { value: 'acompte', label: 'Acompte' },
  { value: 'patente', label: 'Patente' },
  { value: 'foncier', label: 'Contribution foncière' },
];

// Impôts directs : échéances, montants, paiements. Le montant dû est saisi (aucun taux en dur) ; un rappel
// « en retard » apparaît dès qu'une échéance est dépassée et non soldée.
function ImpotsDirectsTab() {
  const [annee, setAnnee] = useState(String(new Date().getFullYear()));
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState({ kind: 'is', label: '', dueDate: aujourdhui(), amountDue: '' });
  const [paiement, setPaiement] = useState(null); // { id, amount, paidOn }
  const [erreur, setErreur] = useState('');
  const [lignes, erreurChargement] = useDonnees(async () => api.getDirectTaxes(annee), [annee, version]);

  async function ajouter(e) {
    e.preventDefault();
    setErreur('');
    try {
      await api.createDirectTax({ ...form, year: annee, amountDue: Number(form.amountDue) });
      setForm({ kind: form.kind, label: '', dueDate: aujourdhui(), amountDue: '' });
      setVersion((v) => v + 1);
    } catch (err) { setErreur(err.message); }
  }
  async function payer(e) {
    e.preventDefault();
    setErreur('');
    try {
      await api.payDirectTax(paiement.id, { amount: Number(paiement.amount), paidOn: paiement.paidOn });
      setPaiement(null);
      setVersion((v) => v + 1);
    } catch (err) { setErreur(err.message); }
  }
  async function supprimer(id) {
    if (!window.confirm('Supprimer cette échéance ?')) return;
    try { await api.deleteDirectTax(id); setVersion((v) => v + 1); } catch (err) { setErreur(err.message); }
  }

  const aujourdhuiIso = aujourdhui();
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <Etiquette>Année</Etiquette>
        <input type="number" value={annee} onChange={(e) => setAnnee(e.target.value)} style={{ width: 100 }} />
      </div>
      <form onSubmit={ajouter} className="sg-form-ligne">
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          {NATURES_IMPOT.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
        </select>
        <input placeholder="Libellé (facultatif)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required />
        <input type="number" min="0" placeholder="Montant dû (FCFA)" value={form.amountDue} onChange={(e) => setForm({ ...form, amountDue: e.target.value })} required />
        <button type="submit" className="btn btn-principal">Ajouter l'échéance</button>
      </form>
      {(erreur || erreurChargement) && <div className="erreur">{erreur || erreurChargement}</div>}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={enteteTable}>Impôt</th><th style={enteteTable}>Échéance</th><th style={enteteTable}>Dû</th>
            <th style={enteteTable}>Payé</th><th style={enteteTable}>Reste</th><th style={enteteTable}>Statut</th><th style={enteteTable} />
          </tr>
        </thead>
        <tbody>
          {(lignes || []).map((l) => {
            const reste = Number(l.amount_due) - Number(l.amount_paid);
            const enRetard = reste > 0 && l.due_date < aujourdhuiIso;
            return (
              <tr key={l.id}>
                <td style={cellule}>{l.label || l.kindLabel}</td>
                <td style={cellule}>{dateFr(l.due_date)}</td>
                <td style={droite}>{fmt(l.amount_due)}</td>
                <td style={droite}>{fmt(l.amount_paid)}</td>
                <td style={droite}>{fmt(Math.max(reste, 0))}</td>
                <td style={cellule}>{reste <= 0 ? 'Soldé' : enRetard ? 'En retard' : 'À payer'}</td>
                <td style={cellule}>
                  {reste > 0 && <button type="button" className="btn" style={boutonPetit} onClick={() => setPaiement({ id: l.id, amount: String(reste), paidOn: aujourdhui() })}>Payer</button>}{' '}
                  <button type="button" className="btn" style={boutonPetit} onClick={() => supprimer(l.id)}>Supprimer</button>
                </td>
              </tr>
            );
          })}
          {lignes && lignes.length === 0 && <tr><td style={cellule} colSpan={7}>Aucune échéance enregistrée pour {annee}.</td></tr>}
        </tbody>
      </table>
      {paiement && (
        <form onSubmit={payer} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 16 }}>
          <input type="number" min="1" value={paiement.amount} onChange={(e) => setPaiement({ ...paiement, amount: e.target.value })} required />
          <input type="date" value={paiement.paidOn} max={aujourdhui()} onChange={(e) => setPaiement({ ...paiement, paidOn: e.target.value })} required />
          <button type="submit" className="btn btn-principal">Enregistrer le paiement</button>
          <button type="button" className="btn" onClick={() => setPaiement(null)}>Annuler</button>
        </form>
      )}
    </div>
  );
}

// CGU / Annuelle : le barème (tranches de chiffre d'affaires → montant) est modifiable et propre à chaque
// commerçant. Il est vide au départ : à renseigner avec le comptable, aucun chiffre n'est inventé.
function CguTab() {
  const [annee, setAnnee] = useState(String(new Date().getFullYear()));
  const [version, setVersion] = useState(0);
  const [donnees, erreurChargement] = useDonnees(async () => api.getCgu(annee), [annee, version]);
  const [tranches, setTranches] = useState([]);
  const [ca, setCa] = useState('');
  const [paye, setPaye] = useState('');
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (donnees) setTranches(donnees.bareme.map((t) => ({ jusqua: t.jusqua === null ? '' : String(t.jusqua), montant: String(t.montant) })));
  }, [donnees]);

  async function enregistrerBareme() {
    setErreur(''); setMessage('');
    try {
      await api.saveCguBareme(tranches.map((t) => ({ jusqua: t.jusqua === '' ? null : Number(t.jusqua), montant: Number(t.montant) })));
      setMessage('Barème enregistré.');
      setVersion((v) => v + 1);
    } catch (err) { setErreur(err.message); }
  }
  async function calculer(e) {
    e.preventDefault();
    setErreur(''); setMessage('');
    try {
      const r = await api.saveCguDeclaration({ year: annee, turnover: Number(ca), paidAmount: paye ? Number(paye) : undefined, paidOn: paye ? aujourdhui() : undefined });
      setMessage(`CGU ${annee} : ${fmt(r.amountDue)} FCFA.`);
      setVersion((v) => v + 1);
    } catch (err) { setErreur(err.message); }
  }

  return (
    <div>
      {(erreur || erreurChargement) && <div className="erreur">{erreur || erreurChargement}</div>}
      {message && <p style={{ color: '#137a4b' }}>{message}</p>}

      <h3 style={{ fontSize: 14 }}>Barème</h3>
      {tranches.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <input type="number" min="0" placeholder="CA jusqu'à (vide = sans plafond)" value={t.jusqua}
            onChange={(e) => setTranches(tranches.map((x, j) => (j === i ? { ...x, jusqua: e.target.value } : x)))} />
          <input type="number" min="0" placeholder="Montant de la CGU" value={t.montant}
            onChange={(e) => setTranches(tranches.map((x, j) => (j === i ? { ...x, montant: e.target.value } : x)))} />
          <button type="button" className="btn" style={boutonPetit} onClick={() => setTranches(tranches.filter((_, j) => j !== i))}>Retirer</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
        <button type="button" className="btn" onClick={() => setTranches([...tranches, { jusqua: '', montant: '' }])}>Ajouter une tranche</button>
        <button type="button" className="btn btn-principal" onClick={enregistrerBareme}>Enregistrer le barème</button>
      </div>

      <h3 style={{ fontSize: 14 }}>Calcul pour l'année</h3>
      <form onSubmit={calculer} className="sg-form-ligne">
        <input type="number" value={annee} onChange={(e) => setAnnee(e.target.value)} style={{ width: 100 }} />
        <input type="number" min="0" placeholder="Chiffre d'affaires (FCFA)" value={ca} onChange={(e) => setCa(e.target.value)} required />
        <input type="number" min="0" placeholder="Déjà payé (facultatif)" value={paye} onChange={(e) => setPaye(e.target.value)} />
        <button type="submit" className="btn btn-principal">Calculer et enregistrer</button>
      </form>

      <h3 style={{ fontSize: 14 }}>Historique</h3>
      <table style={tableStyle}>
        <thead>
          <tr><th style={enteteTable}>Année</th><th style={enteteTable}>Chiffre d'affaires</th><th style={enteteTable}>CGU due</th><th style={enteteTable}>Payée</th><th style={enteteTable}>Reste</th></tr>
        </thead>
        <tbody>
          {(donnees?.historique || []).map((h) => (
            <tr key={h.id}>
              <td style={cellule}>{h.year}</td><td style={droite}>{fmt(h.turnover)}</td><td style={droite}>{fmt(h.amount_due)}</td>
              <td style={droite}>{fmt(h.amount_paid)}</td><td style={droite}>{fmt(Math.max(Number(h.amount_due) - Number(h.amount_paid), 0))}</td>
            </tr>
          ))}
          {donnees && donnees.historique.length === 0 && <tr><td style={cellule} colSpan={5}>Aucune CGU enregistrée.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Obligations mensuelles suivies dans l'échéancier. Une déclaration est « déposée » dès qu'un dépôt existe pour
// (type, période) ; l'échéance est le 15 du mois suivant la période. Fenêtre : les 4 derniers mois + le mois en cours.
const OBLIGATIONS = [
  { id: 'tva', label: 'TVA', desc: 'Taxe sur la valeur ajoutée', kinds: ['tva'], dettes: ['tva'] },
  { id: 'vrs', label: 'VRS', desc: 'Versement des retenues sur salaires', kinds: ['vrs', 'ir'], dettes: ['retenues'] },
  { id: 'brs', label: 'BRS', desc: 'Retenue à la source sur loyers et prestations', kinds: ['brs'], dettes: [] },
];
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS_FR = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const joursEntre = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

function construireEcheances(depots, auj) {
  const maintenant = new Date(`${auj}T00:00:00`);
  const liste = [];
  for (let k = -4; k <= 0; k += 1) {
    const mois = new Date(maintenant.getFullYear(), maintenant.getMonth() + k, 1);
    const periode = `${mois.getFullYear()}-${String(mois.getMonth() + 1).padStart(2, '0')}`;
    const echeance = iso(new Date(mois.getFullYear(), mois.getMonth() + 1, 15));
    OBLIGATIONS.forEach((o) => {
      const depot = (depots || []).find((f) => o.kinds.includes(f.kind) && f.period === periode);
      let etat = 'avenir';
      if (depot) etat = 'ok';
      else if (echeance < auj) etat = 'retard';
      liste.push({
        cle: `${o.id}-${periode}`, obligation: o, periode, echeance, depot, etat,
        titre: `${o.label} — ${majuscule(MOIS_FR[mois.getMonth()])} ${mois.getFullYear()}`,
      });
    });
  }
  return liste.sort((a, b) => a.echeance.localeCompare(b.echeance));
}

// Échéancier : bandeau marine (état des déclarations), une carte par obligation, calendrier fiscal et liste
// des déclarations triées par échéance. Étapes : À préparer = échéance à plus de 7 jours ; En cours = dans les
// 7 jours ; À valider = échéance dépassée non déposée ; Validées = déposée sans récépissé ; Déposées = avec récépissé.
function VueEnsembleFiscalite({ onOuvrir }) {
  const { merchant } = useAuth();
  const [d, erreur] = useDonnees(async () => {
    const [dues, depots] = await Promise.all([
      api.getAccountingStateDues(),
      api.getTaxFilings().catch(() => []),
    ]);
    return { dues, depots };
  }, []);
  const auj = aujourdhui();
  const [vue, setVue] = useState(() => { const t = new Date(); return { a: t.getFullYear(), m: t.getMonth() }; });

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!d) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;

  const echeances = construireEcheances(d.depots, auj);
  const ouvertes = echeances.filter((e) => e.etat !== 'ok');
  const retards = ouvertes.filter((e) => e.etat === 'retard');
  const imminentes = ouvertes.filter((e) => e.etat === 'avenir' && joursEntre(auj, e.echeance) <= 7);
  const aPreparer = ouvertes.filter((e) => e.etat === 'avenir' && joursEntre(auj, e.echeance) > 7);
  const validees = echeances.filter((e) => e.etat === 'ok' && !e.depot.receipt_number);
  const deposees = echeances.filter((e) => e.etat === 'ok' && e.depot.receipt_number);
  const prochaine = ouvertes.find((e) => e.echeance >= auj) || ouvertes[0];

  const etapes = [
    { id: 'preparer', label: 'À préparer', compte: aPreparer.length },
    { id: 'encours', label: 'En cours', compte: imminentes.length },
    { id: 'valider', label: 'À valider', compte: retards.length },
    { id: 'validees', label: 'Validées', compte: validees.length },
    { id: 'deposees', label: 'Déposées', compte: deposees.length },
  ];
  const actif = retards.length ? 'valider' : imminentes.length ? 'encours' : aPreparer.length ? 'preparer' : 'deposees';
  etapes.forEach((e) => { e.statut = e.id === actif ? 'actif' : 'a_faire'; e.cliquable = false; });

  const detteDe = (types) => (d.dues?.dettes || []).filter((x) => types.includes(x.type)).reduce((t, x) => t + Number(x.du || 0), 0);
  const totalDu = (d.dues?.dettes || []).filter((x) => !['css', 'ipres'].includes(x.type)).reduce((t, x) => t + Number(x.du || 0), 0);

  // Calendrier du mois affiché.
  const premier = new Date(vue.a, vue.m, 1);
  const decalage = (premier.getDay() + 6) % 7;
  const nbJours = new Date(vue.a, vue.m + 1, 0).getDate();
  const cases = [];
  for (let i = 0; i < decalage; i += 1) cases.push({ vide: true, cle: `v${i}` });
  for (let n = 1; n <= nbJours; n += 1) {
    const date = iso(new Date(vue.a, vue.m, n));
    const jourSemaine = (decalage + n - 1) % 7;
    cases.push({ cle: date, n, date, we: jourSemaine >= 5, auj: date === auj, items: echeances.filter((e) => e.echeance === date) });
  }
  function changerMois(delta) {
    const t = new Date(vue.a, vue.m + delta, 1);
    setVue({ a: t.getFullYear(), m: t.getMonth() });
  }

  const nomCommerce = merchant?.businessName || '';
  const ordreListe = [...ouvertes, ...echeances.filter((e) => e.etat === 'ok').reverse().slice(0, 4)];

  return (
    <div>
      <BandeauMarine
        surtitre={`ÉCHÉANCES · TOUTES OBLIGATIONS · ${nomCommerce.toUpperCase()}`}
        titre={retards.length > 0 ? `${retards.length} déclaration${retards.length > 1 ? 's' : ''} en retard` : 'Aucune déclaration en retard'}
        detail={prochaine ? `prochaine échéance le ${dateFr(prochaine.echeance)}` : undefined}
        etapes={etapes}
      />

      <div className="sg-grille-obligations">
        {OBLIGATIONS.map((o) => {
          const prochaineO = ouvertes.find((e) => e.obligation.id === o.id);
          const montant = o.dettes.length ? detteDe(o.dettes) : null;
          const retard = prochaineO?.etat === 'retard';
          return (
            <div key={o.id} className="sg-obligation">
              <div className="sg-obligation-tete">
                <b>{o.label}</b>
                <span className={`sg-pastille-statut ${!prochaineO ? 'ok' : retard ? 'retard' : ''}`} style={{ marginTop: 0 }}>
                  {!prochaineO ? 'À jour' : retard ? 'En retard' : 'À venir'}
                </span>
                <em>Mensuelle</em>
              </div>
              <p className="desc">{o.desc}</p>
              <div className="sg-obligation-pied">
                <div>
                  <small>Prochaine échéance</small>
                  <span className={`date${retard ? ' retard' : ''}`}>{prochaineO ? dateFr(prochaineO.echeance) : '—'}</span>
                  {retard && <small>En retard de {joursEntre(prochaineO.echeance, auj)} j</small>}
                </div>
                <div>
                  <small style={{ textAlign: 'right' }}>Montant estimé</small>
                  <div className="montant">{montant === null || montant === 0 ? '—' : fmt(montant)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sg-deux-colonnes">
        <div className="sg-panneau">
          <div className="sg-panneau-tete">
            <h3>Calendrier fiscal</h3>
            <span className="sg-nav-mois">
              <button type="button" onClick={() => changerMois(-1)} aria-label="Mois précédent">‹</button>
              {majuscule(MOIS_FR[vue.m])} {vue.a}
              <button type="button" onClick={() => changerMois(1)} aria-label="Mois suivant">›</button>
            </span>
            <span className="sg-legende">
              <span><i style={{ background: '#c7a45f' }} />À venir</span>
              <span><i style={{ background: '#b3261e' }} />En retard</span>
              <span><i style={{ background: '#2f6b5c' }} />Déposé</span>
            </span>
          </div>
          <div className="sg-calendrier">
            {JOURS_FR.map((j) => <div key={j} className="sg-jour-nom">{j}</div>)}
            {cases.map((c) => (c.vide ? <div key={c.cle} className="sg-jour vide" /> : (
              <div key={c.cle} className={`sg-jour${c.we ? ' we' : ''}${c.auj ? ' auj' : ''}`}>
                {c.n}
                {c.items.map((e) => <span key={e.cle} className={`sg-jour-chip ${e.etat}`}>{e.obligation.label}</span>)}
              </div>
            )))}
          </div>
        </div>

        <div className="sg-panneau">
          <div className="sg-panneau-tete">
            <h3>Déclarations</h3>
            <span className="sg-discret">{nomCommerce} · triées par échéance</span>
          </div>
          <div className="sg-groupe">À traiter · {ouvertes.length} échéance{ouvertes.length > 1 ? 's' : ''}</div>
          {ordreListe.map((e) => (
            <button key={e.cle} type="button" className="sg-decl" onClick={() => onOuvrir('declarations')}>
              <span className={`sg-decl-barre ${e.etat}`} />
              <span>
                <span className="sg-decl-titre">{e.titre}</span>
                <small>{nomCommerce}</small>
              </span>
              <span className={`sg-decl-date ${e.etat === 'retard' ? 'retard' : ''}`}>
                {dateFr(e.echeance)}
                <div><span className={`sg-pastille-statut ${e.etat === 'retard' ? 'retard' : e.etat === 'ok' ? 'ok' : 'neutre'}`}>
                  {e.etat === 'retard' ? 'En retard' : e.etat === 'ok' ? 'Déposée' : 'À préparer'}
                </span></div>
              </span>
            </button>
          ))}
          {ordreListe.length === 0 && <p style={{ padding: 18, color: 'var(--encre-douce)' }}>Aucune échéance.</p>}
        </div>
      </div>

      <p className="sg-pied-note">
        Dû à l'État (impôts) : <b>{fmt(totalDu)} FCFA</b> · fenêtre : 4 derniers mois + mois en cours ·{' '}
        <button type="button" onClick={() => onOuvrir('declarations')}>Ouvrir les déclarations</button>
      </p>
    </div>
  );
}

export function FiscalitePage() {
  const { user, aRole } = useAuth();
  const { loaded, accounting, fiscalite } = useModulesAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const [onglet, setOnglet] = useState(() => searchParams.get('onglet') || 'vue');
  useEffect(() => {
    const demande = searchParams.get('onglet');
    if (demande && demande !== onglet) setOnglet(demande);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  function choisirOnglet(id) {
    setOnglet(id);
    setSearchParams({ onglet: id }, { replace: true });
  }

  // Manager, ou comptable (même cumulé avec un autre rôle, ex. gérant + comptable) ayant la page Fiscalité
  // dans ses permissions (rien de personnalisé = les trois pages de finance).
  const pageAutorisee = aRole('manager')
    || (aRole('comptable') && (!Array.isArray(user?.visibleModules) || user.visibleModules.includes('fiscalite')));
  if (!pageAutorisee) return <Navigate to="/" replace />;
  if (!loaded) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;
  if (!accounting || !fiscalite) return <PageModuleNonActive nom="Fiscalité" />;

  const onglets = [
    { id: 'vue', label: 'Échéancier' },
    { id: 'declarations', label: 'Déclarations' },
    { id: 'impots', label: 'Impôts' },
    { id: 'etat1024', label: 'État 1024' },
    { id: 'impotsdirects', label: 'Impôts directs' },
    { id: 'cgu', label: 'CGU / Annuelle' },
    { id: 'profil', label: 'Profil fiscal' },
  ];

  return (
    <div>
      <ApercuPdf />
      <EntetePage numero="05. FISCALITÉ" titre="Fiscalité">
        <button type="button" className="btn" onClick={() => choisirOnglet('profil')}>Paramètres fiscaux</button>
        <button type="button" className="btn btn-principal" onClick={() => choisirOnglet('declarations')}>Préparer une déclaration</button>
      </EntetePage>
      <BarreSections sections={onglets} actif={onglet} onChoisir={choisirOnglet} />
      {onglet === 'vue' && <VueEnsembleFiscalite onOuvrir={choisirOnglet} />}
      {onglet === 'declarations' && <DeclarationsTab />}
      {onglet === 'impots' && <ImpotsTab />}
      {onglet === 'etat1024' && <Etat1024Tab />}
      {onglet === 'impotsdirects' && <ImpotsDirectsTab />}
      {onglet === 'cgu' && <CguTab />}
      {onglet === 'profil' && <ProfilTab />}
    </div>
  );
}

export default FiscalitePage;
