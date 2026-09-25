import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const LABEL_STATUT = { en_cours: 'En cours', ajustee: 'Ajustée', cloturee: 'Clôturée' };
const CLASSE_STATUT = { en_cours: 'tampon-laiton', ajustee: 'tampon-sarcelle', cloturee: '' };

export function ComptageTab() {
  const { user } = useAuth();
  const estManager = user.role === 'manager';

  const [sessions, setSessions] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [sessionOuverte, setSessionOuverte] = useState(null);
  const [creation, setCreation] = useState(false);
  const [recherche, setRecherche] = useState('');

  // Boutique active — même sélecteur/clé localStorage que les autres pages
  // (Stock, Achats…), pour rester cohérent d'une page à l'autre.
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState(() => (estManager ? localStorage.getItem('boutiqueActiveId') || '' : ''));
  const [chargementBoutiques, setChargementBoutiques] = useState(estManager);
  const activeWarehouseId = estManager ? warehouseId : user.warehouseId;

  useEffect(() => {
    if (!estManager) return;
    api.getWarehouses()
      .then((liste) => {
        setWarehouses(liste);
        const actives = liste.filter((w) => w.is_active);
        setWarehouseId((avant) => {
          if (avant && actives.some((w) => w.id === avant)) return avant;
          return actives[0]?.id || '';
        });
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargementBoutiques(false));
  }, [estManager]);

  useEffect(() => {
    if (estManager && warehouseId) localStorage.setItem('boutiqueActiveId', warehouseId);
  }, [estManager, warehouseId]);

  function charger() {
    if (!activeWarehouseId) return;
    setChargement(true);
    api.getInventorySessions(activeWarehouseId).then(setSessions).catch((err) => setErreur(err.message)).finally(() => setChargement(false));
  }

  useEffect(charger, [activeWarehouseId]);

  async function handleNouvelleSession() {
    setCreation(true);
    try {
      const session = await api.createInventorySession(activeWarehouseId);
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
      setRecherche('');
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSaisieComptage(itemId, valeur) {
    const quantite = Number(valeur);
    if (Number.isNaN(quantite) || quantite < 0) return;
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
    const totalPerte = sessionOuverte.items.reduce((somme, item) => {
      if (item.counted_quantity === null) return somme;
      const ecart = item.counted_quantity - item.theoretical_quantity;
      return ecart < 0 ? somme + Math.abs(ecart) * Number(item.unit_price || 0) : somme;
    }, 0);
    const rechercheNormalisee = recherche.trim().toLowerCase();
    const itemsAffiches = rechercheNormalisee
      ? sessionOuverte.items.filter((item) => item.product_name.toLowerCase().includes(rechercheNormalisee))
      : sessionOuverte.items;
    return (
      <>
        <div className="barre-outils" style={{ flexWrap: 'wrap', gap: 12 }}>
          <button className="btn" onClick={() => setSessionOuverte(null)}>← Retour aux sessions</button>
          <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>
            {sessionOuverte.session_number}{sessionOuverte.warehouse_name ? ` — ${sessionOuverte.warehouse_name}` : ''} — {totalCompte}/{sessionOuverte.items.length} comptés
          </span>
          <input
            type="text"
            className="champ"
            placeholder="Rechercher un produit…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            style={{ marginLeft: 'auto', maxWidth: 260 }}
          />
        </div>

        {erreur && <div className="erreur">{erreur}</div>}

        {rechercheNormalisee && (
          <p style={{ color: 'var(--encre-douce)', fontSize: 13, marginTop: -8, marginBottom: 12 }}>
            {itemsAffiches.length} produit(s) trouvé(s)
          </p>
        )}

        {itemsAffiches.length === 0 ? (
          <p className="etat-vide">Aucun produit ne correspond à « {recherche} ».</p>
        ) : (
        <table className="registre" style={{ marginBottom: 20 }}>
          <thead>
            <tr>
              <th>Produit</th>
              <th>Stock théorique</th>
              <th>Quantité comptée</th>
              <th>Écart</th>
              <th>Montant</th>
            </tr>
          </thead>
          <tbody>
            {itemsAffiches.map((item) => {
              const ecart = item.counted_quantity !== null ? item.counted_quantity - item.theoretical_quantity : null;
              const montant = ecart !== null ? ecart * Number(item.unit_price || 0) : null;
              return (
                <tr key={item.id}>
                  <td>{item.product_name}</td>
                  <td className="chiffre">{Math.round(Number(item.theoretical_quantity))}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      className="champ"
                      style={{ width: 90, padding: '6px 10px' }}
                      defaultValue={item.counted_quantity ?? ''}
                      onBlur={(e) => e.target.value !== '' && handleSaisieComptage(item.id, e.target.value)}
                    />
                  </td>
                  <td className="chiffre" style={{ color: ecart ? 'var(--danger)' : 'var(--encre-douce)' }}>
                    {ecart === null ? '—' : ecart > 0 ? `+${ecart}` : ecart}
                  </td>
                  <td className="chiffre" style={{ color: montant < 0 ? 'var(--danger)' : 'var(--encre-douce)' }}>
                    {montant === null ? '—' : `${montant > 0 ? '+' : ''}${Math.round(montant).toLocaleString('fr-FR')} FCFA`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {totalPerte > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4} style={{ textAlign: 'right', fontWeight: 600 }}>Perte totale (manquants)</td>
                <td className="chiffre" style={{ color: 'var(--danger)', fontWeight: 600 }}>
                  -{Math.round(totalPerte).toLocaleString('fr-FR')} FCFA
                </td>
              </tr>
            </tfoot>
          )}
        </table>
        )}

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
      <div className="barre-outils" style={{ flexWrap: 'wrap', gap: 12 }}>
        {estManager && warehouses.length > 0 && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px 5px 11px',
              borderRadius: 999,
              border: '1px solid var(--trait)',
              background: 'var(--accent-clair)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M3 9l1.5-5h15L21 9" />
              <path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
              <path d="M9 20v-6h6v6" />
            </svg>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--accent)',
                outline: 'none',
                cursor: 'pointer',
                appearance: 'none',
                WebkitAppearance: 'none',
                padding: 0,
                maxWidth: 130,
              }}
            >
              {warehouses.filter((w) => w.is_active).map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}
        <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{sessions.length} session(s)</span>
        <button className="btn btn-principal" onClick={handleNouvelleSession} disabled={creation || !activeWarehouseId}>
          {creation ? 'Création…' : 'Nouvelle session'}
        </button>
      </div>

      {estManager && !chargementBoutiques && warehouses.length === 0 && (
        <p className="etat-vide">Aucune boutique n'a encore été créée. Créez-en une avant de faire un inventaire.</p>
      )}

      {erreur && <div className="erreur">{erreur}</div>}

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : sessions.length === 0 ? (
        <p className="etat-vide">Aucune session d'inventaire pour le moment.</p>
      ) : (
        <table className="registre">
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Date</th>
              <th>Responsable</th>
              <th>Inventaire</th>
              <th>Écarts</th>
              <th>Montant perdu</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => ouvrirSession(s.id)}>
                <td className="chiffre">{s.session_number}</td>
                <td>{new Date(s.created_at).toLocaleDateString('fr-FR')}</td>
                <td>{s.created_by_name || '—'}</td>
                <td className="chiffre">{s.total_comptes} / {s.total_produits}</td>
                <td className="chiffre" style={{ color: Number(s.total_ecarts) > 0 ? 'var(--danger)' : 'inherit' }}>
                  {Number(s.total_ecarts) > 0 ? `${s.total_ecarts} écart(s)` : 'Aucun'}
                </td>
                <td className="chiffre" style={{ color: Number(s.total_perte) > 0 ? 'var(--danger)' : 'var(--encre-douce)' }}>
                  {Number(s.total_perte) > 0 ? `-${Math.round(Number(s.total_perte)).toLocaleString('fr-FR')} FCFA` : '—'}
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
