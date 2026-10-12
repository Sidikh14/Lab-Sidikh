import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StylesModernes } from '../components/StylesModernes';

// Carte du restaurant : plats, tables et QR codes, import de la carte.
// Un commerçant = un compte ; ses restaurants sont ses boutiques (warehouses). Chaque restaurant a sa carte
// (plats rattachés via product_warehouses) ; le prix d'un plat est le même dans tous les restaurants.
// Accès : manager (tous les restaurants) et gérant (les restaurants qui lui sont affectés).

const prixFcfa = (n) => `${Math.round(Number(n)).toLocaleString('fr-FR')} FCFA`;

const echapperHtml = (t) =>
  String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Image PNG du QR code (correction d'erreur « M » : lisible même un peu abîmé ou taché).
const qrImage = (url, largeur = 600) =>
  QRCode.toDataURL(url, { width: largeur, margin: 2, errorCorrectionLevel: 'M' });

function ApercuQr({ url, taille = 96 }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let annule = false;
    qrImage(url, 300).then((u) => { if (!annule) setSrc(u); }).catch(() => {});
    return () => { annule = true; };
  }, [url]);
  if (!src) return <div style={{ width: taille, height: taille }} />;
  return <img src={src} alt="QR code de la table" width={taille} height={taille} style={{ borderRadius: 6, background: '#fff' }} />;
}

