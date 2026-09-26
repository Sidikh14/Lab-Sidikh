import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const NOMS_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
function formatMois(moisStr) {
  const [annee, mois] = moisStr.split('-');
  return `${NOMS_MOIS[Number(mois) - 1]} ${annee}`;
}

export function MyPayslipsPage() {
  const { user } = useAuth();
  const [bulletins, setBulletins] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    api
      .getMyPayslips()
      .then(setBulletins)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  function voirPdf(mois) {
    api.previewPayslipPdf(user.id, mois).catch((err) => setErreur(err.message));
  }

  return (
    <>
      <div className="entete-page">
        <h1>Mes bulletins de paie</h1>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : bulletins.length === 0 ? (
        <p className="etat-vide">Aucun bulletin disponible pour le moment.</p>
      ) : (
        <div className="liste-a-encaisser">
          {bulletins.map((b) => (
            <div key={b.month} className="carte-a-encaisser">
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="carte-a-encaisser-numero">{formatMois(b.month)}</p>
                <p className="carte-a-encaisser-client">
                  Net à payer : {Math.round(b.net_a_payer).toLocaleString('fr-FR')} FCFA
                </p>
              </div>
              <button className="btn btn-principal" onClick={() => voirPdf(b.month)}>
                Voir / imprimer
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
