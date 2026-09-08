import { useEffect, useState } from 'react';
import { api } from '../api/client';

const LABEL_STATUT = { en_cours: 'En cours', ajustee: 'Ajustée', cloturee: 'Clôturée' };
const CLASSE_STATUT = { en_cours: 'tampon-laiton', ajustee: 'tampon-sarcelle', cloturee: '' };

export function ComptageTab() {
  const [sessions, setSessions] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [sessionOuverte, setSessionOuverte] = useState(null);
  const [creation, setCreation] = useState(false);

  function charger() {
    setChargement(true);
    api.getInventorySessions().then(setSessions).catch((err) => setErreur(err.message)).finally(() => setChargement(false));
  }

  useEffect(charger, []);

  async function handleNouvelleSession() {
    setCreation(true);
    try {
      const session = await api.createInventorySession();
      charger();
      ouvrirSession(session.id);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setCreation(false);
    }
  }

  async function ouvrirSession(id) {
    try {
      const detail = await api.getInventorySession(id);
      setSessionOuverte(detail);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSaisieComptage(itemId, valeur) {
    const quantite = Number(valeur);
    if (!Number.isInteger(quantite) || quantite < 0) return;
    try {
      await api.setInventoryItemCount(sessionOuverte.id, itemId, quantite);
      setSessionOuverte((prev) => ({
        ...prev,
        items: prev.items.map((it) => (it.id === itemId ? { ...it, counted_quantity: quantite } : it)),
      }));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleCloturer() {
    try {
      await api.closeInventorySession(sessionOuverte.id);
      setSessionOuverte(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleAjuster() {
    if (!window.confirm('Le stock réel sera mis à jour pour tous les écarts constatés. Continuer ?')) return;
    try {
      await api.adjustInventorySession(sessionOuverte.id);
      setSessionOuverte(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (sessionOuverte) {
    const totalCompte = sessionOuverte.items.filter((i) => i.counted_quantity !== null).length;
    return (
      <>
        <div className="barre-outils">
          <button className="btn" onClick={() => setSessionOuverte(null)}>← Retour aux sessions</button>
          <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>
            {sessionOuverte.session_number} — {totalCompte}/{sessionOuverte.items.length} comptés
          </span>
        </div>

        {erreur && <div className="erreur">{erreur}</div>}

        <table className="registre" style={{ marginBottom: 20 }}>
          <thead>
            <tr>
              <th>Produit</th>
              <th>Stock théorique</th>
              <th>Quantité comptée</th>
              <th>Écart</th>
            </tr>
          </thead>
          <tbody>
            {sessionOuverte.items.map((item) => {
              const ecart = item.counted_quantity !== null ? item.counted_quantity - item.theoretical_quantity : null;
              return (
                <tr key={item.id}>
                  <td>{item.product_name}</td>
                  <td className="chiffre">{item.theoretical_quantity}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      className="champ"
                      style={{ width: 90, padding: '6px 10px' }}
                      defaultValue={item.counted_quantity ?? ''}
                      onBlur={(e) => e.target.value !== '' && handleSaisieComptage(item.id, e.target.value)}
                    />
                  </td>
                  <td className="chiffre" style={{ color: ecart ? 'var(--danger)' : 'var(--encre-douce)' }}>
                    {ecart === null ? '—' : ecart > 0 ? `+${ecart}` : ecart}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {sessionOuverte.status === 'en_cours' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={handleCloturer}>Clôturer sans ajuster</button>
            <button className="btn btn-principal" onClick={handleAjuster}>Ajuster le stock</button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="barre-outils">
        <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{sessions.length} session(s)</span>
        <button className="btn btn-principal" onClick={handleNouvelleSession} disabled={creation}>
          {creation ? 'Création…' : 'Nouvelle session'}
        </button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : sessions.length === 0 ? (
        <p className="etat-vide">Aucune session de comptage pour le moment.</p>
      ) : (
        <table className="registre">
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Date</th>
              <th>Responsable</th>
              <th>Produits</th>
              <th>Comptage</th>
              <th>Écarts</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => ouvrirSession(s.id)}>
                <td className="chiffre">{s.session_number}</td>
                <td>{new Date(s.created_at).toLocaleDateString('fr-FR')}</td>
                <td>{s.created_by_name || '—'}</td>
                <td className="chiffre">{s.total_produits}</td>
                <td className="chiffre">{s.total_comptes} / {s.total_produits}</td>
                <td className="chiffre" style={{ color: Number(s.total_ecarts) > 0 ? 'var(--danger)' : 'inherit' }}>
                  {Number(s.total_ecarts) > 0 ? `${s.total_ecarts} écart(s)` : 'Aucun'}
                </td>
                <td><span className={`tampon ${CLASSE_STATUT[s.status]}`}>{LABEL_STATUT[s.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
