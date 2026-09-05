const STYLES = {
  en_stock: { classe: 'tampon-sarcelle', texte: 'En stock' },
  faible: { classe: 'tampon-laiton', texte: 'Faible' },
  rupture: { classe: 'tampon-brique', texte: 'Rupture' },
  en_attente: { classe: 'tampon-laiton', texte: 'En attente' },
  validee: { classe: 'tampon-sarcelle', texte: 'Validée' },
  livree: { classe: 'tampon-sarcelle', texte: 'Livrée' },
  annulee: { classe: 'tampon-brique', texte: 'Annulée' },
};

export function StatusBadge({ status }) {
  const style = STYLES[status] || { classe: 'tampon-laiton', texte: status };
  return <span className={`tampon ${style.classe}`}>{style.texte}</span>;
}
