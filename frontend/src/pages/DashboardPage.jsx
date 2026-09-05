import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';

export function DashboardPage() {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    Promise.all([api.getProducts(), api.getOrders()])
      .then(([p, o]) => {
        setProducts(p);
        setOrders(o);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  const enRupture = products.filter((p) => p.status === 'rupture').length;
  const enAttente = orders.filter((o) => o.status === 'en_attente').length;
  const aujourdHui = new Date().toDateString();
  const ventesDuJour = orders
    .filter((o) => new Date(o.created_at).toDateString() === aujourdHui)
    .reduce((sum, o) => sum + Number(o.total_amount), 0);

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
              <span className="valeur" style={{ color: enRupture > 0 ? 'var(--brique)' : 'inherit' }}>
                {enRupture}
              </span>
            </div>
            <div className="stat">
              <span className="etiquette">Références en stock</span>
              <span className="valeur">{products.length}</span>
            </div>
          </div>

          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Commandes récentes</h2>
          <div className="panneau">
            {orders.length === 0 ? (
              <p className="etat-vide">Aucune commande pour le moment.</p>
            ) : (
              <table className="registre">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Montant</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 6).map((o) => (
                    <tr key={o.id}>
                      <td>{o.client_name || 'Client de passage'}</td>
                      <td className="chiffre">{Number(o.total_amount).toLocaleString('fr-FR')} FCFA</td>
                      <td><StatusBadge status={o.status} /></td>
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
