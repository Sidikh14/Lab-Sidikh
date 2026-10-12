import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';

// Page ouverte par le client en scannant le QR de sa table (aucune connexion).
// Affiche la carte du restaurant de cette table : plats, ingrédients, allergènes, options. Prix TTC.
// Le panier et l'envoi de la commande seront ajoutés avec la route de commande depuis le QR.

const prixFcfa = (n) => `${Math.round(Number(n)).toLocaleString('fr-FR')} FCFA`;
const supplement = (n) => (Number(n) > 0 ? ` (+${prixFcfa(n)})` : '');

const styles = {
  page: { maxWidth: 640, margin: '0 auto', padding: '0 16px 48px', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: '#1c1c1c' },
  entete: { padding: '28px 0 16px' },
  resto: { fontSize: 26, fontWeight: 700, margin: 0, lineHeight: 1.2 },
  table: { margin: '4px 0 0', color: '#555', fontSize: 15 },
  nav: {
    position: 'sticky', top: 0, background: '#fff', zIndex: 5, display: 'flex', gap: 8, overflowX: 'auto',
    padding: '10px 0', borderBottom: '1px solid #e4e4e4', marginBottom: 8,
  },
  puce: { flexShrink: 0, padding: '7px 14px', borderRadius: 999, border: '1px solid #cfcfcf', background: '#fff', fontSize: 14, color: '#1c1c1c', textDecoration: 'none' },
  categorie: { fontSize: 19, fontWeight: 700, margin: '26px 0 10px', scrollMarginTop: 64 },
  plat: { padding: '14px 0', borderBottom: '1px solid #eee' },
  ligne: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' },
  nom: { fontSize: 16, fontWeight: 600, margin: 0 },
  prix: { fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap' },
  texte: { margin: '4px 0 0', fontSize: 14, color: '#444', lineHeight: 1.45 },
  petit: { margin: '4px 0 0', fontSize: 13, color: '#666', lineHeight: 1.4 },
  allergene: { display: 'inline-block', margin: '6px 6px 0 0', padding: '2px 8px', borderRadius: 6, background: '#fff4e0', color: '#8a4b00', fontSize: 12 },
  regime: { display: 'inline-block', margin: '6px 6px 0 0', padding: '2px 8px', borderRadius: 6, background: '#e8f4ea', color: '#1e6b2f', fontSize: 12 },
  groupe: { margin: '8px 0 0', fontSize: 13, color: '#444' },
};

function Plat({ plat }) {
  return (
    <article style={styles.plat}>
      <div style={styles.ligne}>
        <h3 style={styles.nom}>{plat.name}</h3>
        <span style={styles.prix}>{prixFcfa(plat.price)}</span>
      </div>
      {plat.description && <p style={styles.texte}>{plat.description}</p>}
      {plat.ingredients && <p style={styles.petit}>Ingrédients : {plat.ingredients}</p>}
      {(plat.allergenes.length > 0 || plat.regimes.length > 0) && (
        <div>
          {plat.allergenes.map((a) => (
            <span key={`a-${a}`} style={styles.allergene}>Contient : {a}</span>
          ))}
          {plat.regimes.map((r) => (
            <span key={`r-${r}`} style={styles.regime}>{r}</span>
          ))}
        </div>
      )}
      {plat.options.map((g) => (
        <p key={g.name} style={styles.groupe}>
          <strong>{g.name}{g.required ? ' (obligatoire)' : ''}</strong>
          {g.choices.length > 0 && ' : ' + g.choices.map((c) => `${c.name}${supplement(c.priceDelta)}`).join(', ')}
        </p>
      ))}
    </article>
  );
}

export function MenuPublicPage() {
  const { token } = useParams();
  const [carte, setCarte] = useState(null);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    document.title = 'Carte du restaurant';
    api.getPublicMenu(token)
      .then((data) => {
        setCarte(data);
        document.title = `${data.restaurant} — ${data.table}`;
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, [token]);

  const categories = useMemo(() => {
    const groupes = new Map();
    for (const p of carte?.plats || []) {
      const cle = p.categorie || 'Autres';
      if (!groupes.has(cle)) groupes.set(cle, []);
      groupes.get(cle).push(p);
    }
    return [...groupes.entries()];
  }, [carte]);

  if (chargement) return <div style={styles.page}><p style={{ paddingTop: 40 }}>Chargement de la carte…</p></div>;

  if (erreur || !carte) {
    return (
      <div style={styles.page}>
        <div style={styles.entete}>
          <h1 style={styles.resto}>Ce QR code n'est plus valide</h1>
          <p style={styles.texte}>Demandez au personnel de vous indiquer la carte ou un nouveau QR code.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <header style={styles.entete}>
        <h1 style={styles.resto}>{carte.restaurant}</h1>
        <p style={styles.table}>{carte.table}</p>
      </header>

      {categories.length === 0 && <p style={styles.texte}>La carte n'est pas disponible pour le moment.</p>}

      {categories.length > 1 && (
        <nav style={styles.nav} aria-label="Catégories">
          {categories.map(([nom]) => (
            <a key={nom} href={`#cat-${encodeURIComponent(nom)}`} style={styles.puce}>{nom}</a>
          ))}
        </nav>
      )}

      {categories.map(([nom, plats]) => (
        <section key={nom} id={`cat-${encodeURIComponent(nom)}`}>
          <h2 style={styles.categorie}>{nom}</h2>
          {plats.map((p) => <Plat key={p.id} plat={p} />)}
        </section>
      ))}
    </div>
  );
}
