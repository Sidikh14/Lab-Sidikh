import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ businessName: '', sector: '', fullName: '', email: '', password: '' });
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErreur('');

    if (!form.businessName || !form.fullName || !form.email || !form.password) {
      setErreur('Tous les champs marqués sont requis.');
      return;
    }

    setChargement(true);
    try {
      await register(form);
      navigate('/');
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargement(false);
    }
  }

  return (
    <div className="ecran-connexion">
      <div className="carte-connexion" style={{ width: 420 }}>
        <h1>Créer votre commerce</h1>
        <p className="souligne">Ce compte sera votre accès manager</p>

        {erreur && <div className="erreur">{erreur}</div>}

        <form onSubmit={handleSubmit}>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="businessName">Nom du commerce</label>
            <input
              id="businessName"
              className="champ"
              value={form.businessName}
              onChange={(e) => update('businessName', e.target.value)}
              placeholder="Épicerie Fatou"
            />
          </div>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="sector">Secteur</label>
            <input
              id="sector"
              className="champ"
              value={form.sector}
              onChange={(e) => update('sector', e.target.value)}
              placeholder="Alimentation, textile…"
            />
          </div>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="fullName">Votre nom</label>
            <input
              id="fullName"
              className="champ"
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
            />
          </div>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="champ"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
            />
          </div>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              className="champ"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <button type="submit" className="btn btn-principal" style={{ width: '100%' }} disabled={chargement}>
            {chargement ? 'Création…' : 'Créer le compte'}
          </button>
        </form>

        <p className="lien-bas">
          Déjà inscrit ? <Link to="/connexion">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
