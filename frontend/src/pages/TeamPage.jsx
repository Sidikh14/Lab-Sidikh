import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getSecteurConfig } from '../config/sectorConfig';
import { useLiveEvent } from '../offline/liveEvents';
import { StylesModernes } from '../components/StylesModernes';

function initialesMembre(nom) {
  return (nom || '?').split(' ').filter(Boolean).map((mot) => mot[0]).slice(0, 2).join('').toUpperCase();
}

function IconEquipe() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 19c0-3.6 2.9-5.8 6.5-5.8s6.5 2.2 6.5 5.8" />
      <path d="M16 8.4a3 3 0 1 1 3.6 2.9" />
      <path d="M21.5 19c0-2.7-1.7-4.6-4-5.4" />
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

function IconCadenas() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function IconCle() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8" />
      <path d="M16 7l2 2" />
      <path d="M19 4l2 2" />
    </svg>
  );
}

function IconRole() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3l4 4-4 4" />
      <path d="M21 7H9" />
      <path d="M7 21l-4-4 4-4" />
      <path d="M3 17h12" />
    </svg>
  );
}

function IconSupprimer() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

// Rôles qui vendent : affectables uniquement à une boutique (un dépôt sert au
// stockage seul — seul un gérant peut y être affecté).
const ROLES_VENTE = ['vendeur', 'caissier', 'vendeur_caissier'];

function lieuxAffectables(warehouses, role) {
  return ROLES_VENTE.includes(role) ? warehouses.filter((w) => w.type !== 'depot') : warehouses;
}

function IconBoutique() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

const FILTRES_STATUT = [
  { value: 'tous', label: 'Tous' },
  { value: 'actifs', label: 'Actifs' },
  { value: 'desactives', label: 'Désactivés' },
];

const ROLES_PROPOSES = {
  manager: [
    { value: 'gerant', label: 'Gérant' },
    { value: 'vendeur', label: 'Vendeur' },
    { value: 'caissier', label: 'Caissier' },
    { value: 'vendeur_caissier', label: 'Vendeur/Caissier' },
  ],
};

const MODULES = [
  { value: 'stock', label: 'Stock' },
  { value: 'ventes', label: 'Ventes' },
  { value: 'clients', label: 'Clients' },
  { value: 'fournisseurs', label: 'Fournisseurs' },
  { value: 'achats', label: 'Commandes fournisseurs' },
  { value: 'caisse', label: 'Caisse' },
];

const MODULES_PAR_DEFAUT = {
  gerant: ['stock', 'ventes', 'clients', 'fournisseurs', 'achats', 'caisse'],
  vendeur: ['stock', 'ventes', 'clients'],
  caissier: ['ventes', 'caisse'],
  vendeur_caissier: ['stock', 'ventes', 'clients', 'caisse'],
};

const TOUS_LES_ROLES = [
  { value: 'gerant', label: 'Gérant' },
  { value: 'vendeur', label: 'Vendeur' },
  { value: 'caissier', label: 'Caissier' },
  { value: 'vendeur_caissier', label: 'Vendeur/Caissier' },
];

const NOMS_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
function formatMois(moisStr) {
  const [annee, mois] = moisStr.split('-');
  return `${NOMS_MOIS[Number(mois) - 1]} ${annee}`;
}

// La gestion de la paie (salaires, bulletins, réglages) a son propre module : page « Paie ».
// Cette page ne garde que l'équipe ; les autres rôles y trouvent « Mes bulletins ».
export function TeamPage() {
  const { user } = useAuth();
  const estManager = user.role === 'manager';
  // "Équipe" reste réservé à manager/gérant ; les autres rôles (caissier, vendeur…)
  // n'ont accès qu'à "Mes bulletins".
  const voitTrombinoscope = ['manager', 'gerant'].includes(user.role);
  const [searchParams] = useSearchParams();
  const [onglet, setOnglet] = useState(() => (voitTrombinoscope ? 'equipe' : 'mes-bulletins'));

  // Anciens liens vers l'onglet Salaires (rappels, tableau de bord) : redirigés vers la page Paie.
  if (estManager && ['salaires', 'reglages-paie'].includes(searchParams.get('tab'))) {
    return <Navigate to="/paie" replace />;
  }

  return (
    <>
      <StylesModernes />
      <div className="entete-page">
        <h1>Équipe</h1>
      </div>

      {!voitTrombinoscope && (
        <div className="onglets" style={{ marginBottom: 20 }}>
          <button className={onglet === 'mes-bulletins' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('mes-bulletins')}>
            Mes bulletins
          </button>
        </div>
      )}

      {onglet === 'equipe' && <EquipeTab />}
      {onglet === 'mes-bulletins' && <MesBulletinsTab />}
    </>
  );
}

