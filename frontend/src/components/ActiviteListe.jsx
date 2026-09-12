const PALETTE_AVATARS = ['#5b4fe9', '#0891b2', '#db2777', '#2563eb', '#7c3aed', '#0d9488', '#c2410c'];
const LABEL_MOUVEMENT = { entree: 'ajouté', sortie: 'sorti', ajustement: 'ajusté' };
const LABEL_PAIEMENT = { especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', cheque: 'Chèque', virement: 'Virement' };

const COULEUR_ACTION = {
  vente: '#16a34a',        // vert — vente créée
  encaissement: '#2563eb', // bleu — argent encaissé
  livraison: '#0891b2',    // cyan — livraison marquée
  entree: '#16a34a',       // vert — entrée de stock
  sortie: '#ea580c',       // orange — sortie de stock
  ajustement: '#ca8a04',   // ambre — ajustement de stock
  annulation: '#dc2626',   // rouge — action critique
  suppression: '#991b1b',  // bordeaux — action critique irréversible
  modification: '#ea580c', // orange — modification produit
  neutre: '#6b7280',       // gris — info neutre (connexion, etc.)
};

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

// Détermine la couleur du texte selon le type d'action.
// Pour les entrées de type "journal" (texte libre), on déduit la
// catégorie à partir de mots-clés dans la description.
function couleurAction(a) {
  if (a.type === 'vente') return COULEUR_ACTION.vente;
  if (a.type === 'encaissement') return COULEUR_ACTION.encaissement;
  if (a.type === 'livraison') return COULEUR_ACTION.livraison;
  if (a.type === 'journal') {
    const texte = (a.description || '').toLowerCase();
    if (texte.includes('annul')) return COULEUR_ACTION.annulation;
    if (texte.includes('supprim')) return COULEUR_ACTION.suppression;
    if (texte.includes('modifi')) return COULEUR_ACTION.modification;
    return COULEUR_ACTION.neutre;
  }
  // Mouvements de stock
  if (a.movement_type && COULEUR_ACTION[a.movement_type]) return COULEUR_ACTION[a.movement_type];
  return null; // pas de couleur spécifique, garde le texte par défaut
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
    const moyen = LABEL_PAIEMENT[a.payment_method] || a.payment_method;
    return (
      <>
        a encaissé <strong>{Number(a.montant).toLocaleString('fr-FR')} FCFA</strong>
        {moyen && <> ({moyen})</>}
      </>
    );
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
          {activite.map((a) => {
            const couleur = couleurAction(a);
            return (
              <li key={a.id} className="ligne-activite">
                <span className="ligne-activite-heure">{formatQuand(a.created_at)}</span>
                <span className="avatar avatar-couleur" style={{ background: couleurPour(a.user_name) }}>
                  {initiales(a.user_name)}
                </span>
                <p className="ligne-activite-texte" style={couleur ? { color: couleur } : undefined}>
                  <strong style={{ color: 'inherit' }}>{a.user_name || 'Inconnu'}</strong> {descriptionAction(a)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}