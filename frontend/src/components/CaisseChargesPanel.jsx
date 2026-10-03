import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Paiement des charges (loyer, électricité, eau, internet…) depuis la page
// Caisse. La sortie de caisse ET l'écriture comptable sont créées ensemble.
// N'affiche rien si le module comptabilité n'est pas activé pour le commerçant.
//
// Usage dans CaissePage (onglet Sorties) :
//   <CaisseChargesPanel warehouseId={activeWarehouseId} onPaid={rafraichir} />
// warehouseId : boutique active (utile au manager, qui n'est rattaché à aucune boutique) ;
// onPaid : appelé après chaque paiement pour rafraîchir la caisse.

const MODES = [
  ['especes', 'Espèces'],
  ['wave', 'Wave'],
  ['orange_money', 'Orange Money'],
];
const libelleMode = (m) => (MODES.find((x) => x[0] === m) || [m, m])[1];
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

export function CaisseChargesPanel({ onPaid, warehouseId }) {
  const [donnees, setDonnees] = useState(null);
  const [choix, setChoix] = useState(null);
  const [montant, setMontant] = useState('');
  const [mode, setMode] = useState('especes');
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [envoi, setEnvoi] = useState(false);

  async function charger() {
    try {
      setDonnees(await api.getCaisseCharges());
    } catch {
      setDonnees({ enabled: false, charges: [], recent: [] });
    }
  }

  useEffect(() => {
    charger();
  }, []);

  if (!donnees || !donnees.enabled || donnees.charges.length === 0) return null;

  function choisir(c) {
    setChoix(c);
    setMontant(c.amount ? String(Number(c.amount)) : '');
    setMode(MODES.some((m) => m[0] === c.payment_method) ? c.payment_method : 'especes');
    setErreur('');
    setMessage('');
  }

  async function payer(e) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await api.payCaisseCharge(choix.id, { amount: Number(montant), paymentMethod: mode, warehouseId: warehouseId || undefined });
      setMessage(`« ${choix.label} » : ${fmt(montant)} FCFA payés depuis la caisse et comptabilisés.`);
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
      <h2 style={{ margin: '0 0 4px' }}>Payer une charge</h2>
      <p style={{ margin: '0 0 12px', color: 'var(--encre-douce)', fontSize: 13 }}>
        Loyer, électricité, eau, internet… La somme sort de la caisse et est comptabilisée automatiquement.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {donnees.charges.map((c) => (
          <button key={c.id} type="button" className={`btn ${choix?.id === c.id ? 'btn-principal' : ''}`}
            style={{ padding: '7px 12px', fontSize: 13 }} onClick={() => choisir(c)}>
            {c.label}
          </button>
        ))}
      </div>

      {message && <p style={{ margin: '12px 0 0', color: 'var(--succes, #1a7f4b)', fontSize: 13.5 }}>{message}</p>}

      {choix && (
        <form onSubmit={payer} style={{ marginTop: 14, display: 'grid', gap: 10, maxWidth: 420 }}>
          <strong>{choix.label}</strong>
          <input type="number" min="1" step="any" className="champ" placeholder="Montant (FCFA)" value={montant}
            onChange={(e) => setMontant(e.target.value)} required autoFocus />
          <select className="champ" value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => <option key={m[0]} value={m[0]}>{m[1]}</option>)}
          </select>
          {erreur && <div className="erreur">{erreur}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setChoix(null)}>Annuler</button>
            <button type="submit" className="btn btn-principal" disabled={envoi}>
              {envoi ? 'Enregistrement…' : 'Payer depuis la caisse'}
            </button>
          </div>
        </form>
      )}

      {donnees.recent.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12.5, color: 'var(--encre-douce)', marginBottom: 4 }}>Derniers paiements</div>
          {donnees.recent.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5, padding: '3px 0' }}>
              <span>{dateFr(p.entry_date)} · {p.charge_label} · {libelleMode(p.payment_method)}</span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(p.amount)} FCFA</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
