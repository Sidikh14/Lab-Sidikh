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
