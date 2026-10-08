import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PiecesModal } from './PiecesModal';

// Factures de charges « à payer plus tard » (dette fournisseur) : on les règle ici,
// depuis la caisse (espèces, Wave, Orange Money) ou par virement. Le règlement crée la
// sortie de caisse ET l'écriture comptable. N'affiche rien s'il n'y a aucune facture
// à régler ou si le module comptabilité n'est pas activé.
//
// Usage dans CaissePage (onglet Sorties) :
//   <CaisseFacturesPanel warehouseId={activeWarehouseId} refreshKey={refreshKey} onPaid={rafraichir} />

const MODES = [
  ['especes', 'Espèces (sort de la caisse)'],
  ['wave', 'Wave (sort de la caisse)'],
  ['orange_money', 'Orange Money (sort de la caisse)'],
  ['virement', 'Virement bancaire'],
];
const libelleMode = (m) => (MODES.find((x) => x[0] === m) || [m, m])[1].replace(/ \(.*\)$/, '');
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

export function CaisseFacturesPanel({ warehouseId, refreshKey, onPaid }) {
  const [donnees, setDonnees] = useState(null);
  const [choix, setChoix] = useState(null);
  const [mode, setMode] = useState('especes');
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [envoi, setEnvoi] = useState(false);
  // Justificatif (facture du fournisseur, reçu…) joint à une facture à payer.
  const [piecesFacture, setPiecesFacture] = useState(null);

  async function charger() {
    try {
      setDonnees(await api.getCaisseFactures());
    } catch {
      setDonnees({ enabled: false, open: [], recent: [] });
    }
  }

  useEffect(() => {
    charger();
  }, [refreshKey]);

  if (!donnees || !donnees.enabled || (donnees.open.length === 0 && !message)) return null;

  function choisir(f) {
    setChoix(f);
    setMode('especes');
    setErreur('');
    setMessage('');
  }

  async function regler(e) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await api.payCaisseFacture(choix.id, { paymentMethod: mode, warehouseId: mode === 'virement' ? undefined : warehouseId || undefined });
      setMessage(`« ${choix.label} » : ${fmt(choix.amount)} FCFA réglés (${libelleMode(mode)}) et comptabilisés.`);
      setChoix(null);
      await charger();
      if (onPaid) onPaid();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="md-carte" style={{ marginBottom: 20 }}>
      <h2 style={{ margin: '0 0 4px' }}>Factures à payer</h2>
      <p style={{ margin: '0 0 12px', color: 'var(--encre-douce)', fontSize: 13 }}>
        Charges enregistrées « à payer plus tard ». Le règlement sort de la caisse (ou du compte bancaire) et est comptabilisé automatiquement.
      </p>

      {message && <p style={{ margin: '0 0 12px', color: 'var(--succes, #1a7f4b)', fontSize: 13.5 }}>{message}</p>}

      {donnees.open.map((f) => (
        <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid rgba(128,128,128,0.18)' }}>
          <span style={{ fontSize: 13.5 }}>{dateFr(f.bill_date)} · {f.label}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(f.amount)} FCFA</strong>
            <button type="button" className="btn" style={{ padding: '6px 10px', fontSize: 12.5 }} onClick={() => setPiecesFacture(f)}>Justificatif</button>
            <button type="button" className={`btn ${choix?.id === f.id ? 'btn-principal' : ''}`} style={{ padding: '6px 10px', fontSize: 12.5 }} onClick={() => choisir(f)}>
              Régler
            </button>
          </span>
        </div>
      ))}

      {piecesFacture && (
        <PiecesModal sourceType="facture_charge" sourceId={piecesFacture.id} titre={`${piecesFacture.label} — ${fmt(piecesFacture.amount)} FCFA`} onClose={() => setPiecesFacture(null)} />
      )}

      {choix && (
        <form onSubmit={regler} style={{ marginTop: 14, display: 'grid', gap: 10, maxWidth: 420 }}>
          <strong>{choix.label} — {fmt(choix.amount)} FCFA</strong>
          <select className="champ" value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => <option key={m[0]} value={m[0]}>{m[1]}</option>)}
          </select>
          {erreur && <div className="erreur">{erreur}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setChoix(null)}>Annuler</button>
            <button type="submit" className="btn btn-principal" disabled={envoi}>
              {envoi ? 'Enregistrement…' : 'Enregistrer le règlement'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