// Planche imprimable : un QR par table, avec le nom du restaurant et de la table, deux par ligne sur A4.
// La fenêtre est ouverte tout de suite (avant la génération des images) pour ne pas être bloquée par le navigateur.
async function imprimerQrs(tables, nomRestaurant) {
  const fenetre = window.open('', '_blank');
  if (!fenetre) throw new Error("Le navigateur a bloqué la fenêtre d'impression. Autorisez les fenêtres pour ce site.");
  fenetre.document.write('<p style="font-family:sans-serif">Préparation des QR codes…</p>');
  try {
    const cartes = await Promise.all(
      tables.map(async (t) => {
        const img = await qrImage(t.qrUrl, 800);
        return `<div class="qr">
          <div class="resto">${echapperHtml(nomRestaurant)}</div>
          <img src="${img}" alt="" />
          <div class="table">${echapperHtml(t.label)}</div>
          <div class="aide">Scannez pour voir la carte et commander</div>
        </div>`;
      })
    );
    fenetre.document.open();
    fenetre.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
      <title>QR codes — ${echapperHtml(nomRestaurant)}</title>
      <style>
        @page { size: A4; margin: 12mm; }
        * { box-sizing: border-box; }
        body { font-family: system-ui, sans-serif; margin: 0; color: #111; }
        .planche { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
        .qr { border: 1px dashed #888; border-radius: 6mm; padding: 8mm; text-align: center; break-inside: avoid; }
        .resto { font-size: 15pt; font-weight: 600; margin-bottom: 4mm; }
        .qr img { width: 100%; max-width: 70mm; height: auto; }
        .table { font-size: 22pt; font-weight: 700; margin-top: 3mm; }
        .aide { font-size: 11pt; margin-top: 2mm; color: #444; }
      </style></head>
      <body><div class="planche">${cartes.join('')}</div>
      <script>window.onload = function () { setTimeout(function () { window.print(); }, 300); };<\/script>
      </body></html>`);
    fenetre.document.close();
  } catch (err) {
    fenetre.close();
    throw err;
  }
}

async function telechargerQr(table) {
  const img = await qrImage(table.qrUrl, 1000);
  const a = document.createElement('a');
  a.href = img;
  a.download = `QR-${table.label.replace(/[^\w-]+/g, '_')}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function CartePage() {
  const { user } = useAuth();
  const estManager = user.role === 'manager';

  const [onglet, setOnglet] = useState('plats');
  const [restaurants, setRestaurants] = useState([]);
  const [restaurantId, setRestaurantId] = useState(() => localStorage.getItem('boutiqueActiveId') || '');
  const [plats, setPlats] = useState([]);
  const [tables, setTables] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [recherche, setRecherche] = useState('');

  // Modification d'un plat
  const [platEnEdition, setPlatEnEdition] = useState(null);
  const [formPlat, setFormPlat] = useState({ name: '', price: '', description: '', ingredients: '' });
  const [enregistrement, setEnregistrement] = useState(false);

  // Nouvelle table
  const [nouvelleTable, setNouvelleTable] = useState({ label: '', capacity: '2' });

  // Import
  const [texteImport, setTexteImport] = useState('');
  const [rapportImport, setRapportImport] = useState(null);
  const [importEnCours, setImportEnCours] = useState(false);

  useEffect(() => {
    api.getWarehouses()
      .then((liste) => {
        const actifs = liste.filter((w) => w.is_active);
        setRestaurants(actifs);
        setRestaurantId((avant) => (avant && actifs.some((w) => w.id === avant) ? avant : actifs[0]?.id || ''));
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  useEffect(() => {
    if (estManager && restaurantId) localStorage.setItem('boutiqueActiveId', restaurantId);
  }, [estManager, restaurantId]);

  async function chargerPlats() {
    if (!restaurantId) return;
    setErreur('');
    try {
      setPlats(await api.getRestaurantMenu(restaurantId));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function chargerTables() {
    setErreur('');
    try {
      setTables(await api.getRestaurantTables());
    } catch (err) {
      setErreur(err.message);
    }
  }

  useEffect(() => {
    if (onglet === 'plats') chargerPlats();
    if (onglet === 'tables') chargerTables();
    setMessage('');
  }, [onglet, restaurantId]);

  const platsFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return q ? plats.filter((p) => p.name.toLowerCase().includes(q)) : plats;
  }, [plats, recherche]);

  const platsParCategorie = useMemo(() => {
    const groupes = new Map();
    for (const p of platsFiltres) {
      const cle = p.categorie || 'Sans catégorie';
      if (!groupes.has(cle)) groupes.set(cle, []);
      groupes.get(cle).push(p);
    }
    return [...groupes.entries()];
  }, [platsFiltres]);

  const tablesDuRestaurant = useMemo(
    () => tables.filter((t) => t.warehouse_id === restaurantId),
    [tables, restaurantId]
  );

  async function basculerDisponibilite(plat) {
    try {
      await api.setDishAvailability(plat.id, restaurantId, !plat.disponible_ici);
      setPlats((liste) => liste.map((p) => (p.id === plat.id ? { ...p, disponible_ici: !p.disponible_ici } : p)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  function ouvrirEdition(plat) {
    setPlatEnEdition(plat);
    setFormPlat({
      name: plat.name,
      price: String(Math.round(Number(plat.price))),
      description: plat.description || '',
      ingredients: plat.ingredients_text || '',
    });
  }

  async function enregistrerPlat(e) {
    e.preventDefault();
    setEnregistrement(true);
    setErreur('');
    try {
      await api.updateDish(platEnEdition.id, {
        name: formPlat.name,
        price: Number(formPlat.price),
        description: formPlat.description || null,
        ingredients: formPlat.ingredients || null,
      });
      setPlatEnEdition(null);
      await chargerPlats();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  async function creerTable(e) {
    e.preventDefault();
    setErreur('');
    try {
      await api.createRestaurantTable({
        label: nouvelleTable.label,
        capacity: Number(nouvelleTable.capacity) || 2,
        warehouseId: restaurantId,
      });
      setNouvelleTable({ label: '', capacity: '2' });
      await chargerTables();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function basculerTable(table) {
    try {
      await api.setRestaurantTableStatus(table.id, !table.is_active);
      await chargerTables();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function regenererQr(table) {
    if (!window.confirm(`Régénérer le QR de « ${table.label} » ? L'ancien QR cessera de fonctionner.`)) return;
    try {
      await api.regenerateTableQr(table.id);
      await chargerTables();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function copierLien(table) {
    try {
      await navigator.clipboard.writeText(table.qrUrl);
      setMessage(`Lien de « ${table.label} » copié.`);
    } catch {
      setMessage(table.qrUrl);
    }
  }

  function lireFichierImport(e) {
    const fichier = e.target.files[0];
    if (!fichier) return;
    fichier.text().then((t) => { setTexteImport(t); setRapportImport(null); });
  }

  async function lancerImport(verifierSeulement) {
    setErreur('');
    setRapportImport(null);
    let carte;
    try {
      carte = JSON.parse(texteImport);
    } catch {
      setErreur("Le contenu n'est pas un JSON valide.");
      return;
    }
    setImportEnCours(true);
    try {
      const rapport = await api.importRestaurantMenu({ ...carte, warehouseId: restaurantId }, verifierSeulement);
      setRapportImport(rapport);
      if (!verifierSeulement) setTexteImport('');
    } catch (err) {
      setErreur(err.message);
    } finally {
      setImportEnCours(false);
    }
  }

  async function imprimer(listeTables) {
    setErreur('');
    try {
      await imprimerQrs(listeTables, restaurantActif?.name || '');
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function telecharger(table) {
    try {
      await telechargerQr(table);
    } catch (err) {
      setErreur(err.message);
    }
  }

  const restaurantActif = restaurants.find((w) => w.id === restaurantId);

  return (
    <>
      <StylesModernes />
      <div className="entete-page">
        <h1>Carte</h1>
        {restaurants.length > 0 && (
          <div className="selecteur-boutique">
            <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} aria-label="Restaurant">
              {restaurants.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!chargement && restaurants.length === 0 && (
        <p className="etat-vide">Aucun restaurant n'a encore été créé. Créez-en un avant de gérer la carte.</p>
      )}

      {erreur && <div className="erreur">{erreur}</div>}
      {message && <p className="etiquette">{message}</p>}

      {restaurantId && (
        <>
          <div className="onglets">
            <button className={onglet === 'plats' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('plats')}>Plats</button>
            <button className={onglet === 'tables' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('tables')}>Tables et QR</button>
            <button className={onglet === 'import' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('import')}>Importer la carte</button>
          </div>

          {onglet === 'plats' && (
            <>
              <input
                className="champ"
                style={{ maxWidth: 320, margin: '12px 0' }}
                placeholder="Rechercher un plat"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
              {plats.length === 0 && (
                <p className="etat-vide">
                  Aucun plat à la carte de {restaurantActif?.name}. Utilisez l'onglet « Importer la carte ».
                </p>
              )}
              {platsParCategorie.map(([categorie, liste]) => (
                <section key={categorie} style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: 16, margin: '14px 0 8px' }}>{categorie}</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {liste.map((p) => (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                          padding: '10px 12px', borderRadius: 10, background: 'var(--carte, #fff)',
                          border: '1px solid var(--trait-fort, #ddd)', opacity: p.disponible_ici ? 1 : 0.55,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          {p.description && (
                            <div style={{ fontSize: 13, color: 'var(--encre-douce)' }}>{p.description}</div>
                          )}
                          {p.nb_restaurants > 1 && (
                            <div style={{ fontSize: 12, color: 'var(--encre-douce)' }}>
                              Au même prix dans {p.nb_restaurants} restaurants
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <strong>{prixFcfa(p.price)}</strong>
                          <button type="button" className="btn" onClick={() => basculerDisponibilite(p)}>
                            {p.disponible_ici ? 'Marquer en rupture' : 'Remettre à la carte'}
                          </button>
                          <button type="button" className="btn" onClick={() => ouvrirEdition(p)}>Modifier</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}

          {onglet === 'tables' && (
            <>
              <form onSubmit={creerTable} style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
                <input
                  className="champ"
                  style={{ maxWidth: 220 }}
                  placeholder="Nom de la table (ex. Table 4)"
                  value={nouvelleTable.label}
                  onChange={(e) => setNouvelleTable({ ...nouvelleTable, label: e.target.value })}
                  required
                />
                <input
                  type="number"
                  min="1"
                  max="50"
                  className="champ"
                  style={{ width: 100 }}
                  placeholder="Places"
                  value={nouvelleTable.capacity}
                  onChange={(e) => setNouvelleTable({ ...nouvelleTable, capacity: e.target.value })}
                />
                <button type="submit" className="btn btn-principal">Ajouter la table</button>
                {tablesDuRestaurant.some((t) => t.is_active) && (
                  <button type="button" className="btn" onClick={() => imprimer(tablesDuRestaurant.filter((t) => t.is_active))}>
                    Imprimer tous les QR
                  </button>
                )}
              </form>
              {tablesDuRestaurant.length === 0 && (
                <p className="etat-vide">Aucune table dans {restaurantActif?.name}. Chaque table aura son propre QR code.</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tablesDuRestaurant.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                      padding: '10px 12px', borderRadius: 10, border: '1px solid var(--trait-fort, #ddd)',
                      opacity: t.is_active ? 1 : 0.55,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <ApercuQr url={t.qrUrl} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{t.label} — {t.capacity} place(s)</div>
                        <div style={{ fontSize: 12, color: 'var(--encre-douce)', wordBreak: 'break-all' }}>{t.qrUrl}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-principal" onClick={() => imprimer([t])}>Imprimer</button>
                      <button type="button" className="btn" onClick={() => telecharger(t)}>Télécharger l'image</button>
                      <button type="button" className="btn" onClick={() => copierLien(t)}>Copier le lien</button>
                      <button type="button" className="btn" onClick={() => regenererQr(t)}>Régénérer le QR</button>
                      <button type="button" className="btn" onClick={() => basculerTable(t)}>
                        {t.is_active ? 'Désactiver' : 'Réactiver'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {onglet === 'import' && (
            <div style={{ maxWidth: 720, marginTop: 12 }}>
              <p className="etiquette">
                La carte importée est rattachée à {restaurantActif?.name}. Un plat qui existe déjà est simplement
                rattaché à ce restaurant, sans être dupliqué. Tous les prix sont TTC.
              </p>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="fichier-carte">Fichier de carte (JSON)</label>
                <input id="fichier-carte" type="file" accept=".json,application/json" onChange={lireFichierImport} />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="texte-carte">Ou collez le contenu</label>
                <textarea
                  id="texte-carte"
                  className="champ"
                  rows={10}
                  value={texteImport}
                  onChange={(e) => { setTexteImport(e.target.value); setRapportImport(null); }}
                  placeholder='{ "categories": [ { "name": "Entrées", "items": [ { "name": "…", "price": 2500 } ] } ] }'
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" disabled={importEnCours || !texteImport.trim()} onClick={() => lancerImport(true)}>
                  Vérifier sans importer
                </button>
                <button type="button" className="btn btn-principal" disabled={importEnCours || !texteImport.trim()} onClick={() => lancerImport(false)}>
                  {importEnCours ? 'Import…' : 'Importer'}
                </button>
              </div>
              {rapportImport && (
                <div style={{ marginTop: 12, fontSize: 14 }}>
                  {rapportImport.message && <p>{rapportImport.message}</p>}
                  {rapportImport.platsCrees !== undefined && (
                    <p>
                      {rapportImport.platsCrees} plat(s) créé(s), {rapportImport.platsRattaches} rattaché(s) à ce restaurant,
                      {' '}{rapportImport.platsIgnores.length} déjà présent(s).
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {platEnEdition && (
        <div className="modale-fond" onClick={() => setPlatEnEdition(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Modifier le plat</h2>
            {platEnEdition.nb_restaurants > 1 && (
              <p className="etiquette">
                Ce plat figure à la carte de {platEnEdition.nb_restaurants} restaurants : le nom et le prix changent partout.
              </p>
            )}
            <form onSubmit={enregistrerPlat}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="plat-nom">Nom</label>
                <input id="plat-nom" className="champ" value={formPlat.name} onChange={(e) => setFormPlat({ ...formPlat, name: e.target.value })} required />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="plat-prix">Prix TTC (FCFA)</label>
                <input id="plat-prix" type="number" min="0" className="champ" value={formPlat.price} onChange={(e) => setFormPlat({ ...formPlat, price: e.target.value })} required />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="plat-desc">Description</label>
                <textarea id="plat-desc" className="champ" rows={2} maxLength={500} value={formPlat.description} onChange={(e) => setFormPlat({ ...formPlat, description: e.target.value })} />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="plat-ingr">Ingrédients</label>
                <textarea id="plat-ingr" className="champ" rows={2} maxLength={500} value={formPlat.ingredients} onChange={(e) => setFormPlat({ ...formPlat, ingredients: e.target.value })} />
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setPlatEnEdition(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={enregistrement}>
                  {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
