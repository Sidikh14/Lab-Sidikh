import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLiveEvent } from '../offline/liveEvents';

function IconFournisseur() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 21V8l7-4 7 4v13" />
      <path d="M13 21V13h5v8" />
      <path d="M7 11h.01M7 15h.01" />
    </svg>
  );
}

function IconRecherche() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function IconReglement() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 10h20" />
      <path d="M6 15h4" />
    </svg>
  );
}

function IconCorbeille() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </svg>
  );
}

function IconTelecharger() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  );
}

function IconBonAchat() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 4h13l3 3v13H4z" />
      <path d="M9 4v4H4" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

const LABEL_MOYEN = { especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', cheque: 'Chèque', virement: 'Virement' };

const FILTRES_DETTE = [
  { value: 'tous', label: 'Tous' },
  { value: 'dette', label: 'Avec dette' },
  { value: 'a_jour', label: 'À jour' },
];

const STATUTS_ACHAT = ['envoyee', 'recue', 'annulee'];
const LABEL_STATUT_ACHAT = { envoyee: 'Envoyée', recue: 'Reçue', annulee: 'Annulée' };
const COULEUR_STATUT_ACHAT = {
  envoyee: { background: 'var(--accent-clair)', color: 'var(--accent)' },
  recue: { background: 'var(--vif-clair, #d1fae5)', color: 'var(--vif, #059669)' },
  annulee: { background: 'var(--danger-clair)', color: 'var(--danger)' },
};

// Page fusionnée (20/09) : Fournisseurs + Commandes d'achat, sous forme de
// deux onglets d'une même page, pour alléger la barre latérale. Le module
// de permission ('fournisseurs' ou 'achats') détermine quels onglets un
// membre restreint peut voir ; un manager/gérant les voit toujours tous les
// deux.
export function SuppliersPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const voitFournisseurs = user.role === 'manager' || user.role === 'gerant' || !Array.isArray(user.visibleModules) || user.visibleModules.includes('fournisseurs');
  const voitAchats = user.role === 'manager' || user.role === 'gerant' || !Array.isArray(user.visibleModules) || user.visibleModules.includes('achats');
  const [onglet, setOnglet] = useState(() => {
    const demande = searchParams.get('tab');
    if (demande === 'achats' && voitAchats) return 'achats';
    return voitFournisseurs ? 'fournisseurs' : 'achats';
  });

  return (
    <>
      <div className="entete-page">
        <h1>Fournisseurs</h1>
      </div>

      <div className="onglets" style={{ marginBottom: 20 }}>
        {voitFournisseurs && (
          <button className={onglet === 'fournisseurs' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('fournisseurs')}>
            Fournisseurs
          </button>
        )}
        {voitAchats && (
          <button className={onglet === 'achats' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('achats')}>
            Commandes d'achat
          </button>
        )}
      </div>

      {onglet === 'fournisseurs' ? <FournisseursTab /> : <AchatsTab />}
    </>
  );
}

