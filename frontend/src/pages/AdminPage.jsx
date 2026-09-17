import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

// Page réservée au propriétaire de la plateforme (rôle "owner"). Indépendante
// du layout commerçant habituel (pas de Sidebar) puisqu'un owner n'a pas de
// `merchant` — ce qui casserait toute page conçue pour un commerce.
export function AdminPage() {
  const { user, logout } = useAuth();
  const [commercants, setCommercants] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [commercantOuvert, setCommercantOuvert] = useState(null);
  const [equipe, setEquipe] = useState([]);
  const [chargementEquipe, setChargementEquipe] = useState(false);

  async function charger() {
    setChargement(true);
    setErreur('');
    try {
      const data = await api.getAdminMerchants();
      setCommercants(data);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    charger();
  }, []);

  async function toggleCommercantOuvert(id) {
    if (commercantOuvert === id) {
      setCommercantOuvert(null);
      return;
    }
    setCommercantOuvert(id);
    setChargementEquipe(true);
    try {
      const data = await api.getMerchantTeam(id);
      setEquipe(data);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargementEquipe(false);
    }
  }

  async function basculerStatutCommercant(commercant) {
    try {
      await api.setMerchantStatus(commercant.id, !commercant.is_active);
      await charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function modifierPlafond(commercant) {
    const saisie = window.prompt(
      `Nombre de comptes maximum pour ${commercant.business_name} :`,
      commercant.max_team_members
    );
    if (saisie === null) return;
    const valeur = parseInt(saisie, 10);
    if (!Number.isInteger(valeur) || valeur < 1) {
      setErreur('Le plafond doit être un nombre entier positif.');
      return;
    }
    try {
      await api.setMerchantLimit(commercant.id, valeur);
      await charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function supprimerCommercant(commercant) {
    if (!window.confirm(`Supprimer définitivement ${commercant.business_name} ? Cette action est irréversible.`)) return;
    try {
      await api.deleteMerchant(commercant.id);
      await charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function basculerStatutUtilisateur(membre) {
    try {
      await api.setAdminUserStatus(membre.id, !membre.is_active);
      const data = await api.getMerchantTeam(commercantOuvert);
      setEquipe(data);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function supprimerUtilisateur(membre) {
    if (!window.confirm(`Supprimer définitivement ${membre.full_name} ?`)) return;
    try {
      await api.deleteAdminUser(membre.id);
      const data = await api.getMerchantTeam(commercantOuvert);
      setEquipe(data);
      await charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function reinitialiserMotDePasse(membre) {
    const nouveauMotDePasse = window.prompt(
      `Nouveau mot de passe pour ${membre.full_name} (${membre.role}) — au moins 6 caractères :`
    );
    if (nouveauMotDePasse === null) return;
    if (nouveauMotDePasse.length < 6) {
      setErreur('Le nouveau mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    try {
      await api.resetAdminUserPassword(membre.id, nouveauMotDePasse);
      window.alert(`Mot de passe de ${membre.full_name} réinitialisé avec succès.`);
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.entete}>
        <div>
          <h1 style={styles.titre}>Administration</h1>
          <p style={styles.sousTitre}>Connecté en tant que {user?.fullName}</p>
        </div>
        <button type="button" style={styles.boutonSecondaire} onClick={logout}>
          Se déconnecter
        </button>
      </header>

      {erreur && <div style={styles.erreur}>{erreur}</div>}

      {chargement ? (
        <p>Chargement…</p>
      ) : (
        <div style={styles.liste}>
          {commercants.map((commercant) => (
            <div key={commercant.id} style={styles.carte}>
              <div style={styles.carteEntete} onClick={() => toggleCommercantOuvert(commercant.id)}>
                <div>
                  <strong>{commercant.business_name}</strong>
                  <span style={styles.discret}>
                    {' '}
                    · {commercant.sector || 'Secteur non renseigné'} · {commercant.email}
                  </span>
                </div>
                <div style={styles.badges}>
                  <span style={commercant.is_active ? styles.badgeActif : styles.badgeInactif}>
                    {commercant.is_active ? 'Actif' : 'Bloqué'}
                  </span>
                  <span style={styles.badgeNeutre}>
                    {commercant.member_count} / {commercant.max_team_members} comptes
                  </span>
                </div>
              </div>

              <div style={styles.actions}>
                <button type="button" style={styles.bouton} onClick={() => basculerStatutCommercant(commercant)}>
                  {commercant.is_active ? 'Bloquer' : 'Débloquer'}
                </button>
                <button type="button" style={styles.bouton} onClick={() => modifierPlafond(commercant)}>
                  Modifier le plafond
                </button>
                <button type="button" style={styles.boutonDanger} onClick={() => supprimerCommercant(commercant)}>
                  Supprimer
                </button>
              </div>

              {commercantOuvert === commercant.id && (
                <div style={styles.equipe}>
                  {chargementEquipe ? (
                    <p>Chargement de l'équipe…</p>
                  ) : equipe.length === 0 ? (
                    <p style={styles.discret}>Aucun membre.</p>
                  ) : (
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Nom</th>
                          <th style={styles.th}>Email</th>
                          <th style={styles.th}>Rôle</th>
                          <th style={styles.th}>Statut</th>
                          <th style={styles.th}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {equipe.map((membre) => (
                          <tr key={membre.id}>
                            <td style={styles.td}>{membre.full_name}</td>
                            <td style={styles.td}>{membre.email}</td>
                            <td style={styles.td}>{membre.role}</td>
                            <td style={styles.td}>{membre.is_active ? 'Actif' : 'Bloqué'}</td>
                            <td style={{ ...styles.td, display: 'flex', gap: 8 }}>
                              <button type="button" style={styles.boutonPetit} onClick={() => basculerStatutUtilisateur(membre)}>
                                {membre.is_active ? 'Bloquer' : 'Débloquer'}
                              </button>
                              <button type="button" style={styles.boutonPetit} onClick={() => reinitialiserMotDePasse(membre)}>
                                Réinitialiser mot de passe
                              </button>
                              <button type="button" style={styles.boutonPetitDanger} onClick={() => supprimerUtilisateur(membre)}>
                                Supprimer
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { maxWidth: 960, margin: '0 auto', padding: '32px 20px', fontFamily: 'inherit' },
  entete: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  titre: { fontSize: 26, margin: 0 },
  sousTitre: { color: '#6b6b6b', fontSize: 13, margin: '4px 0 0' },
  erreur: { background: '#fde8e8', color: '#a3241f', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 },
  liste: { display: 'flex', flexDirection: 'column', gap: 14 },
  carte: { border: '1px solid #e2e2e2', borderRadius: 10, overflow: 'hidden' },
  carteEntete: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', cursor: 'pointer', gap: 12, flexWrap: 'wrap' },
  discret: { color: '#8a8a8a', fontSize: 13 },
  badges: { display: 'flex', gap: 8, flexShrink: 0 },
  badgeActif: { background: '#e6f6ec', color: '#1a7a3d', padding: '3px 10px', borderRadius: 999, fontSize: 12 },
  badgeInactif: { background: '#fde8e8', color: '#a3241f', padding: '3px 10px', borderRadius: 999, fontSize: 12 },
  badgeNeutre: { background: '#f2f2f2', color: '#444', padding: '3px 10px', borderRadius: 999, fontSize: 12 },
  actions: { display: 'flex', gap: 8, padding: '0 16px 14px', flexWrap: 'wrap' },
  bouton: { padding: '6px 12px', borderRadius: 6, border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontSize: 13 },
  boutonSecondaire: { padding: '8px 14px', borderRadius: 6, border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontSize: 13, height: 'fit-content' },
  boutonDanger: { padding: '6px 12px', borderRadius: 6, border: '1px solid #e2b6b3', background: '#fff', color: '#a3241f', cursor: 'pointer', fontSize: 13 },
  boutonPetit: { padding: '4px 10px', borderRadius: 6, border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontSize: 12 },
  boutonPetitDanger: { padding: '4px 10px', borderRadius: 6, border: '1px solid #e2b6b3', background: '#fff', color: '#a3241f', cursor: 'pointer', fontSize: 12 },
  equipe: { borderTop: '1px solid #e2e2e2', padding: '14px 16px', background: '#fafafa' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', color: '#8a8a8a', fontWeight: 500, padding: '4px 8px', borderBottom: '1px solid #e2e2e2' },
  td: { padding: '8px 8px', borderBottom: '1px solid #ececec' },
};
