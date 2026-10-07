import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useModulesAccess } from '../hooks/useModulesAccess';
import { PageModuleNonActive } from '../components/ModuleNonActive';
import { BarreSections, GrilleKpi, BarresComparaison } from '../components/SectionsUi';
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
      <p style={{ color: 'var(--encre-douce)', fontSize: 13, margin: '0 0 10px' }}>
        Ajoutez uniquement les loyers et prestations payés à des tiers qui sont soumis à la retenue à la source : la retenue est calculée à 5 % du montant brut.
      </p>
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
      <p style={{ color: 'var(--encre-douce)', fontSize: 13.5, marginTop: 0 }}>
        Chaque déclaration reprend la présentation des documents de la DGID : renseignements du contribuable, puis annexe fiscale avec des lignes numérotées.
        Ouvrez la fiche PDF, saisissez les montants sur le portail (Mon Espace Perso ou e-Tax), puis enregistrez ici le numéro de récépissé.
      </p>
      {erreurAction && <div className="erreur">{erreurAction}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {TYPES.map((t) => (
          <button key={t.id} type="button" className={`btn ${t.id === type ? 'btn-principal' : ''}`} onClick={() => setType(t.id)}>{t.label}</button>
        ))}
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
      <p style={{ color: 'var(--encre-douce)', fontSize: 13.5, marginTop: 0 }}>
        Ces informations figurent en en-tête des fiches de déclaration. Elles doivent correspondre à celles de votre dossier à la DGID.
      </p>
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
function prochaineEcheance() {
  const auj = new Date();
  const d = new Date(auj.getFullYear(), auj.getMonth(), 15);
  if (auj.getDate() > 15) d.setMonth(d.getMonth() + 1);
  const jours = Math.ceil((d - new Date(auj.getFullYear(), auj.getMonth(), auj.getDate())) / 86400000);
  return { date: d.toLocaleDateString('fr-FR'), jours };
}

// Vue d'ensemble : ce que l'on doit à l'État, la prochaine échéance, le BRS et les déclarations du mois.
function VueEnsembleFiscalite() {
  const mois = moisPrecedent();
  const [d, erreur] = useDonnees(async () => {
    const [dues, brs, depots] = await Promise.all([
      api.getAccountingStateDues(),
      api.getBrsEntries(mois).catch(() => []),
      api.getTaxFilings().catch(() => []),
    ]);
    return { dues, brs, depots };
  }, []);

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!d) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;

  // Les cotisations (CSS, IPRES) se suivent dans la page Paie : ici seulement les impôts.
  const impots = (d.dues.dettes || []).filter((x) => !['css', 'ipres'].includes(x.type));
  const aPayer = impots.filter((x) => Number(x.du) > 0);
  const totalDu = aPayer.reduce((t, x) => t + Number(x.du), 0);
  const brsTotal = (d.brs || []).reduce((t, x) => t + Number(x.gross_ht || 0), 0);
  const echeance = prochaineEcheance();
  const nbDepots = Array.isArray(d.depots) ? d.depots.length : 0;

  return (
    <div>
      <GrilleKpi cartes={[
        { label: "Dû à l'État (impôts)", valeur: fmt(totalDu), unite: 'FCFA', detail: aPayer.length > 0 ? `${aPayer.length} impôt(s) à payer` : 'Rien à payer', ton: totalDu > 0 ? 'alerte' : undefined },
        { label: 'Prochaine échéance', valeur: echeance.date, detail: echeance.jours === 0 ? "C'est aujourd'hui" : `dans ${echeance.jours} jour(s)`, ton: echeance.jours <= 3 ? 'alerte' : undefined },
        { label: `BRS — ${libelleMois(mois)}`, valeur: String((d.brs || []).length), unite: 'versement(s)', detail: `Base : ${fmt(brsTotal)} FCFA` },
        { label: 'Déclarations déposées', valeur: String(nbDepots), detail: 'enregistrées avec leur récépissé' },
      ]} />

      {aPayer.length > 0 ? (
        <BarresComparaison
          titre="Ce que vous devez, par impôt"
          lignes={aPayer.map((x) => ({ label: x.label, valeur: Number(x.du), texte: `${fmt(x.du)} FCFA` }))}
        />
      ) : (
        <p style={{ color: 'var(--encre-douce)', fontSize: 13.5 }}>Aucun impôt à payer pour le moment.</p>
      )}
      <p style={{ color: 'var(--encre-douce)', fontSize: 12.5 }}>
        Les déclarations du mois précédent se préparent dans l'onglet « Déclarations » ; le paiement se fait dans « Impôts ».
        La date limite indiquée est celle des déclarations mensuelles (le 15).
      </p>
    </div>
  );
}

export function FiscalitePage() {
  const { user } = useAuth();
  const { loaded, accounting, fiscalite } = useModulesAccess();
  const [onglet, setOnglet] = useState('vue');

  if (user?.role !== 'manager') return <Navigate to="/" replace />;
  if (!loaded) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;
  if (!accounting || !fiscalite) return <PageModuleNonActive nom="Fiscalité" />;

  const onglets = [
    { id: 'vue', label: "Vue d'ensemble" },
    { id: 'declarations', label: 'Déclarations' },
    { id: 'impots', label: 'Impôts' },
    { id: 'profil', label: 'Profil fiscal' },
  ];

  return (
    <div>
      <ApercuPdf />
      <div className="entete-page">
        <div>
          <h1>Fiscalité</h1>
          <p style={{ color: 'var(--encre-douce)', fontSize: 13, margin: '4px 0 0' }}>
            Déclarations DGID · impôts · calculés depuis la comptabilité et la paie · montants en FCFA
          </p>
        </div>
      </div>
      <BarreSections sections={onglets} actif={onglet} onChoisir={setOnglet} />
      {onglet === 'vue' && <VueEnsembleFiscalite />}
      {onglet === 'declarations' && <DeclarationsTab />}
      {onglet === 'impots' && <ImpotsTab />}
      {onglet === 'profil' && <ProfilTab />}
    </div>
  );
}

export default FiscalitePage;
