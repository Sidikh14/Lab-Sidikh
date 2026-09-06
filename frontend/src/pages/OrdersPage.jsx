import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';

const PEUT_CREER = ['manager', 'gerant', 'vendeur'];
const PEUT_ENCAISSER = ['manager', 'caissier'];
const PEUT_GERER_STATUT = ['manager', 'gerant', 'caissier'];

const MOYENS_PAIEMENT = [
  { value: 'especes', label: 'Espèces' },
  { value: 'wave', label: 'Wave' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'virement', label: 'Virement' },
];

export function OrdersPage() {
  const { user } = useAuth();
  const peutCreer = PEUT_CREER.includes(user.role);
  const peutEncaisser = PEUT_ENCAISSER.includes(user.role);
  const peutGererStatut = PEUT_GERER_STATUT.includes(user.role);

  const [orders, setOrders] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const [modaleVenteOuverte, setModaleVenteOuverte] = useState(false);
  const [clientId, setClientId] = useState('');
  const [tvaApplicable, setTvaApplicable] = useState(false);
  const [lignes, setLignes] = useState([{ productId: '', quantity: 1 }]);

  const [commandeAEncaisser, setCommandeAEncaisser] = useState(null);
  const [moyenPaiement, setMoyenPaiement] = useState('especes');
  const [montantRecu, setMontantRecu] = useState('');

  function charger() {
    setChargement(true);
    Promise.all([api.getOrders(), api.getClients(), api.getProducts()])
      .then(([o, c, p]) => {
        setOrders(o);
        setClients(c);
        setProducts(p);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  function ajouterLigne() {
    setLignes([...lignes, { productId: '', quantity: 1 }]);
  }

  function modifierLigne(index, champ, valeur) {
    const copie = [...lignes];
    copie[index] = { ...copie[index], [champ]: valeur };
    setLignes(copie);
  }

  function retirerLigne(index) {
    setLignes(lignes.filter((_, i) => i !== index));
  }

  const apercu = useMemo(() => {
    const sousTotal = lignes.reduce((sum, l) => {
      const produit = products.find((p) => p.id === l.productId);
      if (!produit || !Number(l.quantity)) return sum;
      return sum + Number(produit.unit_price) * Number(l.quantity);
    }, 0);
    const tva = tvaApplicable ? Math.round(sousTotal * 18) / 100 : 0;
    return { sousTotal, tva, total: sousTotal + tva };
  }, [lignes, products, tvaApplicable]);

  async function handleCreate(e) {
    e.preventDefault();
    const items = lignes
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantity) }));

    if (items.length === 0) {
      setErreur('Ajoutez au moins un produit à la commande.');
      return;
    }

    try {
      await api.createOrder({ clientId: clientId || null, items, tvaApplicable });
      setModaleVenteOuverte(false);
      setClientId('');
      setTvaApplicable(false);
      setLignes([{ productId: '', quantity: 1 }]);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  function ouvrirEncaissement(order) {
    setCommandeAEncaisser(order);
    setMoyenPaiement('especes');
    setMontantRecu(String(order.total_amount));
  }

  const monnaieARendre = commandeAEncaisser
    ? Math.max(0, Number(montantRecu || 0) - Number(commandeAEncaisser.total_amount))
    : 0;

  async function handleEncaisser(e) {
    e.preventDefault();
    if (Number(montantRecu) < Number(commandeAEncaisser.total_amount)) {
      setErreur('Le montant reçu est inférieur au total à payer.');
      return;
    }
    try {
      await api.recordOrderPayment(commandeAEncaisser.id, {
        paymentMethod: moyenPaiement,
        amountReceived: Number(montantRecu),
      });
      setCommandeAEncaisser(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleStatut(order, status) {
    try {
      await api.updateOrderStatus(order.id, status);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <>
      <div className="entete-page">
        <h1>Ventes</h1>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-outils">
        <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{orders.length} vente(s)</span>
        {peutCreer && (
          <button className="btn btn-principal" onClick={() => setModaleVenteOuverte(true)}>
            Nouvelle vente
          </button>
        )}
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : orders.length === 0 ? (
        <p className="etat-vide">Aucune vente enregistrée pour le moment.</p>
      ) : (
        <table className="registre">
          <thead>
            <tr>
              <th>N° commande</th>
              <th>Client</th>
              <th>Montant</th>
              <th>Statut</th>
              {(peutEncaisser || peutGererStatut) && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="chiffre">{o.order_number}</td>
                <td>{o.client_name || 'Client de passage'}</td>
                <td className="chiffre">{Number(o.total_amount).toLocaleString('fr-FR')} FCFA</td>
                <td><StatusBadge status={o.status} /></td>
                {(peutEncaisser || peutGererStatut) && (
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {peutEncaisser && o.status === 'en_attente' && (
                      <button className="btn btn-principal" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => ouvrirEncaissement(o)}>
                        Encaisser
                      </button>
                    )}
                    {peutGererStatut && o.status === 'validee' && (
                      <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => handleStatut(o, 'livree')}>
                        Marquer livrée
                      </button>
                    )}
                    {peutGererStatut && ['en_attente', 'validee'].includes(o.status) && (
                      <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => handleStatut(o, 'annulee')}>
                        Annuler
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modaleVenteOuverte && (
        <div className="modale-fond" onClick={() => setModaleVenteOuverte(false)}>
          <div className="modale" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle vente</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="o-client">Client (facultatif)</label>
                <select id="o-client" className="champ" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Client de passage</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name}</option>
                  ))}
                </select>
              </div>

              <label className="etiquette">Articles</label>
              {lignes.map((ligne, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select className="champ" value={ligne.productId} onChange={(e) => modifierLigne(index, 'productId', e.target.value)}>
                    <option value="">Choisir un produit</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    className="champ"
                    style={{ width: 80 }}
                    value={ligne.quantity}
                    onChange={(e) => modifierLigne(index, 'quantity', e.target.value)}
                  />
                  {lignes.length > 1 && (
                    <button type="button" className="btn" onClick={() => retirerLigne(index)}>×</button>
                  )}
                </div>
              ))}
              <button type="button" className="btn" onClick={ajouterLigne} style={{ marginBottom: 16 }}>
                Ajouter un article
              </button>

              <label className="case-a-cocher" style={{ marginBottom: 16 }}>
                <input type="checkbox" checked={tvaApplicable} onChange={(e) => setTvaApplicable(e.target.checked)} />
                Appliquer la TVA (18 %)
              </label>

              <div style={{ background: 'var(--fond)', border: '1px solid var(--trait)', borderRadius: 'var(--rayon-petit)', padding: '10px 14px', marginBottom: 16, fontSize: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--encre-douce)' }}>Sous-total</span>
                  <span className="chiffre">{apercu.sousTotal.toLocaleString('fr-FR')} FCFA</span>
                </div>
                {tvaApplicable && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--encre-douce)' }}>TVA (18 %)</span>
                    <span className="chiffre">{apercu.tva.toLocaleString('fr-FR')} FCFA</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                  <span>Total</span>
                  <span className="chiffre">{apercu.total.toLocaleString('fr-FR')} FCFA</span>
                </div>
              </div>

              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setModaleVenteOuverte(false)}>Annuler</button>
                <button type="submit" className="btn btn-principal">Enregistrer la vente</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {commandeAEncaisser && (
        <div className="modale-fond" onClick={() => setCommandeAEncaisser(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Encaisser {commandeAEncaisser.order_number}</h2>
            <p style={{ fontSize: 14, color: 'var(--encre-douce)', marginBottom: 16 }}>
              Total à payer : <strong className="chiffre" style={{ color: 'var(--encre)' }}>
                {Number(commandeAEncaisser.total_amount).toLocaleString('fr-FR')} FCFA
              </strong>
            </p>
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
                Monnaie à rendre : <strong className="chiffre">{monnaieARendre.toLocaleString('fr-FR')} FCFA</strong>
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setCommandeAEncaisser(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal">Confirmer l'encaissement</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}