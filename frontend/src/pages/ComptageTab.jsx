import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StylesModernes } from '../components/StylesModernes';

const LABEL_STATUT = { en_cours: 'En cours', ajustee: 'Ajustée', cloturee: 'Clôturée' };
const CLASSE_STATUT = { en_cours: 'tampon-laiton', ajustee: 'tampon-sarcelle', cloturee: '' };

function IconInventaire() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 3v2h6V3" />
      <path d="M9 12l2 2 4-4" />
      <path d="M9 17h6" />
    </svg>
  );
}

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

  const fcfa = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
  const nettoyer = (n) => Number(Number(n).toFixed(3));

  const selecteurBoutique = estManager && warehouses.length > 0 && (
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
  );

  const barreProgression = (fait, total) => (
    <div style={{ height: 8, borderRadius: 999, background: 'var(--fond, #f3f4f6)', overflow: 'hidden' }}>
      <div
        style={{
          height: '100%',
          width: `${total > 0 ? Math.round((fait / total) * 100) : 0}%`,
          borderRadius: 999,
          background: 'var(--accent)',
          transition: 'width .3s',
        }}
      />
    </div>
  );

  if (sessionOuverte) {
    const totalProduits = sessionOuverte.items.length;
    const totalCompte = sessionOuverte.items.filter((i) => i.counted_quantity !== null).length;
    const nbEcarts = sessionOuverte.items.filter(
      (i) => i.counted_quantity !== null && Number(i.counted_quantity) !== Number(i.theoretical_quantity)
    ).length;
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
        <StylesModernes />

        <div className="md-carte" style={{ marginBottom: 16 }}>
          <div className="md-carte-tete" style={{ marginBottom: 12 }}>
            <div>
              <h2>{sessionOuverte.session_number}</h2>
              <p className="md-sous">{sessionOuverte.warehouse_name || 'Session d\'inventaire'}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className={`tampon ${CLASSE_STATUT[sessionOuverte.status] || ''}`}>{LABEL_STATUT[sessionOuverte.status] || sessionOuverte.status}</span>
              <button className="btn" onClick={() => setSessionOuverte(null)}>← Retour aux sessions</button>
            </div>
          </div>
          {barreProgression(totalCompte, totalProduits)}
          <p className="md-sous" style={{ marginTop: 6 }}>{totalCompte} / {totalProduits} produits comptés</p>
        </div>

        <div className="md-kpis">
          <div className="md-kpi md-kpi--hero">
            <span className="md-kpi-icone"><IconInventaire /></span>
            <p className="md-kpi-label">Comptés</p>
            <p className="md-kpi-valeur">{totalCompte} <small>/ {totalProduits}</small></p>
          </div>
          <div className={'md-kpi' + (nbEcarts > 0 ? ' md-kpi--alerte' : '')}>
            <span className="md-kpi-icone"><IconInventaire /></span>
            <p className="md-kpi-label">Écarts</p>
            <p className="md-kpi-valeur">{nbEcarts}</p>
          </div>
          <div className={'md-kpi' + (totalPerte > 0 ? ' md-kpi--alerte' : '')}>
            <span className="md-kpi-icone"><IconInventaire /></span>
            <p className="md-kpi-label">Perte (manquants)</p>
            <p className="md-kpi-valeur">{totalPerte > 0 ? '-' : ''}{fcfa(totalPerte)} <small>FCFA</small></p>
          </div>
        </div>

        {erreur && <div className="erreur">{erreur}</div>}

        <div className="md-outils">
          <div className="champ-avec-icone md-recherche">
            <input
              type="text"
              className="champ"
              placeholder="Rechercher un produit…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
            />
          </div>
          {rechercheNormalisee && <span className="md-sous">{itemsAffiches.length} produit(s) trouvé(s)</span>}
        </div>

        {itemsAffiches.length === 0 ? (
          <p className="etat-vide">Aucun produit ne correspond à « {recherche} ».</p>
        ) : (
          <div className="md-table">
            <table className="registre">
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
                      <td style={{ fontWeight: 600 }}>{item.product_name}</td>
                      <td className="chiffre">{Math.round(Number(item.theoretical_quantity))}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className="champ"
                          style={{ width: 100, padding: '6px 10px' }}
                          defaultValue={item.counted_quantity ?? ''}
                          onBlur={(e) => e.target.value !== '' && handleSaisieComptage(item.id, e.target.value)}
                        />
                      </td>
                      <td className="chiffre">
                        {ecart === null ? (
                          <span style={{ color: 'var(--encre-douce)' }}>—</span>
                        ) : ecart === 0 ? (
                          <span className="tampon tampon-sarcelle">OK</span>
                        ) : (
                          <span className="tampon tampon-brique">{ecart > 0 ? `+${nettoyer(ecart)}` : nettoyer(ecart)}</span>
                        )}
                      </td>
                      <td className="chiffre" style={{ color: montant < 0 ? 'var(--danger)' : 'var(--encre-douce)' }}>
                        {montant === null ? '—' : `${montant > 0 ? '+' : ''}${fcfa(montant)} FCFA`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {totalPerte > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right', fontWeight: 600, padding: '12px 14px' }}>Perte totale (manquants)</td>
                    <td className="chiffre" style={{ color: 'var(--danger)', fontWeight: 700, padding: '12px 14px' }}>
                      -{fcfa(totalPerte)} FCFA
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {sessionOuverte.status === 'en_cours' && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" onClick={handleCloturer}>Clôturer sans ajuster</button>
            <button className="btn btn-principal" onClick={handleAjuster}>Ajuster le stock</button>
          </div>
        )}
      </>
    );
  }

  const nbEnCours = sessions.filter((x) => x.status === 'en_cours').length;
  const perteCumulee = sessions.reduce((somme, x) => somme + Number(x.total_perte || 0), 0);

  return (
    <>
      <StylesModernes />

      <div className="md-kpis">
        <div className="md-kpi md-kpi--hero">
          <span className="md-kpi-icone"><IconInventaire /></span>
          <p className="md-kpi-label">Sessions</p>
          <p className="md-kpi-valeur">{sessions.length}</p>
        </div>
        <div className={'md-kpi' + (nbEnCours > 0 ? ' md-kpi--alerte' : '')}>
          <span className="md-kpi-icone"><IconInventaire /></span>
          <p className="md-kpi-label">En cours</p>
          <p className="md-kpi-valeur">{nbEnCours}</p>
        </div>
        <div className={'md-kpi' + (perteCumulee > 0 ? ' md-kpi--alerte' : '')}>
          <span className="md-kpi-icone"><IconInventaire /></span>
          <p className="md-kpi-label">Pertes cumulées</p>
          <p className="md-kpi-valeur">{perteCumulee > 0 ? '-' : ''}{fcfa(perteCumulee)} <small>FCFA</small></p>
        </div>
      </div>

      <div className="md-outils" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        {selecteurBoutique || <span />}
        <button className="btn btn-principal" onClick={handleNouvelleSession} disabled={creation || !activeWarehouseId}>
          {creation ? 'Création…' : '+ Nouvelle session'}
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
        <div className="md-liste">
          {sessions.map((x) => (
            <div
              key={x.id}
              className={'md-ligne' + (x.status === 'en_cours' ? ' md-ligne--prioritaire' : '')}
              style={{ cursor: 'pointer' }}
              onClick={() => ouvrirSession(x.id)}
            >
              <span className="md-avatar"><IconInventaire /></span>

              <div className="md-bloc">
                <p className="md-titre chiffre">{x.session_number}</p>
                <p className="md-sous">
                  {new Date(x.created_at).toLocaleDateString('fr-FR')} · {x.created_by_name || '—'}
                </p>
              </div>

              <div className="md-bloc md-bloc--montant">
                {barreProgression(Number(x.total_comptes) || 0, Number(x.total_produits) || 0)}
                <p className="md-sous" style={{ marginTop: 6 }}>
                  {x.total_comptes} / {x.total_produits} comptés ·{' '}
                  <span style={{ color: Number(x.total_ecarts) > 0 ? 'var(--danger)' : undefined }}>
                    {Number(x.total_ecarts) > 0 ? `${x.total_ecarts} écart(s)` : 'aucun écart'}
                  </span>
                </p>
              </div>

              <div className="md-actions" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
                <span className={`tampon ${CLASSE_STATUT[x.status] || ''}`}>{LABEL_STATUT[x.status] || x.status}</span>
                {Number(x.total_perte) > 0 && (
                  <span className="chiffre" style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 14 }}>
                    -{fcfa(x.total_perte)} FCFA
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
