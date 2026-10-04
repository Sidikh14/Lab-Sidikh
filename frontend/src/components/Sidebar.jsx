import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getSecteurConfig } from '../config/sectorConfig';
import { useAccountingAccess } from '../hooks/useAccountingAccess';
import { useModulesAccess } from '../hooks/useModulesAccess';
import { ModuleNonActive } from './ModuleNonActive';

function IconDashboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="12" width="8" height="9" rx="1.5" />
      <rect x="3" y="15" width="8" height="6" rx="1.5" />
    </svg>
  );
}

function IconStock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </svg>
  );
}

function IconVentes() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6" />
    </svg>
  );
}

function IconClients() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16.5 4.3a3.2 3.2 0 0 1 0 6.2" />
      <path d="M18.5 14.3c2.3.6 3.9 2.6 4 5.7" />
    </svg>
  );
}

function IconFournisseurs() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="10" width="13" height="8" rx="1.3" />
      <path d="M16 13h3l2 2.5V18h-5" />
      <circle cx="7.5" cy="19.5" r="1.4" />
      <circle cx="17" cy="19.5" r="1.4" />
    </svg>
  );
}

function IconAchats() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 4h2l1.2 12.4A2 2 0 0 0 9.2 18h8.6a2 2 0 0 0 2-1.7L21 8H7.5" />
      <path d="M12 11v4M10 13h4" />
    </svg>
  );
}

function IconCaisse() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="2.5" y="6" width="19" height="13" rx="1.5" />
      <path d="M2.5 11h19" />
      <path d="M7 15h4" />
    </svg>
  );
}

function IconEquipe() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="8.5" cy="8" r="3.2" />
      <path d="M2 19.5c0-3.4 2.9-5.7 6.5-5.7s6.5 2.3 6.5 5.7" />
      <path d="M18 8h4M20 6v4" />
    </svg>
  );
}

function IconEntreprise() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="4" y="8" width="16" height="13" rx="1.3" />
      <path d="M9 21v-5h6v5" />
      <path d="M9 8V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3" />
    </svg>
  );
}

function IconSalaires() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 5v14M18 5v14" />
    </svg>
  );
}

function IconBoutique() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

function IconTransferts() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 8h13" />
      <path d="M13 4l4 4-4 4" />
      <path d="M20 16H7" />
      <path d="M11 12l-4 4 4 4" />
    </svg>
  );
}

function IconComptabilite() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" />
      <path d="M5 17a3 3 0 0 1 3-3h11" />
      <path d="M9 8h6M9 11h4" />
    </svg>
  );
}

function IconFiscalite() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M6 3h9l4 4v14H6V3z" />
      <path d="M15 3v4h4" />
      <path d="M9.5 16.5l5-5" />
      <circle cx="10" cy="12" r="1" />
      <circle cx="14" cy="16" r="1" />
    </svg>
  );
}

function IconCadenasMenu() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', opacity: 0.7, flexShrink: 0 }}>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function IconChevronGroupe({ ouvert }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      style={{ transition: 'transform 0.2s', transform: ouvert ? 'rotate(180deg)' : 'none', flexShrink: 0 }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const TOUS_LES_LIENS = [
  { to: '/stock', label: 'Produits', icone: IconStock, module: 'stock' },
  { to: '/ventes', label: 'Ventes', icone: IconVentes, module: 'ventes' },
  { to: '/clients', label: 'Clients', icone: IconClients, module: 'clients' },
  { to: '/fournisseurs', label: 'Fournisseurs', icone: IconFournisseurs, module: 'fournisseurs' },
  { to: '/caisse', label: 'Caisse', icone: IconCaisse, module: 'caisse' },
];

