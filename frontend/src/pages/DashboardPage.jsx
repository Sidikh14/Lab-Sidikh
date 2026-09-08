import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { ActiviteListe } from '../components/ActiviteListe';

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

function dateAujourdHui() {
  return new Date().toISOString().slice(0, 10);
}

export function DashboardPage() {
  const { user } = useAuth();
  const vueEquipe = ['manager', 'gerant'].includes(user.role);

  const [onglet, setOnglet] = useState('pilotage');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  // Journal d'activité — plage de dates
  const [dateDebut, setDateDebut] = useState(dateAujourdHui());
  const [dateFin, setDateFin] = useState(dateAujourdHui());
  const [activite, setActivite] = useState([]);
  const [chargementActivite, setChargementActivite] = useState(true);

  const [activiteAujourdhui, setActiviteAujourdhui] = useState([]);

  useEffect(() => {
    Promise.all([api.getProducts(), api.getOrders(), api.getActivityToday()])
      .then(([p, o, a]) => {
        setProducts(p);
        setOrders(o);
        setActiviteAujourdhui(a);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  function chargerActivite() {
    setChargementActivite(true);
    api
      .getActivityRange(dateDebut, dateFin)
      .then(setActivite)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementActivite(false));
  }

  useEffect(() => {
    if (onglet === 'activite') chargerActivite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet]);

  const enRupture = products.filter((p) => p.status === 'rupture');
  const enFaible = products.filter((p) => p.status === 'faible');
  const enAttente = orders.filter((o) => o.status === 'en_attente').length;
  const aLivrer = orders.filter((o) => o.status === 'validee');
  const valeurStock = products.reduce((sum, p) => sum + Number(p.unit_price) * Number(p.quantity_in_stock), 0);
  const aujourdHui = new Date().toDateString();
  const ventesDuJour = orders
    .filter((o) => new Date(o.created_at).toDateString() === aujourdHui)
    .reduce((sum, o) => sum + Number(o.total_amount), 0);

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
        ) : (
          <>
            <div className="ligne-stats">
              <div className="stat">
                <span className="stat-icone"><IconValeur /></span>
                <span className="etiquette">Valeur du stock</span>
                <span className="valeur">{valeurStock.toLocaleString('fr-FR')} FCFA</span>
              </div>
              <div className="stat">
                <span className="stat-icone" style={enRupture.length + enFaible.length > 0 ? { background: 'var(--danger-clair)', color: 'var(--danger)' } : undefined}><IconAlerte /></span>
                <span className="etiquette">Alertes de seuil</span>
                <span className="valeur">{enRupture.length + enFaible.length}</span>
              </div>
              <div className="stat">
                <span className="stat-icone"><IconVentes /></span>
                <span className="etiquette">Ventes du jour</span>
                <span className="valeur">{ventesDuJour.toLocaleString('fr-FR')} FCFA</span>
              </div>
              <div className="stat">
                <span className="stat-icone"><IconHorloge /></span>
                <span className="etiquette">En attente</span>
                <span className="valeur">{enAttente}</span>
              </div>
              <div className="stat">
                <span className="stat-icone"><IconCamion /></span>
                <span className="etiquette">À livrer</span>
                <span className="valeur">{aLivrer.length}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {vueEquipe && (enRupture.length > 0 || enFaible.length > 0) && (
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
                        <tr key={o.id}>
                          <td className="chiffre">{o.order_number}</td>
                          <td>{o.client_name || 'Client de passage'}</td>
                          <td className="chiffre">{Number(o.total_amount).toLocaleString('fr-FR')} FCFA</td>
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
          </div>

          {chargementActivite ? (
            <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
          ) : (
            <>
              {vueEquipe && Object.keys(resumeParVendeur).length > 0 && (
                <>
                  <h2 style={{ fontSize: 16, marginBottom: 12 }}>Ventes par membre de l'équipe, sur cette période</h2>
                  <table className="registre" style={{ marginBottom: 32 }}>
                    <thead>
                      <tr>
                        <th>Membre</th>
                        <th>Ventes</th>
                        <th>Total encaissé</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(resumeParVendeur).map(([nom, r]) => (
                        <tr key={nom}>
                          <td>{nom}</td>
                          <td className="chiffre">{r.count}</td>
                          <td className="chiffre">{r.total.toLocaleString('fr-FR')} FCFA</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
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
    </>
  );
}
