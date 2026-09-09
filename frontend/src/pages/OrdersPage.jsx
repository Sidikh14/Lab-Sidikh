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

function IconPanier() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6" />
    </svg>
  );
}

function IconRecherche() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function OrdersPage() {
  const { user } = useAuth();
  const peutCreer = PEUT_CREER.includes(user.role);
  const peutEncaisser = PEUT_ENCAISSER.includes(user.role);
  const peutGererStatut = PEUT_GERER_STATUT.includes(user.role);

  const [onglet, setOnglet] = useState(peutCreer ? 'caisse' : 'historique');
  const [orders, setOrders] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  // Caisse
  const [rechercheCaisse, setRechercheCaisse] = useState('');
  const [panier, setPanier] = useState([]); // [{ productId, quantity }]
  const [clientId, setClientId] = useState('');
  const [tvaApplicable, setTvaApplicable] = useState(false);
  const [venteEnCours, setVenteEnCours] = useState(false);

  // Encaissement
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

  const produitsCaisse = useMemo(
    () => products.filter((p) => p.name.toLowerCase().includes(rechercheCaisse.toLowerCase())),
    [products, rechercheCaisse]
  );

  function ajouterAuPanier(produit) {
    if (produit.quantity_in_stock <= 0) return;
    setPanier((prev) => {
      const existant = prev.find((l) => l.productId === produit.id);
      if (existant) {
        if (existant.quantity >= produit.quantity_in_stock) return prev;
        return prev.map((l) => (l.productId === produit.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { productId: produit.id, quantity: 1 }];
    });
  }

  function changerQuantite(productId, delta) {
    setPanier((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  function retirerDuPanier(productId) {
    setPanier((prev) => prev.filter((l) => l.productId !== productId));
  }

  const lignesPanier = panier
    .map((l) => ({ ...l, produit: products.find((p) => p.id === l.productId) }))
    .filter((l) => l.produit);

  const apercuCaisse = useMemo(() => {
    const sousTotal = lignesPanier.reduce((sum, l) => sum + Number(l.produit.unit_price) * l.quantity, 0);
    const tva = tvaApplicable ? Math.round(sousTotal * 18) / 100 : 0;
    return { sousTotal, tva, total: sousTotal + tva };
  }, [lignesPanier, tvaApplicable]);

  async function handlePayer() {
    if (lignesPanier.length === 0) return;
    setVenteEnCours(true);
    setErreur('');
    try {
      const commande = await api.createOrder({
        clientId: clientId || null,
        items: panier.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        tvaApplicable,
      });
      setPanier([]);
      setClientId('');
      setTvaApplicable(false);
      charger();
      if (peutEncaisser) {
        ouvrirEncaissement(commande);
      }
    } catch (err) {
      setErreur(err.message);
    } finally {
      setVenteEnCours(false);
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
        <h1>Ventes & caisse</h1>
      </div>

      <div className="onglets">
        {peutCreer && (
          <button className={onglet === 'caisse' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('caisse')}>
            Caisse
          </button>
        )}
        <button className={onglet === 'historique' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('historique')}>
          Historique
        </button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {onglet === 'caisse' && peutCreer && (
        <div className="mise-en-page-caisse">
          <div className="caisse-produits">
            <div className="champ-avec-icone" style={{ marginBottom: 16 }}>
              <span className="champ-icone"><IconRecherche /></span>
              <input
                type="text"
                className="champ champ--avec-icone"
                placeholder="Rechercher ou scanner un produit…"
                value={rechercheCaisse}
                onChange={(e) => setRechercheCaisse(e.target.value)}
              />
            </div>
            <div className="grille-caisse">
              {produitsCaisse.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="carte-caisse"
                  disabled={p.quantity_in_stock <= 0}
                  onClick={() => ajouterAuPanier(p)}
                >
                  <span className="carte-produit-icone"><IconPanier /></span>
                  <span className="carte-caisse-nom">{p.name}</span>
                  <span className="carte-caisse-prix">{Number(p.unit_price).toLocaleString('fr-FR')}</span>
                  {p.quantity_in_stock <= 0 ? (
                    <span className="tampon tampon-brique" style={{ marginTop: 4 }}>Rupture</span>
                  ) : (
                    <span className="carte-caisse-stock">{p.quantity_in_stock} en stock</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="caisse-ticket">
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="c-client">Client</label>
              <select id="c-client" className="champ" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Client de passage</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>

            <div className="ticket-lignes">
              {lignesPanier.length === 0 ? (
                <p className="etat-vide" style={{ padding: '32px 8px' }}>
                  Ticket vide. Touchez un produit pour l'ajouter.
                </p>
              ) : (
                lignesPanier.map((l) => (
                  <div key={l.productId} className="ticket-ligne">
                    <div style={{ minWidth: 0 }}>
                      <p className="ticket-ligne-nom">{l.produit.name}</p>
                      <p className="ticket-ligne-prix">{Number(l.produit.unit_price).toLocaleString('fr-FR')} FCFA</p>
                    </div>
                    <div className="ticket-ligne-qte">
                      <button type="button" onClick={() => changerQuantite(l.productId, -1)}>−</button>
                      <span>{l.quantity}</span>
                      <button type="button" onClick={() => changerQuantite(l.productId, 1)}>+</button>
                    </div>
                    <button type="button" className="ticket-ligne-retirer" onClick={() => retirerDuPanier(l.productId)}>×</button>
                  </div>
                ))
              )}
            </div>

            <label className="case-a-cocher" style={{ margin: '12px 0' }}>
              <input type="checkbox" checked={tvaApplicable} onChange={(e) => setTvaApplicable(e.target.checked)} />
              Vente avec TVA (18 %)
            </label>

            <div className="ticket-totaux">
              <div className="ticket-total-ligne">
                <span>Sous-total</span>
                <span className="chiffre">{apercuCaisse.sousTotal.toLocaleString('fr-FR')}</span>
              </div>
              {tvaApplicable && (
                <div className="ticket-total-ligne">
                  <span>TVA (18 %)</span>
                  <span className="chiffre">{apercuCaisse.tva.toLocaleString('fr-FR')}</span>
                </div>
              )}
              <div className="ticket-total-ligne ticket-total-ligne--principal">
                <span>Total à payer</span>
                <span className="chiffre">{apercuCaisse.total.toLocaleString('fr-FR')} FCFA</span>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-principal"
              style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
              disabled={lignesPanier.length === 0 || venteEnCours}
              onClick={handlePayer}
            >
              {venteEnCours ? 'Enregistrement…' : `Payer · ${apercuCaisse.total.toLocaleString('fr-FR')} FCFA`}
            </button>
          </div>
        </div>
      )}

      {onglet === 'historique' && (
        <>
          <div className="barre-outils">
            <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{orders.length} vente(s)</span>
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
                        {peutGererStatut && o.status === 'validee' && o.client_name && (
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
        </>
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
                <button type="button" className="btn" onClick={() => setCommandeAEncaisser(null)}>Plus tard</button>
                <button type="submit" className="btn btn-principal">Confirmer l'encaissement</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
