import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';

const LABEL_MOUVEMENT = { entree: 'Entrée', sortie: 'Sortie', ajustement: 'Ajustement' };

export function DashboardPage() {
  const { user } = useAuth();
  const vueEquipe = ['manager', 'gerant'].includes(user.role);

  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [activite, setActivite] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    Promise.all([api.getProducts(), api.getOrders(), api.getActivityToday()])
      .then(([p, o, a]) => {
        setProducts(p);
        setOrders(o);
        setActivite(a);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  const enRupture = products.filter((p) => p.status === 'rupture');
  const enFaible = products.filter((p) => p.status === 'faible');
  const enAttente = orders.filter((o) => o.status === 'en_attente').length;
  const aLivrer = orders.filter((o) => o.status === 'validee');
  const aujourdHui = new Date().toDateString();
  const ventesDuJour = orders
    .filter((o) => new Date(o.created_at).toDateString() === aujourdHui)
    .reduce((sum, o) => sum + Number(o.total_amount), 0);

  // Résumé des ventes du jour par vendeur, à partir du flux d'activité.
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
        <h1>Tableau de bord</h1>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}
      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : (
        <>
          <div className="ligne-stats">
            <div className="stat">
              <span className="etiquette">Ventes du jour</span>
              <span className="valeur">{ventesDuJour.toLocaleString('fr-FR')} FCFA</span>
            </div>
            <div className="stat">
              <span className="etiquette">Commandes en attente</span>
              <span className="valeur">{enAttente}</span>
            </div>
            <div className="stat">
              <span className="etiquette">Produits en rupture</span>
              <span className="valeur" style={{ color: enRupture.length > 0 ? 'var(--danger)' : 'inherit' }}>
                {enRupture.length}
              </span>
            </div>
            <div className="stat">
              <span className="etiquette">À livrer</span>
              <span className="valeur">{aLivrer.length}</span>
            </div>
          </div>

          {vueEquipe && (enRupture.length > 0 || enFaible.length > 0) && (
            <>
              <h2 style={{ fontSize: 18, marginBottom: 12 }}>Alertes de stock</h2>
              <table className="registre" style={{ marginBottom: 32 }}>
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Quantité restante</th>
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
            </>
          )}

          {aLivrer.length > 0 && (
            <>
              <h2 style={{ fontSize: 18, marginBottom: 12 }}>Commandes à livrer</h2>
              <table className="registre" style={{ marginBottom: 32 }}>
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
            </>
          )}

          {vueEquipe && Object.keys(resumeParVendeur).length > 0 && (
            <>
              <h2 style={{ fontSize: 18, marginBottom: 12 }}>Ventes du jour par membre de l'équipe</h2>
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

          <h2 style={{ fontSize: 18, marginBottom: 12 }}>
            {vueEquipe ? "Activité de l'équipe aujourd'hui" : "Mon activité aujourd'hui"}
          </h2>
          <div className="panneau">
            {activite.length === 0 ? (
              <p className="etat-vide">Aucune activité enregistrée aujourd'hui.</p>
            ) : (
              <table className="registre">
                <thead>
                  <tr>
                    <th>Heure</th>
                    <th>Membre</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activite.slice(0, 15).map((a) => (
                    <tr key={a.id}>
                      <td className="chiffre">{new Date(a.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{a.user_name || 'Inconnu'}</td>
                      <td>
                        {a.type === 'vente'
                          ? `Vente de ${Number(a.montant).toLocaleString('fr-FR')} FCFA`
                          : `${LABEL_MOUVEMENT[a.movement_type] || a.movement_type} — ${a.product_name} (${a.quantity})`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
