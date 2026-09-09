const PALETTE_AVATARS = ['#5b4fe9', '#0891b2', '#db2777', '#2563eb', '#7c3aed', '#0d9488', '#c2410c'];
const LABEL_MOUVEMENT = { entree: 'ajouté', sortie: 'sorti', ajustement: 'ajusté' };

export function initiales(nom) {
  return (nom || '?')
    .split(' ')
    .map((mot) => mot[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function couleurPour(nom) {
  const texte = nom || '?';
  let hash = 0;
  for (let i = 0; i < texte.length; i++) hash = texte.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE_AVATARS[Math.abs(hash) % PALETTE_AVATARS.length];
}

function formatQuand(dateStr) {
  const d = new Date(dateStr);
  const auj = new Date();
  if (d.toDateString() === auj.toDateString()) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  const hier = new Date(auj);
  hier.setDate(hier.getDate() - 1);
  if (d.toDateString() === hier.toDateString()) return 'hier';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function descriptionAction(a) {
  if (a.type === 'vente') {
    return <>a créé une <strong>vente de {Number(a.montant).toLocaleString('fr-FR')} FCFA</strong></>;
  }
  if (a.type === 'encaissement') {
    return <>a encaissé <strong>{Number(a.montant).toLocaleString('fr-FR')} FCFA</strong></>;
  }
  if (a.type === 'livraison') {
    return <>a <strong>livré</strong> la commande {a.client_name ? `de ${a.client_name}` : ''}</>;
  }
  if (a.type === 'journal') {
    return a.description;
  }
  const verbe = LABEL_MOUVEMENT[a.movement_type] || a.movement_type;
  return (
    <>
      a {verbe} <strong>{a.quantity} × {a.product_name}</strong>
      {a.supplier_name && <> (fournisseur : {a.supplier_name})</>}
    </>
  );
}

export function ActiviteListe({ activite, titre = 'Activité récente' }) {
  return (
    <div className="carte-activite">
      <h2 className="carte-activite-titre">{titre}</h2>
      {activite.length === 0 ? (
        <p className="etat-vide">Aucune activité pour le moment.</p>
      ) : (
        <ul className="liste-activite">
          {activite.map((a) => (
            <li key={a.id} className="ligne-activite">
              <span className="ligne-activite-heure">{formatQuand(a.created_at)}</span>
              <span className="avatar avatar-couleur" style={{ background: couleurPour(a.user_name) }}>
                {initiales(a.user_name)}
              </span>
              <p className="ligne-activite-texte">
                <strong>{a.user_name || 'Inconnu'}</strong> {descriptionAction(a)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
