// OfflineBanner.jsx — bandeau affiché en haut de l'app quand on est hors-ligne,
// en cours de synchro, ou qu'il reste des ventes à régulariser manuellement.
// À placer une fois, en haut de App.jsx (ou du layout principal).
import { useOfflineSync } from './useOfflineSync';

export default function OfflineBanner({ api }) {
  const { isOnline, pendingCount, failedCount, syncing, syncNow } = useOfflineSync(api);

  if (isOnline && pendingCount === 0 && failedCount === 0) return null;

  return (
    <div className={`bandeau-hors-ligne ${!isOnline ? 'bandeau-hors-ligne--offline' : ''}`}>
      {!isOnline && (
        <span>
          Pas de connexion — les ventes sont enregistrées localement et seront envoyées
          automatiquement au retour du réseau.
        </span>
      )}
      {isOnline && syncing && <span>Synchronisation des ventes en attente…</span>}
      {isOnline && !syncing && pendingCount > 0 && (
        <span>
          {pendingCount} vente(s) en attente de synchronisation.{' '}
          <button type="button" onClick={syncNow}>Réessayer maintenant</button>
        </span>
      )}
      {failedCount > 0 && (
        <span className="bandeau-hors-ligne__erreur">
          {failedCount} vente(s) n'ont pas pu être synchronisées (conflit de stock probable) —
          à régulariser manuellement.
        </span>
      )}
    </div>
  );
}
