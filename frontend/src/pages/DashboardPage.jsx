import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { ActiviteListe, initiales, couleurPour } from '../components/ActiviteListe';
import { ModaleEncaissement } from '../components/ModaleEncaissement';

function IconValeur() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="7" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconAlerte() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  );
}

function IconVentes() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
    </svg>
  );
}

function IconHorloge() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

function IconCamion() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="1" y="7" width="13" height="10" rx="1" />
      <path d="M14 10h4l3 3v4h-7z" />
      <circle cx="5.5" cy="19" r="1.6" />
      <circle cx="17.5" cy="19" r="1.6" />
    </svg>
  );
}

function IconCaisse() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 11h20M7 15h4" />
    </svg>
  );
}

function dateAujourdHui() {
  return new Date().toISOString().slice(0, 10);
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const vueEquipe = ['manager', 'gerant'].includes(user.role);
  const estCaissier = user.role === 'caissier';
  const estVendeur = user.role === 'vendeur';

  const [onglet, setOnglet] = useState('pilotage');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const [dateDebut, setDateDebut] = useState(dateAujourdHui());
  const [dateFin, setDateFin] = useState(dateAujourdHui());
  const [activite, setActivite] = useState([]);
  const [chargementActivite, setChargementActivite] = useState(true);
  const [activiteAujourdhui, setActiviteAujourdhui] = useState([]);

  const [commandeDetail, setCommandeDetail] = useState(null);
  const [chargementDetail, setChargementDetail] = useState(false);
  const [commandeAEncaisser, setCommandeAEncaisser] = useState(null);

  function charger() {
    setChargement(true);
    Promise.all([api.getProducts(), api.getOrders(), api.getActivityToday()])
      .then(([p, o, a]) => {
        setProducts(p);
        setOrders(o);
        setActiviteAujourdhui(a);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  function chargerActivite() {
    setChargementActivite(true);
    api.getActivityRange(dateDebut, dateFin).then(setActivite).catch((err) => setErreur(err.message)).finally(() => setChargementActivite(false));
  }

  useEffect(() => {
    if (onglet === 'activite') chargerActivite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet]);

  async function ouvrirDetailCommande(id) {
    setChargementDetail(true);
    try {
      const detail = await api.getOrder(id);
      setCommandeDetail(detail);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargementDetail(false);
    }
  }

  // Le widget "Ventes à encaisser" ne contient que les champs résumés de
  // GET /orders (pas les articles) : on va chercher la commande complète
  // avant d'ouvrir la modale, sinon le caissier voit une facture vide.
  async function ouvrirEncaissementDepuisDashboard(order) {
    setChargementDetail(true);
    setErreur('');
    try {
      const detail = await api.getOrder(order.id);
      setCommandeAEncaisser(detail);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargementDetail(false);
    }
  }

  async function annulerCommandeRenvoyee(order) {
    try {
      await api.updateOrderStatus(order.id, 'annulee');
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const enRupture = products.filter((p) => p.status === 'rupture');
  const enFaible = products.filter((p) => p.status === 'faible');
  const commandesEnAttente = [...orders]
    .filter((o) => o.status === 'en_attente')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const commandesRenvoyees = [...orders]
    .filter((o) => o.status === 'renvoyee_vendeur')
    .sort((a, b) => new Date(b.returned_at || b.created_at) - new Date(a.returned_at || a.created_at));
  const aLivrer = orders.filter((o) => o.status === 'validee');
  const valeurStock = products.reduce((sum, p) => sum + Number(p.unit_price) * Number(p.quantity_in_stock), 0);
  const aujourdHui = new Date().toDateString();
  const ventesDuJour = orders
    .filter((o) => new Date(o.created_at).toDateString() === aujourdHui)
    .reduce((sum, o) => sum + Number(o.total_amount), 0);

  const encaissementsAujourdhui = activiteAujourdhui.filter((a) => a.type === 'encaissement');
  const totalEncaisseAujourdhui = encaissementsAujourdhui.reduce((sum, a) => sum + Number(a.montant), 0);

  const mesVentesAujourdhui = activiteAujourdhui.filter((a) => a.type === 'vente');
  const totalMesVentesAujourdhui = mesVentesAujourdhui.reduce((sum, a) => sum + Number(a.montant), 0);

  const resumeParVendeur = {};
  activite
    .filter((a) => a.type === 'vente')
    .forEach((a) => {
      const nom = a.user_name || 'Inconnu';
      if (!resumeParVendeur[nom]) resumeParVendeur[nom] = { count: 0, total: 0 };
      resumeParVendeur[nom].count += 1;
      resumeParVendeur[nom].total += Number(a.montant);
    });

  return (
    <>
      <div className="entete-page">
        <h1>Pilotage</h1>
      </div>

      <div className="onglets">
        <button className={onglet === 'pilotage' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('pilotage')}>
          Tableau de bord
        </button>
        <button className={onglet === 'activite' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('activite')}>
          Journal d'activité
        </button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {onglet === 'pilotage' && (
        chargement ? (
          <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
        ) : estCaissier ? (
          <>
            <div className="ligne-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <div className="stat">
                <span className="stat-icone" style={commandesEnAttente.length > 0 ? { background: 'var(--accent-clair)', color: 'var(--accent)' } : undefined}><IconCaisse /></span>
                <span className="etiquette">À encaisser</span>
                <span className="valeur">{commandesEnAttente.length}</span>
              </div>
              <div className="stat">
                <span className="stat-icone"><IconVentes /></span>
                <span className="etiquette">Encaissé aujourd'hui</span>
                <span className="valeur">{Math.round(totalEncaisseAujourdhui).toLocaleString('fr-FR')} FCFA</span>
              </div>
            </div>

            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Ventes à encaisser</h2>
            {commandesEnAttente.length === 0 ? (
              <p className="etat-vide" style={{ marginBottom: 24 }}>Aucune vente en attente d'encaissement pour le moment.</p>
            ) : (
              <div className="liste-a-encaisser">
                {commandesEnAttente.map((o) => (
                  <div key={o.id} className="carte-a-encaisser">
                    <div style={{ minWidth: 0 }}>
                      <p className="carte-a-encaisser-numero">{o.order_number}</p>
                      <p className="carte-a-encaisser-client">{o.client_name || 'Client de passage'}</p>
                    </div>
                    <p className="carte-a-encaisser-montant">{Math.round(o.total_amount).toLocaleString('fr-FR')} FCFA</p>
                    <button className="btn btn-principal" disabled={chargementDetail} onClick={() => ouvrirEncaissementDepuisDashboard(o)}>Encaisser</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 24 }}>
              <ActiviteListe activite={activiteAujourdhui.slice(0, 8)} titre="Mon activité aujourd'hui" />
            </div>
          </>
        ) : estVendeur ? (
          <>
            <div className="ligne-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <div className="stat">
                <span className="stat-icone"><IconVentes /></span>
                <span className="etiquette">Mes ventes aujourd'hui</span>
                <span className="valeur">{mesVentesAujourdhui.length}</span>
              </div>
              <div className="stat">
                <span className="stat-icone" style={commandesRenvoyees.length > 0 ? { background: 'var(--danger-clair)', color: 'var(--danger)' } : undefined}><IconAlerte /></span>
                <span className="etiquette">Factures renvoyées</span>
                <span className="valeur">{commandesRenvoyees.length}</span>
              </div>
              <div className="stat">
                <span className="stat-icone"><IconValeur /></span>
                <span className="etiquette">Total réalisé aujourd'hui</span>
                <span className="valeur">{Math.round(totalMesVentesAujourdhui).toLocaleString('fr-FR')} FCFA</span>
              </div>
            </div>

            {commandesRenvoyees.length > 0 && (
              <>
                <h2 style={{ fontSize: 16, marginBottom: 12 }}>Factures renvoyées par la caisse</h2>
                <div className="liste-a-encaisser" style={{ marginBottom: 24 }}>
                  {commandesRenvoyees.map((o) => (
                    <div key={o.id} className="carte-a-encaisser">
                      <div style={{ minWidth: 0 }}>
                        <p className="carte-a-encaisser-numero">{o.order_number}</p>
                        <p className="carte-a-encaisser-client">
                          {o.client_name || 'Client de passage'}
                          {o.returned_reason && <span style={{ color: 'var(--danger)' }}> · {o.returned_reason}</span>}
                        </p>
                      </div>
                      <p className="carte-a-encaisser-montant">{Math.round(o.total_amount).toLocaleString('fr-FR')} FCFA</p>
                      <button className="btn btn-principal" onClick={() => navigate(`/ventes?modifier=${o.id}`)}>Modifier</button>
                      <button className="btn btn-brique" onClick={() => annulerCommandeRenvoyee(o)}>Annuler</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <button className="btn btn-principal" style={{ marginBottom: 24 }} onClick={() => navigate('/ventes')}>
              + Nouvelle vente
            </button>

            <ActiviteListe activite={activiteAujourdhui.slice(0, 10)} titre="Mon activité aujourd'hui" />
          </>
        ) : (
          <>
            <div className="ligne-stats">
              <div className="stat">
                <span className="stat-icone"><IconValeur /></span>
                <span className="etiquette">Valeur du stock</span>
                <span className="valeur">{Math.round(valeurStock).toLocaleString('fr-FR')} FCFA</span>
              </div>
              <div className="stat">
                <span className="stat-icone" style={enRupture.length + enFaible.length > 0 ? { background: 'var(--danger-clair)', color: 'var(--danger)' } : undefined}><IconAlerte /></span>
                <span className="etiquette">Alertes de seuil</span>
                <span className="valeur">{enRupture.length + enFaible.length}</span>
              </div>
              <div className="stat">
                <span className="stat-icone"><IconVentes /></span>
                <span className="etiquette">Ventes du jour</span>
                <span className="valeur">{Math.round(ventesDuJour).toLocaleString('fr-FR')} FCFA</span>
              </div>
              <div className="stat">
                <span className="stat-icone"><IconHorloge /></span>
                <span className="etiquette">En attente</span>
                <span className="valeur">{commandesEnAttente.length}</span>
              </div>
              <div className="stat">
                <span className="stat-icone"><IconCamion /></span>
                <span className="etiquette">À livrer</span>
                <span className="valeur">{aLivrer.length}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {(enRupture.length > 0 || enFaible.length > 0) && (
                <div style={{ flex: 1, minWidth: 280 }}>
                  <h2 style={{ fontSize: 16, marginBottom: 12 }}>Alertes de seuil</h2>
                  <table className="registre">
                    <thead>
                      <tr>
                        <th>Produit</th>
                        <th>Quantité</th>
                        <th>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...enRupture, ...enFaible].map((p) => (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td className="chiffre">{p.quantity_in_stock}</td>
                          <td><StatusBadge status={p.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {aLivrer.length > 0 && (
                <div style={{ flex: 1, minWidth: 280 }}>
                  <h2 style={{ fontSize: 16, marginBottom: 12 }}>Commandes à livrer</h2>
                  <table className="registre">
                    <thead>
                      <tr>
                        <th>N° commande</th>
                        <th>Client</th>
                        <th>Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aLivrer.slice(0, 8).map((o) => (
                        <tr key={o.id} className="ligne-cliquable" onClick={() => ouvrirDetailCommande(o.id)}>
                          <td className="chiffre">{o.order_number}</td>
                          <td>{o.client_name || 'Client de passage'}</td>
                          <td className="chiffre">{Math.round(o.total_amount).toLocaleString('fr-FR')} FCFA</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ marginTop: 24 }}>
              <ActiviteListe activite={activiteAujourdhui.slice(0, 8)} titre="Activité récente" />
            </div>
          </>
        )
      )}

      {onglet === 'activite' && (
        <>
          <div className="barre-filtres">
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="date-debut">Du</label>
              <input id="date-debut" type="date" className="champ" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
            </div>
            <div className="champ-groupe" style={{ marginBottom: 0 }}>
              <label className="etiquette" htmlFor="date-fin">Au</label>
              <input id="date-fin" type="date" className="champ" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
            </div>
            <button className="btn btn-principal" style={{ alignSelf: 'flex-end' }} onClick={chargerActivite}>
              Afficher
            </button>
            <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => api.downloadActivityPdf(dateDebut, dateFin).catch((err) => setErreur(err.message))}>
              Exporter PDF
            </button>
          </div>

          {chargementActivite ? (
            <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
          ) : (
            <>
              {vueEquipe && Object.keys(resumeParVendeur).length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h2 style={{ fontSize: 16, marginBottom: 12 }}>Ventes par membre de l'équipe, sur cette période</h2>
                  <div className="grille-resume-equipe">
                    {Object.entries(resumeParVendeur)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([nom, r]) => (
                        <div key={nom} className="carte-resume-membre">
                          <span className="avatar avatar-couleur" style={{ background: couleurPour(nom) }}>
                            {initiales(nom)}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <p className="carte-resume-membre-nom">{nom}</p>
                            <p className="carte-resume-membre-detail">{r.count} vente{r.count > 1 ? 's' : ''}</p>
                          </div>
                          <p className="carte-resume-membre-total">{Math.round(r.total).toLocaleString('fr-FR')} FCFA</p>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <ActiviteListe
                activite={activite}
                titre={
                  (vueEquipe ? "Activité de l'équipe" : 'Mon activité') +
                  ' (' +
                  (dateDebut === dateFin
                    ? new Date(dateDebut).toLocaleDateString('fr-FR')
                    : `${new Date(dateDebut).toLocaleDateString('fr-FR')} → ${new Date(dateFin).toLocaleDateString('fr-FR')}`) +
                  ')'
                }
              />
            </>
          )}
        </>
      )}

      {(commandeDetail || chargementDetail) && (
        <div className="modale-fond" onClick={() => setCommandeDetail(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            {chargementDetail && !commandeDetail ? (
              <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
            ) : (
              <>
                <h2>{commandeDetail.order_number}</h2>
                <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
                  {commandeDetail.client_name || 'Client de passage'} · <StatusBadge status={commandeDetail.status} />
                </p>
                <table className="registre" style={{ marginBottom: 16 }}>
                  <thead>
                    <tr>
                      <th>Produit</th>
                      <th>Qté</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commandeDetail.items.map((it) => (
                      <tr key={it.id}>
                        <td>{it.product_name}</td>
                        <td className="chiffre">{it.quantity}</td>
                        <td className="chiffre">{Math.round(it.line_total).toLocaleString('fr-FR')} FCFA</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontWeight: 700, textAlign: 'right' }}>
                  Total : {Math.round(commandeDetail.total_amount).toLocaleString('fr-FR')} FCFA
                </p>
                <div className="actions-modale">
                  <button className="btn" onClick={() => setCommandeDetail(null)}>Fermer</button>
                </div>
              </>
            )}
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
    </>
  );
}
