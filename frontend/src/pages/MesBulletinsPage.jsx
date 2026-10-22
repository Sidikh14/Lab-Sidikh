import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { StylesModernes } from '../components/StylesModernes';

const NOMS_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
function formatMois(moisStr) {
  const [annee, mois] = moisStr.split('-');
  return `${NOMS_MOIS[Number(mois) - 1]} ${annee}`;
}

// Page self-service, accessible à tous les rôles (contrairement à /paie, réservée au
// manager/comptable) : chaque salarié ne voit et ne télécharge que SES PROPRES bulletins,
// une fois le mois marqué payé (l'API /payroll/me/... applique déjà cette règle côté serveur).
export function MesBulletinsPage() {
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

  function telecharger(mois) {
    setErreur('');
    api.previewPayslipPdf('me', mois).catch((err) => setErreur(err.message));
  }

  return (
    <>
      <StylesModernes />
      <div className="entete-page">
        <h1>Mes bulletins</h1>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : bulletins.length === 0 ? (
        <p className="etat-vide">Aucun bulletin disponible pour le moment.</p>
      ) : (
        <div className="md-liste">
          {bulletins.map((b) => (
            <div key={b.month} className="md-ligne">
              <div className="md-avatar">{b.month.slice(5, 7)}</div>
              <div className="md-bloc">
                <p className="md-titre">{formatMois(b.month)}</p>
                <p className="md-sous">N° {b.number}</p>
              </div>
              <div className="md-bloc md-bloc--montant">
                <p className="md-sous">Net à payer : {Math.round(Number(b.net_a_payer)).toLocaleString('fr-FR')} FCFA</p>
              </div>
              <div className="md-actions">
                <button className="btn btn-principal" onClick={() => telecharger(b.month)}>
                  PDF
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default MesBulletinsPage;
