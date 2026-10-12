import { useState } from 'react';
import { api } from '../api/client';

// Écran bloquant affiché quand le membre se connecte avec un mot de passe provisoire.
// Il ne peut rien faire d'autre tant qu'il n'a pas défini son propre mot de passe.
export function ChangementMotDePasseObligatoire({ onTermine, onDeconnexion }) {
  const [actuel, setActuel] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErreur('');
    if (!actuel || !nouveau || !confirmation) {
      setErreur('Tous les champs sont requis.');
      return;
    }
    if (nouveau.length < 6) {
      setErreur('Le nouveau mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    if (nouveau !== confirmation) {
      setErreur('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }
    setChargement(true);
    try {
      await api.changeOwnPassword(actuel, nouveau);
      onTermine();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargement(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titre-changement-mot-de-passe"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(15, 39, 71, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div className="carte-connexion carte-connexion--plate" style={{ maxWidth: 420, width: '100%' }}>
        <span className="pastille-accueil">Sécurité</span>
        <h2 id="titre-changement-mot-de-passe" style={{ fontSize: 22, margin: '14px 0 4px', fontWeight: 700 }}>
          Choisissez votre mot de passe
        </h2>
        <p className="souligne">
          Votre mot de passe est provisoire. Définissez-en un nouveau pour accéder à votre espace.
        </p>

        {erreur && <div className="erreur">{erreur}</div>}

        <form onSubmit={handleSubmit}>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="cmdp-actuel">Mot de passe provisoire</label>
            <input
              id="cmdp-actuel"
              type="password"
              className="champ"
              value={actuel}
              onChange={(e) => setActuel(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="cmdp-nouveau">Nouveau mot de passe</label>
            <input
              id="cmdp-nouveau"
              type="password"
              className="champ"
              value={nouveau}
              onChange={(e) => setNouveau(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="champ-groupe">
            <label className="etiquette" htmlFor="cmdp-confirmation">Confirmer le nouveau mot de passe</label>
            <input
              id="cmdp-confirmation"
              type="password"
              className="champ"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <button type="submit" className="btn btn-principal btn-connexion" disabled={chargement}>
            {chargement ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>

        <button type="button" className="btn" onClick={onDeconnexion} style={{ marginTop: 10, width: '100%' }}>
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
