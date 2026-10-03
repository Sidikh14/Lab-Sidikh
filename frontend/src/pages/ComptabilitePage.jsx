import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAccountingAccess } from '../hooks/useAccountingAccess';
import { useAuth } from '../context/AuthContext';
import { exporterPdf } from '../utils/exportPdf';

// Module comptabilité (SYSCOHADA). Affiché uniquement si l'owner a donné
// l'accès au commerçant : sinon la page redirige vers l'accueil et le lien
// n'apparaît pas dans le menu.

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const debutAnnee = () => `${new Date().getFullYear()}-01-01`;

const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 };
const cellule = { padding: '6px 8px', borderBottom: '1px solid rgba(128,128,128,0.18)', textAlign: 'left' };
const droite = { ...cellule, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const enteteTable = { ...cellule, fontWeight: 600, color: 'var(--encre-douce)' };
const boutonPetit = { padding: '6px 10px', fontSize: 12.5 };

const useEntreprise = () => useAuth().merchant?.businessName || '';
const libellePeriode = (p) => `Du ${dateFr(p.from)} au ${dateFr(p.to)}`;

function BoutonPdf({ onClick, disabled }) {
  return (
    <button type="button" className="btn" style={boutonPetit} disabled={disabled} onClick={onClick}>
      Exporter en PDF
    </button>
  );
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
function useDonnees(chargeur, deps) {
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
          <BoutonPdf disabled={!ecritures || ecritures.length === 0} onClick={exporterJournal} />
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
        <BoutonPdf disabled={!pret || comptesAffiches.length === 0} onClick={exporter} />
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
        <BoutonPdf disabled={lignes.length === 0} onClick={exporter} />
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
        <BoutonPdf disabled={!r} onClick={exporter} />
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
        <BoutonPdf disabled={!b} onClick={exporter} />
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

// ---------- Charges ----------

const MODES = [
  ['especes', 'Espèces'],
  ['wave', 'Wave'],
  ['orange_money', 'Orange Money'],
  ['virement', 'Virement'],
  ['a_payer', 'À payer plus tard (dette fournisseur)'],
];
const libelleMode = (m) => (MODES.find((x) => x[0] === m) || [m, m])[1];
const moisCourant = () => aujourdhui().slice(0, 7);

// [nom, compte SYSCOHADA, mensuelle par défaut]
const SUGGESTIONS = [
  ['Loyer', '622', true],
  ['Électricité / Eau', '605', true],
  ['Téléphone et Internet', '628', true],
  ['Assurance', '625', false],
  ['Transport', '618', false],
  ['Frais bancaires', '631', true],
  ['Entretien et réparations', '624', false],
  ['Publicité', '627', false],
  ['Impôts et taxes', '641', false],
];

function ChargeModal({ comptes, initial, onClose, onSaved }) {
  const [label, setLabel] = useState(initial?.label || '');
  const [accountId, setAccountId] = useState(initial?.accountId || '');
  const [amount, setAmount] = useState(initial?.amount ? String(Number(initial.amount)) : '');
  const [recurrente, setRecurrente] = useState(initial?.recurrente ?? false);
  const [jour, setJour] = useState(initial?.jour || 5);
  const [mode, setMode] = useState(initial?.mode || 'especes');
  const [debut, setDebut] = useState(initial?.debut || moisCourant());
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const classe6 = comptes.filter((c) => c.code[0] === '6' && c.is_active);

  async function enregistrer(e) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    const data = {
      label,
      accountId,
      amount: amount ? Number(amount) : null,
      isRecurring: recurrente,
      dayOfMonth: Number(jour),
      paymentMethod: mode,
      startMonth: recurrente ? debut : null,
    };
    try {
      if (initial?.id) await api.updateAccountingCharge(initial.id, data);
      else await api.createAccountingCharge(data);
      onSaved();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="modale-fond" onClick={onClose}>
      <div className="modale" style={{ maxWidth: 520, width: '96%', maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>{initial?.id ? 'Modifier la charge' : 'Nouvelle charge'}</h2>
        <form onSubmit={enregistrer}>
          <div className="champ-groupe">
            <label className="etiquette">Nom</label>
            <input className="champ" value={label} maxLength={150} onChange={(e) => setLabel(e.target.value)} required />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Compte de charge</label>
            <select className="champ" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              <option value="">Choisir…</option>
              {classe6.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.label}</option>)}
            </select>
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Montant habituel (FCFA)</label>
            <input type="number" min="1" step="any" className="champ" value={amount} onChange={(e) => setAmount(e.target.value)} required={recurrente} />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Mode de paiement</label>
            <select className="champ" value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map((m) => <option key={m[0]} value={m[0]}>{m[1]}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
            <input type="checkbox" checked={recurrente} onChange={(e) => setRecurrente(e.target.checked)} />
            Charge mensuelle : comptabilisée automatiquement chaque mois
          </label>
          {recurrente && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="champ-groupe">
                <label className="etiquette">Jour du mois (1 à 28)</label>
                <input type="number" min="1" max="28" className="champ" value={jour} onChange={(e) => setJour(e.target.value)} />
              </div>
              <div className="champ-groupe">
                <label className="etiquette">À partir du mois</label>
                <input type="month" className="champ" value={debut} onChange={(e) => setDebut(e.target.value)} />
              </div>
            </div>
          )}
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

function PaiementChargeModal({ charge, onClose, onSaved }) {
  const [date, setDate] = useState(aujourdhui());
  const [amount, setAmount] = useState(charge.amount ? String(Number(charge.amount)) : '');
  const [mode, setMode] = useState(charge.payment_method);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  async function valider(e) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await api.payAccountingCharge(charge.id, { date, amount: Number(amount), paymentMethod: mode });
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
        <h2>{charge.label}</h2>
        <p style={{ color: 'var(--encre-douce)', fontSize: 13.5 }}>L'écriture comptable est créée automatiquement.</p>
        <form onSubmit={valider}>
          <div className="champ-groupe">
            <label className="etiquette">Date</label>
            <input type="date" className="champ" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Montant (FCFA)</label>
            <input type="number" min="1" step="any" className="champ" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Mode de paiement</label>
            <select className="champ" value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map((m) => <option key={m[0]} value={m[0]}>{m[1]}</option>)}
            </select>
          </div>
          {erreur && <div className="erreur">{erreur}</div>}
          <div className="actions-modale">
            <button type="button" className="btn" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-principal" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Comptabiliser'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChargesTab() {
  const [version, setVersion] = useState(0);
  const [modale, setModale] = useState(null); // { type: 'charge', initial } | { type: 'paiement', charge }
  const [erreurAction, setErreurAction] = useState('');
  // Les charges mensuelles échues sont comptabilisées d'elles-mêmes avant l'affichage.
  const [donnees, erreur] = useDonnees(async () => {
    await api.generateAccountingCharges().catch(() => null);
    const [charges, historique, comptes] = await Promise.all([
      api.getAccountingCharges(),
      api.getAccountingChargePostings({ limit: 100 }),
      api.getAccountingAccounts(),
    ]);
    return { charges, historique, comptes };
  }, [version]);

  const recharger = () => { setModale(null); setVersion((v) => v + 1); };

  function suggerer([nom, code, mensuelle]) {
    const compte = donnees.comptes.find((c) => c.code === code);
    setModale({ type: 'charge', initial: { label: nom, accountId: compte?.id || '', recurrente: mensuelle } });
  }

  async function basculer(c) {
    setErreurAction('');
    try {
      await api.updateAccountingCharge(c.id, { isActive: !c.is_active });
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(err.message);
    }
  }

  async function annuler(p) {
    if (!window.confirm(`Annuler la comptabilisation « ${p.charge_label} » du ${dateFr(p.entry_date)} ?`)) return;
    setErreurAction('');
    try {
      await api.cancelAccountingChargePosting(p.id);
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(err.message);
    }
  }

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!donnees) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;
  const { charges, historique, comptes } = donnees;

  return (
    <div>
      <p style={{ color: 'var(--encre-douce)', fontSize: 13.5, marginTop: 0 }}>
        Déclarez une charge une seule fois. Une charge mensuelle est ensuite comptabilisée toute seule à sa date ;
        une charge ponctuelle se comptabilise en un clic. Il n'y a aucune écriture à saisir.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {SUGGESTIONS.map((sg) => (
          <button key={sg[0]} type="button" className="btn" style={boutonPetit} onClick={() => suggerer(sg)}>+ {sg[0]}</button>
        ))}
        <button type="button" className="btn btn-principal" style={boutonPetit} onClick={() => setModale({ type: 'charge', initial: null })}>
          Autre charge
        </button>
      </div>

      {erreurAction && <div className="erreur">{erreurAction}</div>}

      {charges.length === 0 ? (
        <p className="etat-vide">Aucune charge déclarée. Choisissez une suggestion ci-dessus pour commencer.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 26 }}>
          {charges.map((c) => (
            <div key={c.id} className="carte-entite" style={{ opacity: c.is_active ? 1 : 0.55 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <strong>{c.label}</strong>
                  <div style={{ color: 'var(--encre-douce)', fontSize: 13 }}>
                    {c.account_code} — {c.account_label} · {libelleMode(c.payment_method)}
                  </div>
                  <div style={{ fontSize: 13.5, marginTop: 2 }}>
                    {c.amount ? `${fmt(c.amount)} FCFA` : 'Montant variable'}
                    {c.is_recurring ? ` · chaque mois le ${c.day_of_month} (depuis ${c.start_month})` : ' · ponctuelle'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  {c.is_active && (
                    <button type="button" className="btn btn-principal" style={boutonPetit} onClick={() => setModale({ type: 'paiement', charge: c })}>
                      Comptabiliser un paiement
                    </button>
                  )}
                  <button type="button" className="btn" style={boutonPetit}
                    onClick={() => setModale({ type: 'charge', initial: {
                      id: c.id, label: c.label, accountId: c.account_id, amount: c.amount, recurrente: c.is_recurring,
                      jour: c.day_of_month || 5, mode: c.payment_method, debut: c.start_month || moisCourant(),
                    } })}>
                    Modifier
                  </button>
                  <button type="button" className="btn" style={boutonPetit} onClick={() => basculer(c)}>
                    {c.is_active ? 'Désactiver' : 'Réactiver'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: 15 }}>Charges comptabilisées</h3>
      {historique.length === 0 ? (
        <p className="etat-vide">Rien de comptabilisé pour l'instant.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={enteteTable}>Date</th>
                <th style={enteteTable}>Charge</th>
                <th style={enteteTable}>Paiement</th>
                <th style={{ ...enteteTable, textAlign: 'right' }}>Montant</th>
                <th style={enteteTable}>Écriture</th>
                <th style={enteteTable} />
              </tr>
            </thead>
            <tbody>
              {historique.map((p) => (
                <tr key={p.id} style={{ opacity: p.cancelled ? 0.5 : 1 }}>
                  <td style={cellule}>{dateFr(p.entry_date)}</td>
                  <td style={cellule}>{p.charge_label}{p.period ? ` (${p.period})` : ''}</td>
                  <td style={cellule}>{libelleMode(p.payment_method)}</td>
                  <td style={droite}>{fmt(p.amount)}</td>
                  <td style={cellule}>{p.cancelled ? 'Annulée' : `N°${p.entry_number}`}</td>
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

      {modale?.type === 'charge' && (
        <ChargeModal comptes={comptes} initial={modale.initial} onClose={() => setModale(null)} onSaved={recharger} />
      )}
      {modale?.type === 'paiement' && (
        <PaiementChargeModal charge={modale.charge} onClose={() => setModale(null)} onSaved={recharger} />
      )}
    </div>
  );
}

// ---------- Impôts & cotisations ----------
// Ce qui reste dû à l'État et aux organismes sociaux (calculé depuis les écritures
// automatiques : ventes, achats, paie) et les paiements effectués.

const MODES_ETAT = MODES.filter((m) => m[0] !== 'a_payer');
const NOMS_ETAT = {
  tva: 'TVA', retenues: 'IR et TRIMF sur salaires', css: 'Cotisations CSS',
  ipres: 'Cotisations IPRES', cfce: 'CFCE', is: 'Impôt sur les résultats',
};

function boutiqueActive() {
  try {
    return localStorage.getItem('boutiqueActiveId') || '';
  } catch {
    return '';
  }
}

function PaiementEtatModal({ dette, onClose, onSaved }) {
  const [date, setDate] = useState(aujourdhui());
  const [amount, setAmount] = useState(dette.du > 0 ? String(dette.du) : '');
  const [mode, setMode] = useState('virement');
  const [periode, setPeriode] = useState(moisCourant());
  const [note, setNote] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  async function valider(e) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await api.createAccountingStatePayment({
        type: dette.type, amount: Number(amount), paymentMethod: mode, paymentDate: date,
        period: periode || undefined, note: note || undefined,
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
        <h2>Payer : {NOMS_ETAT[dette.type]}</h2>
        <p style={{ color: 'var(--encre-douce)', fontSize: 13.5 }}>
          {dette.type === 'tva'
            ? "Saisissez le net versé : la TVA déductible est compensée automatiquement avec la TVA facturée."
            : "L'écriture comptable est créée automatiquement."}
        </p>
        <form onSubmit={valider}>
          <div className="champ-groupe">
            <label className="etiquette">Date du paiement</label>
            <input type="date" className="champ" value={date} max={aujourdhui()} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="champ-groupe">
            <label className="etiquette">Période concernée</label>
            <input type="month" className="champ" value={periode} onChange={(e) => setPeriode(e.target.value)} />
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
                Sortie de la caisse de la boutique active (choisie sur la page Caisse).
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

function ImpotsTab() {
  const [version, setVersion] = useState(0);
  const [modale, setModale] = useState(null);
  const [erreurAction, setErreurAction] = useState('');
  const [donnees, erreur] = useDonnees(
    async () => {
      const [dues, paiements] = await Promise.all([api.getAccountingStateDues(), api.getAccountingStatePayments()]);
      return { dettes: dues.dettes, paiements };
    },
    [version]
  );

  function recharger() {
    setModale(null);
    setVersion((v) => v + 1);
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
  const { dettes, paiements } = donnees;

  return (
    <div>
      <p style={{ color: 'var(--encre-douce)', fontSize: 13.5, marginTop: 0 }}>
        Montants calculés automatiquement depuis les ventes, les achats et les bulletins de paie.
        Enregistrez un paiement pour solder la dette : l'écriture (et la sortie de caisse) se crée toute seule.
      </p>
      {erreurAction && <div className="erreur">{erreurAction}</div>}

      <div style={{ overflowX: 'auto', marginBottom: 26 }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={enteteTable}>Impôt / cotisation</th>
              <th style={{ ...enteteTable, textAlign: 'right' }}>Reste à payer</th>
              <th style={enteteTable} />
            </tr>
          </thead>
          <tbody>
            {dettes.map((d) => (
              <tr key={d.type}>
                <td style={cellule}>
                  {NOMS_ETAT[d.type]}
                  {d.type === 'tva' && (
                    <div style={{ color: 'var(--encre-douce)', fontSize: 12 }}>
                      Facturée {fmt(d.collectee)} − déductible {fmt(d.deductible)}
                    </div>
                  )}
                </td>
                <td style={droite}>{d.du < 0 ? `Crédit de ${fmt(-d.du)}` : fmt(d.du)}</td>
                <td style={{ ...cellule, textAlign: 'right' }}>
                  <button type="button" className="btn btn-principal" style={boutonPetit} onClick={() => setModale(d)}>Payer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
                    {NOMS_ETAT[p.kind] || p.kind}{p.period ? ` (${p.period})` : ''}
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

      {modale && <PaiementEtatModal dette={modale} onClose={() => setModale(null)} onSaved={recharger} />}
    </div>
  );
}

// ---------- Page ----------

const ONGLETS = [
  { id: 'journal', label: 'Journal', composant: JournalTab },
  { id: 'charges', label: 'Charges', composant: ChargesTab },
  { id: 'impots', label: 'Impôts & cotisations', composant: ImpotsTab },
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
  if (!enabled) return <Navigate to="/" replace />;

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
        Reprises automatiquement : ventes, retours, règlements clients et assureurs, achats, règlements fournisseurs, salaires, charges et valeur du stock.
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
