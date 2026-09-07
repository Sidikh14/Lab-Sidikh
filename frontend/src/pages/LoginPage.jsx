import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const PUCES = ['Stock', 'Ventes', 'Clients', 'Fournisseurs'];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
        <div className="decor-cercles" aria-hidden="true">
          <span className="cercle cercle-1" />
          <span className="cercle cercle-2" />
          <span className="cercle cercle-3" />
          <span className="point-central" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40 }}>
          <div className="logo-badge">A</div>
          <span className="nom-marque">Amaterasu</span>
        </div>
        <h1 className="titre-marque">
          Votre gestion de stock,<br />simplifiée.
        </h1>
        <p className="tagline-marque">
          Pilotez votre stock, vos ventes, vos clients et vos fournisseurs
          depuis un espace unique.
        </p>
        <div className="puces-marque">
          {PUCES.map((p) => (
            <span key={p} className="puce">{p}</span>
          ))}
        </div>
      </div>

      <div className="panneau-formulaire">
        <div className="carte-connexion carte-connexion--plate">
          <h2 style={{ fontSize: 22, marginBottom: 4 }}>Bienvenue</h2>
          <p className="souligne">Connectez-vous à votre espace Amaterasu</p>

          {erreur && <div className="erreur">{erreur}</div>}

          <form onSubmit={handleSubmit}>
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="champ"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nom@boutique.com"
                autoComplete="email"
              />
            </div>
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="password">Mot de passe</label>
              <input
                id="password"
                type="password"
                className="champ"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="btn btn-principal" style={{ width: '100%' }} disabled={chargement}>
              {chargement ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
