import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useLiveEvent } from '../offline/liveEvents';

const LABEL_MOYEN = { especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', cheque: 'Chèque', virement: 'Virement' };

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

const FILTRES_DETTE = [
  { value: 'tous', label: 'Tous' },
  { value: 'dette', label: 'Avec dette' },
  { value: 'a_jour', label: 'À jour' },
];

export function SuppliersPage() {
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

  return (
    <>
      <div className="entete-page">
        <h1>Fournisseurs</h1>
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
