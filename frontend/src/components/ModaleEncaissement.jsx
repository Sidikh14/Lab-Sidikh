import { useState } from 'react';
import { api } from '../api/client';

const MOYENS_PAIEMENT = [
  { value: 'especes', label: 'Espèces' },
  { value: 'wave', label: 'Wave' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'virement', label: 'Virement' },
];

export function ModaleEncaissement({ commande, onClose, onSuccess }) {
  const [moyenPaiement, setMoyenPaiement] = useState('especes');
  const [montantRecu, setMontantRecu] = useState(String(commande.total_amount));
  const [erreur, setErreur] = useState('');

  const monnaieARendre = Math.max(0, Number(montantRecu || 0) - Number(commande.total_amount));

  async function handleEncaisser(e) {
    e.preventDefault();
    if (Number(montantRecu) < Number(commande.total_amount)) {
      setErreur('Le montant reçu est inférieur au total à payer.');
      return;
    }
    try {
      await api.recordOrderPayment(commande.id, {
        paymentMethod: moyenPaiement,
        amountReceived: Number(montantRecu),
      });
      onSuccess();
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <div className="modale-fond" onClick={onClose}>
      <div className="modale" onClick={(e) => e.stopPropagation()}>
        <h2>Encaisser {commande.order_number}</h2>
        <p style={{ fontSize: 14, color: 'var(--encre-douce)', marginBottom: 16 }}>
          Total à payer : <strong className="chiffre" style={{ color: 'var(--encre)' }}>
            {Math.round(commande.total_amount).toLocaleString('fr-FR')} FCFA
          </strong>
        </p>
        {erreur && <div className="erreur">{erreur}</div>}
        <form onSubmit={handleEncaisser}>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="e-moyen">Moyen de paiement</label>
            <select id="e-moyen" className="champ" value={moyenPaiement} onChange={(e) => setMoyenPaiement(e.target.value)}>
              {MOYENS_PAIEMENT.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="e-recu">Montant reçu (FCFA)</label>
            <input
              id="e-recu"
              type="number"
              className="champ"
              value={montantRecu}
              onChange={(e) => setMontantRecu(e.target.value)}
            />
          </div>
          <div style={{ fontSize: 14, marginBottom: 8 }}>
            Monnaie à rendre : <strong className="chiffre">{Math.round(monnaieARendre).toLocaleString('fr-FR')} FCFA</strong>
          </div>
          <div className="actions-modale">
            <button type="button" className="btn" onClick={onClose}>Plus tard</button>
            <button type="submit" className="btn btn-principal">Confirmer l'encaissement</button>
          </div>
        </form>
      </div>
    </div>
  );
}
