import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { PageModuleNonActive } from '../components/ModuleNonActive';
import { api } from '../api/client';
import { useAccountingAccess } from '../hooks/useAccountingAccess';
import { useAuth } from '../context/AuthContext';

// Module comptabilité (SYSCOHADA). Affiché uniquement si l'owner a donné
// l'accès au commerçant : sinon la page redirige vers l'accueil et le lien
// n'apparaît pas dans le menu.

export const fmt = (n) => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
export const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
export const aujourdhui = () => new Date().toISOString().slice(0, 10);
const debutAnnee = () => `${new Date().getFullYear()}-01-01`;

export const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 };
export const cellule = { padding: '6px 8px', borderBottom: '1px solid rgba(128,128,128,0.18)', textAlign: 'left' };
export const droite = { ...cellule, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
export const enteteTable = { ...cellule, fontWeight: 600, color: 'var(--encre-douce)' };
export const boutonPetit = { padding: '6px 10px', fontSize: 12.5 };

const useEntreprise = () => useAuth().merchant?.businessName || '';
const libellePeriode = (p) => `Du ${dateFr(p.from)} au ${dateFr(p.to)}`;

// Format de la sortie en cours : les fonctions d'export des onglets appellent toutes
// exporterPdf(payload) ; le bouton « Excel » fait aiguiller ce même payload vers un fichier
// tableur, sans dupliquer la construction du rapport dans chaque onglet.
let formatSortie = 'pdf';

function BoutonExport({ onClick, disabled }) {
  function lancer(format) {
    formatSortie = format;
    try {
      onClick();
    } finally {
      formatSortie = 'pdf';
    }
  }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" className="btn" style={boutonPetit} disabled={disabled} onClick={() => lancer('pdf')}>
        Exporter en PDF
      </button>
      <button type="button" className="btn" style={boutonPetit} disabled={disabled} onClick={() => lancer('excel')}>
        Exporter pour Excel
      </button>
    </div>
  );
}

// ---------- Export tableur (CSV lisible par Excel) ----------
// Les montants affichés (« 1 234 567,5 ») sont convertis en vrais nombres pour que les
// colonnes se totalisent dans Excel. Séparateur « ; » + BOM UTF-8 : s'ouvre directement
// en français, accents compris.

const MONTANT_AFFICHE = /^-?\d{1,3}(?:[\u202f\u00a0 ]\d{3})*(?:,\d+)?$|^-?\d+(?:,\d+)?$/;

