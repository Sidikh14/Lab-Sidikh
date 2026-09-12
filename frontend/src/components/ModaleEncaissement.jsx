import { useState } from 'react';
import { api } from '../api/client';

const MOYENS_PAIEMENT = [
  { value: 'especes', label: 'Espèces' },
  { value: 'wave', label: 'Wave' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'virement', label: 'Virement' },
  { value: 'a_credit', label: 'À crédit' },
];

// Détail en lecture seule de la facture : le caissier voit exactement ce
// que le vendeur a saisi, mais ne peut rien y changer directement.
function DetailFacture({ commande }) {
  return (
    <div className="ticket-lignes" style={{ marginBottom: 16, border: '1px solid var(--trait)', borderRadius: 'var(--rayon-petit)' }}>
      {(commande.items || []).map((item) => (
        <div key={item.id} className="ticket-ligne">
          <div style={{ minWidth: 0 }}>
            <p className="ticket-ligne-nom">
              {item.product_name}
              {item.packaging_label && <span style={{ color: 'var(--accent)' }}> · {item.packaging_label}</span>}
            </p>
            <p className="ticket-ligne-prix">{item.quantity} × {Math.round(item.unit_price).toLocaleString('fr-FR')} FCFA</p>
          </div>
          <span className="chiffre">{Math.round(item.line_total).toLocaleString('fr-FR')} FCFA</span>
        </div>
      ))}
    </div>
  );
}

export function ModaleEncaissement({ commande, onClose, onSuccess, onReturned }) {
  const [moyenPaiement, setMoyenPaiement] = useState('especes');
  const [montantRecu, setMontantRecu] = useState(String(commande.total_amount));
  const [erreur, setErreur] = useState('');
  const [vueRetour, setVueRetour] = useState(false);
  const [motifRetour, setMotifRetour] = useState('');
  const [enCours, setEnCours] = useState(false);

  const estACredit = moyenPaiement === 'a_credit';
  const monnaieARendre = Math.max(0, Number(montantRecu || 0) - Number(commande.total_amount));

  async function handleEncaisser(e) {
    e.preventDefault();
    if (estACredit && !commande.client_id) {
      setErreur('Le paiement à crédit est réservé aux clients enregistrés.');
      return;
    }
    if (!estACredit && Number(montantRecu) < Number(commande.total_amount)) {
      setErreur('Le montant reçu est inférieur au total à payer.');
      return;
    }
    setEnCours(true);
    setErreur('');
    try {
      await api.recordOrderPayment(commande.id, {
        paymentMethod: moyenPaiement,
        amountReceived: estACredit ? 0 : Number(montantRecu),
      });
      // Le reçu (ticket étroit pour un client de passage, facture A4 pour
      // un client enregistré) s'ouvre automatiquement dans un nouvel
      // onglet — l'échec de cet appel ne doit pas bloquer l'encaissement
      // déjà enregistré, donc on l'isole dans son propre try/catch.
      try {
        await api.previewOrderReceipt(commande.id);
      } catch (err) {
        console.error('Impossible d\'ouvrir le reçu automatiquement :', err.message);
      }
      onSuccess();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleAnnuler() {
    setEnCours(true);
    setErreur('');
    try {
      await api.updateOrderStatus(commande.id, 'annulee');
      onSuccess();
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  }

  async function handleConfirmerRetour() {
    setEnCours(true);
    setErreur('');
    try {
      await api.returnOrderToSeller(commande.id, motifRetour || undefined);
      if (onReturned) onReturned();
      else onSuccess();
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  }

  if (vueRetour) {
    return (
      <div className="modale-fond" onClick={onClose}>
        <div className="modale" onClick={(e) => e.stopPropagation()}>
          <h2>Retourner {commande.order_number} au vendeur</h2>
          <p style={{ fontSize: 14, color: 'var(--encre-douce)', marginBottom: 16 }}>
            Le vendeur pourra modifier ou annuler cette facture. Elle vous reviendra directement une fois corrigée.
          </p>
          {erreur && <div className="erreur">{erreur}</div>}
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="e-motif">Motif (optionnel)</label>
            <input
              id="e-motif"
              type="text"
              className="champ"
              placeholder="Ex : erreur de quantité, mauvais produit…"
              value={motifRetour}
              onChange={(e) => setMotifRetour(e.target.value)}
            />
          </div>
          <div className="actions-modale">
            <button type="button" className="btn" onClick={() => setVueRetour(false)} disabled={enCours}>Retour</button>
            <button type="button" className="btn btn-principal" onClick={handleConfirmerRetour} disabled={enCours}>
              {enCours ? 'Envoi…' : 'Confirmer le retour au vendeur'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modale-fond" onClick={onClose}>
      <div className="modale" onClick={(e) => e.stopPropagation()}>
        <h2>Encaisser {commande.order_number}</h2>
        <p style={{ fontSize: 14, color: 'var(--encre-douce)', marginBottom: 8 }}>
          {commande.client_name || 'Client de passage'}
        </p>

        <DetailFacture commande={commande} />

        <div className="ticket-totaux" style={{ marginBottom: 16 }}>
          <div className="ticket-total-ligne">
            <span>Sous-total</span>
            <span className="chiffre">{Math.round(commande.subtotal_amount).toLocaleString('fr-FR')}</span>
          </div>
          {commande.tva_applicable && (
            <div className="ticket-total-ligne">
              <span>TVA ({commande.tva_rate ?? 18} %)</span>
              <span className="chiffre">{Math.round(commande.tva_amount).toLocaleString('fr-FR')}</span>
            </div>
          )}
          <div className="ticket-total-ligne ticket-total-ligne--principal">
            <span>Total à payer</span>
            <span className="chiffre">{Math.round(commande.total_amount).toLocaleString('fr-FR')} FCFA</span>
          </div>
        </div>

        {erreur && <div className="erreur">{erreur}</div>}
        <form onSubmit={handleEncaisser}>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="e-moyen">Moyen de paiement</label>
            <select id="e-moyen" className="champ" value={moyenPaiement} onChange={(e) => setMoyenPaiement(e.target.value)}>
              {MOYENS_PAIEMENT.map((m) => (
                <option key={m.value} value={m.value} disabled={m.value === 'a_credit' && !commande.client_id}>
                  {m.label}{m.value === 'a_credit' && !commande.client_id ? ' (client enregistré requis)' : ''}
                </option>
              ))}
            </select>
          </div>

          {estACredit ? (
            <div
              style={{
                background: 'var(--fond)', border: '1px solid var(--trait)', borderRadius: 'var(--rayon-petit)',
                padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--encre-douce)',
              }}
            >
              Le montant total (<strong className="chiffre">{Math.round(commande.total_amount).toLocaleString('fr-FR')} FCFA</strong>) sera
              ajouté à la créance de <strong>{commande.client_name}</strong>, à régler plus tard depuis sa fiche client.
            </div>
          ) : (
            <>
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
            </>
          )}

          <div className="actions-modale" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={onClose} disabled={enCours}>Plus tard</button>
            <button type="button" className="btn btn-brique" onClick={handleAnnuler} disabled={enCours}>Annuler la vente</button>
            <button type="button" className="btn" onClick={() => setVueRetour(true)} disabled={enCours}>Retourner au vendeur</button>
            <button type="submit" className="btn btn-principal" disabled={enCours}>
              {enCours ? 'Encaissement…' : estACredit ? 'Confirmer la vente à crédit' : "Confirmer l'encaissement"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
