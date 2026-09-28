import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useOfflineSync } from '../offline/useOfflineSync';

const MOYENS_PAIEMENT = [
  { value: 'especes', label: 'Espèces' },
  { value: 'wave', label: 'Wave' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'virement', label: 'Virement' },
  { value: 'a_credit', label: 'À crédit' },
  { value: 'tiers_payant', label: 'Tiers payant (mutuelle)' },
];

const TYPES_REDUCTION = [
  { value: 'remise', label: 'Remise' },
  { value: 'rabais', label: 'Rabais' },
  { value: 'ristourne', label: 'Ristourne' },
  { value: 'escompte', label: 'Escompte' },
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
  const { user } = useAuth();
  const { isOnline, recordPayment } = useOfflineSync(api);
  const [moyenPaiement, setMoyenPaiement] = useState('especes');
  const [montantRecu, setMontantRecu] = useState(String(commande.total_amount));
  const [erreur, setErreur] = useState('');
  const [vueRetour, setVueRetour] = useState(false);
  const [motifRetour, setMotifRetour] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [demandeNom, setDemandeNom] = useState('');
  const [demandeTelephone, setDemandeTelephone] = useState('');
  const [demandeAdresse, setDemandeAdresse] = useState('');
  const [demandeEnvoyee, setDemandeEnvoyee] = useState(false);
  const [confirmationHorsLigne, setConfirmationHorsLigne] = useState(false);
  const [prevoirLivraison, setPrevoirLivraison] = useState(false);
  const [fraisLivraison, setFraisLivraison] = useState('');
  const [adresseLivraison, setAdresseLivraison] = useState(commande.client_address || '');
  const [reductionActive, setReductionActive] = useState(false);
  const [typeReduction, setTypeReduction] = useState('remise');
  const [modeReduction, setModeReduction] = useState('pourcentage');
  const [valeurReduction, setValeurReduction] = useState('');
  const [avanceActive, setAvanceActive] = useState(false);
  const [montantAvance, setMontantAvance] = useState('');
  const [moyenAvance, setMoyenAvance] = useState('especes');
  const [moyenResteACharge, setMoyenResteACharge] = useState('especes');
  // Format du reçu pour un client enregistré : facture A4 ou ticket de caisse.
  const [formatRecu, setFormatRecu] = useState('a4');

  // Mutuelle du client (tiers payant) — chargée une fois, pas incluse dans
  // l'objet commande.
  const [clientInfo, setClientInfo] = useState(null);
  useEffect(() => {
    if (commande.client_id) {
      api.getClient(commande.client_id).then(setClientInfo).catch(() => {});
    }
  }, [commande.client_id]);

  const estManager = user?.role === 'manager';
  const estClientDePassage = !commande.client_id;
  const estACredit = moyenPaiement === 'a_credit';
  const estTiersPayant = moyenPaiement === 'tiers_payant';
  const clientAMutuelle = Boolean(clientInfo?.insurer_id && Number(clientInfo?.insurance_coverage_percent) > 0);
  const fraisLivraisonNombre = prevoirLivraison ? Number(fraisLivraison || 0) : 0;
  const montantReduction =
    estManager && reductionActive && valeurReduction
      ? Math.min(
          modeReduction === 'pourcentage'
            ? Math.round(Number(commande.total_amount) * (Number(valeurReduction) / 100))
            : Math.round(Number(valeurReduction)),
          Number(commande.total_amount)
        )
      : 0;
  const totalAPayer = Number(commande.total_amount) - montantReduction + fraisLivraisonNombre;
  const montantCouvertAssurance = estTiersPayant && clientAMutuelle
    ? Math.min(totalAPayer, Math.round(totalAPayer * (Number(clientInfo.insurance_coverage_percent) / 100)))
    : 0;
  const montantResteACharge = estTiersPayant ? totalAPayer - montantCouvertAssurance : totalAPayer;
  const monnaieARendre = Math.max(0, Number(montantRecu || 0) - montantResteACharge);

  // Client assuré : le tiers payant est sélectionné d'office dès que la
  // fiche client est chargée (une seule fois — le caissier peut ensuite
  // choisir un autre moyen de paiement s'il le souhaite).
  const tiersPayantAutoApplique = useRef(false);
  useEffect(() => {
    if (clientAMutuelle && !tiersPayantAutoApplique.current) {
      tiersPayantAutoApplique.current = true;
      setMoyenPaiement('tiers_payant');
    }
  }, [clientAMutuelle]);

  // Le montant reçu suit le reste à charge en tiers payant (au lieu de
  // rester sur le total de la facture), et revient au total si on quitte
  // le tiers payant.
  const etaitTiersPayant = useRef(false);
  useEffect(() => {
    if (estTiersPayant) {
      setMontantRecu(String(montantResteACharge));
    } else if (etaitTiersPayant.current) {
      setMontantRecu(String(totalAPayer));
    }
    etaitTiersPayant.current = estTiersPayant;
  }, [estTiersPayant, montantResteACharge, totalAPayer]);

  async function handleEncaisser(e) {
    e.preventDefault();
    if (estACredit && !commande.client_id) {
      setErreur('Le paiement à crédit est réservé aux clients enregistrés.');
      return;
    }
    if (estTiersPayant && !clientAMutuelle) {
      setErreur("Ce client n'a pas de mutuelle/tiers payant configuré sur sa fiche.");
      return;
    }
    if (prevoirLivraison && (fraisLivraison !== '' && (Number.isNaN(Number(fraisLivraison)) || Number(fraisLivraison) < 0))) {
      setErreur('Montant de livraison invalide.');
      return;
    }
    if (prevoirLivraison && !adresseLivraison.trim()) {
      setErreur("L'adresse de livraison est requise.");
      return;
    }
    if (estManager && reductionActive) {
      if (!valeurReduction || Number(valeurReduction) <= 0) {
        setErreur('Valeur de réduction invalide.');
        return;
      }
      if (modeReduction === 'pourcentage' && Number(valeurReduction) > 100) {
        setErreur('Le pourcentage de réduction ne peut pas dépasser 100.');
        return;
      }
    }
    if (!estACredit && Number(montantRecu) < montantResteACharge) {
      setErreur(estTiersPayant ? 'Le montant reçu est inférieur au reste à charge du client.' : 'Le montant reçu est inférieur au total à payer.');
      return;
    }
    if (estACredit && avanceActive) {
      if (!montantAvance || Number(montantAvance) <= 0) {
        setErreur("Montant de l'avance invalide.");
        return;
      }
      if (Number(montantAvance) > totalAPayer) {
        setErreur("L'avance ne peut pas dépasser le total de la facture.");
        return;
      }
    }
    setEnCours(true);
    setErreur('');
    try {
      const resultat = await recordPayment(commande.id, {
        paymentMethod: moyenPaiement,
        amountReceived: estACredit ? 0 : estTiersPayant ? (montantResteACharge > 0 ? Number(montantRecu) : 0) : Number(montantRecu),
        needsDelivery: prevoirLivraison,
        deliveryFee: fraisLivraisonNombre,
        deliveryAddress: prevoirLivraison ? adresseLivraison.trim() : '',
        ...(estManager && reductionActive
          ? { discountType: typeReduction, discountMode: modeReduction, discountValue: Number(valeurReduction) }
          : {}),
        ...(estACredit && avanceActive
          ? { advanceAmount: Number(montantAvance), advancePaymentMethod: moyenAvance }
          : {}),
        ...(estTiersPayant && montantResteACharge > 0 ? { copaymentMethod: moyenResteACharge } : {}),
      });
      if (resultat?.offline) {
        // Pas de réseau : l'encaissement est en file d'attente, on ne peut
        // pas générer le reçu PDF (ça nécessite le serveur) tant qu'il n'est
        // pas synchronisé. On informe le caissier au lieu d'ouvrir un reçu.
        setConfirmationHorsLigne(true);
        return;
      }
      // Le reçu (ticket étroit pour un client de passage, facture A4 pour
      // un client enregistré) s'ouvre automatiquement dans un nouvel
      // onglet — l'échec de cet appel ne doit pas bloquer l'encaissement
      // déjà enregistré, donc on l'isole dans son propre try/catch.
      try {
        await api.previewOrderReceipt(commande.id, commande.client_id ? formatRecu : undefined);
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

  async function handleEnvoyerDemandeCredit(e) {
    e.preventDefault();
    if (!demandeNom.trim()) {
      setErreur('Le nom du client est requis.');
      return;
    }
    setEnCours(true);
    setErreur('');
    try {
      await api.createCreditRequest({
        orderId: commande.id,
        fullName: demandeNom.trim(),
        phone: demandeTelephone || undefined,
        address: demandeAdresse || undefined,
      });
      setDemandeEnvoyee(true);
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

  if (confirmationHorsLigne) {
    return (
      <div className="modale-fond" onClick={onSuccess}>
        <div className="modale" style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
          <h2 style={{ marginBottom: 6 }}>Encaissement enregistré localement</h2>
          <p style={{ color: 'var(--encre-douce)', fontSize: 14, marginBottom: 16 }}>
            Pas de connexion — il sera envoyé automatiquement au retour du réseau. Le reçu ne pourra être imprimé
            qu'une fois la synchronisation faite.
          </p>
          <button className="btn btn-principal" style={{ width: '100%', justifyContent: 'center' }} onClick={onSuccess}>
            Compris
          </button>
        </div>
      </div>
    );
  }

  if (estACredit && estClientDePassage) {
    if (demandeEnvoyee) {
      return (
        <div className="modale-fond" onClick={onClose}>
          <div className="modale" style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 6 }}>Demande envoyée</h2>
            <p style={{ color: 'var(--encre-douce)', fontSize: 14, marginBottom: 16 }}>
              Le manager ou le gérant doit valider la création du client avant que cette vente puisse être encaissée à crédit.
              Reviens sur cette commande une fois la demande approuvée.
            </p>
            <button className="btn btn-principal" style={{ width: '100%', justifyContent: 'center' }} onClick={onClose}>
              Compris
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="modale-fond" onClick={onClose}>
        <div className="modale" onClick={(e) => e.stopPropagation()}>
          <h2>Demander une vente à crédit</h2>
          <p style={{ fontSize: 14, color: 'var(--encre-douce)', marginBottom: 16 }}>
            La vente à crédit n'est autorisée que pour un client enregistré. Renseigne ses informations : le manager ou le
            gérant devra valider la création du client avant que tu puisses encaisser cette commande à crédit.
          </p>
          {erreur && <div className="erreur">{erreur}</div>}
          <form onSubmit={handleEnvoyerDemandeCredit}>
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="dc-nom">Nom complet du client</label>
              <input id="dc-nom" type="text" className="champ" value={demandeNom} onChange={(e) => setDemandeNom(e.target.value)} required />
            </div>
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="dc-tel">Téléphone (optionnel)</label>
              <input id="dc-tel" type="text" className="champ" value={demandeTelephone} onChange={(e) => setDemandeTelephone(e.target.value)} />
            </div>
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="dc-adresse">Adresse (optionnel)</label>
              <input id="dc-adresse" type="text" className="champ" value={demandeAdresse} onChange={(e) => setDemandeAdresse(e.target.value)} />
            </div>
            <div className="actions-modale">
              <button type="button" className="btn" onClick={() => setMoyenPaiement('especes')} disabled={enCours}>Annuler</button>
              <button type="submit" className="btn btn-principal" disabled={enCours}>
                {enCours ? 'Envoi…' : 'Envoyer la demande'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
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
        {!isOnline && (
          <p style={{ fontSize: 12, color: 'var(--brique, #b45309)', marginBottom: 4 }}>
            Hors-ligne — sera synchronisé au retour du réseau
          </p>
        )}
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
          {prevoirLivraison && fraisLivraisonNombre > 0 && (
            <div className="ticket-total-ligne">
              <span>Frais de livraison</span>
              <span className="chiffre">{Math.round(fraisLivraisonNombre).toLocaleString('fr-FR')}</span>
            </div>
          )}
          {montantReduction > 0 && (
            <div className="ticket-total-ligne">
              <span>{TYPES_REDUCTION.find((t) => t.value === typeReduction)?.label}</span>
              <span className="chiffre">- {Math.round(montantReduction).toLocaleString('fr-FR')}</span>
            </div>
          )}
          {estTiersPayant && clientAMutuelle ? (
            <>
              <div className="ticket-total-ligne">
                <span>Total facture</span>
                <span className="chiffre">{Math.round(totalAPayer).toLocaleString('fr-FR')} FCFA</span>
              </div>
              <div className="ticket-total-ligne">
                <span>Part {clientInfo?.insurer_name || 'assurance'} ({Number(clientInfo?.insurance_coverage_percent)}%)</span>
                <span className="chiffre">- {Math.round(montantCouvertAssurance).toLocaleString('fr-FR')} FCFA</span>
              </div>
              <div className="ticket-total-ligne ticket-total-ligne--principal">
                <span>Reste à charge client</span>
                <span className="chiffre">{Math.round(montantResteACharge).toLocaleString('fr-FR')} FCFA</span>
              </div>
            </>
          ) : (
            <div className="ticket-total-ligne ticket-total-ligne--principal">
              <span>Total à payer</span>
              <span className="chiffre">{Math.round(totalAPayer).toLocaleString('fr-FR')} FCFA</span>
            </div>
          )}
        </div>

        <div
          className="champ-groupe"
          style={{
            background: 'var(--fond)', border: '1px solid var(--trait)', borderRadius: 'var(--rayon-petit)',
            padding: '10px 14px', marginBottom: 12,
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: prevoirLivraison ? 10 : 0, cursor: 'pointer' }}>
            <input type="checkbox" checked={prevoirLivraison} onChange={(e) => setPrevoirLivraison(e.target.checked)} />
            Prévoir une livraison
          </label>
          {prevoirLivraison && (
            <div style={{ marginTop: 4 }}>
              <label className="etiquette" htmlFor="e-adresse-livraison">Adresse de livraison</label>
              <input
                id="e-adresse-livraison"
                type="text"
                className="champ"
                placeholder="Ex : Villa 42, Cité Keur Gorgui, Dakar"
                value={adresseLivraison}
                onChange={(e) => setAdresseLivraison(e.target.value)}
                required
                style={{ marginBottom: 10 }}
              />
              <label className="etiquette" htmlFor="e-frais-livraison">Frais de livraison (FCFA, optionnel)</label>
              <input
                id="e-frais-livraison"
                type="number"
                className="champ"
                placeholder="0"
                value={fraisLivraison}
                onChange={(e) => setFraisLivraison(e.target.value)}
              />
            </div>
          )}
        </div>

        {erreur && <div className="erreur">{erreur}</div>}
        <form onSubmit={handleEncaisser}>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="e-moyen">Moyen de paiement</label>
            <select id="e-moyen" className="champ" value={moyenPaiement} onChange={(e) => setMoyenPaiement(e.target.value)}>
              {MOYENS_PAIEMENT.filter((m) => m.value !== 'tiers_payant' || clientAMutuelle).map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}{m.value === 'a_credit' && estClientDePassage ? ' (client de passage → demande requise)' : ''}
                </option>
              ))}
            </select>
          </div>

          {estTiersPayant ? (
            <div
              style={{
                background: 'var(--fond)', border: '1px solid var(--trait)', borderRadius: 'var(--rayon-petit)',
                padding: '10px 14px', marginBottom: 12,
              }}
            >
              <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 10 }}>
                <strong>{clientInfo?.insurer_name}</strong> prend en charge {Number(clientInfo?.insurance_coverage_percent)}% :
                {' '}<strong className="chiffre">{Math.round(montantCouvertAssurance).toLocaleString('fr-FR')} FCFA</strong> à leur charge,
                {' '}<strong className="chiffre">{Math.round(montantResteACharge).toLocaleString('fr-FR')} FCFA</strong> à la charge du client.
              </p>

              {montantResteACharge > 0 ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 140px' }}>
                    <label className="etiquette" htmlFor="e-moyen-reste">Moyen de paiement du reste à charge</label>
                    <select
                      id="e-moyen-reste"
                      className="champ"
                      value={moyenResteACharge}
                      onChange={(e) => setMoyenResteACharge(e.target.value)}
                    >
                      {MOYENS_PAIEMENT.filter((m) => m.value !== 'a_credit' && m.value !== 'tiers_payant').map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: '1 1 140px' }}>
                    <label className="etiquette" htmlFor="e-recu-reste">Montant reçu (FCFA)</label>
                    <input
                      id="e-recu-reste"
                      type="number"
                      className="champ"
                      value={montantRecu}
                      onChange={(e) => setMontantRecu(e.target.value)}
                    />
                  </div>
                  <p style={{ fontSize: 13, width: '100%', margin: 0 }}>
                    Monnaie à rendre : <strong className="chiffre">{Math.round(monnaieARendre).toLocaleString('fr-FR')} FCFA</strong>
                  </p>
                </div>
              ) : (
                <p style={{ fontSize: 13, margin: 0 }}>Entièrement pris en charge — aucun encaissement requis.</p>
              )}
            </div>
          ) : estACredit ? (
            <div
              style={{
                background: 'var(--fond)', border: '1px solid var(--trait)', borderRadius: 'var(--rayon-petit)',
                padding: '10px 14px', marginBottom: 12,
              }}
            >
              <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: avanceActive ? 10 : 0 }}>
                Le montant total (<strong className="chiffre">{Math.round(totalAPayer).toLocaleString('fr-FR')} FCFA</strong>) sera
                ajouté à la créance de <strong>{commande.client_name}</strong>, à régler plus tard depuis sa fiche client.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginTop: 10, marginBottom: avanceActive ? 10 : 0, cursor: 'pointer' }}>
                <input type="checkbox" checked={avanceActive} onChange={(e) => setAvanceActive(e.target.checked)} />
                Le client verse une avance maintenant
              </label>
              {avanceActive && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 140px' }}>
                    <label className="etiquette" htmlFor="e-montant-avance">Montant de l'avance (FCFA)</label>
                    <input
                      id="e-montant-avance"
                      type="number"
                      min="0"
                      max={totalAPayer}
                      className="champ"
                      placeholder="Ex : 5000"
                      value={montantAvance}
                      onChange={(e) => setMontantAvance(e.target.value)}
                    />
                  </div>
                  <div style={{ flex: '1 1 140px' }}>
                    <label className="etiquette" htmlFor="e-moyen-avance">Moyen de paiement</label>
                    <select
                      id="e-moyen-avance"
                      className="champ"
                      value={moyenAvance}
                      onChange={(e) => setMoyenAvance(e.target.value)}
                    >
                      {MOYENS_PAIEMENT.filter((m) => m.value !== 'a_credit').map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  {Number(montantAvance) > 0 && (
                    <p style={{ fontSize: 13, width: '100%', margin: 0 }}>
                      Reste à payer après l'avance : <strong className="chiffre">{Math.round(Math.max(0, totalAPayer - Number(montantAvance))).toLocaleString('fr-FR')} FCFA</strong>
                    </p>
                  )}
                </div>
              )}
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

          {estManager && (
            <div
              className="champ-groupe"
              style={{
                background: 'var(--fond)', border: '1px solid var(--trait)', borderRadius: 'var(--rayon-petit)',
                padding: '10px 14px', marginBottom: 12,
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: reductionActive ? 10 : 0, cursor: 'pointer' }}>
                <input type="checkbox" checked={reductionActive} onChange={(e) => setReductionActive(e.target.checked)} />
                Réduction commerciale
              </label>
              {reductionActive && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 120px' }}>
                    <label className="etiquette" htmlFor="e-type-reduction">Type</label>
                    <select
                      id="e-type-reduction"
                      className="champ"
                      value={typeReduction}
                      onChange={(e) => setTypeReduction(e.target.value)}
                    >
                      {TYPES_REDUCTION.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: '1 1 100px' }}>
                    <label className="etiquette" htmlFor="e-mode-reduction">Mode</label>
                    <select
                      id="e-mode-reduction"
                      className="champ"
                      value={modeReduction}
                      onChange={(e) => setModeReduction(e.target.value)}
                    >
                      <option value="pourcentage">%</option>
                      <option value="montant">FCFA</option>
                    </select>
                  </div>
                  <div style={{ flex: '1 1 100px' }}>
                    <label className="etiquette" htmlFor="e-valeur-reduction">Valeur</label>
                    <input
                      id="e-valeur-reduction"
                      type="number"
                      min="0"
                      max={modeReduction === 'pourcentage' ? 100 : undefined}
                      className="champ"
                      placeholder={modeReduction === 'pourcentage' ? 'Ex : 10' : 'Ex : 2000'}
                      value={valeurReduction}
                      onChange={(e) => setValeurReduction(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {!estClientDePassage && (
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="e-format-recu">Reçu à imprimer</label>
              <select
                id="e-format-recu"
                className="champ"
                value={formatRecu}
                onChange={(e) => setFormatRecu(e.target.value)}
              >
                <option value="a4">Facture A4</option>
                <option value="ticket">Ticket de caisse</option>
              </select>
            </div>
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