function celluleTableur(valeur) {
  if (valeur === null || valeur === undefined) return '';
  let s = String(valeur);
  if (MONTANT_AFFICHE.test(s.trim())) {
    // Nombre : on retire les séparateurs de milliers, la virgule décimale reste (Excel FR).
    return s.trim().replace(/[\u202f\u00a0 ]/g, '').replace('-', '-');
  }
  // Un texte qui commencerait par = + @ - serait pris pour une formule par le tableur.
  if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`;
  s = s.replace(/^ +/, (esp) => '\u00a0'.repeat(esp.length)); // garde l'indentation des sous-comptes
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exporterTableur(payload) {
  const lignesCsv = [];
  const ajouter = (cells) => lignesCsv.push(cells.map(celluleTableur).join(';'));
  if (payload.entreprise) ajouter([payload.entreprise]);
  ajouter([payload.titre || 'Rapport']);
  if (payload.periode) ajouter([payload.periode]);
  for (const section of payload.sections || []) {
    ajouter([]);
    if (section.titre) ajouter([section.titre]);
    if (section.colonnes) ajouter(section.colonnes.map((c) => c.label));
    for (const ligne of section.lignes || []) ajouter(Array.isArray(ligne) ? ligne : ligne.cells || []);
  }
  const contenu = `\uFEFF${lignesCsv.join('\r\n')}\r\n`;
  const blob = new Blob([contenu], { type: 'text/csv;charset=utf-8' });
  const nom = `${String(payload.titre || 'rapport').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}_${aujourdhui()}.csv`;
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const CLASSES = {
  1: 'Classe 1 — Ressources durables',
  2: 'Classe 2 — Actif immobilisé',
  3: 'Classe 3 — Stocks',
  4: 'Classe 4 — Tiers',
  5: 'Classe 5 — Trésorerie',
  6: 'Classe 6 — Charges des activités ordinaires',
  7: 'Classe 7 — Produits des activités ordinaires',
  8: 'Classe 8 — Autres charges et produits',
};

// Charge des données et les recharge quand `deps` change.
export function useDonnees(chargeur, deps) {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    let actif = true;
    setErreur('');
    chargeur()
      .then((d) => actif && setDonnees(d))
      .catch((e) => actif && setErreur(e.message));
    return () => {
      actif = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [donnees, erreur];
}

function Periode({ periode, onChange, unSeulJour }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
      {!unSeulJour && (
        <>
          <label className="etiquette">Du</label>
          <input type="date" className="champ" style={{ width: 'auto' }} value={periode.from}
            onChange={(e) => onChange({ ...periode, from: e.target.value })} />
        </>
      )}
      <label className="etiquette">{unSeulJour ? 'Au' : 'au'}</label>
      <input type="date" className="champ" style={{ width: 'auto' }} value={periode.to}
        onChange={(e) => onChange({ ...periode, to: e.target.value })} />
    </div>
  );
}

function Ligne({ libelle, montant, fort, sousLigne }) {
  return (
    <tr>
      <td style={{ ...cellule, fontWeight: fort ? 700 : 400, paddingLeft: sousLigne ? 24 : 8, color: sousLigne ? 'var(--encre-douce)' : undefined }}>
        {libelle}
      </td>
      <td style={{ ...droite, fontWeight: fort ? 700 : 400 }}>{fmt(montant)}</td>
    </tr>
  );
}

function BlocComptes({ titre, bloc }) {
  return (
    <>
      <Ligne libelle={titre} montant={bloc.total} fort />
      {bloc.comptes.map((c) => (
        <Ligne key={c.code + c.label} sousLigne libelle={`${c.code} — ${c.label}`} montant={c.montant} />
      ))}
    </>
  );
}

// ---------- Journal ----------

function EcritureModal({ journaux, comptes, onClose, onSaved }) {
  const [journalId, setJournalId] = useState(journaux[0]?.id || '');
  const [date, setDate] = useState(aujourdhui());
  const [reference, setReference] = useState('');
  const [libelle, setLibelle] = useState('');
  const [lignes, setLignes] = useState([
    { accountId: '', debit: '', credit: '' },
    { accountId: '', debit: '', credit: '' },
  ]);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const totalDebit = lignes.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lignes.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const equilibre = totalDebit > 0 && Math.round(totalDebit * 100) === Math.round(totalCredit * 100);

  function maj(i, champ, valeur) {
    setLignes((ls) =>
      ls.map((l, k) => {
        if (k !== i) return l;
        const suivante = { ...l, [champ]: valeur };
        if (champ === 'debit' && valeur) suivante.credit = '';
        if (champ === 'credit' && valeur) suivante.debit = '';
        return suivante;
      })
    );
  }

  async function enregistrer(e) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await api.createAccountingEntry({
        journalId,
        entryDate: date,
        reference,
        label: libelle,
        lines: lignes
          .filter((l) => l.accountId || l.debit || l.credit)
          .map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
      });
      onSaved();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="modale-fond" onClick={onClose}>
      <div className="modale" style={{ maxWidth: 780, width: '96%', maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>Nouvelle écriture</h2>
        <form onSubmit={enregistrer}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <div className="champ-groupe">
              <label className="etiquette">Journal</label>
              <select className="champ" value={journalId} onChange={(e) => setJournalId(e.target.value)}>
                {journaux.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.label}</option>)}
              </select>
            </div>
            <div className="champ-groupe">
              <label className="etiquette">Date</label>
              <input type="date" className="champ" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="champ-groupe">
              <label className="etiquette">Référence (pièce)</label>
              <input className="champ" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Libellé</label>
            <input className="champ" value={libelle} maxLength={300} onChange={(e) => setLibelle(e.target.value)} required />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
            {lignes.map((l, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr) auto', gap: 8 }}>
                <select className="champ" value={l.accountId} onChange={(e) => maj(i, 'accountId', e.target.value)}>
                  <option value="">Compte…</option>
                  {comptes.filter((c) => c.is_active).map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.label}</option>
                  ))}
                </select>
                <input type="number" min="0" step="any" className="champ" placeholder="Débit" value={l.debit} onChange={(e) => maj(i, 'debit', e.target.value)} />
                <input type="number" min="0" step="any" className="champ" placeholder="Crédit" value={l.credit} onChange={(e) => maj(i, 'credit', e.target.value)} />
                <button type="button" className="btn" style={boutonPetit} disabled={lignes.length <= 2}
                  onClick={() => setLignes((ls) => ls.filter((_, k) => k !== i))}>×</button>
              </div>
            ))}
            <div>
              <button type="button" className="btn" style={boutonPetit}
                onClick={() => setLignes((ls) => [...ls, { accountId: '', debit: '', credit: '' }])}>
                + Ajouter une ligne
              </button>
            </div>
          </div>

          <p style={{ margin: '0 0 10px', fontSize: 13.5, color: equilibre ? 'var(--succes, #1a7f4b)' : 'var(--danger, #b42318)' }}>
            Débit {fmt(totalDebit)} · Crédit {fmt(totalCredit)}{' '}
            {equilibre ? '— équilibrée' : `— écart ${fmt(Math.abs(totalDebit - totalCredit))}`}
          </p>
          {erreur && <div className="erreur">{erreur}</div>}
          <div className="actions-modale">
            <button type="button" className="btn" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-principal" disabled={!equilibre || envoi}>
              {envoi ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function JournalTab() {
  const [periode, setPeriode] = useState({ from: debutAnnee(), to: aujourdhui() });
  const [version, setVersion] = useState(0);
  const [modale, setModale] = useState(false);
  const [erreurAction, setErreurAction] = useState('');
  const [ecritures, erreur] = useDonnees(
    () => api.getAccountingEntries({ from: periode.from, to: periode.to, limit: 300 }),
    [periode.from, periode.to, version]
  );
  const [ref] = useDonnees(() => Promise.all([api.getAccountingJournals(), api.getAccountingAccounts()]), [version]);

  const entreprise = useEntreprise();
  function exporterJournal() {
    const lignes = [];
    for (const e of [...ecritures].reverse()) {
      lignes.push({ fort: true, cells: [dateFr(e.entry_date), `N°${e.entry_number} · ${e.journal_code}`, `${e.label}${e.reference ? ` (${e.reference})` : ''}`, '', ''] });
      for (const l of e.lines) {
        lignes.push(['', '', `${l.accountCode} — ${l.accountLabel}`, Number(l.debit) > 0 ? fmt(l.debit) : '', Number(l.credit) > 0 ? fmt(l.credit) : '']);
      }
    }
    exporterPdf({
      entreprise, titre: 'Journal', periode: libellePeriode(periode),
      sections: [{ colonnes: [{ label: 'Date' }, { label: 'Pièce' }, { label: 'Libellé / compte' }, { label: 'Débit', align: 'right' }, { label: 'Crédit', align: 'right' }], lignes }],
    });
  }

  async function supprimer(e) {
    if (!window.confirm(`Supprimer l'écriture n°${e.entry_number} ?`)) return;
    setErreurAction('');
    try {
      await api.deleteAccountingEntry(e.id);
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(err.message);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <Periode periode={periode} onChange={setPeriode} />
        <div style={{ display: 'flex', gap: 8 }}>
          <BoutonExport disabled={!ecritures || ecritures.length === 0} onClick={exporterJournal} />
          <button type="button" className="btn btn-principal" disabled={!ref} onClick={() => setModale(true)}>
            Nouvelle écriture
          </button>
        </div>
      </div>
      {(erreur || erreurAction) && <div className="erreur">{erreur || erreurAction}</div>}
      {!ecritures ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : ecritures.length === 0 ? (
        <p className="etat-vide">Aucune écriture sur cette période.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ecritures.map((e) => (
            <div key={e.id} className="carte-entite">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <strong>N°{e.entry_number} · {dateFr(e.entry_date)} · {e.journal_code}{e.reference ? ` · ${e.reference}` : ''}</strong>
                {e.source_type === 'manuel' && (
                  <button type="button" className="btn btn-brique" style={boutonPetit} onClick={() => supprimer(e)}>Supprimer</button>
                )}
              </div>
              <div style={{ color: 'var(--encre-douce)', fontSize: 13.5, marginBottom: 6 }}>{e.label}</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <tbody>
                    {e.lines.map((l, i) => (
                      <tr key={i}>
                        <td style={{ ...cellule, paddingLeft: Number(l.credit) > 0 ? 28 : 8 }}>{l.accountCode} — {l.accountLabel}</td>
                        <td style={droite}>{Number(l.debit) > 0 ? fmt(l.debit) : ''}</td>
                        <td style={droite}>{Number(l.credit) > 0 ? fmt(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
      {modale && ref && (
        <EcritureModal
          journaux={ref[0]}
          comptes={ref[1]}
          onClose={() => setModale(false)}
          onSaved={() => { setModale(false); setVersion((v) => v + 1); }}
        />
      )}
    </div>
  );
}

// ---------- Plan comptable ----------

function PlanTab() {
  const [version, setVersion] = useState(0);
  const [recherche, setRecherche] = useState('');
  const [nouveau, setNouveau] = useState({ code: '', label: '' });
  const [tiers, setTiers] = useState(false);
  const [erreurAction, setErreurAction] = useState('');
  const [comptes, erreur] = useDonnees(() => api.getAccountingAccounts(), [version]);

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const estTiers = (c) => c.code.length === 6 && (c.code.startsWith('411') || c.code.startsWith('401') || c.code.startsWith('422'));
    return (comptes || []).filter((c) => (tiers || !estTiers(c)) && (!q || c.code.startsWith(q) || c.label.toLowerCase().includes(q)));
  }, [comptes, recherche, tiers]);

  async function ajouter(e) {
    e.preventDefault();
    setErreurAction('');
    try {
      await api.createAccountingAccount(nouveau);
      setNouveau({ code: '', label: '' });
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(err.message);
    }
  }

  async function basculer(c) {
    setErreurAction('');
    try {
      await api.updateAccountingAccount(c.id, { isActive: !c.is_active });
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(err.message);
    }
  }

  return (
    <div>
      <form onSubmit={ajouter} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <input className="champ" style={{ width: 130 }} placeholder="N° (ex. 5213)" value={nouveau.code}
          onChange={(e) => setNouveau({ ...nouveau, code: e.target.value })} required />
        <input className="champ" style={{ flex: 1, minWidth: 200 }} placeholder="Intitulé du nouveau compte" value={nouveau.label}
          onChange={(e) => setNouveau({ ...nouveau, label: e.target.value })} required />
        <button type="submit" className="btn btn-principal">Ajouter un compte</button>
      </form>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: 13.5 }}>
        <input type="checkbox" checked={tiers} onChange={(e) => setTiers(e.target.checked)} />
        Afficher les comptes auxiliaires des clients (411…), assureurs (4119…), fournisseurs (401…) et du personnel (422…)
      </label>
      <input className="champ" style={{ marginBottom: 14 }} placeholder="Rechercher par numéro ou intitulé…" value={recherche}
        onChange={(e) => setRecherche(e.target.value)} />
      {(erreur || erreurAction) && <div className="erreur">{erreur || erreurAction}</div>}
      {!comptes ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : (
        Object.keys(CLASSES).map((n) => {
          const deClasse = filtres.filter((c) => c.code[0] === n);
          if (deClasse.length === 0) return null;
          return (
            <div key={n} style={{ marginBottom: 18 }}>
              <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>{CLASSES[n]}</h3>
              <table style={tableStyle}>
                <tbody>
                  {deClasse.map((c) => (
                    <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.5 }}>
                      <td style={{ ...cellule, width: 90, fontVariantNumeric: 'tabular-nums' }}>{c.code}</td>
                      <td style={cellule}>{c.label}</td>
                      <td style={{ ...cellule, textAlign: 'right' }}>
                        <button type="button" className="btn" style={boutonPetit} onClick={() => basculer(c)}>
                          {c.is_active ? 'Désactiver' : 'Réactiver'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------- Grand livre ----------

const GENERAL = '__general__';

const COLONNES_LIVRE = [
  { label: 'Date' }, { label: 'N°' }, { label: 'Jnl' }, { label: 'Libellé' },
  { label: 'Débit', align: 'right' }, { label: 'Crédit', align: 'right' }, { label: 'Solde', align: 'right' },
];

function lignesLivre(c, avecOuverture) {
  return [
    ...(avecOuverture ? [{ fort: true, cells: ['', '', '', "Solde à l'ouverture", '', '', fmt(c.opening)] }] : []),
    ...c.lines.map((l) => [dateFr(l.date), l.entryNumber, l.journal, l.label, l.debit > 0 ? fmt(l.debit) : '', l.credit > 0 ? fmt(l.credit) : '', fmt(l.solde)]),
    { fort: true, cells: ['', '', '', 'Totaux', fmt(c.totalDebit), fmt(c.totalCredit), fmt(c.closing)] },
  ];
}

function TableCompte({ c, avecOuverture }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={enteteTable}>Date</th><th style={enteteTable}>N°</th><th style={enteteTable}>Jnl</th>
            <th style={enteteTable}>Libellé</th>
            <th style={{ ...enteteTable, textAlign: 'right' }}>Débit</th>
            <th style={{ ...enteteTable, textAlign: 'right' }}>Crédit</th>
            <th style={{ ...enteteTable, textAlign: 'right' }}>Solde</th>
          </tr>
        </thead>
        <tbody>
          {avecOuverture && (
            <tr>
              <td style={cellule} colSpan={6}><em>Solde à l'ouverture de la période</em></td>
              <td style={droite}>{fmt(c.opening)}</td>
            </tr>
          )}
          {c.lines.map((l, i) => (
            <tr key={i}>
              <td style={cellule}>{dateFr(l.date)}</td>
              <td style={cellule}>{l.entryNumber}</td>
              <td style={cellule}>{l.journal}</td>
              <td style={cellule}>{l.label}</td>
              <td style={droite}>{l.debit > 0 ? fmt(l.debit) : ''}</td>
              <td style={droite}>{l.credit > 0 ? fmt(l.credit) : ''}</td>
              <td style={droite}>{fmt(l.solde)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...cellule, fontWeight: 700 }} colSpan={4}>Totaux</td>
            <td style={{ ...droite, fontWeight: 700 }}>{fmt(c.totalDebit)}</td>
            <td style={{ ...droite, fontWeight: 700 }}>{fmt(c.totalCredit)}</td>
            <td style={{ ...droite, fontWeight: 700 }}>{fmt(c.closing)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function GrandLivreTab() {
  const entreprise = useEntreprise();
  const [periode, setPeriode] = useState({ from: debutAnnee(), to: aujourdhui() });
  const [code, setCode] = useState('');
  const [classe, setClasse] = useState('');
  const [comptes] = useDonnees(() => api.getAccountingAccounts(), []);
  const general = code === GENERAL;
  const [livre, erreur] = useDonnees(() => {
    if (!code) return Promise.resolve(null);
    if (general) return api.getAccountingGeneralLedger({ from: periode.from, to: periode.to, classe });
    return api.getAccountingLedger({ code, from: periode.from, to: periode.to });
  }, [code, classe, periode.from, periode.to]);

  // Le résultat conservé peut être celui de l'autre mode pendant le chargement.
  const pret = livre && (general ? Array.isArray(livre.accounts) : Array.isArray(livre.lines));
  const comptesAffiches = !pret ? [] : general ? livre.accounts : [{ code: livre.account.code, label: livre.account.label, ...livre }];

  function exporter() {
    exporterPdf({
      entreprise,
      titre: general ? `Grand livre général${classe ? ` — classe ${classe}` : ''}` : 'Grand livre',
      periode: libellePeriode(periode),
      sections: comptesAffiches.map((c) => ({
        titre: `${c.code} — ${c.label}`,
        colonnes: COLONNES_LIVRE,
        lignes: lignesLivre(c, Boolean(periode.from)),
      })),
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="champ" style={{ flex: 1, minWidth: 220 }} value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">Choisir un compte…</option>
          <option value={GENERAL}>Grand livre général (tous les comptes)</option>
          {(comptes || []).map((c) => <option key={c.id} value={c.code}>{c.code} — {c.label}</option>)}
        </select>
        {general && (
          <select className="champ" style={{ width: 'auto' }} value={classe} onChange={(e) => setClasse(e.target.value)}>
            <option value="">Toutes les classes</option>
            {Object.keys(CLASSES).map((n) => <option key={n} value={n}>{CLASSES[n]}</option>)}
          </select>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <Periode periode={periode} onChange={setPeriode} />
        <BoutonExport disabled={!pret || comptesAffiches.length === 0} onClick={exporter} />
      </div>
      {erreur && <div className="erreur">{erreur}</div>}
      {!code ? (
        <p className="etat-vide">Choisissez un compte, ou le grand livre général pour tous les comptes.</p>
      ) : !pret ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : general ? (
        <div>
          {livre.truncated && <div className="erreur">Résultat tronqué (trop de lignes) : réduisez la période ou choisissez une classe.</div>}
          {comptesAffiches.length === 0 ? (
            <p className="etat-vide">Aucun mouvement sur cette période.</p>
          ) : (
            comptesAffiches.map((c) => (
              <details key={c.code} style={{ marginBottom: 10 }}>
                <summary style={{ cursor: 'pointer', padding: '6px 0', fontSize: 14 }}>
                  <strong>{c.code} — {c.label}</strong>
                  <span style={{ color: 'var(--encre-douce)' }}> · débit {fmt(c.totalDebit)} · crédit {fmt(c.totalCredit)} · solde {fmt(c.closing)}</span>
                </summary>
                <TableCompte c={c} avecOuverture={Boolean(periode.from)} />
              </details>
            ))
          )}
          <p style={{ fontSize: 12.5, color: 'var(--encre-douce)' }}>Solde positif = débiteur, négatif = créditeur. Cliquez sur un compte pour voir son détail.</p>
        </div>
      ) : (
        <div>
          <TableCompte c={comptesAffiches[0]} avecOuverture={Boolean(periode.from)} />
          <p style={{ fontSize: 12.5, color: 'var(--encre-douce)' }}>Solde positif = débiteur, négatif = créditeur.</p>
        </div>
      )}
    </div>
  );
}

// ---------- Balance ----------

function BalanceTab() {
  const entreprise = useEntreprise();
  const [periode, setPeriode] = useState({ from: debutAnnee(), to: aujourdhui() });
  const [filtre, setFiltre] = useState('tous');
  const [balance, erreur] = useDonnees(
    () => api.getAccountingTrialBalance({ from: periode.from, to: periode.to }),
    [periode.from, periode.to]
  );
  const filtres = {
    clients: (c) => c.startsWith('411') && !c.startsWith('4119'),
    assureurs: (c) => c.startsWith('4119'),
    fournisseurs: (c) => c.startsWith('401'),
    personnel: (c) => c.startsWith('421') || c.startsWith('422'),
  };
  const lignes = balance ? balance.lines.filter((l) => !filtres[filtre] || filtres[filtre](l.code)) : [];
  const somme = (k) => lignes.reduce((t, l) => t + l[k], 0);
  const TITRES = {
    tous: 'Balance générale', clients: 'Balance auxiliaire des clients', assureurs: 'Balance auxiliaire des assureurs',
    fournisseurs: 'Balance auxiliaire des fournisseurs', personnel: 'Balance auxiliaire du personnel',
  };

  function exporter() {
    exporterPdf({
      entreprise, titre: TITRES[filtre], periode: libellePeriode(periode),
      sections: [{
        colonnes: [{ label: 'Compte' }, { label: 'Débit', align: 'right' }, { label: 'Crédit', align: 'right' }, { label: 'Solde débiteur', align: 'right' }, { label: 'Solde créditeur', align: 'right' }],
        lignes: [
          ...lignes.map((l) => [`${l.code} — ${l.label}`, fmt(l.debit), fmt(l.credit), l.soldeDebiteur ? fmt(l.soldeDebiteur) : '', l.soldeCrediteur ? fmt(l.soldeCrediteur) : '']),
          { fort: true, cells: ['Totaux', fmt(somme('debit')), fmt(somme('credit')), fmt(somme('soldeDebiteur')), fmt(somme('soldeCrediteur'))] },
        ],
      }],
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <Periode periode={periode} onChange={setPeriode} />
        <BoutonExport disabled={lignes.length === 0} onClick={exporter} />
      </div>
      <select className="champ" style={{ width: 'auto', marginBottom: 14 }} value={filtre} onChange={(e) => setFiltre(e.target.value)}>
        <option value="tous">Balance générale (tous les comptes)</option>
        <option value="clients">Balance auxiliaire des clients (411…)</option>
        <option value="assureurs">Balance auxiliaire des assureurs (4119…)</option>
        <option value="fournisseurs">Balance auxiliaire des fournisseurs (401…)</option>
        <option value="personnel">Balance auxiliaire du personnel (422…)</option>
      </select>
      {erreur && <div className="erreur">{erreur}</div>}
      {!balance ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : lignes.length === 0 ? (
        <p className="etat-vide">Aucun mouvement sur cette période.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={enteteTable}>Compte</th>
                <th style={{ ...enteteTable, textAlign: 'right' }}>Débit</th>
                <th style={{ ...enteteTable, textAlign: 'right' }}>Crédit</th>
                <th style={{ ...enteteTable, textAlign: 'right' }}>Solde débiteur</th>
                <th style={{ ...enteteTable, textAlign: 'right' }}>Solde créditeur</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.code}>
                  <td style={cellule}>{l.code} — {l.label}</td>
                  <td style={droite}>{fmt(l.debit)}</td>
                  <td style={droite}>{fmt(l.credit)}</td>
                  <td style={droite}>{l.soldeDebiteur ? fmt(l.soldeDebiteur) : ''}</td>
                  <td style={droite}>{l.soldeCrediteur ? fmt(l.soldeCrediteur) : ''}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...cellule, fontWeight: 700 }}>Totaux</td>
                <td style={{ ...droite, fontWeight: 700 }}>{fmt(somme('debit'))}</td>
                <td style={{ ...droite, fontWeight: 700 }}>{fmt(somme('credit'))}</td>
                <td style={{ ...droite, fontWeight: 700 }}>{fmt(somme('soldeDebiteur'))}</td>
                <td style={{ ...droite, fontWeight: 700 }}>{fmt(somme('soldeCrediteur'))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Compte de résultat ----------

function ResultatTab() {
  const entreprise = useEntreprise();
  const [periode, setPeriode] = useState({ from: debutAnnee(), to: aujourdhui() });
  const [r, erreur] = useDonnees(
    () => api.getAccountingIncomeStatement({ from: periode.from, to: periode.to }),
    [periode.from, periode.to]
  );

  function exporter() {
    const bloc = (titre, b) => [
      { fort: true, cells: [titre, fmt(b.total)] },
      ...b.comptes.map((c) => [`     ${c.code} — ${c.label}`, fmt(c.montant)]),
    ];
    exporterPdf({
      entreprise, titre: 'Compte de résultat', periode: libellePeriode(periode),
      sections: [{
        colonnes: [{ label: 'Rubrique' }, { label: 'Montant', align: 'right' }],
        lignes: [
          ["Chiffre d'affaires (classe 70)", fmt(r.chiffreAffaires)],
          ['Marge commerciale (701 − 601 − 6031)', fmt(r.margeCommerciale)],
          ...bloc("Produits d'exploitation", r.produitsExploitation),
          ...bloc("Charges d'exploitation", r.chargesExploitation),
          { fort: true, cells: ["RÉSULTAT D'EXPLOITATION", fmt(r.resultatExploitation)] },
          ...bloc('Produits financiers', r.produitsFinanciers),
          ...bloc('Charges financières', r.chargesFinancieres),
          { fort: true, cells: ['RÉSULTAT FINANCIER', fmt(r.resultatFinancier)] },
          { fort: true, cells: ['RÉSULTAT DES ACTIVITÉS ORDINAIRES', fmt(r.resultatActivitesOrdinaires)] },
          ...bloc('Produits hors activités ordinaires (HAO)', r.produitsHao),
          ...bloc('Charges hors activités ordinaires (HAO)', r.chargesHao),
          { fort: true, cells: ['RÉSULTAT HAO', fmt(r.resultatHao)] },
          ...bloc('Participation des travailleurs', r.participation),
          ...bloc('Impôts sur le résultat', r.impots),
          { fort: true, cells: ['RÉSULTAT NET', fmt(r.resultatNet)] },
        ],
      }],
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <Periode periode={periode} onChange={setPeriode} />
        <BoutonExport disabled={!r} onClick={exporter} />
      </div>
      {erreur && <div className="erreur">{erreur}</div>}
      {!r ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <tbody>
              <Ligne libelle="Chiffre d'affaires (classe 70)" montant={r.chiffreAffaires} />
              <Ligne libelle="Marge commerciale (701 − 601 − 6031)" montant={r.margeCommerciale} />
              <BlocComptes titre="Produits d'exploitation" bloc={r.produitsExploitation} />
              <BlocComptes titre="Charges d'exploitation" bloc={r.chargesExploitation} />
              <Ligne libelle="RÉSULTAT D'EXPLOITATION" montant={r.resultatExploitation} fort />
              <BlocComptes titre="Produits financiers" bloc={r.produitsFinanciers} />
              <BlocComptes titre="Charges financières" bloc={r.chargesFinancieres} />
              <Ligne libelle="RÉSULTAT FINANCIER" montant={r.resultatFinancier} fort />
              <Ligne libelle="RÉSULTAT DES ACTIVITÉS ORDINAIRES" montant={r.resultatActivitesOrdinaires} fort />
              <BlocComptes titre="Produits hors activités ordinaires (HAO)" bloc={r.produitsHao} />
              <BlocComptes titre="Charges hors activités ordinaires (HAO)" bloc={r.chargesHao} />
              <Ligne libelle="RÉSULTAT HAO" montant={r.resultatHao} fort />
              <BlocComptes titre="Participation des travailleurs" bloc={r.participation} />
              <BlocComptes titre="Impôts sur le résultat" bloc={r.impots} />
              <Ligne libelle="RÉSULTAT NET" montant={r.resultatNet} fort />
            </tbody>
          </table>
          <p style={{ fontSize: 12.5, color: 'var(--encre-douce)' }}>
            Présentation simplifiée selon les classes 6, 7 et 8 du SYSCOHADA. Montants en FCFA.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------- Bilan ----------

function BilanTab() {
  const entreprise = useEntreprise();
  const [date, setDate] = useState(aujourdhui());
  const [b, erreur] = useDonnees(() => api.getAccountingBalanceSheet({ date }), [date]);

  function exporter() {
    const lignesBloc = (titre, bloc) => [
      { fort: true, cells: [titre, fmt(bloc.total)] },
      ...bloc.comptes.map((c) => [`     ${c.code} — ${c.label}`, fmt(c.montant)]),
    ];
    const colonnes = [{ label: 'Rubrique' }, { label: 'Montant', align: 'right' }];
    exporterPdf({
      entreprise, titre: 'Bilan', periode: `Au ${dateFr(date)}`,
      sections: [
        { titre: 'Actif', colonnes, lignes: [
          ...lignesBloc("Immobilisations (nettes d'amortissements)", b.actif.immobilisations),
          ...lignesBloc('Stocks', b.actif.stocks),
          ...lignesBloc('Créances et emplois assimilés', b.actif.creances),
          ...lignesBloc('Trésorerie-actif', b.actif.tresorerie),
          { fort: true, cells: ['TOTAL ACTIF', fmt(b.totalActif)] },
        ] },
        { titre: 'Passif', colonnes, lignes: [
          ...lignesBloc('Capitaux propres et ressources assimilées', b.passif.capitauxPropres),
          ...lignesBloc('Dettes financières', b.passif.dettesFinancieres),
          ...lignesBloc('Passif circulant (dettes de tiers)', b.passif.passifCirculant),
          ...lignesBloc('Trésorerie-passif', b.passif.tresorerie),
          { fort: true, cells: ['TOTAL PASSIF', fmt(b.totalPassif)] },
        ] },
      ],
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <Periode periode={{ from: '', to: date }} unSeulJour onChange={(p) => setDate(p.to)} />
        <BoutonExport disabled={!b} onClick={exporter} />
      </div>
      {erreur && <div className="erreur">{erreur}</div>}
      {!b ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
            <div style={{ overflowX: 'auto' }}>
              <h3 style={{ fontSize: 15 }}>Actif</h3>
              <table style={tableStyle}>
                <tbody>
                  <BlocComptes titre="Immobilisations (nettes d'amortissements)" bloc={b.actif.immobilisations} />
                  <BlocComptes titre="Stocks" bloc={b.actif.stocks} />
                  <BlocComptes titre="Créances et emplois assimilés" bloc={b.actif.creances} />
                  <BlocComptes titre="Trésorerie-actif" bloc={b.actif.tresorerie} />
                  <Ligne libelle="TOTAL ACTIF" montant={b.totalActif} fort />
                </tbody>
              </table>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <h3 style={{ fontSize: 15 }}>Passif</h3>
              <table style={tableStyle}>
                <tbody>
                  <BlocComptes titre="Capitaux propres et ressources assimilées" bloc={b.passif.capitauxPropres} />
                  <BlocComptes titre="Dettes financières" bloc={b.passif.dettesFinancieres} />
                  <BlocComptes titre="Passif circulant (dettes de tiers)" bloc={b.passif.passifCirculant} />
                  <BlocComptes titre="Trésorerie-passif" bloc={b.passif.tresorerie} />
                  <Ligne libelle="TOTAL PASSIF" montant={b.totalPassif} fort />
                </tbody>
              </table>
            </div>
          </div>
          {b.ecart !== 0 && (
            <div className="erreur" style={{ marginTop: 14 }}>
              Le bilan n'est pas équilibré (écart de {fmt(b.ecart)}). Vérifiez les écritures saisies.
            </div>
          )}
          <p style={{ fontSize: 12.5, color: 'var(--encre-douce)' }}>
            Bilan cumulé à la date choisie. Les comptes clients et fournisseurs sont regroupés (détail dans la balance auxiliaire).
            La clôture d'exercice (report à nouveau) n'est pas encore gérée.
          </p>
        </>
      )}
    </div>
  );
}

// ---------- Modes de paiement (partagés par les onglets) ----------

const MODES = [
  ['especes', 'Espèces'],
  ['wave', 'Wave'],
  ['orange_money', 'Orange Money'],
  ['virement', 'Virement'],
  ['a_payer', 'À payer plus tard (dette fournisseur)'],
];
const libelleMode = (m) => (MODES.find((x) => x[0] === m) || [m, m])[1];
const moisCourant = () => aujourdhui().slice(0, 7);

// ---------- Immobilisations ----------
// Registre des biens durables (véhicule, matériel, mobilier, informatique…). Les dotations
// aux amortissements (mensuelles, linéaires) et les écritures d'acquisition et de cession
// sont générées automatiquement.

const MODES_IMMO = [
  ['especes', 'Payé en espèces (sort de la caisse)'],
  ['wave', 'Payé par Wave (sort de la caisse)'],
  ['orange_money', 'Payé par Orange Money (sort de la caisse)'],
  ['virement', 'Payé par virement bancaire'],
  ['a_payer', 'À payer plus tard (dette fournisseur)'],
  ['existant', 'Déjà possédé avant la comptabilité'],
];
const MODES_ENCAISSEMENT = [
  ['especes', 'Espèces (entre en caisse)'],
  ['wave', 'Wave (entre en caisse)'],
  ['orange_money', 'Orange Money (entre en caisse)'],
  ['virement', 'Virement bancaire'],
];
const MODES_REGLEMENT = [
  ['especes', 'Espèces (sort de la caisse)'],
  ['wave', 'Wave (sort de la caisse)'],
  ['orange_money', 'Orange Money (sort de la caisse)'],
  ['virement', 'Virement bancaire'],
];
const ETATS_IMMO = { en_service: 'En service', amortie: 'Totalement amortie', cedee: 'Sortie du patrimoine' };

function ImmobilisationModal({ categories, onClose, onSaved }) {
  const [form, setForm] = useState({
    label: '', category: categories[0]?.key || 'materiel', acquisitionDate: aujourdhui(), cost: '',
    residualValue: '', usefulLifeYears: '', paymentMethod: 'virement', note: '',
  });
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const cat = categories.find((c) => c.key === form.category);
  const maj = (champ) => (e) => setForm({ ...form, [champ]: e.target.value });
  const enCaisse = ['especes', 'wave', 'orange_money'].includes(form.paymentMethod);

  async function valider(e) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await api.createAccountingAsset({
        ...form,
        cost: Number(form.cost),
        residualValue: form.residualValue ? Number(form.residualValue) : 0,
        usefulLifeYears: cat?.amortissable ? Number(form.usefulLifeYears || cat.duree) : undefined,
        warehouseId: enCaisse ? boutiqueActive() || undefined : undefined,
      });
      onSaved();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="modale-fond" onClick={onClose}>
      <div className="modale" style={{ maxWidth: 480, width: '96%', maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>Nouvelle immobilisation</h2>
        <form onSubmit={valider}>
          <div className="champ-groupe">
            <label className="etiquette">Désignation</label>
            <input className="champ" maxLength={150} placeholder="Ex : Camionnette Toyota, Ordinateur caisse…" value={form.label} onChange={maj('label')} required autoFocus />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Catégorie</label>
            <select className="champ" value={form.category} onChange={maj('category')}>
              {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Date d'acquisition</label>
            <input type="date" className="champ" value={form.acquisitionDate} max={aujourdhui()} onChange={maj('acquisitionDate')} required />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Coût d'acquisition (FCFA)</label>
            <input type="number" min="1" step="any" className="champ" value={form.cost} onChange={maj('cost')} required />
          </div>
          {cat?.amortissable && (
            <>
              <div className="champ-groupe">
                <label className="etiquette">Durée d'amortissement (années)</label>
                <input type="number" min="0.5" max="60" step="any" className="champ" placeholder={String(cat.duree)} value={form.usefulLifeYears} onChange={maj('usefulLifeYears')} />
                <p style={{ color: 'var(--encre-douce)', fontSize: 12.5, margin: '4px 0 0' }}>
                  Laissez vide pour {cat.duree} ans (usage courant). Amortissement linéaire, par mois, dès le mois d'acquisition.
                </p>
              </div>
              <div className="champ-groupe">
                <label className="etiquette">Valeur résiduelle (facultatif)</label>
                <input type="number" min="0" step="any" className="champ" value={form.residualValue} onChange={maj('residualValue')} />
              </div>
            </>
          )}
          <div className="champ-groupe">
            <label className="etiquette">Paiement</label>
            <select className="champ" value={form.paymentMethod} onChange={maj('paymentMethod')}>
              {MODES_IMMO.map((m) => <option key={m[0]} value={m[0]}>{m[1]}</option>)}
            </select>
            {enCaisse && (
              <p style={{ color: 'var(--encre-douce)', fontSize: 12.5, margin: '4px 0 0' }}>
                Le montant sort de la caisse de la boutique active (choisie sur la page Caisse).
              </p>
            )}
            {form.paymentMethod === 'existant' && (
              <p style={{ color: 'var(--encre-douce)', fontSize: 12.5, margin: '4px 0 0' }}>
                Le bien est repris au bilan d'ouverture, net des amortissements déjà écoulés. Aucune sortie d'argent.
              </p>
            )}
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Note (facultatif)</label>
            <input className="champ" maxLength={300} value={form.note} onChange={maj('note')} />
          </div>
          {erreur && <div className="erreur">{erreur}</div>}
          <div className="actions-modale">
            <button type="button" className="btn" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-principal" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Règlement d'une dette sur immobilisation, ou cession / mise au rebut d'un bien.
function ActionImmoModal({ bien, action, onClose, onSaved }) {
  const cession = action === 'sortie';
  const [date, setDate] = useState(aujourdhui());
  const [prix, setPrix] = useState('');
  const [mode, setMode] = useState(cession ? 'virement' : 'virement');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const prixSaisi = Number(prix) > 0;
  const modeCaisse = ['especes', 'wave', 'orange_money'].includes(mode);
  const besoinMode = cession ? prixSaisi : true;

  async function valider(e) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      const warehouseId = besoinMode && modeCaisse ? boutiqueActive() || undefined : undefined;
      if (cession) {
        await api.disposeAccountingAsset(bien.id, { date, price: prixSaisi ? Number(prix) : 0, paymentMethod: prixSaisi ? mode : undefined, warehouseId });
      } else {
        await api.payAccountingAsset(bien.id, { paymentDate: date, paymentMethod: mode, warehouseId });
      }
      onSaved();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="modale-fond" onClick={onClose}>
      <div className="modale" style={{ maxWidth: 440, width: '96%' }} onClick={(e) => e.stopPropagation()}>
        <h2>{cession ? 'Vendre ou mettre au rebut' : 'Régler la dette'} : {bien.label}</h2>
        <p style={{ color: 'var(--encre-douce)', fontSize: 13.5 }}>
          {cession
            ? "Les amortissements s'arrêtent le mois de la sortie. Laissez le prix vide pour une mise au rebut (aucun encaissement)."
            : `Montant à régler : ${fmt(bien.cost)} FCFA.`}
        </p>
        <form onSubmit={valider}>
          <div className="champ-groupe">
            <label className="etiquette">{cession ? 'Date de la sortie' : 'Date du règlement'}</label>
            <input type="date" className="champ" value={date} max={aujourdhui()} min={bien.acquisitionDate} onChange={(e) => setDate(e.target.value)} required />
          </div>
          {cession && (
            <div className="champ-groupe">
              <label className="etiquette">Prix de vente encaissé (FCFA)</label>
              <input type="number" min="0" step="any" className="champ" value={prix} onChange={(e) => setPrix(e.target.value)} />
            </div>
          )}
          {besoinMode && (
            <div className="champ-groupe">
              <label className="etiquette">{cession ? 'Encaissé par' : 'Payé par'}</label>
              <select className="champ" value={mode} onChange={(e) => setMode(e.target.value)}>
                {(cession ? MODES_ENCAISSEMENT : MODES_REGLEMENT).map((m) => <option key={m[0]} value={m[0]}>{m[1]}</option>)}
              </select>
              {modeCaisse && (
                <p style={{ color: 'var(--encre-douce)', fontSize: 12.5, margin: '4px 0 0' }}>
                  Concerne la caisse de la boutique active (choisie sur la page Caisse).
                </p>
              )}
            </div>
          )}
          {erreur && <div className="erreur">{erreur}</div>}
          <div className="actions-modale">
            <button type="button" className="btn" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-principal" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Valider'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ImmobilisationsTab() {
  const [cle, setCle] = useState(0);
  const [biens, erreur] = useDonnees(() => api.getAccountingAssets(), [cle]);
  const [categories, setCategories] = useState([]);
  const [modale, setModale] = useState(null); // { type: 'nouveau' } | { type: 'sortie'|'regler', bien }
  const [erreurAction, setErreurAction] = useState('');

  useEffect(() => {
    api.getAccountingAssetCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  const recharger = () => {
    setModale(null);
    setCle((k) => k + 1);
  };

  async function supprimer(bien) {
    if (!window.confirm(`Supprimer « ${bien.label} » ? Ses écritures et les mouvements de caisse liés seront supprimés.`)) return;
    setErreurAction('');
    try {
      await api.deleteAccountingAsset(bien.id);
      recharger();
    } catch (err) {
      setErreurAction(err.message);
    }
  }

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!biens) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;

  const actifs = biens.filter((b) => b.status !== 'cedee');
  const totalCout = actifs.reduce((s, b) => s + b.cost, 0);
  const totalVnc = actifs.reduce((s, b) => s + b.netValue, 0);
  const totalAmorti = actifs.reduce((s, b) => s + b.accumulated, 0);
  const dotationAnnuelle = actifs.filter((b) => b.status === 'en_service').reduce((s, b) => s + b.yearlyCharge, 0);

  return (
    <div className="md-carte">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Immobilisations</h2>
        <button type="button" className="btn btn-principal" style={boutonPetit} disabled={categories.length === 0} onClick={() => setModale({ type: 'nouveau' })}>
          Ajouter une immobilisation
        </button>
      </div>
      <p style={{ margin: '0 0 12px', color: 'var(--encre-douce)', fontSize: 13 }}>
        Véhicules, matériel, mobilier, informatique… Une dotation aux amortissements est comptabilisée chaque fin de mois (compte 681) ; la valeur nette du bilan se met à jour toute seule.
      </p>
      {erreurAction && <div className="erreur" style={{ marginBottom: 10 }}>{erreurAction}</div>}

      {actifs.length > 0 && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '0 0 14px', fontSize: 13.5 }}>
          <span>Valeur d'achat : <strong>{fmt(totalCout)}</strong></span>
          <span>Amortissements cumulés : <strong>{fmt(totalAmorti)}</strong></span>
          <span>Valeur nette : <strong>{fmt(totalVnc)}</strong></span>
          <span>Dotation annuelle : <strong>{fmt(dotationAnnuelle)}</strong></span>
        </div>
      )}

      {biens.length === 0 ? (
        <p style={{ color: 'var(--encre-douce)' }}>Aucune immobilisation enregistrée. Sans elles, le bilan n'affiche pas vos biens durables et le résultat ne tient pas compte de leur usure.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={enteteTable}>Bien</th>
                <th style={enteteTable}>Acquis le</th>
                <th style={{ ...enteteTable, textAlign: 'right' }}>Coût</th>
                <th style={{ ...enteteTable, textAlign: 'right' }}>Amorti</th>
                <th style={{ ...enteteTable, textAlign: 'right' }}>Valeur nette</th>
                <th style={enteteTable}>État</th>
                <th style={enteteTable} />
              </tr>
            </thead>
            <tbody>
              {biens.map((b) => (
                <tr key={b.id} style={b.status === 'cedee' ? { opacity: 0.6 } : undefined}>
                  <td style={cellule}>
                    <strong>{b.label}</strong>
                    <div style={{ color: 'var(--encre-douce)', fontSize: 12 }}>
                      {b.categoryLabel}{b.usefulLifeYears ? ` · ${b.usefulLifeYears} ans` : ''}
                      {b.paymentMethod === 'existant' ? ' · repris à l\'ouverture' : ''}
                    </div>
                    {b.debtOpen && <div style={{ color: 'var(--brique, #b3402a)', fontSize: 12 }}>Dette fournisseur non réglée : {fmt(b.cost)} FCFA</div>}
                  </td>
                  <td style={cellule}>{dateFr(b.acquisitionDate)}</td>
                  <td style={droite}>{fmt(b.cost)}</td>
                  <td style={droite}>{fmt(b.accumulated)}</td>
                  <td style={droite}>{fmt(b.netValue)}</td>
                  <td style={cellule}>
                    {ETATS_IMMO[b.status]}
                    {b.disposalDate && <div style={{ color: 'var(--encre-douce)', fontSize: 12 }}>le {dateFr(b.disposalDate)}{b.disposalPrice ? ` · vendue ${fmt(b.disposalPrice)}` : ' · mise au rebut'}</div>}
                  </td>
                  <td style={{ ...cellule, whiteSpace: 'nowrap' }}>
                    {b.debtOpen && <button type="button" className="btn btn-principal" style={{ ...boutonPetit, marginRight: 6 }} onClick={() => setModale({ type: 'regler', bien: b })}>Régler</button>}
                    {b.status !== 'cedee' && <button type="button" className="btn" style={{ ...boutonPetit, marginRight: 6 }} onClick={() => setModale({ type: 'sortie', bien: b })}>Vendre / rebut</button>}
                    <button type="button" className="btn" style={boutonPetit} onClick={() => supprimer(b)}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modale?.type === 'nouveau' && <ImmobilisationModal categories={categories} onClose={() => setModale(null)} onSaved={recharger} />}
      {modale?.type === 'sortie' && <ActionImmoModal bien={modale.bien} action="sortie" onClose={() => setModale(null)} onSaved={recharger} />}
      {modale?.type === 'regler' && <ActionImmoModal bien={modale.bien} action="regler" onClose={() => setModale(null)} onSaved={recharger} />}
    </div>
  );
}

// ---------- Capital et financement ----------
// Capital versé, apports et retraits de l'exploitant, emprunts reçus et remboursés.
// Les écritures sont générées automatiquement.

const TYPES_FINANCEMENT = [
  ['capital', 'Capital (apport en capital)'],
  ['apport', "Apport de l'exploitant (compte courant)"],
  ['retrait', "Retrait de l'exploitant"],
  ['emprunt', 'Emprunt reçu'],
  ['remboursement', "Remboursement d'emprunt"],
];
const ENTREES_FINANCEMENT = ['capital', 'apport', 'emprunt'];

function FinancementModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ kind: 'capital', label: '', amount: '', interestAmount: '', opDate: aujourdhui(), paymentMethod: 'virement' });
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const maj = (champ) => (e) => setForm({ ...form, [champ]: e.target.value });
  const entree = ENTREES_FINANCEMENT.includes(form.kind);
  const existantPossible = ['capital', 'emprunt'].includes(form.kind);
  const modeCaisse = ['especes', 'wave', 'orange_money'].includes(form.paymentMethod);

  function changerType(e) {
    const kind = e.target.value;
    setForm({ ...form, kind, paymentMethod: form.paymentMethod === 'existant' && !['capital', 'emprunt'].includes(kind) ? 'virement' : form.paymentMethod });
  }

  async function valider(e) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await api.createAccountingFinancing({
        kind: form.kind, label: form.label, amount: Number(form.amount),
        interestAmount: form.kind === 'remboursement' && form.interestAmount ? Number(form.interestAmount) : 0,
        opDate: form.opDate, paymentMethod: form.paymentMethod,
        warehouseId: modeCaisse ? boutiqueActive() || undefined : undefined,
      });
      onSaved();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="modale-fond" onClick={onClose}>
      <div className="modale" style={{ maxWidth: 460, width: '96%', maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>Nouvelle opération de financement</h2>
        <form onSubmit={valider}>
          <div className="champ-groupe">
            <label className="etiquette">Type d'opération</label>
            <select className="champ" value={form.kind} onChange={changerType}>
              {TYPES_FINANCEMENT.map((m) => <option key={m[0]} value={m[0]}>{m[1]}</option>)}
            </select>
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Description (facultatif)</label>
            <input className="champ" maxLength={150} placeholder={form.kind === 'emprunt' || form.kind === 'remboursement' ? 'Ex : Prêt banque, échéance de mars…' : 'Ex : Capital de départ…'} value={form.label} onChange={maj('label')} />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">{form.kind === 'remboursement' ? 'Capital remboursé (FCFA)' : 'Montant (FCFA)'}</label>
            <input type="number" min="1" step="any" className="champ" value={form.amount} onChange={maj('amount')} required />
          </div>
          {form.kind === 'remboursement' && (
            <div className="champ-groupe">
              <label className="etiquette">Intérêts payés avec l'échéance (FCFA)</label>
              <input type="number" min="0" step="any" className="champ" value={form.interestAmount} onChange={maj('interestAmount')} />
            </div>
          )}
          <div className="champ-groupe">
            <label className="etiquette">Date</label>
            <input type="date" className="champ" value={form.opDate} max={aujourdhui()} onChange={maj('opDate')} required />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">{entree ? 'Reçu par' : 'Payé par'}</label>
            <select className="champ" value={form.paymentMethod} onChange={maj('paymentMethod')}>
              <option value="virement">Virement bancaire</option>
              <option value="especes">Espèces ({entree ? 'entre en caisse' : 'sort de la caisse'})</option>
              <option value="wave">Wave ({entree ? 'entre en caisse' : 'sort de la caisse'})</option>
              <option value="orange_money">Orange Money ({entree ? 'entre en caisse' : 'sort de la caisse'})</option>
              {existantPossible && <option value="existant">Déjà en place avant la comptabilité</option>}
            </select>
            {modeCaisse && (
              <p style={{ color: 'var(--encre-douce)', fontSize: 12.5, margin: '4px 0 0' }}>
                Concerne la caisse de la boutique active (choisie sur la page Caisse).
              </p>
            )}
            {form.paymentMethod === 'existant' && (
              <p style={{ color: 'var(--encre-douce)', fontSize: 12.5, margin: '4px 0 0' }}>
                Repris au bilan d'ouverture, sans mouvement de trésorerie (contrepartie : report à nouveau).
              </p>
            )}
          </div>
          {erreur && <div className="erreur">{erreur}</div>}
          <div className="actions-modale">
            <button type="button" className="btn" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-principal" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FinancementTab() {
  const [cle, setCle] = useState(0);
  const [donnees, erreur] = useDonnees(() => api.getAccountingFinancing(), [cle]);
  const [modale, setModale] = useState(false);
  const [erreurAction, setErreurAction] = useState('');

  const recharger = () => {
    setModale(false);
    setCle((k) => k + 1);
  };

  async function supprimer(op) {
    if (!window.confirm(`Supprimer « ${op.kindLabel} » du ${dateFr(op.date)} (${fmt(op.amount)} FCFA) ? Son écriture et le mouvement de caisse lié seront supprimés.`)) return;
    setErreurAction('');
    try {
      await api.deleteAccountingFinancing(op.id);
      recharger();
    } catch (err) {
      setErreurAction(err.message);
    }
  }

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!donnees) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;
  const { summary, operations } = donnees;

  return (
    <div className="md-carte">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Capital et financement</h2>
        <button type="button" className="btn btn-principal" style={boutonPetit} onClick={() => setModale(true)}>Nouvelle opération</button>
      </div>
      <p style={{ margin: '0 0 12px', color: 'var(--encre-douce)', fontSize: 13 }}>
        Capital versé, apports et retraits de l'exploitant, emprunts et remboursements. Sans ces opérations, le bilan ne montre ni le capital ni les dettes bancaires.
      </p>
      {erreurAction && <div className="erreur" style={{ marginBottom: 10 }}>{erreurAction}</div>}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '0 0 14px', fontSize: 13.5 }}>
        <span>Capital : <strong>{fmt(summary.capital)}</strong></span>
        <span>Compte courant de l'exploitant : <strong>{fmt(summary.currentAccount)}</strong></span>
        <span>Emprunts restant dus : <strong>{fmt(summary.loans)}</strong></span>
      </div>
      {operations.length === 0 ? (
        <p style={{ color: 'var(--encre-douce)' }}>Aucune opération enregistrée.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={enteteTable}>Date</th>
                <th style={enteteTable}>Opération</th>
                <th style={{ ...enteteTable, textAlign: 'right' }}>Montant</th>
                <th style={{ ...enteteTable, textAlign: 'right' }}>Intérêts</th>
                <th style={enteteTable}>Mode</th>
                <th style={enteteTable} />
              </tr>
            </thead>
            <tbody>
              {operations.map((o) => (
                <tr key={o.id}>
                  <td style={cellule}>{dateFr(o.date)}</td>
                  <td style={cellule}>
                    <strong>{o.kindLabel}</strong>
                    {o.label && o.label !== o.kindLabel && <div style={{ color: 'var(--encre-douce)', fontSize: 12 }}>{o.label}</div>}
                  </td>
                  <td style={droite}>{fmt(o.amount)}</td>
                  <td style={droite}>{o.interest ? fmt(o.interest) : ''}</td>
                  <td style={cellule}>{o.paymentMethod === 'existant' ? 'Repris à l\'ouverture' : libelleMode(o.paymentMethod)}</td>
                  <td style={cellule}><button type="button" className="btn" style={boutonPetit} onClick={() => supprimer(o)}>Supprimer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modale && <FinancementModal onClose={() => setModale(false)} onSaved={recharger} />}
    </div>
  );
}

// ---------- Régularisations ----------
// Rattache chaque charge à la bonne période avant de clôturer : charge payée d'avance ou
// charge engagée mais pas encore facturée. L'extourne est passée automatiquement le lendemain.

const TYPES_REGULARISATION = [
  ['charge_avance', "Charge constatée d'avance (payée, mais concerne la période suivante)"],
  ['charge_a_payer', 'Charge à payer (consommée, facture pas encore reçue)'],
];

function RegularisationModal({ onClose, onSaved }) {
  const [natures, setNatures] = useState([]);
  const [form, setForm] = useState({ kind: 'charge_avance', chargeAccount: '', label: '', amount: '', adjDate: aujourdhui(), reverse: true });
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const maj = (champ) => (e) => setForm({ ...form, [champ]: e.target.value });

  useEffect(() => {
    api.getCaisseNatures().then((d) => {
      const liste = d?.natures || [];
      setNatures(liste);
      setForm((f) => ({ ...f, chargeAccount: f.chargeAccount || liste[0]?.code || '' }));
    }).catch(() => setNatures([]));
  }, []);

  async function valider(e) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await api.createAccountingAdjustment({ ...form, amount: Number(form.amount) });
      onSaved();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="modale-fond" onClick={onClose}>
      <div className="modale" style={{ maxWidth: 460, width: '96%', maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>Nouvelle régularisation</h2>
        <form onSubmit={valider}>
          <div className="champ-groupe">
            <label className="etiquette">Type</label>
            <select className="champ" value={form.kind} onChange={maj('kind')}>
              {TYPES_REGULARISATION.map((m) => <option key={m[0]} value={m[0]}>{m[1]}</option>)}
            </select>
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Nature de la charge</label>
            <select className="champ" value={form.chargeAccount} onChange={maj('chargeAccount')} required>
              {natures.map((n) => <option key={n.code} value={n.code}>{n.label}</option>)}
            </select>
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Description (facultatif)</label>
            <input className="champ" maxLength={150} placeholder="Ex : assurance annuelle, électricité de décembre…" value={form.label} onChange={maj('label')} />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Montant (FCFA)</label>
            <input type="number" min="1" step="any" className="champ" value={form.amount} onChange={maj('amount')} required />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Date de la régularisation (ex : 31/12)</label>
            <input type="date" className="champ" value={form.adjDate} max={aujourdhui()} onChange={maj('adjDate')} required />
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, margin: '0 0 12px' }}>
            <input type="checkbox" checked={form.reverse} onChange={(e) => setForm({ ...form, reverse: e.target.checked })} />
            Annuler automatiquement le lendemain (extourne) — recommandé
          </label>
          {erreur && <div className="erreur">{erreur}</div>}
          <div className="actions-modale">
            <button type="button" className="btn" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-principal" disabled={envoi || natures.length === 0}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RegularisationsTab() {
  const [cle, setCle] = useState(0);
  const [liste, erreur] = useDonnees(() => api.getAccountingAdjustments(), [cle]);
  const [modale, setModale] = useState(false);
  const [erreurAction, setErreurAction] = useState('');

  const recharger = () => {
    setModale(false);
    setCle((k) => k + 1);
  };

  async function supprimer(a) {
    if (!window.confirm(`Supprimer la régularisation « ${a.label} » (${fmt(a.amount)} FCFA) et son extourne ?`)) return;
    setErreurAction('');
    try {
      await api.deleteAccountingAdjustment(a.id);
      recharger();
    } catch (err) {
      setErreurAction(err.message);
    }
  }

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!liste) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;

  return (
    <div className="md-carte">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Régularisations de fin de période</h2>
        <button type="button" className="btn btn-principal" style={boutonPetit} onClick={() => setModale(true)}>Nouvelle régularisation</button>
      </div>
      <p style={{ margin: '0 0 12px', color: 'var(--encre-douce)', fontSize: 13 }}>
        À faire avant de clôturer l'exercice : une assurance payée en décembre pour toute l'année suivante n'est pas une charge de l'année écoulée (charge constatée d'avance) ; l'électricité consommée en décembre mais facturée en janvier l'est (charge à payer).
      </p>
      {erreurAction && <div className="erreur" style={{ marginBottom: 10 }}>{erreurAction}</div>}
      {liste.length === 0 ? (
        <p style={{ color: 'var(--encre-douce)' }}>Aucune régularisation enregistrée.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={enteteTable}>Date</th>
                <th style={enteteTable}>Régularisation</th>
                <th style={enteteTable}>Charge</th>
                <th style={{ ...enteteTable, textAlign: 'right' }}>Montant</th>
                <th style={enteteTable}>Extourne</th>
                <th style={enteteTable} />
              </tr>
            </thead>
            <tbody>
              {liste.map((a) => (
                <tr key={a.id}>
                  <td style={cellule}>{dateFr(a.date)}</td>
                  <td style={cellule}>
                    <strong>{a.kindLabel}</strong>
                    {a.label && a.label !== a.natureLabel && <div style={{ color: 'var(--encre-douce)', fontSize: 12 }}>{a.label}</div>}
                  </td>
                  <td style={cellule}>{a.natureLabel}</td>
                  <td style={droite}>{fmt(a.amount)}</td>
                  <td style={cellule}>{a.reverseDate ? `le ${dateFr(a.reverseDate)}` : 'Non'}</td>
                  <td style={cellule}><button type="button" className="btn" style={boutonPetit} onClick={() => supprimer(a)}>Supprimer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modale && <RegularisationModal onClose={() => setModale(false)} onSaved={recharger} />}
    </div>
  );
}

// ---------- Impôts & cotisations ----------
// Les impôts (TVA, IR/TRIMF, CFCE) se paient chaque mois. Les cotisations (CSS, IPRES)
// suivent la périodicité choisie par le manager. Les montants sont calculés depuis les
// ventes, les achats et les bulletins de paie.

const MODES_ETAT = MODES.filter((m) => m[0] !== 'a_payer');
const NOMS_ETAT = {
  tva: 'TVA', retenues: 'IR et TRIMF sur salaires', css: 'Cotisations CSS',
  ipres: 'Cotisations IPRES', cfce: 'CFCE', is: 'Impôt sur les résultats',
};
const FREQUENCES_COTISATIONS = [['monthly', 'Mensuelle'], ['quarterly', 'Trimestrielle'], ['semiannual', 'Semestrielle']];
const NOMS_MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function libellePeriodeEtat(cle) {
  if (!cle) return '';
  const [annee, reste] = String(cle).split('-');
  if (/^\d{2}$/.test(reste)) return `${NOMS_MOIS_FR[Number(reste) - 1]} ${annee}`;
  if (reste?.[0] === 'T') return `${reste[1] === '1' ? '1er' : `${reste[1]}e`} trimestre ${annee}`;
  if (reste?.[0] === 'S') return `${reste[1] === '1' ? '1er' : '2e'} semestre ${annee}`;
  return cle;
}

function boutiqueActive() {
  try {
    return localStorage.getItem('boutiqueActiveId') || '';
  } catch {
    return '';
  }
}

function PaiementEtatModal({ ligne, periode, onClose, onSaved }) {
  const [date, setDate] = useState(aujourdhui());
  const [amount, setAmount] = useState(ligne.reste > 0 ? String(ligne.reste) : '');
  const [mode, setMode] = useState('virement');
  const [note, setNote] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  async function valider(e) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await api.createAccountingStatePayment({
        type: ligne.type, amount: Number(amount), paymentMethod: mode, paymentDate: date,
        period: periode ? periode.key : undefined, note: note || undefined,
        warehouseId: mode === 'virement' ? undefined : boutiqueActive() || undefined,
      });
      onSaved();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="modale-fond" onClick={onClose}>
      <div className="modale" style={{ maxWidth: 440, width: '96%' }} onClick={(e) => e.stopPropagation()}>
        <h2>Payer : {NOMS_ETAT[ligne.type]}{periode ? ` — ${periode.label}` : ''}</h2>
        <p style={{ color: 'var(--encre-douce)', fontSize: 13.5 }}>
          {ligne.type === 'tva'
            ? "Saisissez le net versé : la TVA déductible du mois est compensée automatiquement avec la TVA facturée."
            : "L'écriture comptable est créée automatiquement."}
        </p>
        <form onSubmit={valider}>
          <div className="champ-groupe">
            <label className="etiquette">Date du paiement</label>
            <input type="date" className="champ" value={date} max={aujourdhui()} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Montant versé (FCFA)</label>
            <input type="number" min="1" step="any" className="champ" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Mode de paiement</label>
            <select className="champ" value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES_ETAT.map((m) => <option key={m[0]} value={m[0]}>{m[1]}</option>)}
            </select>
            {mode !== 'virement' && (
              <p style={{ color: 'var(--encre-douce)', fontSize: 12.5, margin: '4px 0 0' }}>
                Le montant sort de la caisse de la boutique active (choisie sur la page Caisse).
              </p>
            )}
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Note (facultatif)</label>
            <input type="text" className="champ" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {erreur && <div className="erreur">{erreur}</div>}
          <div className="actions-modale">
            <button type="button" className="btn" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-principal" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer le paiement'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EcheancesPeriode({ periodes, cleChoisie, onChoisir, onPayer }) {
  const periode = periodes.find((p) => p.key === cleChoisie) || periodes.find((p) => !p.enCours) || periodes[0];
  return (
    <div style={{ marginBottom: 26 }}>
      <select className="champ" style={{ maxWidth: 280, marginBottom: 10 }} value={periode.key} onChange={(e) => onChoisir(e.target.value)}>
        {periodes.map((p) => <option key={p.key} value={p.key}>{p.label}{p.enCours ? ' (en cours)' : ''}</option>)}
      </select>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={enteteTable}>Impôt / cotisation</th>
              <th style={{ ...enteteTable, textAlign: 'right' }}>Dû</th>
              <th style={{ ...enteteTable, textAlign: 'right' }}>Payé</th>
              <th style={{ ...enteteTable, textAlign: 'right' }}>Reste</th>
              <th style={enteteTable} />
            </tr>
          </thead>
          <tbody>
            {periode.lignes.map((l) => (
              <tr key={l.type}>
                <td style={cellule}>
                  {NOMS_ETAT[l.type]}
                  {l.type === 'tva' && (
                    <div style={{ color: 'var(--encre-douce)', fontSize: 12 }}>
                      Facturée {fmt(l.collectee)} − déductible {fmt(l.deductible)}
                      {l.creditUtilise > 0 && ` − crédit reporté ${fmt(l.creditUtilise)}`}
                      {l.creditAReporter > 0 && <div>Crédit de TVA reporté sur le mois suivant : {fmt(l.creditAReporter)}</div>}
                      {l.creditAReporter === 0 && l.creditDisponible > 0 && <div>Crédit de TVA restant : {fmt(l.creditDisponible)}</div>}
                    </div>
                  )}
                </td>
                <td style={droite}>{l.du < 0 ? `Crédit de ${fmt(-l.du)}` : fmt(l.du)}</td>
                <td style={droite}>{fmt(l.paye)}</td>
                <td style={droite}>{l.reste > 0 ? fmt(l.reste) : l.du > 0 ? 'Soldé' : '—'}</td>
                <td style={{ ...cellule, textAlign: 'right' }}>
                  {l.reste > 0 && (
                    <button type="button" className="btn btn-principal" style={boutonPetit} onClick={() => onPayer(l, periode)}>Payer</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ImpotsTab() {
  const [version, setVersion] = useState(0);
  const [modale, setModale] = useState(null);
  const [cleImpots, setCleImpots] = useState('');
  const [cleCotisations, setCleCotisations] = useState('');
  const [erreurAction, setErreurAction] = useState('');
  const [donnees, erreur] = useDonnees(
    async () => {
      const [dues, paiements] = await Promise.all([api.getAccountingStateDues(), api.getAccountingStatePayments()]);
      return { dues, paiements };
    },
    [version]
  );

  function recharger() {
    setModale(null);
    setVersion((v) => v + 1);
  }

  async function changerFrequence(valeur) {
    setErreurAction('');
    try {
      await api.setAccountingTaxSettings({ contributionsFrequency: valeur });
      setCleCotisations('');
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(err.message);
    }
  }

  async function annuler(p) {
    if (!window.confirm('Annuler ce paiement ? L\'écriture comptable et la sortie de caisse associées seront supprimées.')) return;
    setErreurAction('');
    try {
      await api.cancelAccountingStatePayment(p.id);
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(err.message);
    }
  }

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!donnees) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;
  const { dues, paiements } = donnees;
  const impotSociete = dues.dettes.find((d) => d.type === 'is');

  return (
    <div>
      <p style={{ color: 'var(--encre-douce)', fontSize: 13.5, marginTop: 0 }}>
        Montants calculés automatiquement depuis les ventes, les achats et les bulletins de paie.
        Enregistrez un paiement pour solder la période : l'écriture (et la sortie de caisse) se crée toute seule.
      </p>
      {erreurAction && <div className="erreur">{erreurAction}</div>}

      <h3 style={{ fontSize: 15 }}>Impôts — chaque mois</h3>
      <EcheancesPeriode
        periodes={dues.impots} cleChoisie={cleImpots} onChoisir={setCleImpots}
        onPayer={(ligne, periode) => setModale({ ligne, periode })}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>Cotisations sociales</h3>
        <select className="champ" style={{ maxWidth: 190 }} value={dues.frequency} onChange={(e) => changerFrequence(e.target.value)} title="Périodicité de paiement des cotisations (CSS, IPRES)">
          {FREQUENCES_COTISATIONS.map((f) => <option key={f[0]} value={f[0]}>{f[1]}</option>)}
        </select>
      </div>
      <EcheancesPeriode
        periodes={dues.cotisations} cleChoisie={cleCotisations} onChoisir={setCleCotisations}
        onPayer={(ligne, periode) => setModale({ ligne, periode })}
      />

      {impotSociete && (
        <div style={{ marginBottom: 26 }}>
          <h3 style={{ fontSize: 15 }}>Impôt sur les résultats — annuel</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>Reste à payer : <strong>{fmt(Math.max(0, impotSociete.du))}</strong></span>
            {impotSociete.du > 0 && (
              <button type="button" className="btn btn-principal" style={boutonPetit} onClick={() => setModale({ ligne: { type: 'is', reste: impotSociete.du }, periode: null })}>Payer</button>
            )}
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 15 }}>Paiements effectués</h3>
      {paiements.length === 0 ? (
        <p className="etat-vide">Aucun paiement enregistré.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={enteteTable}>Date</th>
                <th style={enteteTable}>Objet</th>
                <th style={enteteTable}>Mode</th>
                <th style={{ ...enteteTable, textAlign: 'right' }}>Montant</th>
                <th style={enteteTable}>Écriture</th>
                <th style={enteteTable} />
              </tr>
            </thead>
            <tbody>
              {paiements.map((p) => (
                <tr key={p.id} style={{ opacity: p.cancelled ? 0.5 : 1 }}>
                  <td style={cellule}>{dateFr(p.payment_date)}</td>
                  <td style={cellule}>
                    {NOMS_ETAT[p.kind] || p.kind}{p.period ? ` — ${libellePeriodeEtat(p.period)}` : ''}
                    {Number(p.offset_amount) > 0 && (
                      <div style={{ color: 'var(--encre-douce)', fontSize: 12 }}>TVA déductible compensée : {fmt(p.offset_amount)}</div>
                    )}
                  </td>
                  <td style={cellule}>{libelleMode(p.payment_method)}</td>
                  <td style={droite}>{fmt(p.amount)}</td>
                  <td style={cellule}>{p.cancelled ? 'Annulé' : p.entry_number ? `N°${p.entry_number}` : ''}</td>
                  <td style={{ ...cellule, textAlign: 'right' }}>
                    {!p.cancelled && (
                      <button type="button" className="btn btn-brique" style={boutonPetit} onClick={() => annuler(p)}>Annuler</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modale && <PaiementEtatModal ligne={modale.ligne} periode={modale.periode} onClose={() => setModale(null)} onSaved={recharger} />}
    </div>
  );
}

// ---------- Clôture d'exercice ----------
// Impôt sur les résultats (30 % par défaut, modifiable) puis clôture de l'année civile :
// un exercice clôturé est figé, plus aucune écriture ne peut y être ajoutée ni modifiée.

function ClotureTab() {
  const anneeCourante = new Date().getFullYear();
  const [annee, setAnnee] = useState(anneeCourante - 1);
  const [taux, setTaux] = useState('30');
  const [minimum, setMinimum] = useState('');
  const [params, setParams] = useState({ rate: '30', minimum: '' });
  const [version, setVersion] = useState(0);
  const [erreurAction, setErreurAction] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [donnees, erreur] = useDonnees(
    async () => {
      const [apercu, exercices] = await Promise.all([
        api.getAccountingClosingPreview({ year: annee, rate: params.rate, minimum: params.minimum }),
        api.getAccountingFiscalYears(),
      ]);
      return { apercu, exercices };
    },
    [annee, params, version]
  );

  async function executer(action) {
    setErreurAction('');
    setEnCours(true);
    try {
      await action();
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(err.message);
    } finally {
      setEnCours(false);
    }
  }

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!donnees) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;
  const { apercu, exercices } = donnees;
  const dernierCloture = exercices.length > 0 ? Math.max(...exercices.map((x) => x.year)) : null;

  return (
    <div>
      <p style={{ color: 'var(--encre-douce)', fontSize: 13.5, marginTop: 0 }}>
        L'exercice est l'année civile. L'impôt est calculé sur le résultat comptable ; vérifiez le taux et le minimum
        fiscal applicables à votre régime avec votre comptable.
      </p>
      {erreurAction && <div className="erreur">{erreurAction}</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div className="champ-groupe" style={{ margin: 0 }}>
          <label className="etiquette">Exercice</label>
          <select className="champ" value={annee} onChange={(e) => setAnnee(Number(e.target.value))}>
            {[0, 1, 2, 3, 4].map((i) => anneeCourante - i).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="champ-groupe" style={{ margin: 0 }}>
          <label className="etiquette">Taux de l'impôt (%)</label>
          <input type="number" min="0" max="100" step="any" className="champ" style={{ width: 110 }} value={taux} onChange={(e) => setTaux(e.target.value)} />
        </div>
        <div className="champ-groupe" style={{ margin: 0 }}>
          <label className="etiquette">Minimum fiscal (FCFA)</label>
          <input type="number" min="0" step="any" className="champ" style={{ width: 150 }} value={minimum} onChange={(e) => setMinimum(e.target.value)} />
        </div>
        <button type="button" className="btn" onClick={() => setParams({ rate: taux, minimum })}>Recalculer</button>
      </div>

      <table style={tableStyle}>
        <tbody>
          <tr><td style={cellule}>Résultat avant impôt</td><td style={droite}>{fmt(apercu.resultBeforeTax)}</td></tr>
          <tr><td style={cellule}>Impôt sur les résultats proposé</td><td style={droite}>{fmt(apercu.taxProposed)}</td></tr>
          <tr><td style={cellule}>Impôt déjà comptabilisé</td><td style={droite}>{apercu.taxBooked === null ? '—' : fmt(apercu.taxBooked)}</td></tr>
          <tr><td style={{ ...cellule, fontWeight: 600 }}>Résultat net</td><td style={{ ...droite, fontWeight: 600 }}>{fmt(apercu.netResult)}</td></tr>
        </tbody>
      </table>

      <h3 style={{ fontSize: 15, marginTop: 20 }}>Contrôles avant clôture</h3>
      <ul style={{ paddingLeft: 18, margin: '6px 0 16px' }}>
        {apercu.checks.map((c) => (
          <li key={c.id} style={{ color: c.ok ? 'inherit' : 'var(--brique, #b3423a)' }}>{c.ok ? '✓' : '✗'} {c.label}</li>
        ))}
      </ul>

      {apercu.closed ? (
        <p className="etat-vide">L'exercice {annee} est clôturé.</p>
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button" className="btn" disabled={enCours}
            onClick={() => executer(() => api.bookAccountingIncomeTax({ year: annee, rate: taux, minimum }))}
          >
            {apercu.taxBooked === null ? "Comptabiliser l'impôt" : "Recalculer l'impôt comptabilisé"}
          </button>
          <button
            type="button" className="btn btn-principal" disabled={enCours || !apercu.canClose}
            onClick={() => {
              if (window.confirm(`Clôturer l'exercice ${annee} ? Plus aucune écriture ne pourra y être ajoutée ni modifiée.`)) {
                executer(() => api.closeAccountingFiscalYear(annee));
              }
            }}
          >
            Clôturer l'exercice {annee}
          </button>
        </div>
      )}

      <h3 style={{ fontSize: 15, marginTop: 26 }}>Exercices clôturés</h3>
      {exercices.length === 0 ? (
        <p className="etat-vide">Aucun exercice clôturé.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={enteteTable}>Exercice</th>
              <th style={{ ...enteteTable, textAlign: 'right' }}>Résultat avant impôt</th>
              <th style={{ ...enteteTable, textAlign: 'right' }}>Impôt</th>
              <th style={{ ...enteteTable, textAlign: 'right' }}>Résultat net</th>
              <th style={enteteTable} />
            </tr>
          </thead>
          <tbody>
            {exercices.map((x) => (
              <tr key={x.year}>
                <td style={cellule}>{x.year}</td>
                <td style={droite}>{fmt(x.result_before_tax)}</td>
                <td style={droite}>{fmt(x.tax_amount)}</td>
                <td style={droite}>{fmt(x.net_result)}</td>
                <td style={{ ...cellule, textAlign: 'right' }}>
                  {x.year === dernierCloture && (
                    <button
                      type="button" className="btn btn-brique" style={boutonPetit} disabled={enCours}
                      onClick={() => {
                        if (window.confirm(`Rouvrir l'exercice ${x.year} ?`)) executer(() => api.reopenAccountingFiscalYear(x.year));
                      }}
                    >
                      Rouvrir
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Aperçu PDF ----------
// Les états s'ouvrent en aperçu (télécharger, imprimer ou ouvrir dans un onglet) au lieu
// de lancer directement l'impression. Le PDF est généré par le serveur (/accounting/pdf).

let afficherApercu = null;

export async function exporterPdf(payload) {
  if (formatSortie === 'excel') {
    exporterTableur(payload);
    return;
  }
  if (!afficherApercu) return;
  afficherApercu({ titre: payload.titre, chargement: true });
  try {
    const blob = await api.buildAccountingPdf(payload);
    afficherApercu({ titre: payload.titre, blob });
  } catch (err) {
    afficherApercu({ titre: payload.titre, erreur: err.message });
  }
}

export function ApercuPdf() {
  const [etat, setEtat] = useState(null);
  const [url, setUrl] = useState('');
  const cadre = useRef(null);

  useEffect(() => {
    afficherApercu = setEtat;
    return () => { afficherApercu = null; };
  }, []);

  useEffect(() => {
    if (!etat?.blob) {
      setUrl('');
      return undefined;
    }
    const u = URL.createObjectURL(etat.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [etat]);

  if (!etat) return null;
  const nom = `${String(etat.titre || 'etat').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase()}-${aujourdhui()}.pdf`;

  function imprimer() {
    try {
      cadre.current.contentWindow.focus();
      cadre.current.contentWindow.print();
    } catch {
      window.open(url, '_blank');
    }
  }

  return (
    <div className="modale-fond" onClick={() => setEtat(null)}>
      <div className="modale" style={{ maxWidth: 900, width: '96%', height: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Aperçu — {etat.titre}</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {url && <a className="btn btn-principal" style={boutonPetit} href={url} download={nom}>Télécharger</a>}
            {url && <button type="button" className="btn" style={boutonPetit} onClick={imprimer}>Imprimer</button>}
            {url && <button type="button" className="btn" style={boutonPetit} onClick={() => window.open(url, '_blank')}>Ouvrir</button>}
            <button type="button" className="btn" style={boutonPetit} onClick={() => setEtat(null)}>Fermer</button>
          </div>
        </div>
        {etat.chargement && <p style={{ color: 'var(--encre-douce)' }}>Génération du PDF…</p>}
        {etat.erreur && <div className="erreur">{etat.erreur}</div>}
        {url && <iframe ref={cadre} title="Aperçu du PDF" src={url} style={{ flex: 1, width: '100%', border: '1px solid rgba(128,128,128,0.3)', borderRadius: 6 }} />}
        {url && (
          <p style={{ color: 'var(--encre-douce)', fontSize: 12, margin: '8px 0 0' }}>
            Si l'aperçu ne s'affiche pas sur votre téléphone, utilisez « Ouvrir » ou « Télécharger ».
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- Page ----------

const ONGLETS = [
  { id: 'journal', label: 'Journal', composant: JournalTab },
  { id: 'immobilisations', label: 'Immobilisations', composant: ImmobilisationsTab },
  { id: 'financement', label: 'Capital et emprunts', composant: FinancementTab },
  { id: 'regularisations', label: 'Régularisations', composant: RegularisationsTab },
  { id: 'cloture', label: 'Clôture', composant: ClotureTab },
  { id: 'plan', label: 'Plan comptable', composant: PlanTab },
  { id: 'grandlivre', label: 'Grand livre', composant: GrandLivreTab },
  { id: 'balance', label: 'Balance', composant: BalanceTab },
  { id: 'resultat', label: 'Compte de résultat', composant: ResultatTab },
  { id: 'bilan', label: 'Bilan', composant: BilanTab },
];

export function ComptabilitePage() {
  const { enabled, loading } = useAccountingAccess();
  const [onglet, setOnglet] = useState('journal');
  const [cle, setCle] = useState(0);
  const [synchro, setSynchro] = useState(null);
  const [enSynchro, setEnSynchro] = useState(false);

  // À l'ouverture, la reprise automatique des données est lancée d'elle-même.
  useEffect(() => {
    if (!enabled) return;
    api.syncAccounting().then(setSynchro).catch(() => {});
  }, [enabled]);

  if (loading) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;
  if (!enabled) return <PageModuleNonActive nom="Comptabilité" />;

  async function actualiser() {
    setEnSynchro(true);
    try {
      setSynchro(await api.syncAccounting());
      setCle((k) => k + 1);
    } catch (err) {
      setSynchro({ errors: [err.message] });
    } finally {
      setEnSynchro(false);
    }
  }

  const Actif = ONGLETS.find((o) => o.id === onglet).composant;

  return (
    <div>
      <ApercuPdf />
      <div className="entete-page">
        <div>
          <h1>Comptabilité</h1>
          <p style={{ color: 'var(--encre-douce)', fontSize: 13, margin: '4px 0 0' }}>
            Plan comptable SYSCOHADA · montants en FCFA · écritures générées automatiquement
          </p>
        </div>
        <button type="button" className="btn" disabled={enSynchro} onClick={actualiser}>
          {enSynchro ? 'Mise à jour…' : 'Actualiser'}
        </button>
      </div>
      <p style={{ color: 'var(--encre-douce)', fontSize: 12.5, margin: '0 0 14px' }}>
        Reprises automatiquement : ventes, retours, règlements clients et assureurs, achats, règlements fournisseurs, salaires, sorties de caisse (dont les charges saisies dans la page Caisse), factures à payer, immobilisations et amortissements, capital et emprunts, et valeur du stock.
      </p>
      {synchro?.warnings?.length > 0 && (
        <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 12.5, color: 'var(--encre-douce)' }}>
          {synchro.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {synchro?.errors?.length > 0 && (
        <div className="erreur">Certaines données n'ont pas pu être reprises : {synchro.errors.join(', ')}.</div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {ONGLETS.map((o) => (
          <button key={o.id} type="button" className={`btn ${o.id === onglet ? 'btn-principal' : ''}`} onClick={() => setOnglet(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      <Actif key={`${onglet}-${cle}`} />
    </div>
  );
}
