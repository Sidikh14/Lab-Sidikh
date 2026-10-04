import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useModulesAccess } from '../hooks/useModulesAccess';
import { PageModuleNonActive } from '../components/ModuleNonActive';
import {
  ImpotsTab, ApercuPdf, exporterPdf, useDonnees,
  fmt, dateFr, aujourdhui, tableStyle, cellule, droite, enteteTable, boutonPetit,
} from './ComptabilitePage';

// Module Fiscalité : déclarations de la DGID préparées à partir de la comptabilité et de la paie,
// paiement des impôts et cotisations, profil du contribuable.
// Visible seulement si l'owner a activé la fiscalité (et la comptabilité sur laquelle elle s'appuie).

const TYPES = [
  { id: 'tva', label: 'TVA (mensuelle)' },
  { id: 'vrs', label: 'Retenues sur salaires — IR, TRIMF, CFCE (mensuelle)' },
];
const NOMS_TYPES = { tva: 'TVA', vrs: 'Retenues sur salaires' };
const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const libelleMois = (m) => (m ? `${NOMS_MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : '');

function moisPrecedent() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function DeclarationsTab() {
  const [type, setType] = useState('tva');
  const [mois, setMois] = useState(moisPrecedent());
  const [version, setVersion] = useState(0);
  const [depot, setDepot] = useState(false);
  const [dateDepot, setDateDepot] = useState(aujourdhui());
  const [recepisse, setRecepisse] = useState('');
  const [erreurAction, setErreurAction] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [donnees, erreur] = useDonnees(
    async () => {
      const [declaration, depots] = await Promise.all([api.getTaxDeclaration(type, mois), api.getTaxFilings()]);
      return { declaration, depots };
    },
    [type, mois, version]
  );

  useEffect(() => {
    setDepot(false);
    setRecepisse('');
    setErreurAction('');
  }, [type, mois]);

  async function enregistrerDepot(e) {
    e.preventDefault();
    setErreurAction('');
    setEnCours(true);
    try {
      const d = donnees.declaration;
      await api.createTaxFiling({
        kind: type, period: mois, filedOn: dateDepot, receiptNumber: recepisse || undefined,
        amountDue: type === 'tva' ? d.figures.aPayer : d.totals.aVerser,
        snapshot: type === 'tva' ? d.figures : d.totals,
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
        Les montants sont repris de la comptabilité et de la paie, dans l'ordre des rubriques de la déclaration.
        Imprimez ou ouvrez la fiche PDF, saisissez les montants sur le portail de la DGID (Mon Espace Perso ou e-Tax),
        puis enregistrez ici le numéro de récépissé.
      </p>
      {erreurAction && <div className="erreur">{erreurAction}</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div className="champ-groupe" style={{ margin: 0 }}>
          <label className="etiquette">Déclaration</label>
          <select className="champ" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div className="champ-groupe" style={{ margin: 0 }}>
          <label className="etiquette">Mois concerné</label>
          <input type="month" className="champ" value={mois} max={aujourdhui().slice(0, 7)} onChange={(e) => e.target.value && setMois(e.target.value)} />
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}
      {!donnees && !erreur && <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>}

      {donnees && (() => {
        const d = donnees.declaration;
        return (
          <div style={{ marginBottom: 26 }}>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>{NOMS_TYPES[type]} — {libelleMois(mois)}</h3>
            <p style={{ color: 'var(--encre-douce)', fontSize: 13, margin: '0 0 10px' }}>
              À déposer et payer au plus tard le {dateFr(d.deadline)}.
              {d.neant && ' Aucune opération ce mois : déclaration « NÉANT ».'}
            </p>
            {d.alertes.map((a) => <div key={a} className="erreur" style={{ marginBottom: 8 }}>{a}</div>)}

            {type === 'tva' && (
              <table style={tableStyle}>
                <tbody>
                  {d.rubriques.map((r) => (
                    <tr key={r.code}>
                      <td style={{ ...cellule, width: 44, fontWeight: 600 }}>{r.code}</td>
                      <td style={{ ...cellule, fontWeight: ['E', 'F'].includes(r.code) ? 600 : 400 }}>{r.label}</td>
                      <td style={{ ...droite, fontWeight: ['E', 'F'].includes(r.code) ? 600 : 400 }}>{fmt(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {type === 'vrs' && (
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={enteteTable}>Salarié</th>
                      <th style={{ ...enteteTable, textAlign: 'right' }}>Salaire brut</th>
                      <th style={{ ...enteteTable, textAlign: 'right' }}>IR</th>
                      <th style={{ ...enteteTable, textAlign: 'right' }}>TRIMF</th>
                      <th style={{ ...enteteTable, textAlign: 'right' }}>CFCE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.lines.map((l) => (
                      <tr key={l.name}>
                        <td style={cellule}>{l.name}</td>
                        <td style={droite}>{fmt(l.gross)}</td>
                        <td style={droite}>{fmt(l.ir)}</td>
                        <td style={droite}>{fmt(l.trimf)}</td>
                        <td style={droite}>{fmt(l.cfce)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ ...cellule, fontWeight: 600 }}>Total</td>
                      <td style={{ ...droite, fontWeight: 600 }}>{fmt(d.totals.gross)}</td>
                      <td style={{ ...droite, fontWeight: 600 }}>{fmt(d.totals.ir)}</td>
                      <td style={{ ...droite, fontWeight: 600 }}>{fmt(d.totals.trimf)}</td>
                      <td style={{ ...droite, fontWeight: 600 }}>{fmt(d.totals.cfce)}</td>
                    </tr>
                  </tbody>
                </table>
                <p style={{ fontWeight: 600, margin: '10px 0 0' }}>Total à verser : {fmt(d.totals.aVerser)} FCFA</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
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
        );
      })()}

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
                      <td style={cellule}>{NOMS_TYPES[f.kind]}</td>
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
        <input type="text" className="champ" maxLength={20} value={profil.ninea} onChange={maj('ninea')} />
      </div>
      <div className="champ-groupe">
        <label className="etiquette">Raison sociale</label>
        <input type="text" className="champ" maxLength={200} value={profil.legalName} onChange={maj('legalName')} />
      </div>
      <div className="champ-groupe">
        <label className="etiquette">Adresse</label>
        <input type="text" className="champ" maxLength={300} value={profil.address} onChange={maj('address')} />
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

export function FiscalitePage() {
  const { user } = useAuth();
  const { loaded, accounting, fiscalite } = useModulesAccess();
  const [onglet, setOnglet] = useState('declarations');

  if (user?.role !== 'manager') return <Navigate to="/" replace />;
  if (!loaded) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;
  if (!accounting || !fiscalite) return <PageModuleNonActive nom="Fiscalité" />;

  const onglets = [
    { id: 'declarations', label: 'Déclarations' },
    { id: 'impots', label: 'Impôts & cotisations' },
    { id: 'profil', label: 'Profil fiscal' },
  ];

  return (
    <div>
      <ApercuPdf />
      <div className="entete-page">
        <div>
          <h1>Fiscalité</h1>
          <p style={{ color: 'var(--encre-douce)', fontSize: 13, margin: '4px 0 0' }}>
            Déclarations DGID · impôts et cotisations · calculés depuis la comptabilité et la paie · montants en FCFA
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {onglets.map((o) => (
          <button key={o.id} type="button" className={`btn ${o.id === onglet ? 'btn-principal' : ''}`} onClick={() => setOnglet(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      {onglet === 'declarations' && <DeclarationsTab />}
      {onglet === 'impots' && <ImpotsTab />}
      {onglet === 'profil' && <ProfilTab />}
    </div>
  );
}

export default FiscalitePage;