// Modules visibles par défaut pour chaque rôle, tant que le manager n'a pas
// personnalisé les permissions d'un membre précis (visibleModules).
// "caisse" (clôture, sorties de caisse, relevés) suit les mêmes rôles que le
// backend autorise sur ces routes : manager, gérant, caissier (pas vendeur).
const MODULES_PAR_DEFAUT = {
  manager: ['stock', 'ventes', 'clients', 'fournisseurs', 'achats', 'caisse'],
  gerant: ['stock', 'ventes', 'clients', 'fournisseurs', 'achats', 'caisse'],
  vendeur: ['stock', 'ventes', 'clients'],
  caissier: ['ventes', 'caisse'],
  vendeur_caissier: ['stock', 'ventes', 'clients', 'caisse'],
};

function modulesAutorises(user) {
  if (user.role === 'manager') return MODULES_PAR_DEFAUT.manager;
  if (Array.isArray(user.visibleModules)) return user.visibleModules;
  return MODULES_PAR_DEFAUT[user.role] || [];
}

function IconFermer() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// Deux groupes repliables, indépendants : ouvrir ou fermer l'un ne touche pas à l'autre.
const TITRES_GROUPES = { gestion: 'Gestion & Stock', finance: 'Finance & Administration' };
const CHEMINS_FINANCE = ['/comptabilite', '/fiscalite', '/paie', '/entreprise', '/equipe'];
const CLE_GROUPES = 'sidebarGroupesOuverts';

function groupeDuChemin(pathname) {
  if (CHEMINS_FINANCE.some((c) => pathname === c || pathname.startsWith(`${c}/`))) return 'finance';
  if (pathname === '/') return null;
  return 'gestion';
}

// Par défaut les deux groupes sont ouverts : rien n'est caché tant qu'on ne le replie pas soi-même.
function lireGroupesOuverts() {
  try {
    const v = JSON.parse(localStorage.getItem(CLE_GROUPES));
    return { gestion: v?.gestion !== false, finance: v?.finance !== false };
  } catch {
    return { gestion: true, finance: true };
  }
}

