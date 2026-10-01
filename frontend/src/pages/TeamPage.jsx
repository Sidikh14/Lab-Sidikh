import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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

const METHODES = [
  { value: 'especes', label: 'Espèces' },
  { value: 'virement', label: 'Virement bancaire' },
  { value: 'wave', label: 'Wave' },
  { value: 'orange_money', label: 'Orange Money' },
];

function libelleMethode(value) {
  return METHODES.find((m) => m.value === value)?.label || value || '—';
}

const NOMS_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
function formatMois(moisStr) {
  const [annee, mois] = moisStr.split('-');
  return `${NOMS_MOIS[Number(mois) - 1]} ${annee}`;
}

// Page fusionnée (20/09) : Équipe + Salaires, en deux onglets, pour alléger
// la barre latérale. Salaires reste réservé au manager (comme avant, la
// Sidebar ne donnait ce lien qu'à lui) — l'onglet est masqué pour le gérant.
export function TeamPage() {
  const { user } = useAuth();
  const estManager = user.role === 'manager';
  // "Équipe" (trombinoscope + salaires) reste réservé à manager/gérant ; les
  // autres rôles (caissier, vendeur…) n'ont accès qu'à "Mes bulletins".
  const voitTrombinoscope = ['manager', 'gerant'].includes(user.role);
  const [searchParams] = useSearchParams();
  const [onglet, setOnglet] = useState(() => {
    if (!voitTrombinoscope) return 'mes-bulletins';
    return searchParams.get('tab') === 'salaires' && estManager ? 'salaires' : 'equipe';
  });

  return (
    <>
      <StylesModernes />
      <div className="entete-page">
        <h1>Équipe</h1>
      </div>

      <div className="onglets" style={{ marginBottom: 20 }}>
        {voitTrombinoscope && (
          <button className={onglet === 'equipe' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('equipe')}>
            Équipe
          </button>
        )}
        {estManager && (
          <button className={onglet === 'salaires' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('salaires')}>
            Salaires
          </button>
        )}
        {estManager && (
          <button className={onglet === 'reglages-paie' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('reglages-paie')}>
            Réglages paie
          </button>
        )}
        {!estManager && (
          <button className={onglet === 'mes-bulletins' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('mes-bulletins')}>
            Mes bulletins
          </button>
        )}
      </div>

      {onglet === 'equipe' && <EquipeTab />}
      {onglet === 'salaires' && <SalairesTab />}
      {onglet === 'reglages-paie' && <ReglagesPaieTab />}
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

function SalairesTab() {
  const [mois, setMois] = useState(null);
  const [moisMax, setMoisMax] = useState(null);
  const [employes, setEmployes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const [employeConfig, setEmployeConfig] = useState(null);
  const [salaireSaisi, setSalaireSaisi] = useState('');
  const [methodeSaisie, setMethodeSaisie] = useState('especes');
  const [partsSaisies, setPartsSaisies] = useState(1);

  // Primes fixes (page distincte du bouton "Configurer") : reprises
  // automatiquement à l'ouverture du bulletin de chaque mois.
  const [employePrimesFixes, setEmployePrimesFixes] = useState(null);
  const [primesFixes, setPrimesFixes] = useState([]);

  const [employePaiement, setEmployePaiement] = useState(null);
  const [montantPaiement, setMontantPaiement] = useState('');
  const [methodePaiement, setMethodePaiement] = useState('especes');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const [employeBulletin, setEmployeBulletin] = useState(null);
  const [primes, setPrimes] = useState([]);
  const [bulletinCalcule, setBulletinCalcule] = useState(null);
  const [chargementBulletin, setChargementBulletin] = useState(false);

  useEffect(() => {
    api
      .getSalaryMaxMonth()
      .then((data) => {
        setMoisMax(data.maxMonth);
        setMois(data.maxMonth);
      })
      .catch((err) => setErreur(err.message));
  }, []);

  function charger() {
    if (!mois) return;
    setChargement(true);
    setErreur('');
    api
      .getSalaries(mois)
      .then((data) => setEmployes(data.employees))
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, [mois]);

  function ouvrirPrimesFixes(emp) {
    setEmployePrimesFixes(emp);
    setPrimesFixes(Array.isArray(emp.recurring_bonuses) ? emp.recurring_bonuses.map((p) => ({ label: p.label, amount: p.amount })) : []);
  }

  async function enregistrerPrimesFixes(e) {
    e.preventDefault();
    setEnvoiEnCours(true);
    setErreur('');
    try {
      await api.setSalary(employePrimesFixes.id, {
        monthlySalary: Number(employePrimesFixes.monthly_salary) || 0,
        paymentMethod: employePrimesFixes.payment_method || 'especes',
        partsFiscales: Number(employePrimesFixes.parts_fiscales) || 1,
        recurringBonuses: primesFixes
          .filter((p) => p.label && Number(p.amount))
          .map((p) => ({ label: p.label, amount: Number(p.amount) })),
      });
      setEmployePrimesFixes(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  function ouvrirConfig(emp) {
    setEmployeConfig(emp);
    setSalaireSaisi(emp.monthly_salary || '');
    setMethodeSaisie(emp.payment_method || 'especes');
    setPartsSaisies(emp.parts_fiscales || 1);
  }

  async function enregistrerConfig(e) {
    e.preventDefault();
    if (!salaireSaisi || Number(salaireSaisi) <= 0) {
      setErreur('Montant du salaire invalide.');
      return;
    }
    setEnvoiEnCours(true);
    try {
      await api.setSalary(employeConfig.id, {
        monthlySalary: Number(salaireSaisi),
        paymentMethod: methodeSaisie,
        partsFiscales: Number(partsSaisies) || 1,
      });
      setEmployeConfig(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  function ouvrirPaiement(emp) {
    setEmployePaiement(emp);
    setMethodePaiement(emp.payment_method || 'especes');
    setMontantPaiement(emp.payslip_net);
  }

  async function ouvrirBulletin(emp) {
    setEmployeBulletin(emp);
    setBulletinCalcule(null);
    setChargementBulletin(true);
    try {
      const existantes = await api.getSalaryBonuses(emp.id, mois);
      if (existantes.length > 0) {
        setPrimes(existantes.map((p) => ({ label: p.label, amount: p.amount })));
      } else {
        // Rien de saisi pour ce mois : on reprend les primes fixes configurées
        // pour l'employé, sauf si un bulletin existe déjà pour ce mois.
        let dejaGenere = false;
        try {
          await api.getPayslip(emp.id, mois);
          dejaGenere = true;
        } catch {
          dejaGenere = false;
        }
        const config = Array.isArray(emp.recurring_bonuses) ? emp.recurring_bonuses : [];
        setPrimes(dejaGenere ? [] : config.map((p) => ({ label: p.label, amount: p.amount })));
      }
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargementBulletin(false);
    }
  }

  function ajouterPrime() {
    setPrimes((p) => [...p, { label: '', amount: '' }]);
  }

  function modifierPrime(index, champ, valeur) {
    setPrimes((p) => p.map((prime, i) => (i === index ? { ...prime, [champ]: valeur } : prime)));
  }

  function retirerPrime(index) {
    setPrimes((p) => p.filter((_, i) => i !== index));
  }

  async function genererBulletin(e) {
    e.preventDefault();
    setEnvoiEnCours(true);
    setErreur('');
    try {
      const bonusesValides = primes
        .filter((p) => p.label && Number(p.amount))
        .map((p) => ({ label: p.label, amount: Number(p.amount) }));
      const resultat = await api.generatePayslip(employeBulletin.id, { month: mois, bonuses: bonusesValides });
      setBulletinCalcule(resultat);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function confirmerPaiement(e) {
    e.preventDefault();
    setEnvoiEnCours(true);
    try {
      await api.paySalary(employePaiement.id, {
        month: mois,
        paymentMethod: methodePaiement,
      });
      setEmployePaiement(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  // Synthèse du mois affiché.
  const masseSalariale = employes.reduce((somme, emp) => somme + Number(emp.monthly_salary || 0), 0);
  const employesPayes = employes.filter((emp) => Boolean(emp.paid_at));
  const montantPaye = employesPayes.reduce((somme, emp) => somme + Number(emp.paid_amount || 0), 0);
  const resteAPayer = employes.length - employesPayes.length;

  return (
    <>
      <div className="md-kpis">
        <div className="md-kpi md-kpi--hero">
          <span className="md-kpi-icone"><IconEquipe /></span>
          <p className="md-kpi-label">Masse salariale</p>
          <p className="md-kpi-valeur">{Math.round(masseSalariale).toLocaleString('fr-FR')} <small>FCFA</small></p>
          <p className="md-kpi-sous">{employes.length} employé(s)</p>
        </div>
        <div className="md-kpi">
          <span className="md-kpi-icone"><IconEquipe /></span>
          <p className="md-kpi-label">Déjà payé</p>
          <p className="md-kpi-valeur">{Math.round(montantPaye).toLocaleString('fr-FR')} <small>FCFA</small></p>
          <p className="md-kpi-sous">{employesPayes.length} employé(s)</p>
        </div>
        <div className={'md-kpi' + (resteAPayer > 0 ? ' md-kpi--alerte' : '')}>
          <span className="md-kpi-icone"><IconCadenas /></span>
          <p className="md-kpi-label">Reste à payer</p>
          <p className="md-kpi-valeur">{resteAPayer}</p>
          <p className="md-kpi-sous">employé(s) non payé(s)</p>
        </div>
      </div>

      <div className="md-outils">
        <div className="champ-groupe" style={{ marginBottom: 0 }}>
          <label className="etiquette" htmlFor="mois-salaires">Mois</label>
          <input
            id="mois-salaires"
            type="month"
            className="champ"
            max={moisMax || undefined}
            value={mois || ''}
            onChange={(e) => setMois(e.target.value)}
          />
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : employes.length === 0 ? (
        <p className="etat-vide">Aucun employé actif.</p>
      ) : (
        <div className="md-liste">
          {employes.map((emp) => {
            const paye = Boolean(emp.paid_at);
            return (
              <div key={emp.id} className={'md-ligne' + (!paye ? ' md-ligne--prioritaire' : '')}>
                <div className="md-avatar">{initialesMembre(emp.name)}</div>

                <div className="md-bloc">
                  <p className="md-titre">{emp.name}</p>
                  <p className="md-sous" style={{ textTransform: 'capitalize' }}>
                    {emp.role} ·{' '}
                    <span style={{ textTransform: 'none' }}>
                      {emp.monthly_salary
                        ? `${Math.round(emp.monthly_salary).toLocaleString('fr-FR')} FCFA (${libelleMethode(emp.payment_method)})`
                        : 'salaire non configuré'}
                    </span>
                  </p>
                </div>

                <div className="md-bloc md-bloc--montant">
                  <span className={`tampon ${paye ? 'tampon-sarcelle' : 'tampon-brique'}`}>{paye ? 'Payé' : 'Non payé'}</span>
                  <p className="md-sous">
                    {paye
                      ? `Le ${new Date(emp.paid_at).toLocaleDateString('fr-FR')} · ${Math.round(emp.paid_amount).toLocaleString('fr-FR')} FCFA via ${libelleMethode(emp.paid_method)}`
                      : `Pour ${formatMois(mois)}`}
                  </p>
                </div>

                <div className="md-actions">
                  <button className="btn" onClick={() => ouvrirConfig(emp)}>Configurer</button>
                  <button className="btn" onClick={() => ouvrirPrimesFixes(emp)}>Primes fixes</button>
                  <button className="btn" disabled={!emp.monthly_salary} onClick={() => ouvrirBulletin(emp)}>
                    Bulletin
                  </button>
                  <button className="btn btn-principal" disabled={!emp.payslip_net} onClick={() => ouvrirPaiement(emp)}>
                    {paye ? 'Modifier le paiement' : 'Marquer comme payé'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {employeConfig && (
        <div className="modale-fond" onClick={() => setEmployeConfig(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Configurer le salaire — {employeConfig.name}</h2>
            <form onSubmit={enregistrerConfig}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="salaire-montant">Salaire mensuel (FCFA)</label>
                <input
                  id="salaire-montant"
                  type="number"
                  min="1"
                  className="champ"
                  value={salaireSaisi}
                  onChange={(e) => setSalaireSaisi(e.target.value)}
                  required
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="salaire-methode">Méthode de paiement</label>
                <select
                  id="salaire-methode"
                  className="champ"
                  value={methodeSaisie}
                  onChange={(e) => setMethodeSaisie(e.target.value)}
                >
                  {METHODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="salaire-parts">Parts fiscales (quotient familial)</label>
                <input
                  id="salaire-parts"
                  type="number"
                  min="1"
                  step="0.5"
                  className="champ"
                  value={partsSaisies}
                  onChange={(e) => setPartsSaisies(e.target.value)}
                />
                <p style={{ fontSize: 12, color: 'var(--encre-douce)', marginTop: 4 }}>
                  1 = célibataire sans enfant. Augmente selon la situation familiale déclarée par l'employé (mariage, enfants à charge…) — réduit l'impôt sur le revenu (IRPP) via le quotient familial.
                </p>
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setEmployeConfig(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={envoiEnCours}>Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {employePrimesFixes && (
        <div className="modale-fond" onClick={() => setEmployePrimesFixes(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Primes fixes — {employePrimesFixes.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
              Ces primes/indemnités sont reprises automatiquement à l'ouverture du bulletin de chaque mois. Modifie-les ici une fois pour toutes.
            </p>
            <form onSubmit={enregistrerPrimesFixes}>
              <div className="champ-groupe">
                {primesFixes.map((prime, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input
                      type="text"
                      className="champ"
                      placeholder="Libellé (ex. prime de transport)"
                      value={prime.label}
                      onChange={(e) => setPrimesFixes((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                      style={{ flex: 2 }}
                    />
                    <input
                      type="number"
                      className="champ"
                      placeholder="Montant"
                      value={prime.amount}
                      onChange={(e) => setPrimesFixes((l) => l.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn" onClick={() => setPrimesFixes((l) => l.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                <button type="button" className="btn" onClick={() => setPrimesFixes((l) => [...l, { label: '', amount: '' }])}>+ Ajouter une prime</button>
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setEmployePrimesFixes(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={envoiEnCours}>Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {employeBulletin && (
        <div className="modale-fond" onClick={() => setEmployeBulletin(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Bulletin de paie — {employeBulletin.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>{formatMois(mois)}</p>

            {chargementBulletin ? (
              <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
            ) : (
              <form onSubmit={genererBulletin}>
                <div className="champ-groupe">
                  <label className="etiquette">Primes / indemnités du mois</label>
                  {primes.map((prime, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <input
                        type="text"
                        className="champ"
                        placeholder="Libellé (ex. prime de transport)"
                        value={prime.label}
                        onChange={(e) => modifierPrime(i, 'label', e.target.value)}
                        style={{ flex: 2 }}
                      />
                      <input
                        type="number"
                        className="champ"
                        placeholder="Montant"
                        value={prime.amount}
                        onChange={(e) => modifierPrime(i, 'amount', e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button type="button" className="btn" onClick={() => retirerPrime(i)}>×</button>
                    </div>
                  ))}
                  <button type="button" className="btn" onClick={ajouterPrime}>+ Ajouter une prime</button>
                </div>

                <button type="submit" className="btn btn-principal" disabled={envoiEnCours} style={{ marginTop: 12 }}>
                  {envoiEnCours ? 'Calcul…' : 'Calculer et enregistrer le bulletin'}
                </button>
              </form>
            )}

            {bulletinCalcule && (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--bordure, #e5e5e5)' }}>
                <p className="carte-a-encaisser-client">Salaire brut : {Math.round(bulletinCalcule.gross_salary).toLocaleString('fr-FR')} FCFA</p>
                <p className="carte-a-encaisser-client">Retenues (IPRES, IRPP, TRIMF…) : {Math.round(bulletinCalcule.gross_salary - bulletinCalcule.net_a_payer).toLocaleString('fr-FR')} FCFA</p>
                <p className="carte-a-encaisser-client" style={{ fontWeight: 700 }}>
                  Net à payer : {Math.round(bulletinCalcule.net_a_payer).toLocaleString('fr-FR')} FCFA
                </p>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 10 }}
                  onClick={() => api.previewPayslipPdf(employeBulletin.id, mois).catch((err) => setErreur(err.message))}
                >
                  Voir / imprimer le PDF
                </button>
              </div>
            )}

            <div className="actions-modale">
              <button type="button" className="btn" onClick={() => setEmployeBulletin(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {employePaiement && (
        <div className="modale-fond" onClick={() => setEmployePaiement(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Paiement du salaire — {employePaiement.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 16 }}>
              {formatMois(mois)}
            </p>
            <p style={{ fontSize: 12, color: 'var(--succes, #1a7f37)', marginBottom: 12 }}>
              Montant verrouillé sur le net du bulletin de paie généré.
            </p>
            <form onSubmit={confirmerPaiement}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="paiement-montant">Montant versé (FCFA)</label>
                <input
                  id="paiement-montant"
                  type="number"
                  className="champ"
                  value={montantPaiement}
                  readOnly
                  disabled
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="paiement-methode">Méthode de paiement</label>
                <select
                  id="paiement-methode"
                  className="champ"
                  value={methodePaiement}
                  onChange={(e) => setMethodePaiement(e.target.value)}
                >
                  {METHODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                {methodePaiement === 'virement' ? (
                  <p style={{ fontSize: 12, color: 'var(--encre-douce)', marginTop: 4 }}>
                    Le virement n'impacte pas la caisse, seulement le journal d'activité.
                  </p>
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--encre-douce)', marginTop: 4 }}>
                    Ce montant sera débité de la caisse {libelleMethode(methodePaiement)}.
                  </p>
                )}
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setEmployePaiement(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={envoiEnCours}>Confirmer le paiement</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function versPourcentage(valeurDecimale) {
  return valeurDecimale === null || valeurDecimale === undefined ? '' : Number(valeurDecimale) * 100;
}
function versDecimal(valeurPourcentage) {
  return valeurPourcentage === '' || valeurPourcentage === null ? 0 : Number(valeurPourcentage) / 100;
}

function ReglagesPaieTab() {
  const [chargement, setChargement] = useState(true);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState('');

  const [abattementTaux, setAbattementTaux] = useState('');
  const [abattementPlafond, setAbattementPlafond] = useState('');
  const [ipresTauxSalarial, setIpresTauxSalarial] = useState('');
  const [ipresTauxPatronal, setIpresTauxPatronal] = useState('');
  const [ipresPlafondMensuel, setIpresPlafondMensuel] = useState('');
  const [cssTauxSalarial, setCssTauxSalarial] = useState('');
  const [cssTauxPatronal, setCssTauxPatronal] = useState('');
  const [cssPlafondMensuel, setCssPlafondMensuel] = useState('');
  const [cfceTaux, setCfceTaux] = useState('');
  const [trenchesIrpp, setTranchesIrpp] = useState([]);
  const [paliersTrimf, setPaliersTrimf] = useState([]);

  useEffect(() => {
    api
      .getPayrollSettings()
      .then((r) => {
        setAbattementTaux(versPourcentage(r.abattement_taux));
        setAbattementPlafond(r.abattement_plafond_annuel);
        setIpresTauxSalarial(versPourcentage(r.ipres_taux_salarial));
        setIpresTauxPatronal(versPourcentage(r.ipres_taux_patronal));
        setIpresPlafondMensuel(r.ipres_plafond_mensuel ?? '');
        setCssTauxSalarial(versPourcentage(r.css_taux_salarial));
        setCssTauxPatronal(versPourcentage(r.css_taux_patronal));
        setCssPlafondMensuel(r.css_plafond_mensuel ?? '');
        setCfceTaux(versPourcentage(r.cfce_taux));
        setTranchesIrpp(r.bareme_irpp.map((t) => ({ jusqua: t.jusqua ?? '', taux: t.taux * 100 })));
        setPaliersTrimf(r.trimf_bareme.map((p) => ({ jusqua: p.jusqua ?? '', montant: p.montant })));
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  function modifierTranche(index, champ, valeur) {
    setTranchesIrpp((liste) => liste.map((t, i) => (i === index ? { ...t, [champ]: valeur } : t)));
  }
  function ajouterTranche() {
    setTranchesIrpp((liste) => [...liste, { jusqua: '', taux: 0 }]);
  }
  function retirerTranche(index) {
    setTranchesIrpp((liste) => liste.filter((_, i) => i !== index));
  }

  function modifierPalier(index, champ, valeur) {
    setPaliersTrimf((liste) => liste.map((p, i) => (i === index ? { ...p, [champ]: valeur } : p)));
  }
  function ajouterPalier() {
    setPaliersTrimf((liste) => [...liste, { jusqua: '', montant: 0 }]);
  }
  function retirerPalier(index) {
    setPaliersTrimf((liste) => liste.filter((_, i) => i !== index));
  }

  async function enregistrer(e) {
    e.preventDefault();
    setErreur('');
    setSucces('');
    setEnvoiEnCours(true);
    try {
      await api.updatePayrollSettings({
        abattement_taux: versDecimal(abattementTaux),
        abattement_plafond_annuel: Number(abattementPlafond) || 0,
        ipres_taux_salarial: versDecimal(ipresTauxSalarial),
        ipres_taux_patronal: versDecimal(ipresTauxPatronal),
        ipres_plafond_mensuel: ipresPlafondMensuel === '' ? null : Number(ipresPlafondMensuel),
        css_taux_salarial: versDecimal(cssTauxSalarial),
        css_taux_patronal: versDecimal(cssTauxPatronal),
        css_plafond_mensuel: cssPlafondMensuel === '' ? null : Number(cssPlafondMensuel),
        cfce_taux: versDecimal(cfceTaux),
        bareme_irpp: trenchesIrpp.map((t) => ({
          jusqua: t.jusqua === '' ? null : Number(t.jusqua),
          taux: versDecimal(t.taux),
        })),
        trimf_bareme: paliersTrimf.map((p) => ({
          jusqua: p.jusqua === '' ? null : Number(p.jusqua),
          montant: Number(p.montant) || 0,
        })),
      });
      setSucces('Réglages enregistrés.');
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  if (chargement) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--encre-douce)', maxWidth: 640, marginBottom: 20 }}>
        Ces taux et barèmes déterminent le calcul brut → net des bulletins de paie. Les valeurs de
        départ sont indicatives — fais-les valider par un comptable ou sur impotsetdomaines.gouv.sn
        avant de t'en servir pour payer réellement tes employés.
      </p>

      {erreur && <div className="erreur">{erreur}</div>}
      {succes && <p style={{ color: 'var(--succes, #1a7f37)', fontSize: 13, marginBottom: 12 }}>{succes}</p>}

      <form onSubmit={enregistrer}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Abattement forfaitaire</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Taux (%)</label>
            <input type="number" step="0.01" className="champ" value={abattementTaux} onChange={(e) => setAbattementTaux(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Plafond annuel (FCFA)</label>
            <input type="number" className="champ" value={abattementPlafond} onChange={(e) => setAbattementPlafond(e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>IPRES (retraite)</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Part salariale (%)</label>
            <input type="number" step="0.01" className="champ" value={ipresTauxSalarial} onChange={(e) => setIpresTauxSalarial(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Part patronale (%)</label>
            <input type="number" step="0.01" className="champ" value={ipresTauxPatronal} onChange={(e) => setIpresTauxPatronal(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Plafond mensuel (FCFA, vide = aucun)</label>
            <input type="number" className="champ" value={ipresPlafondMensuel} onChange={(e) => setIpresPlafondMensuel(e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>CSS (prestations familiales / AT)</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Part salariale (%)</label>
            <input type="number" step="0.01" className="champ" value={cssTauxSalarial} onChange={(e) => setCssTauxSalarial(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Part patronale (%)</label>
            <input type="number" step="0.01" className="champ" value={cssTauxPatronal} onChange={(e) => setCssTauxPatronal(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Plafond mensuel (FCFA, vide = aucun)</label>
            <input type="number" className="champ" value={cssPlafondMensuel} onChange={(e) => setCssPlafondMensuel(e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>CFCE (patronal)</h2>
        <div className="champ-groupe" style={{ maxWidth: 200, marginBottom: 18 }}>
          <label className="etiquette">Taux (%)</label>
          <input type="number" step="0.01" className="champ" value={cfceTaux} onChange={(e) => setCfceTaux(e.target.value)} />
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Barème IRPP (tranches annuelles progressives)</h2>
        {trenchesIrpp.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <input
              type="number"
              className="champ"
              placeholder="Jusqu'à (FCFA/an) — vide = illimité"
              value={t.jusqua}
              onChange={(e) => modifierTranche(i, 'jusqua', e.target.value)}
              style={{ flex: 2 }}
            />
            <input
              type="number"
              step="0.01"
              className="champ"
              placeholder="Taux (%)"
              value={t.taux}
              onChange={(e) => modifierTranche(i, 'taux', e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn" onClick={() => retirerTranche(i)}>×</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={ajouterTranche} style={{ marginBottom: 22 }}>+ Ajouter une tranche</button>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Barème TRIMF (paliers mensuels forfaitaires)</h2>
        {paliersTrimf.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <input
              type="number"
              className="champ"
              placeholder="Jusqu'à (FCFA/mois) — vide = illimité"
              value={p.jusqua}
              onChange={(e) => modifierPalier(i, 'jusqua', e.target.value)}
              style={{ flex: 2 }}
            />
            <input
              type="number"
              className="champ"
              placeholder="Montant (FCFA)"
              value={p.montant}
              onChange={(e) => modifierPalier(i, 'montant', e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn" onClick={() => retirerPalier(i)}>×</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={ajouterPalier} style={{ marginBottom: 22 }}>+ Ajouter un palier</button>

        <div>
          <button type="submit" className="btn btn-principal" disabled={envoiEnCours}>
            {envoiEnCours ? 'Enregistrement…' : 'Enregistrer les réglages'}
          </button>
        </div>
      </form>
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
