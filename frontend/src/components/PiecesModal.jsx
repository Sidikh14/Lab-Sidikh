import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Pièces jointes (justificatifs) d'une écriture, d'une sortie de caisse, d'une facture de charge…
// Une photo est réduite dans le navigateur (1600 px, JPEG) pour rester sous 1,5 Mo ; un PDF doit déjà l'être.
const PIECE_MAX = 1572864;

const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 };
const cellule = { padding: '6px 8px', borderBottom: '1px solid rgba(128,128,128,0.18)', textAlign: 'left' };
const boutonPetit = { padding: '6px 10px', fontSize: 12.5 };

function reduireImage(fichier) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let cote = 1600;
      const essayer = (qualite) => {
        const ratio = Math.min(1, cote / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error("Impossible de réduire l'image."));
          if (blob.size <= PIECE_MAX - 20000 || (qualite <= 0.5 && cote <= 800)) return resolve(blob);
          if (qualite > 0.5) essayer(qualite - 0.15);
          else { cote -= 400; essayer(0.7); }
        }, 'image/jpeg', qualite);
      };
      essayer(0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
    img.src = url;
  });
}

export function PiecesModal({ sourceType, sourceId, titre, onClose }) {
  const [pieces, setPieces] = useState(null);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const charger = () => api.getAttachments(sourceType, sourceId).then(setPieces).catch((e) => setErreur(e.message));
  useEffect(() => { charger(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function ajouter(e) {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;
    setErreur('');
    setEnvoi(true);
    try {
      let blob = fichier;
      let nom = fichier.name;
      if (fichier.type.startsWith('image/')) {
        blob = await reduireImage(fichier);
        nom = nom.replace(/\.[^.]+$/, '') + '.jpg';
      } else if (fichier.type !== 'application/pdf') {
        throw new Error('Format non accepté : image ou PDF seulement.');
      } else if (fichier.size > PIECE_MAX) {
        throw new Error('Ce PDF dépasse 1,5 Mo.');
      }
      await api.uploadAttachment(sourceType, sourceId, blob, nom);
      await charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  async function retirer(p) {
    if (!window.confirm(`Supprimer « ${p.file_name} » ?`)) return;
    try { await api.deleteAttachment(p.id); await charger(); } catch (err) { setErreur(err.message); }
  }

  return (
    <div className="modale-fond" onClick={onClose}>
      <div className="modale" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <h2>Pièces jointes</h2>
        {titre && <p style={{ color: 'var(--encre-douce)', fontSize: 13, marginTop: 0 }}>{titre}</p>}
        {erreur && <div className="erreur">{erreur}</div>}
        {!pieces ? <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p> : pieces.length === 0 ? (
          <p style={{ color: 'var(--encre-douce)' }}>Aucune pièce jointe.</p>
        ) : (
          <table style={tableStyle}>
            <tbody>
              {pieces.map((p) => (
                <tr key={p.id}>
                  <td style={cellule}>{p.file_name}<div style={{ color: 'var(--encre-douce)', fontSize: 12 }}>{Math.round(p.size_bytes / 1024)} Ko · {dateFr(p.created_at)}</div></td>
                  <td style={{ ...cellule, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button type="button" className="btn" style={{ ...boutonPetit, marginRight: 6 }} onClick={() => api.previewAttachment(p.id).catch((err) => setErreur(err.message))}>Voir</button>
                    <button type="button" className="btn" style={boutonPetit} onClick={() => retirer(p)}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="actions-modale" style={{ marginTop: 16 }}>
          <label className="btn btn-principal" style={{ cursor: envoi ? 'default' : 'pointer', opacity: envoi ? 0.6 : 1 }}>
            {envoi ? 'Envoi…' : 'Ajouter une photo ou un PDF'}
            <input type="file" accept="image/*,application/pdf" onChange={ajouter} disabled={envoi} style={{ display: 'none' }} />
          </label>
          <button type="button" className="btn" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
