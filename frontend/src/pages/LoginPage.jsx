import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function IconStock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </svg>
  );
}

function IconVentes() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6" />
    </svg>
  );
}

function IconFournisseurs() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="10" width="13" height="8" rx="1.3" />
      <path d="M16 13h3l2 2.5V18h-5" />
      <circle cx="7.5" cy="19.5" r="1.4" />
      <circle cx="17" cy="19.5" r="1.4" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2.2" />
      <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
    </svg>
  );
}

function IconCadenas() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function IconOeil({ ouvert }) {
  return ouvert ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c7 0 10.5 7 10.5 7a17.7 17.7 0 0 1-3.4 4.4M6.6 6.6C3.4 8.7 1.5 12 1.5 12s3.5 7 10.5 7a10.6 10.6 0 0 0 4-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function IconSecteurGrossiste() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="10.5" width="7.5" height="7.5" rx="1" />
      <rect x="13.5" y="10.5" width="7.5" height="7.5" rx="1" />
      <rect x="8.25" y="3" width="7.5" height="7.5" rx="1" />
    </svg>
  );
}

function IconSecteurPharmacie() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function IconSecteurElectromenager() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5.5" y="2.5" width="13" height="19" rx="2.2" />
      <path d="M5.5 10h13" />
      <path d="M9 6.2h0.01M9 14.5h0.01" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
}

function IconSecteurTextile() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 3.5h10M7 20.5h10" strokeLinecap="round" />
      <path d="M7 3.5c0 4.5 5.2 4.3 5.2 8.5S7 16.5 7 20.5" />
      <path d="M17 3.5c0 4.5-5.2 4.3-5.2 8.5s5.2 4.5 5.2 8.5" />
    </svg>
  );
}