function EquipeTab() {
  const { user, merchant } = useAuth();
  const secteurConfig = getSecteurConfig(merchant?.sector);
  const rolesProposes = ROLES_PROPOSES[user.role] || [];
  const estManager = user.role === 'manager';

  const [membres, setMembres] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouveauMembre, setNouveauMembre] = useState({
    fullName: '',
    email: '',
    password: '',
    role: rolesProposes[0]?.value || 'vendeur',
    warehouseId: '',
  });

  const [warehouses, setWarehouses] = useState([]);

  useEffect(() => {
    if (!estManager) return;
    api.getWarehouses()
      .then((liste) => setWarehouses(liste.filter((w) => w.is_active)))
      .catch((err) => setErreur(err.message));
  }, [estManager]);

  function charger() {
    setChargement(true);
    api
      .getUsers()
      .then(setMembres)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  useLiveEvent('activity:created', () => charger());

  const [recherche, setRecherche] = useState('');
  const [filtreStatut, setFiltreStatut] = useState('tous');

  const membresFiltres = useMemo(() => {
    return membres.filter((m) => {
      const correspondRecherche =
        m.full_name.toLowerCase().includes(recherche.toLowerCase()) ||
        m.email.toLowerCase().includes(recherche.toLowerCase());
      const correspondStatut =
        filtreStatut === 'tous' ||
        (filtreStatut === 'actifs' && m.is_active) ||
        (filtreStatut === 'desactives' && !m.is_active);
      return correspondRecherche && correspondStatut;
    });
  }, [membres, recherche, filtreStatut]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!nouveauMembre.fullName || !nouveauMembre.email || !nouveauMembre.password) {
      setErreur('Tous les champs sont requis.');
      return;
    }
    const warehouseId = estManager ? nouveauMembre.warehouseId : user.warehouseId;
    if (!warehouseId) {
      setErreur(`La ${secteurConfig.libelleBoutique.toLowerCase()} est requise.`);
      return;
    }
    try {
      await api.createUser({ ...nouveauMembre, warehouseId });
      setModaleOuverte(false);
      setNouveauMembre({ fullName: '', email: '', password: '', role: rolesProposes[0]?.value || 'vendeur', warehouseId: '' });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleToggleStatus(membre) {
    try {
      await api.setUserStatus(membre.id, !membre.is_active);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const [membrePermissions, setMembrePermissions] = useState(null);
  const [selectionModules, setSelectionModules] = useState([]);

  function ouvrirPermissions(membre) {
    setMembrePermissions(membre);
    setSelectionModules(membre.visible_modules ?? MODULES_PAR_DEFAUT[membre.role] ?? []);
  }

  function toggleModule(value) {
    setSelectionModules((prev) =>
      prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value]
    );
  }

  async function handleSavePermissions(e) {
    e.preventDefault();
    try {
      await api.setUserPermissions(membrePermissions.id, selectionModules);
      setMembrePermissions(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleResetPermissions() {
    try {
      await api.setUserPermissions(membrePermissions.id, null);
      setMembrePermissions(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const [membreMotDePasse, setMembreMotDePasse] = useState(null);
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState('');
  const [messageMotDePasse, setMessageMotDePasse] = useState('');

  function ouvrirResetMotDePasse(membre) {
    setMembreMotDePasse(membre);
    setNouveauMotDePasse('');
    setMessageMotDePasse('');
  }

  async function handleResetMotDePasse(e) {
    e.preventDefault();
    if (nouveauMotDePasse.length < 6) {
      setErreur('Le nouveau mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    try {
      await api.resetUserPassword(membreMotDePasse.id, nouveauMotDePasse);
      setMessageMotDePasse(`Mot de passe de ${membreMotDePasse.full_name} réinitialisé avec succès.`);
      setNouveauMotDePasse('');
    } catch (err) {
      setErreur(err.message);
    }
  }

  const [membreRole, setMembreRole] = useState(null);
  const [nouveauRole, setNouveauRole] = useState('');
  const [enregistrementRole, setEnregistrementRole] = useState(false);

  function ouvrirChangerRole(membre) {
    setMembreRole(membre);
    setNouveauRole(membre.role);
  }

  async function handleChangerRole(e) {
    e.preventDefault();
    if (nouveauRole === membreRole.role) {
      setMembreRole(null);
      return;
    }
    setEnregistrementRole(true);
    try {
      await api.setUserRole(membreRole.id, nouveauRole);
      setMembreRole(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementRole(false);
    }
  }

  async function handleSupprimer(membre) {
    const confirme = window.confirm(
      `Supprimer définitivement ${membre.full_name} de l'équipe ? Cette action est irréversible.`
    );
    if (!confirme) return;
    try {
      await api.deleteUser(membre.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const [membreBoutique, setMembreBoutique] = useState(null);
  const [nouvelleBoutique, setNouvelleBoutique] = useState('');
  const [enregistrementBoutique, setEnregistrementBoutique] = useState(false);

  function ouvrirChangerBoutique(membre) {
    setMembreBoutique(membre);
    setNouvelleBoutique(membre.warehouse_id || '');
  }

  async function handleChangerBoutique(e) {
    e.preventDefault();
    if (!nouvelleBoutique) {
      setErreur(`La ${secteurConfig.libelleBoutique.toLowerCase()} est requise.`);
      return;
    }
    setEnregistrementBoutique(true);
    try {
      await api.setUserWarehouse(membreBoutique.id, nouvelleBoutique);
      setMembreBoutique(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementBoutique(false);
    }
  }

  return (
    <>
      {rolesProposes.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button
            className="btn btn-principal"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, boxShadow: '0 6px 16px -6px var(--accent)', fontWeight: 600 }}
            onClick={() => setModaleOuverte(true)}
          >
            <IconPlus />
            Ajouter un membre
          </button>
        </div>
      )}

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="md-kpis">
        <div className="md-kpi md-kpi--hero">
          <span className="md-kpi-icone"><IconEquipe /></span>
          <p className="md-kpi-label">Membres</p>
          <p className="md-kpi-valeur">{membres.length}</p>
        </div>
        <div className="md-kpi">
          <span className="md-kpi-icone"><IconEquipe /></span>
          <p className="md-kpi-label">Actifs</p>
          <p className="md-kpi-valeur">{membres.filter((m) => m.is_active).length}</p>
        </div>
        <div className={'md-kpi' + (membres.some((m) => !m.is_active) ? ' md-kpi--alerte' : '')}>
          <span className="md-kpi-icone"><IconCadenas /></span>
          <p className="md-kpi-label">Désactivés</p>
          <p className="md-kpi-valeur">{membres.filter((m) => !m.is_active).length}</p>
        </div>
      </div>

      <div className="md-outils">
        <div className="champ-avec-icone md-recherche">
          <span className="champ-icone"><IconRecherche /></span>
          <input
            type="text"
            className="champ champ--avec-icone"
            placeholder="Rechercher par nom ou email…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
      </div>

      <div className="md-barre-vue">
        <div className="md-puces">
          {FILTRES_STATUT.map((f) => {
            const nb =
              f.value === 'tous'
                ? membres.length
                : membres.filter((m) => (f.value === 'actifs' ? m.is_active : !m.is_active)).length;
            return (
              <button
                key={f.value}
                type="button"
                className={'md-puce' + (filtreStatut === f.value ? ' actif' : '')}
                onClick={() => setFiltreStatut(f.value)}
              >
                {f.label} <span>{nb}</span>
              </button>
            );
          })}
        </div>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : membresFiltres.length === 0 ? (
        <p className="etat-vide">
          {membres.length === 0 ? 'Aucun membre pour le moment.' : 'Aucun membre ne correspond à ces filtres.'}
        </p>
      ) : (
        <div className="grille-cartes">
          {membresFiltres.map((m) => (
            <div key={m.id} className="carte-entite">
              <div className="carte-entite-entete">
                <span className="md-avatar">{initialesMembre(m.full_name)}</span>
                <span className={`tampon ${m.is_active ? 'tampon-sarcelle' : 'tampon-brique'}`}>
                  {m.is_active ? 'Actif' : 'Désactivé'}
                </span>
              </div>
              <p className="carte-entite-nom">{m.full_name}</p>
              <p className="carte-entite-detail">{m.email}</p>
              <p className="carte-entite-metrique" style={{ textTransform: 'capitalize' }}>{m.role}</p>
              {m.warehouse_name && <p className="carte-entite-detail">{m.warehouse_name}</p>}
              <p className="carte-entite-souslegende">Depuis le {new Date(m.created_at).toLocaleDateString('fr-FR')}</p>
              {estManager && m.role !== 'manager' && (
                <div className="carte-entite-actions">
                  <button
                    className="btn"
                    style={{ padding: '7px 10px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={() => ouvrirPermissions(m)}
                  >
                    Permissions
                  </button>
                  <button
                    className="btn"
                    style={{ padding: '7px 10px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={() => ouvrirChangerRole(m)}
                    title="Changer le rôle"
                  >
                    <IconRole />
                    Rôle
                  </button>
                  <button
                    className="btn"
                    style={{ padding: '7px 10px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={() => ouvrirChangerBoutique(m)}
                    title={`Changer de ${secteurConfig.libelleBoutique.toLowerCase()}`}
                  >
                    <IconBoutique />
                    {secteurConfig.libelleBoutique}
                  </button>
                  <button
                    className="btn"
                    style={{ padding: '7px 10px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={() => ouvrirResetMotDePasse(m)}
                    title="Réinitialiser le mot de passe"
                  >
                    <IconCle />
                    Mot de passe
                  </button>
                  <button
                    className="btn"
                    style={{ padding: '7px 10px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={() => handleToggleStatus(m)}
                    title={m.is_active ? 'Désactiver ce membre' : 'Réactiver ce membre'}
                  >
                    <IconCadenas />
                    {m.is_active ? 'Désactiver' : 'Réactiver'}
                  </button>
                  <button
                    className="btn"
                    style={{ padding: '7px 10px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--danger, #b3423a)' }}
                    onClick={() => handleSupprimer(m)}
                    title="Supprimer définitivement ce membre"
                  >
                    <IconSupprimer />
                    Supprimer
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Ajouter un membre</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="m-name">Nom complet</label>
                <input
                  id="m-name"
                  className="champ"
                  value={nouveauMembre.fullName}
                  onChange={(e) => setNouveauMembre({ ...nouveauMembre, fullName: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="m-email">Email</label>
                <input
                  id="m-email"
                  type="email"
                  className="champ"
                  value={nouveauMembre.email}
                  onChange={(e) => setNouveauMembre({ ...nouveauMembre, email: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="m-password">Mot de passe temporaire</label>
                <input
                  id="m-password"
                  type="password"
                  className="champ"
                  value={nouveauMembre.password}
                  onChange={(e) => setNouveauMembre({ ...nouveauMembre, password: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="m-role">Rôle</label>
                <select
                  id="m-role"
                  className="champ"
                  value={nouveauMembre.role}
                  onChange={(e) => {
                    const role = e.target.value;
                    const lieuValide = lieuxAffectables(warehouses, role).some((w) => w.id === nouveauMembre.warehouseId);
                    setNouveauMembre({ ...nouveauMembre, role, warehouseId: lieuValide ? nouveauMembre.warehouseId : '' });
                  }}
                >
                  {rolesProposes.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              {estManager && (
                <div className="champ-groupe">
                  <label className="etiquette" htmlFor="m-boutique">{secteurConfig.libelleBoutique}</label>
                  <select
                    id="m-boutique"
                    className="champ"
                    value={nouveauMembre.warehouseId}
                    onChange={(e) => setNouveauMembre({ ...nouveauMembre, warehouseId: e.target.value })}
                  >
                    <option value="">Choisir une {secteurConfig.libelleBoutique.toLowerCase()}</option>
                    {lieuxAffectables(warehouses, nouveauMembre.role).map((w) => (
                      <option key={w.id} value={w.id}>{w.name}{w.type === 'depot' ? ' (dépôt)' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
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

      {membrePermissions && (
        <div className="modale-fond" onClick={() => setMembrePermissions(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Permissions de {membrePermissions.full_name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
              Cochez les pages que ce membre peut voir dans son compte.
            </p>
            <form onSubmit={handleSavePermissions}>
              {MODULES.map((m) => (
                <label key={m.value} className="case-a-cocher" style={{ marginBottom: 10 }}>
                  <input
                    type="checkbox"
                    checked={selectionModules.includes(m.value)}
                    onChange={() => toggleModule(m.value)}
                  />
                  {m.label}
                </label>
              ))}
              <div className="actions-modale">
                <button type="button" className="btn" onClick={handleResetPermissions}>
                  Réinitialiser (par défaut)
                </button>
                <button type="submit" className="btn btn-principal">
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {membreMotDePasse && (
        <div className="modale-fond" onClick={() => setMembreMotDePasse(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Réinitialiser le mot de passe de {membreMotDePasse.full_name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
              Communiquez ce nouveau mot de passe temporaire au membre concerné.
            </p>
            {messageMotDePasse && (
              <div className="tampon tampon-sarcelle" style={{ display: 'block', marginBottom: 12 }}>
                {messageMotDePasse}
              </div>
            )}
            <form onSubmit={handleResetMotDePasse}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="m-nouveau-mdp">Nouveau mot de passe</label>
                <input
                  id="m-nouveau-mdp"
                  type="password"
                  className="champ"
                  value={nouveauMotDePasse}
                  onChange={(e) => setNouveauMotDePasse(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setMembreMotDePasse(null)}>
                  Fermer
                </button>
                <button type="submit" className="btn btn-principal">
                  Réinitialiser
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {membreRole && (
        <div className="modale-fond" onClick={() => setMembreRole(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Changer le rôle de {membreRole.full_name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
              Rôle actuel : <strong style={{ textTransform: 'capitalize' }}>{membreRole.role}</strong>. Les permissions personnalisées seront réinitialisées sur les modules par défaut du nouveau rôle.
            </p>
            <form onSubmit={handleChangerRole}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="m-nouveau-role">Nouveau rôle</label>
                <select
                  id="m-nouveau-role"
                  className="champ"
                  value={nouveauRole}
                  onChange={(e) => setNouveauRole(e.target.value)}
                >
                  {TOUS_LES_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setMembreRole(null)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-principal" disabled={enregistrementRole}>
                  {enregistrementRole ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {membreBoutique && (
        <div className="modale-fond" onClick={() => setMembreBoutique(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Changer la {secteurConfig.libelleBoutique.toLowerCase()} de {membreBoutique.full_name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
              {secteurConfig.libelleBoutique} actuelle : <strong>{membreBoutique.warehouse_name || 'aucune'}</strong>.
            </p>
            <form onSubmit={handleChangerBoutique}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="m-nouvelle-boutique">Nouvelle {secteurConfig.libelleBoutique.toLowerCase()}</label>
                <select
                  id="m-nouvelle-boutique"
                  className="champ"
                  value={nouvelleBoutique}
                  onChange={(e) => setNouvelleBoutique(e.target.value)}
                >
                  <option value="">Choisir une {secteurConfig.libelleBoutique.toLowerCase()}</option>
                  {lieuxAffectables(warehouses, membreBoutique.role).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}{w.type === 'depot' ? ' (dépôt)' : ''}</option>
                  ))}
                </select>
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setMembreBoutique(null)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-principal" disabled={enregistrementBoutique}>
                  {enregistrementBoutique ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function MesBulletinsTab() {
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
