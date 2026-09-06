import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
    <div className="ecran-connexion">
      <div className="carte-connexion">
        <h1>Sidikh Stock</h1>
        <p className="souligne">Gérez votre stock, vos ventes et vos clients</p>

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
  );
}