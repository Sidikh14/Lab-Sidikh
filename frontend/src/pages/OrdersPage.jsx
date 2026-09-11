import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { ModaleEncaissement } from '../components/ModaleEncaissement';

const PEUT_CREER = ['manager', 'gerant', 'vendeur'];
const PEUT_ENCAISSER = ['manager', 'caissier'];
const PEUT_GERER_STATUT = ['manager', 'gerant', 'caissier'];

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

function IconCoche() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12.5l2.5 2.5L16 9" />
    </svg>
  );
}

function optionsDeVente(produit) {
  const detail = { unitId: null, label: 'Détail', price: Number(produit.unit_price), quantityPerUnit: 1 };
  const gros = (produit.units || []).map((u) => ({
    unitId: u.id,
    label: u.label,
    price: Number(u.price),
    quantityPerUnit: u.quantity_per_unit,
  }));
  return [detail, ...gros];
}

function cleLigne(productId, unitId) {
  return `${productId}::${unitId || 'detail'}`;
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

  const [rechercheCaisse, setRechercheCaisse] = useState('');
  const [panier, setPanier] = useState([]);
  const [clientId, setClientId] = useState('');
  const [tvaApplicable, setTvaApplicable] = useState(false);
  const [venteEnCours, setVenteEnCours] = useState(false);
  const [confirmationVente, setConfirmationVente] = useState(null);
  const [choixConditionnement, setChoixConditionnement] = useState(null);

  const [commandeAEncaisser, setCommandeAEncaisser] = useState(null);

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

  function demarrerAjout(produit) {
    const options = optionsDeVente(produit);
    if (options.length === 1) {
      ajouterAuPanier(produit, options[0]);
    } else {
      setChoixConditionnement(produit);
    }
  }

  function ajouterAuPanier(produit, option) {
    const baseParUnite = option.quantityPerUnit;
    const stockDisponibleEnOptions = Math.floor(produit.quantity_in_stock / baseParUnite);
    if (stockDisponibleEnOptions <= 0) return;

    setPanier((prev) => {
      const cle = cleLigne(produit.id, option.unitId);
      const existant = prev.find((l) => cleLigne(l.productId, l.unitId) === cle);
      if (existant) {
        if (existant.quantity >= stockDisponibleEnOptions) return prev;
        return prev.map((l) => (cleLigne(l.productId, l.unitId) === cle ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { productId: produit.id, unitId: option.unitId, quantity: 1 }];
    });
    setChoixConditionnement(null);
  }

  function changerQuantite(productId, unitId, delta) {
    setPanier((prev) =>
      prev
        .map((l) => (l.productId === productId && l.unitId === unitId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  function retirerDuPanier(productId, unitId) {
    setPanier((prev) => prev.filter((l) => !(l.productId === productId && l.unitId === unitId)));
  }

  const lignesPanier = panier
    .map((l) => {
      const produit = products.find((p) => p.id === l.productId);
      if (!produit) return null;
      const option = optionsDeVente(produit).find((o) => o.unitId === l.unitId);
      if (!option) return null;
      return { ...l, produit, option };
    })
    .filter(Boolean);

  const apercuCaisse = useMemo(() => {
    const sousTotal = lignesPanier.reduce((sum, l) => sum + l.option.price * l.quantity, 0);
    const tva = tvaApplicable ? Math.round(sousTotal * 0.18) : 0;
    return { sousTotal, tva, total: sousTotal + tva };
  }, [lignesPanier, tvaApplicable]);

  async function handlePayer() {
    if (lignesPanier.length === 0) return;
    setVenteEnCours(true);
    setErreur('');
    try {
      const commande = await api.createOrder({
        clientId: clientId || null,
        items: panier.map((l) => ({ productId: l.productId, quantity: l.quantity, unitId: l.unitId || undefined })),
        tvaApplicable,
      });
      setPanier([]);
      setClientId('');
      setTvaApplicable(false);
      charger();
      if (peutEncaisser) {
        setCommandeAEncaisser(commande);
      } else {
        setConfirmationVente(commande);
      }
    } catch (err) {
      setErreur(err.message);
    } finally {
      setVenteEnCours(false);
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

  const ordersTries = peutEncaisser
    ? [...orders].sort((a, b) => {
        if (a.status === 'en_attente' && b.status !== 'en_attente') return -1;
        if (b.status === 'en_attente' && a.status !== 'en_attente') return 1;
        return new Date(b.created_at) - new Date(a.created_at);
      })
    : orders;

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
                  onClick={() => demarrerAjout(p)}
                >
                  <span className="carte-produit-icone"><IconPanier /></span>
                  <span className="carte-caisse-nom">{p.name}</span>
                  <span className="carte-caisse-prix">{Math.round(p.unit_price).toLocaleString('fr-FR')}</span>
                  {p.quantity_in_stock <= 0 ? (
                    <span className="tampon tampon-brique" style={{ marginTop: 4 }}>Rupture</span>
                  ) : (
                    <span className="carte-caisse-stock">
                      {p.quantity_in_stock} en stock{p.units?.length > 0 ? ' · gros dispo' : ''}
                    </span>
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
                <p className="etat-vide" style={{ padding: '32px 8px' }}>Ticket vide. Touchez un produit pour l'ajouter.</p>
              ) : (
                lignesPanier.map((l) => (
                  <div key={cleLigne(l.productId, l.unitId)} className="ticket-ligne">
                    <div style={{ minWidth: 0 }}>
                      <p className="ticket-ligne-nom">
                        {l.produit.name}
                        {l.option.label !== 'Détail' && <span style={{ color: 'var(--accent)' }}> · {l.option.label}</span>}
                      </p>
                      <p className="ticket-ligne-prix">{Math.round(l.option.price).toLocaleString('fr-FR')} FCFA</p>
                    </div>
                    <div className="ticket-ligne-qte">
                      <button type="button" onClick={() => changerQuantite(l.productId, l.unitId, -1)}>−</button>
                      <span>{l.quantity}</span>
                      <button type="button" onClick={() => changerQuantite(l.productId, l.unitId, 1)}>+</button>
                    </div>
                    <button type="button" className="ticket-ligne-retirer" onClick={() => retirerDuPanier(l.productId, l.unitId)}>×</button>
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
                <span className="chiffre">{Math.round(apercuCaisse.sousTotal).toLocaleString('fr-FR')}</span>
              </div>
              {tvaApplicable && (
                <div className="ticket-total-ligne">
                  <span>TVA (18 %)</span>
                  <span className="chiffre">{Math.round(apercuCaisse.tva).toLocaleString('fr-FR')}</span>
                </div>
              )}
              <div className="ticket-total-ligne ticket-total-ligne--principal">
                <span>Total à payer</span>
                <span className="chiffre">{Math.round(apercuCaisse.total).toLocaleString('fr-FR')} FCFA</span>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-principal"
              style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
              disabled={lignesPanier.length === 0 || venteEnCours}
              onClick={handlePayer}
            >
              {venteEnCours ? 'Enregistrement…' : `Payer · ${Math.round(apercuCaisse.total).toLocaleString('fr-FR')} FCFA`}
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
                {ordersTries.map((o) => (
                  <tr key={o.id} className={o.status === 'en_attente' && peutEncaisser ? 'ligne-prioritaire' : ''}>
                    <td className="chiffre">{o.order_number}</td>
                    <td>{o.client_name || 'Client de passage'}</td>
                    <td className="chiffre">{Math.round(o.total_amount).toLocaleString('fr-FR')} FCFA</td>
                    <td><StatusBadge status={o.status} /></td>
                    {(peutEncaisser || peutGererStatut) && (
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {peutEncaisser && o.status === 'en_attente' && (
                          <button className="btn btn-principal" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => setCommandeAEncaisser(o)}>
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

      {choixConditionnement && (
        <div className="modale-fond" onClick={() => setChoixConditionnement(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>{choixConditionnement.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>Choisissez le conditionnement à vendre</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {optionsDeVente(choixConditionnement).map((option) => (
                <button
                  key={option.unitId || 'detail'}
                  type="button"
                  className="btn"
                  style={{ justifyContent: 'space-between', padding: '12px 16px' }}
                  onClick={() => ajouterAuPanier(choixConditionnement, option)}
                >
                  <span>{option.label}{option.quantityPerUnit > 1 ? ` (${option.quantityPerUnit} unités)` : ''}</span>
                  <span className="chiffre">{Math.round(option.price).toLocaleString('fr-FR')} FCFA</span>
                </button>
              ))}
            </div>
            <div className="actions-modale">
              <button className="btn" onClick={() => setChoixConditionnement(null)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {commandeAEncaisser && (
        <ModaleEncaissement
          commande={commandeAEncaisser}
          onClose={() => setCommandeAEncaisser(null)}
          onSuccess={() => {
            setCommandeAEncaisser(null);
            charger();
          }}
        />
      )}

      {confirmationVente && (
        <div className="modale-fond" onClick={() => setConfirmationVente(null)}>
          <div className="modale" style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ color: 'var(--vif)', margin: '0 auto 12px', width: 'fit-content' }}>
              <IconCoche />
            </div>
            <h2 style={{ marginBottom: 6 }}>Vente enregistrée</h2>
            <p style={{ color: 'var(--encre-douce)', fontSize: 14, marginBottom: 16 }}>
              Elle a été envoyée à la caisse pour encaissement.
            </p>
            <div style={{ background: 'var(--fond)', border: '1px solid var(--trait)', borderRadius: 'var(--rayon-petit)', padding: '14px', marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--encre-douce)', margin: '0 0 4px' }}>Numéro à donner au client</p>
              <p className="chiffre" style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{confirmationVente.order_number}</p>
              <p style={{ fontSize: 13, color: 'var(--encre-douce)', margin: '4px 0 0' }}>
                Total : {Math.round(confirmationVente.total_amount).toLocaleString('fr-FR')} FCFA
              </p>
            </div>
            <button className="btn btn-principal" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setConfirmationVente(null)}>
              Compris
            </button>
          </div>
        </div>
      )}
    </>
  );
}
