import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

// Page réservée au propriétaire de la plateforme (rôle "owner"). Indépendante
// du layout commerçant habituel (pas de Sidebar) puisqu'un owner n'a pas de
// `merchant` — ce qui casserait toute page conçue pour un commerce.

function IconEntreprise() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="4" y="8" width="16" height="13" rx="1.3" />
      <path d="M9 21v-5h6v5" />
      <path d="M9 8V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3" />
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

function IconCadenas() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function IconJauge() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14a8 8 0 1 1 16 0" />
      <path d="M12 14l3.5-4" />
      <path d="M12 14v.01" />
    </svg>
  );
}

function IconSupprimer() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

function IconChevron({ ouvert }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: ouvert ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease', flexShrink: 0 }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const boutonPetit = { padding: '6px 10px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 };

export function AdminPage() {
  const { user, logout } = useAuth();
  const [commercants, setCommercants] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [recherche, setRecherche] = useState('');
  const [commercantOuvert, setCommercantOuvert] = useState(null);
  const [equipe, setEquipe] = useState([]);
  const [chargementEquipe, setChargementEquipe] = useState(false);

  const [modalePlafond, setModalePlafond] = useState(null); // { commercant, type: 'comptes' | 'boutiques' }
  const [valeurPlafond, setValeurPlafond] = useState('');
  const [enregistrementPlafond, setEnregistrementPlafond] = useState(false);

  // Import de produits en masse depuis Excel, pour le commerçant déplié.
  const [boutiquesImport, setBoutiquesImport] = useState([]);
  const [boutiqueImportId, setBoutiqueImportId] = useState('');
  const [fichierImport, setFichierImport] = useState(null);
  const [importEnCours, setImportEnCours] = useState(false);
  const [resultatImport, setResultatImport] = useState(null);

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

  const commercantsFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return commercants;
    return commercants.filter(
      (c) => c.business_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    );
  }, [commercants, recherche]);

  async function toggleCommercantOuvert(id) {
    if (commercantOuvert === id) {
      setCommercantOuvert(null);
      return;
    }
    setCommercantOuvert(id);
    setChargementEquipe(true);
    setFichierImport(null);
    setResultatImport(null);
    setBoutiqueImportId('');
    try {
      const [data, boutiques] = await Promise.all([api.getMerchantTeam(id), api.getMerchantWarehouses(id)]);
      setEquipe(data);
      setBoutiquesImport(boutiques);
      const actives = boutiques.filter((b) => b.is_active);
      setBoutiqueImportId(actives[0]?.id || '');
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

  function ouvrirModalePlafond(commercant, type) {
    setModalePlafond({ commercant, type });
    setValeurPlafond(String(type === 'comptes' ? commercant.max_team_members : commercant.max_warehouses));
  }

  async function handleEnregistrerPlafond(e) {
    e.preventDefault();
    const valeur = parseInt(valeurPlafond, 10);
    if (!Number.isInteger(valeur) || valeur < 1) {
      setErreur('Le plafond doit être un nombre entier positif.');
      return;
    }
    setEnregistrementPlafond(true);
    try {
      if (modalePlafond.type === 'comptes') {
        await api.setMerchantLimit(modalePlafond.commercant.id, valeur);
      } else {
        await api.setMerchantWarehouseLimit(modalePlafond.commercant.id, valeur);
      }
      setModalePlafond(null);
      await charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementPlafond(false);
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

  async function telechargerModeleImport(commercant) {
    try {
      await api.downloadMerchantProductsTemplate(commercant.id);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function importerProduits(commercant) {
    if (!fichierImport) {
      setErreur('Choisissez un fichier Excel à importer.');
      return;
    }
    if (!boutiqueImportId) {
      setErreur('Choisissez la boutique où loger le stock initial.');
      return;
    }
    setImportEnCours(true);
    setResultatImport(null);
    setErreur('');
    try {
      const resultat = await api.importMerchantProducts(commercant.id, boutiqueImportId, fichierImport);
      setResultatImport(resultat);
      setFichierImport(null);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setImportEnCours(false);
    }
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px 64px' }}>
      <div className="entete-page">
        <div>
          <h1>Administration</h1>
          <p style={{ color: 'var(--encre-douce)', fontSize: 13, margin: '4px 0 0' }}>
            Connecté en tant que {user?.fullName}
          </p>
        </div>
        <button type="button" className="btn" onClick={logout}>Se déconnecter</button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-filtres" style={{ marginBottom: 20 }}>
        <div className="champ-avec-icone champ-avec-icone--pleine-largeur">
          <span className="champ-icone"><IconRecherche /></span>
          <input
            type="text"
            className="champ champ--avec-icone"
            placeholder="Rechercher par nom ou e-mail…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : commercantsFiltres.length === 0 ? (
        <p className="etat-vide">
          {commercants.length === 0 ? 'Aucun commerçant sur la plateforme.' : 'Aucun commerçant ne correspond à cette recherche.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {commercantsFiltres.map((c) => {
            const ouvert = commercantOuvert === c.id;
            return (
              <div key={c.id} className="carte-entite">
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', cursor: 'pointer' }}
                  onClick={() => toggleCommercantOuvert(c.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span className="carte-entite-icone" style={{ flexShrink: 0 }}><IconEntreprise /></span>
                    <div style={{ minWidth: 0 }}>
                      <p className="carte-entite-nom" style={{ margin: 0 }}>{c.business_name}</p>
                      <p className="carte-entite-detail" style={{ margin: '2px 0 0' }}>
                        {c.sector || 'Secteur non renseigné'} · {c.email}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={`tampon ${c.is_active ? 'tampon-sarcelle' : 'tampon-brique'}`}>
                      {c.is_active ? 'Actif' : 'Bloqué'}
                    </span>
                    <span className="tampon" style={{ background: 'var(--fond-alterne, rgba(0,0,0,0.05))', color: 'var(--encre-douce)' }}>
                      {c.member_count} / {c.max_team_members} comptes
                    </span>
                    <span className="tampon" style={{ background: 'var(--fond-alterne, rgba(0,0,0,0.05))', color: 'var(--encre-douce)' }}>
                      {c.warehouse_count} / {c.max_warehouses} boutiques
                    </span>
                    <IconChevron ouvert={ouvert} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <button type="button" className="btn" style={boutonPetit} onClick={() => basculerStatutCommercant(c)}>
                    <IconCadenas />
                    {c.is_active ? 'Bloquer' : 'Débloquer'}
                  </button>
                  <button type="button" className="btn" style={boutonPetit} onClick={() => ouvrirModalePlafond(c, 'comptes')}>
                    <IconJauge />
                    Plafond comptes
                  </button>
                  <button type="button" className="btn" style={boutonPetit} onClick={() => ouvrirModalePlafond(c, 'boutiques')}>
                    <IconJauge />
                    Plafond boutiques
                  </button>
                  <button type="button" className="btn btn-brique" style={boutonPetit} onClick={() => supprimerCommercant(c)}>
                    <IconSupprimer />
                    Supprimer
                  </button>
                </div>

                {ouvert && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--trait)' }}>
                    {chargementEquipe ? (
                      <p style={{ color: 'var(--encre-douce)', fontSize: 13 }}>Chargement de l'équipe…</p>
                    ) : equipe.length === 0 ? (
                      <p style={{ color: 'var(--encre-douce)', fontSize: 13 }}>Aucun membre.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {equipe.map((membre) => (
                          <div
                            key={membre.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 12,
                              padding: '10px 12px',
                              background: 'var(--fond-alterne, rgba(0,0,0,0.03))',
                              borderRadius: 10,
                              flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ minWidth: 160 }}>
                              <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{membre.full_name}</p>
                              <p style={{ margin: 0, fontSize: 12, color: 'var(--encre-douce)' }}>{membre.email}</p>
                            </div>
                            <span className="tampon" style={{ textTransform: 'capitalize', background: 'var(--fond-alterne, rgba(0,0,0,0.06))', color: 'var(--encre-douce)' }}>
                              {membre.role}
                            </span>
                            <span className={`tampon ${membre.is_active ? 'tampon-sarcelle' : 'tampon-brique'}`}>
                              {membre.is_active ? 'Actif' : 'Bloqué'}
                            </span>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button type="button" className="btn" style={boutonPetit} onClick={() => basculerStatutUtilisateur(membre)}>
                                {membre.is_active ? 'Bloquer' : 'Débloquer'}
                              </button>
                              <button type="button" className="btn" style={boutonPetit} onClick={() => reinitialiserMotDePasse(membre)}>
                                Mot de passe
                              </button>
                              <button type="button" className="btn btn-brique" style={boutonPetit} onClick={() => supprimerUtilisateur(membre)}>
                                Supprimer
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--trait)' }}>
                      <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 13 }}>Import de produits (Excel)</p>

                      {boutiquesImport.length === 0 ? (
                        <p style={{ color: 'var(--encre-douce)', fontSize: 13 }}>
                          Ce commerçant n'a aucune boutique — créez-en une avant d'importer des produits.
                        </p>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <button type="button" className="btn" style={boutonPetit} onClick={() => telechargerModeleImport(c)}>
                            Télécharger le modèle
                          </button>

                          <select
                            className="champ"
                            style={{ maxWidth: 200 }}
                            value={boutiqueImportId}
                            onChange={(e) => setBoutiqueImportId(e.target.value)}
                          >
                            {boutiquesImport.filter((b) => b.is_active).map((b) => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>

                          <input
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={(e) => setFichierImport(e.target.files[0] || null)}
                            style={{ fontSize: 13, maxWidth: 220 }}
                          />

                          <button
                            type="button"
                            className="btn btn-principal"
                            style={boutonPetit}
                            disabled={importEnCours || !fichierImport}
                            onClick={() => importerProduits(c)}
                          >
                            {importEnCours ? 'Import…' : 'Importer'}
                          </button>
                        </div>
                      )}

                      {resultatImport && (
                        <div style={{ marginTop: 10, fontSize: 13 }}>
                          <p style={{ margin: 0 }}>
                            {resultatImport.created} créé(s) · {resultatImport.updated} mis à jour · {resultatImport.errors.length} erreur(s)
                          </p>
                          {resultatImport.errors.length > 0 && (
                            <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--danger)' }}>
                              {resultatImport.errors.map((e, i) => (
                                <li key={i}>Ligne {e.ligne} : {e.message}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modalePlafond && (
        <div className="modale-fond" onClick={() => setModalePlafond(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>
              Plafond {modalePlafond.type === 'comptes' ? 'de comptes' : 'de boutiques'} — {modalePlafond.commercant.business_name}
            </h2>
            <form onSubmit={handleEnregistrerPlafond}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="a-plafond">
                  Nombre maximum {modalePlafond.type === 'comptes' ? 'de comptes' : 'de boutiques'}
                </label>
                <input
                  id="a-plafond"
                  type="number"
                  min="1"
                  className="champ"
                  value={valeurPlafond}
                  onChange={(e) => setValeurPlafond(e.target.value)}
                />
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setModalePlafond(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={enregistrementPlafond}>
                  {enregistrementPlafond ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