const SECTEURS_VITRINE = [
  { nom: 'Grossiste', tagline: 'Distribution & gros volumes', couleur: '#A78BFA', couleurClaire: 'rgba(167, 139, 250, 0.16)', Icone: IconSecteurGrossiste },
  { nom: 'Pharmacie', tagline: 'Lots & péremption', couleur: '#4ADE80', couleurClaire: 'rgba(74, 222, 128, 0.16)', Icone: IconSecteurPharmacie },
  { nom: 'Électroménager', tagline: 'Références & garanties', couleur: '#FBBF24', couleurClaire: 'rgba(251, 191, 36, 0.16)', Icone: IconSecteurElectromenager },
  { nom: 'Textile', tagline: 'Tailles & coloris', couleur: '#F87171', couleurClaire: 'rgba(248, 113, 113, 0.16)', Icone: IconSecteurTextile },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [motDePasseVisible, setMotDePasseVisible] = useState(false);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErreur('');

    if (!email || !password) {
      setErreur('Renseignez votre email et votre mot de passe.');
      return;
    }

    setChargement(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargement(false);
    }
  }

  return (
    <div className="ecran-connexion-partage">
      <style>{`
        .secteurs-vitrine {
          margin: 30px 0 6px;
          position: relative;
          z-index: 1;
          animation: secteurs-entree 0.6s ease-out both;
          animation-delay: 0.15s;
        }
        @keyframes secteurs-entree {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .secteurs-vitrine-titre {
          display: block;
          font-size: 13px;
          font-weight: 600;
          opacity: 0.7;
          margin-bottom: 14px;
        }
        .secteurs-grille {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .secteur-carte {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 12px 13px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.09);
          transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
        }
        .secteur-carte:hover {
          border-color: color-mix(in srgb, var(--secteur-couleur) 45%, transparent);
          background: rgba(255, 255, 255, 0.08);
          transform: translateY(-2px);
        }
        .secteur-carte-icone {
          flex-shrink: 0;
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--secteur-couleur);
          background: var(--secteur-couleur-claire);
        }
        .secteur-carte-texte {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }
        .secteur-carte-texte strong {
          font-size: 14px;
          font-weight: 700;
          line-height: 1.25;
        }
        .secteur-carte-texte span {
          font-size: 11.5px;
          opacity: 0.65;
          line-height: 1.3;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @media (max-width: 480px) {
          .secteurs-grille { grid-template-columns: 1fr; }
        }
      `}</style>
      <div className="panneau-marque">
        <div className="fond-motif" aria-hidden="true" />
        <div className="fond-halo" aria-hidden="true" />

        <div className="marque-entete">
          <div className="logo-badge">A</div>
          <span className="nom-marque">Amaterasu</span>
        </div>

        <p className="eyebrow-marque">Plateforme de gestion commerçante</p>
        <h1 className="titre-marque">
          Votre gestion de stock,<br />
          <span className="titre-marque-accent">simplifiée</span>.
        </h1>
        <p className="tagline-marque">
          Pilotez votre stock, vos ventes, vos clients et vos fournisseurs
          depuis un espace unique, pensé pour aller vite.
        </p>

        <div className="secteurs-vitrine">
          <span className="secteurs-vitrine-titre">Un espace pensé pour votre activité</span>
          <div className="secteurs-grille">
            {SECTEURS_VITRINE.map(({ nom, tagline, couleur, couleurClaire, Icone }) => (
              <div
                key={nom}
                className="secteur-carte"
                style={{ '--secteur-couleur': couleur, '--secteur-couleur-claire': couleurClaire }}
              >
                <span className="secteur-carte-icone">
                  <Icone />
                </span>
                <div className="secteur-carte-texte">
                  <strong>{nom}</strong>
                  <span>{tagline}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="cartes-flottantes">
          <div className="carte-flottante carte-flottante--1">
            <span className="carte-flottante-icone"><IconStock /></span>
            <div>
              <strong>312</strong>
              <span>produits en stock</span>
            </div>
          </div>
          <div className="carte-flottante carte-flottante--2">
            <span className="carte-flottante-icone"><IconVentes /></span>
            <div>
              <strong>48</strong>
              <span>ventes aujourd'hui</span>
            </div>
          </div>
          <div className="carte-flottante carte-flottante--3">
            <span className="carte-flottante-icone"><IconFournisseurs /></span>
            <div>
              <strong>12</strong>
              <span>fournisseurs</span>
            </div>
          </div>
        </div>
      </div>

      <div className="panneau-formulaire">
        <div className="fond-motif fond-motif--clair" aria-hidden="true" />
        <div className="fond-halo fond-halo--clair" aria-hidden="true" />

        <div className="carte-connexion carte-connexion--plate">
          <span className="pastille-accueil">Connexion</span>
          <h2 style={{ fontSize: 26, margin: '14px 0 4px', fontWeight: 700 }}>Bon retour</h2>
          <p className="souligne">Connectez-vous à votre espace Amaterasu</p>

          {erreur && <div className="erreur">{erreur}</div>}

          <form onSubmit={handleSubmit}>
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="email">Email</label>
              <div className="champ-avec-icone">
                <span className="champ-icone"><IconMail /></span>
                <input
                  id="email"
                  type="email"
                  className="champ champ--avec-icone"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nom@boutique.com"
                  autoComplete="email"
                />
              </div>
            </div>
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="password">Mot de passe</label>
              <div className="champ-avec-icone">
                <span className="champ-icone"><IconCadenas /></span>
                <input
                  id="password"
                  type={motDePasseVisible ? 'text' : 'password'}
                  className="champ champ--avec-icone champ--avec-icone-droite"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="champ-icone champ-icone--bouton"
                  onClick={() => setMotDePasseVisible((v) => !v)}
                  aria-label={motDePasseVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  <IconOeil ouvert={motDePasseVisible} />
                </button>
              </div>
            </div>
            <button type="submit" className="btn btn-principal btn-connexion" disabled={chargement}>
              {chargement ? 'Connexion…' : 'Se connecter'}
              {!chargement && <span aria-hidden="true">→</span>}
            </button>
          </form>

          <p className="pied-connexion">Amaterasu — gestion commerçante</p>
        </div>
      </div>
    </div>
  );
}