export function Sidebar({ ouvert = false, onFermer }) {
  const { user, merchant, logout } = useAuth();
  const { pathname } = useLocation();
  const secteurConfig = getSecteurConfig(merchant?.sector);
  // Comptabilité, Fiscalité et Paie : visibles seulement si l'owner a donné l'accès.
  const { enabled: comptaOriginale } = useAccountingAccess();
  const { loaded: modulesCharges, accounting, fiscalite: fiscaliteActive, payroll: paieActive } = useModulesAccess();
  const comptaActive = comptaOriginale || accounting;
  // Module cliqué alors qu'il n'est pas activé : message « rapprochez-vous de l'administrateur ».
  const [moduleBloque, setModuleBloque] = useState('');
  const autorises = modulesAutorises(user);
  // "Fournisseurs" héberge aussi l'onglet Achats depuis la fusion des pages
  // (20/09) : le lien reste visible si le membre a l'un OU l'autre module.
  const liensGestion = TOUS_LES_LIENS.map((lien) => {
    if (lien.to === '/stock') return { ...lien, label: `${secteurConfig.libelleProduit}s` };
    if (lien.to === '/clients') return { ...lien, label: `${secteurConfig.libelleClient}s` };
    return lien;
  }).filter((lien) =>
    lien.module === 'fournisseurs' ? autorises.includes('fournisseurs') || autorises.includes('achats') : autorises.includes(lien.module)
  );
  const voitEquipe = ['manager', 'gerant'].includes(user?.role);
  const estManager = user?.role === 'manager';

  if (voitEquipe) {
    liensGestion.push({ to: '/boutiques', label: estManager ? `${secteurConfig.libelleBoutique}s` : 'Transferts', icone: IconBoutique });
  }

  const liensFinance = [];
  // Le manager voit toujours Comptabilité, Fiscalité et Paie ; sans activation par l'owner, le clic
  // affiche un message au lieu d'ouvrir la page (verrouillé = cadenas).
  if (estManager) {
    liensFinance.push({ to: '/comptabilite', label: 'Comptabilité', icone: IconComptabilite, verrouille: modulesCharges && !comptaActive });
    liensFinance.push({ to: '/fiscalite', label: 'Fiscalité', icone: IconFiscalite, verrouille: modulesCharges && !(comptaActive && fiscaliteActive) });
    liensFinance.push({ to: '/paie', label: 'Paie', icone: IconSalaires, verrouille: modulesCharges && !paieActive });
  }
  if (estManager) liensFinance.push({ to: '/entreprise', label: 'Entreprise', icone: IconEntreprise });
  if (voitEquipe) liensFinance.push({ to: '/equipe', label: 'Équipe', icone: IconEquipe });

  const groupes = [
    { id: 'gestion', liens: liensGestion },
    { id: 'finance', liens: liensFinance },
  ].filter((g) => g.liens.length > 0);

  const [ouverts, setOuverts] = useState(lireGroupesOuverts);
  // Si la page affichée appartient à un groupe replié, ce groupe se rouvre (sans toucher à l'autre).
  useEffect(() => {
    const g = groupeDuChemin(pathname);
    if (g) setOuverts((o) => (o[g] ? o : { ...o, [g]: true }));
  }, [pathname]);

  function basculerGroupe(id) {
    setOuverts((o) => {
      const suivant = { ...o, [id]: !o[id] };
      try {
        localStorage.setItem(CLE_GROUPES, JSON.stringify(suivant));
      } catch {
        // mémorisation facultative
      }
      return suivant;
    });
  }

  const initiales = (user?.fullName || '?')
    .split(' ')
    .map((mot) => mot[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const lienNav = (lien) => {
    const Icone = lien.icone;
    if (lien.verrouille) {
      return (
        <li key={lien.to}>
          <button
            type="button"
            className="nav-lien"
            style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}
            onClick={() => setModuleBloque(lien.label)}
          >
            <Icone />
            {lien.label}
            <IconCadenasMenu />
          </button>
        </li>
      );
    }
    return (
      <li key={lien.to}>
        <NavLink to={lien.to} className={({ isActive }) => 'nav-lien' + (isActive ? ' actif' : '')} onClick={onFermer}>
          <Icone />
          {lien.label}
        </NavLink>
      </li>
    );
  };

  const styleTitre = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%',
    padding: '10px 14px 6px', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer',
    fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7, textAlign: 'left',
  };

  return (
    <nav className={'barre-laterale' + (ouvert ? ' ouverte' : '')}>
      <div className="marque">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <span>
            Amaterasu
          </span>
          <button type="button" className="bouton-fermer-menu" onClick={onFermer} aria-label="Fermer le menu">
            <IconFermer />
          </button>
        </div>
      </div>
      <ul className="nav-liste">
        <li>
          <NavLink to="/" end className={({ isActive }) => 'nav-lien' + (isActive ? ' actif' : '')} onClick={onFermer}>
            <IconDashboard />
            Tableau de bord
          </NavLink>
        </li>
        {groupes.length === 1 && groupes[0].liens.map(lienNav)}
        {groupes.length > 1 && groupes.map((g) => {
          const ouvertG = ouverts[g.id];
          return (
            <li key={g.id} style={{ listStyle: 'none' }}>
              <button
                type="button" style={styleTitre} aria-expanded={ouvertG} onClick={() => basculerGroupe(g.id)}
              >
                <span>{TITRES_GROUPES[g.id]}</span>
                <IconChevronGroupe ouvert={ouvertG} />
              </button>
              {ouvertG && <ul className="nav-liste" style={{ margin: 0, padding: 0 }}>{g.liens.map(lienNav)}</ul>}
            </li>
          );
        })}
      </ul>
      {moduleBloque && <ModuleNonActive nom={moduleBloque} onFermer={() => setModuleBloque('')} />}
      {user && (
        <div className="pied-sidebar">
          <span className="avatar">{initiales}</span>
          <div style={{ minWidth: 0 }}>
            <p className="nom">{user.fullName}</p>
            <p className="role">{user.role}</p>
            <button className="lien-deconnexion" onClick={logout}>
              Se déconnecter
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