function FournisseursTab() {
  const [suppliers, setSuppliers] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouveau, setNouveau] = useState({ name: '', phone: '', email: '', address: '' });
  const [fournisseurDette, setFournisseurDette] = useState(null);
  const [detailFournisseur, setDetailFournisseur] = useState(null);
  const [montantReglement, setMontantReglement] = useState('');
  const [moyenReglement, setMoyenReglement] = useState('especes');
  const [enregistrementReglement, setEnregistrementReglement] = useState(false);

  function charger() {
    setChargement(true);
    api
      .getSuppliers()
      .then(setSuppliers)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  useLiveEvent('activity:created', () => charger());

  const [recherche, setRecherche] = useState('');
  const [filtreDette, setFiltreDette] = useState('tous');

  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportEnCours, setExportEnCours] = useState(false);

  const suppliersFiltres = useMemo(() => {
    return suppliers.filter((s) => {
      const correspondRecherche =
        s.name.toLowerCase().includes(recherche.toLowerCase()) ||
        (s.phone || '').toLowerCase().includes(recherche.toLowerCase());
      const correspondDette =
        filtreDette === 'tous' ||
        (filtreDette === 'dette' && Number(s.debt) > 0) ||
        (filtreDette === 'a_jour' && Number(s.debt) <= 0);
      return correspondRecherche && correspondDette;
    });
  }, [suppliers, recherche, filtreDette]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!nouveau.name) {
      setErreur('Le nom du fournisseur est requis.');
      return;
    }
    try {
      await api.createSupplier(nouveau);
      setModaleOuverte(false);
      setNouveau({ name: '', phone: '', email: '', address: '' });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimer(supplier) {
    if (!window.confirm(`Retirer "${supplier.name}" de la liste des fournisseurs ?`)) return;
    try {
      await api.deleteSupplier(supplier.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  function ouvrirReglement(supplier) {
    setFournisseurDette(supplier);
    setMontantReglement('');
    setMoyenReglement('especes');
    api
      .getSupplier(supplier.id)
      .then(setDetailFournisseur)
      .catch((err) => setErreur(err.message));
  }

  async function handleEnregistrerReglement(e) {
    e.preventDefault();
    if (!Number(montantReglement) || Number(montantReglement) <= 0) {
      setErreur('Montant de règlement invalide.');
      return;
    }
    setEnregistrementReglement(true);
    try {
      await api.createSupplierPayment(fournisseurDette.id, { amount: Number(montantReglement), paymentMethod: moyenReglement });
      const detail = await api.getSupplier(fournisseurDette.id);
      setDetailFournisseur(detail);
      setMontantReglement('');
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementReglement(false);
    }
  }

  async function handleExporterAchats() {
    if (!exportFrom || !exportTo) {
      setErreur('Choisissez une date de début et une date de fin.');
      return;
    }
    setExportEnCours(true);
    try {
      await api.downloadSupplierPurchasesPdf(exportFrom, exportTo);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setExportEnCours(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          className="btn btn-principal"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, boxShadow: '0 6px 16px -6px var(--accent)', fontWeight: 600 }}
          onClick={() => setModaleOuverte(true)}
        >
          <IconPlus />
          Nouveau fournisseur
        </button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-filtres">
        <div className="champ-avec-icone champ-avec-icone--pleine-largeur">
          <span className="champ-icone"><IconRecherche /></span>
          <input
            type="text"
            className="champ champ--avec-icone"
            placeholder="Rechercher par nom ou téléphone…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <div
          className="filtre-pilules"
          style={{
            display: 'flex',
            gap: 4,
            padding: 4,
            background: 'var(--fond-alterne, rgba(0,0,0,0.03))',
            borderRadius: 999,
            border: '1px solid var(--trait)',
          }}
        >
          {FILTRES_DETTE.map((f) => {
            const actif = filtreDette === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFiltreDette(f.value)}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  padding: '7px 16px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: actif ? 600 : 500,
                  color: actif ? '#fff' : 'var(--encre-douce)',
                  background: actif ? 'var(--accent)' : 'transparent',
                  boxShadow: actif ? '0 4px 10px -3px var(--accent)' : 'none',
                  transition: 'background 0.15s ease, color 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="barre-filtres"
        style={{ alignItems: 'center', flexWrap: 'wrap', gap: 10 }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--encre-douce)' }}>
          Exporter les achats (PDF)
        </span>
        <input
          type="date"
          className="champ"
          style={{ width: 150 }}
          value={exportFrom}
          onChange={(e) => setExportFrom(e.target.value)}
          aria-label="Du"
        />
        <span style={{ color: 'var(--encre-douce)' }}>au</span>
        <input
          type="date"
          className="champ"
          style={{ width: 150 }}
          value={exportTo}
          onChange={(e) => setExportTo(e.target.value)}
          aria-label="Au"
        />
        <button
          className="btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          onClick={handleExporterAchats}
          disabled={exportEnCours}
        >
          <IconTelecharger />
          {exportEnCours ? 'Génération…' : 'Exporter'}
        </button>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : suppliersFiltres.length === 0 ? (
        <p className="etat-vide">
          {suppliers.length === 0 ? 'Aucun fournisseur enregistré pour le moment.' : 'Aucun fournisseur ne correspond à ces filtres.'}
        </p>
      ) : (
        <div className="grille-cartes">
          {suppliersFiltres.map((s) => {
            const aDette = Number(s.debt) > 0;
            return (
              <div key={s.id} className="carte-entite">
                <div className="carte-entite-entete">
                  <span className="carte-entite-icone"><IconFournisseur /></span>
                  {aDette && <span className="tampon tampon-brique">Dette</span>}
                </div>
                <p className="carte-entite-nom">{s.name}</p>
                <p className="carte-entite-detail">{s.phone || s.email || 'Aucun contact enregistré'}</p>
                <p className="carte-entite-metrique" style={aDette ? { color: 'var(--danger)' } : undefined}>
                  {Math.round(Number(s.debt) || 0).toLocaleString('fr-FR')} FCFA
                </p>
                <p className="carte-entite-souslegende">{aDette ? 'Dette en cours' : 'Aucune dette'}</p>
                <div className="carte-entite-actions">
                  <button
                    className="btn"
                    style={{ flex: 1, justifyContent: 'center', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={() => ouvrirReglement(s)}
                  >
                    <IconReglement />
                    Règlement
                  </button>
                  <button
                    className="btn"
                    style={{ padding: '7px 10px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={() => handleSupprimer(s)}
                    title="Retirer ce fournisseur"
                  >
                    <IconCorbeille />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Ajouter un fournisseur</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="f-name">Nom</label>
                <input
                  id="f-name"
                  className="champ"
                  value={nouveau.name}
                  onChange={(e) => setNouveau({ ...nouveau, name: e.target.value })}
                  placeholder="Grossiste Baol"
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="f-phone">Téléphone</label>
                <input
                  id="f-phone"
                  className="champ"
                  value={nouveau.phone}
                  onChange={(e) => setNouveau({ ...nouveau, phone: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="f-email">Email</label>
                <input
                  id="f-email"
                  type="email"
                  className="champ"
                  value={nouveau.email}
                  onChange={(e) => setNouveau({ ...nouveau, email: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="f-address">Adresse</label>
                <input
                  id="f-address"
                  className="champ"
                  value={nouveau.address}
                  onChange={(e) => setNouveau({ ...nouveau, address: e.target.value })}
                />
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setModaleOuverte(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-principal">
                  Ajouter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {fournisseurDette && (
        <div className="modale-fond" onClick={() => { setFournisseurDette(null); setDetailFournisseur(null); }}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Dette de {fournisseurDette.name}</h2>
            {!detailFournisseur ? (
              <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
            ) : (
              <>
                <p style={{ fontSize: 15, marginBottom: 16 }}>
                  Dette actuelle : <strong className="chiffre">{Math.round(detailFournisseur.debt).toLocaleString('fr-FR')} FCFA</strong>
                </p>
                <form onSubmit={handleEnregistrerReglement}>
                  <div className="champ-groupe">
                    <label className="etiquette" htmlFor="fr-montant">Montant du règlement (FCFA)</label>
                    <input
                      id="fr-montant"
                      type="number"
                      className="champ"
                      value={montantReglement}
                      onChange={(e) => setMontantReglement(e.target.value)}
                    />
                  </div>
                  <div className="champ-groupe">
                    <label className="etiquette" htmlFor="fr-moyen">Moyen de paiement</label>
                    <select
                      id="fr-moyen"
                      className="champ"
                      value={moyenReglement}
                      onChange={(e) => setMoyenReglement(e.target.value)}
                    >
                      <option value="especes">Espèces</option>
                      <option value="wave">Wave</option>
                      <option value="orange_money">Orange Money</option>
                      <option value="cheque">Chèque</option>
                      <option value="virement">Virement</option>
                    </select>
                  </div>
                  <div className="actions-modale">
                    <button type="button" className="btn" onClick={() => { setFournisseurDette(null); setDetailFournisseur(null); }}>
                      Fermer
                    </button>
                    <button type="submit" className="btn btn-principal" disabled={enregistrementReglement}>
                      {enregistrementReglement ? 'Enregistrement…' : 'Enregistrer le règlement'}
                    </button>
                  </div>
                </form>

                {detailFournisseur.payments.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 14, marginTop: 20, marginBottom: 8 }}>Historique des règlements</h3>
                    <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                      {detailFournisseur.payments.map((p) => (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--encre-douce)' }}>
                          <span>{new Date(p.paid_at).toLocaleDateString('fr-FR')} · {p.user_name} · {LABEL_MOYEN[p.payment_method] || p.payment_method}</span>
                          <span className="chiffre">{Math.round(p.amount).toLocaleString('fr-FR')} FCFA</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function AchatsTab() {
  const { user } = useAuth();
  const estManager = user.role === 'manager';

  const [commandes, setCommandes] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [lignes, setLignes] = useState([{ productId: '', quantity: 1, unitCost: '' }]);

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
    Promise.all([api.getPurchaseOrders(activeWarehouseId), api.getSuppliers(), api.getProducts(activeWarehouseId)])
      .then(([po, s, p]) => {
        setCommandes(po);
        setSuppliers(s);
        setProducts(p);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, [activeWarehouseId]);

  function ajouterLigne() {
    setLignes([...lignes, { productId: '', quantity: 1, unitCost: '' }]);
  }

  function modifierLigne(index, champ, valeur) {
    const copie = [...lignes];
    copie[index] = { ...copie[index], [champ]: valeur };
    setLignes(copie);
  }

  function retirerLigne(index) {
    setLignes(lignes.filter((_, i) => i !== index));
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!supplierId) {
      setErreur('Choisissez un fournisseur.');
      return;
    }
    const items = lignes
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) || 0 }));

    if (items.length === 0) {
      setErreur('Ajoutez au moins un produit.');
      return;
    }

    try {
      await api.createPurchaseOrder({ supplierId, items, notes, warehouseId: activeWarehouseId });
      setModaleOuverte(false);
      setSupplierId('');
      setNotes('');
      setLignes([{ productId: '', quantity: 1, unitCost: '' }]);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleStatut(commande, status) {
    try {
      await api.updatePurchaseOrderStatus(commande.id, status);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handlePdf(commande) {
    try {
      await api.downloadPurchaseOrderPdf(commande.id);
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        {estManager && warehouses.length > 0 ? (
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
        ) : <span />}
        <button className="btn btn-principal" onClick={() => setModaleOuverte(true)} disabled={suppliers.length === 0 || !activeWarehouseId}>
          Nouvelle commande
        </button>
      </div>

      {estManager && !chargementBoutiques && warehouses.length === 0 && (
        <p className="etat-vide">Aucune boutique n'a encore été créée. Créez-en une avant de commander.</p>
      )}

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-outils">
        <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{commandes.length} commande(s)</span>
      </div>

      {suppliers.length === 0 && !chargement && (
        <p className="etat-vide">Ajoutez d'abord un fournisseur avant de créer une commande.</p>
      )}

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : commandes.length === 0 ? (
        suppliers.length > 0 && <p className="etat-vide">Aucune commande fournisseur pour le moment.</p>
      ) : (
        <div className="liste-a-encaisser">
          {commandes.map((c) => (
            <div key={c.id} className="carte-a-encaisser">
              <span className="stat-icone" style={{ ...COULEUR_STATUT_ACHAT[c.status], width: 36, height: 36, flexShrink: 0 }}>
                <IconBonAchat />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="carte-a-encaisser-numero">{c.supplier_name}</p>
                <p className="carte-a-encaisser-client">{Number(c.total_amount).toLocaleString('fr-FR')} FCFA</p>
              </div>
              <select
                className="champ"
                style={{ width: 'auto', padding: '5px 8px', fontSize: 13 }}
                value={c.status}
                onChange={(e) => handleStatut(c, e.target.value)}
              >
                {STATUTS_ACHAT.map((s) => (
                  <option key={s} value={s}>{LABEL_STATUT_ACHAT[s]}</option>
                ))}
              </select>
              <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => handlePdf(c)}>
                PDF
              </button>
            </div>
          ))}
        </div>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle commande fournisseur</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="po-supplier">Fournisseur</label>
                <select
                  id="po-supplier"
                  className="champ"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">Choisir un fournisseur</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <label className="etiquette">Articles à commander</label>
              {lignes.map((ligne, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select
                    className="champ"
                    value={ligne.productId}
                    onChange={(e) => modifierLigne(index, 'productId', e.target.value)}
                  >
                    <option value="">Produit</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    className="champ"
                    style={{ width: 70 }}
                    placeholder="Qté"
                    value={ligne.quantity}
                    onChange={(e) => modifierLigne(index, 'quantity', e.target.value)}
                  />
                  <input
                    type="number"
                    min="0"
                    className="champ"
                    style={{ width: 110 }}
                    placeholder="Coût unit."
                    value={ligne.unitCost}
                    onChange={(e) => modifierLigne(index, 'unitCost', e.target.value)}
                  />
                  {lignes.length > 1 && (
                    <button type="button" className="btn" onClick={() => retirerLigne(index)}>
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="btn" onClick={ajouterLigne} style={{ marginBottom: 16 }}>
                Ajouter un article
              </button>

              <div className="champ-groupe">
                <label className="etiquette" htmlFor="po-notes">Notes (facultatif)</label>
                <input
                  id="po-notes"
                  className="champ"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setModaleOuverte(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-principal">
                  Créer la commande
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
