import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';

function IconClient() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  );
}

function IconRecherche() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function IconDossier() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

const FILTRES_CREANCE = [
  { value: 'tous', label: 'Tous' },
  { value: 'creance', label: 'Avec créance' },
  { value: 'a_jour', label: 'À jour' },
];

export function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouveauClient, setNouveauClient] = useState({ fullName: '', phone: '', email: '' });

  const [clientSelectionne, setClientSelectionne] = useState(null);
  const [detailChargement, setDetailChargement] = useState(false);
  const [detailErreur, setDetailErreur] = useState('');
  const [vueReglement, setVueReglement] = useState(false);
  const [montantReglement, setMontantReglement] = useState('');
  const [moyenReglement, setMoyenReglement] = useState('especes');
  const [noteReglement, setNoteReglement] = useState('');
  const [reglementEnCours, setReglementEnCours] = useState(false);
  const [envoiReleveEnCours, setEnvoiReleveEnCours] = useState(false);
  const [clientEnEdition, setClientEnEdition] = useState(null);
  const [enregistrementEdition, setEnregistrementEdition] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [filtreCreance, setFiltreCreance] = useState('tous');

  async function handleEnvoyerReleve() {
    setEnvoiReleveEnCours(true);
    setDetailErreur('');
    try {
      const { phone, message } = await api.getClientWhatsappStatement(clientSelectionne.id);
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
    } catch (err) {
      setDetailErreur(err.message);
    } finally {
      setEnvoiReleveEnCours(false);
    }
  }

  function charger() {
    setChargement(true);
    api
      .getClients()
      .then(setClients)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  const clientsFiltres = useMemo(() => {
    return clients.filter((c) => {
      const correspondRecherche =
        c.full_name.toLowerCase().includes(recherche.toLowerCase()) ||
        (c.phone || '').toLowerCase().includes(recherche.toLowerCase());
      const correspondCreance =
        filtreCreance === 'tous' ||
        (filtreCreance === 'creance' && Number(c.balance_due) > 0) ||
        (filtreCreance === 'a_jour' && Number(c.balance_due) <= 0);
      return correspondRecherche && correspondCreance;
    });
  }, [clients, recherche, filtreCreance]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!nouveauClient.fullName) {
      setErreur('Le nom du client est requis.');
      return;
    }
    try {
      await api.createClient(nouveauClient);
      setModaleOuverte(false);
      setNouveauClient({ fullName: '', phone: '', email: '' });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function ouvrirFiche(client) {
    setClientSelectionne(client);
    setDetailChargement(true);
    setDetailErreur('');
    try {
      const detail = await api.getClient(client.id);
      setClientSelectionne(detail);
    } catch (err) {
      setDetailErreur(err.message);
    } finally {
      setDetailChargement(false);
    }
  }

  async function rafraichirFiche(id) {
    try {
      const detail = await api.getClient(id);
      setClientSelectionne(detail);
      charger();
    } catch (err) {
      setDetailErreur(err.message);
    }
  }

  function ouvrirEdition(client) {
    setClientEnEdition({
      fullName: client.full_name,
      phone: client.phone || '',
      email: client.email || '',
      address: client.address || '',
    });
  }

  async function handleEnregistrerEdition(e) {
    e.preventDefault();
    if (!clientEnEdition.fullName) {
      setDetailErreur('Le nom du client est requis.');
      return;
    }
    setEnregistrementEdition(true);
    try {
      await api.updateClient(clientSelectionne.id, clientEnEdition);
      setClientEnEdition(null);
      await rafraichirFiche(clientSelectionne.id);
    } catch (err) {
      setDetailErreur(err.message);
    } finally {
      setEnregistrementEdition(false);
    }
  }

  async function handleEnregistrerReglement(e) {
    e.preventDefault();
    const montant = Number(montantReglement);
    if (!montant || montant <= 0) {
      setDetailErreur('Le montant du règlement doit être un nombre positif.');
      return;
    }
    setReglementEnCours(true);
    setDetailErreur('');
    try {
      await api.recordCreditPayment(clientSelectionne.id, {
        amount: montant,
        paymentMethod: moyenReglement,
        note: noteReglement || undefined,
      });
      setVueReglement(false);
      setMontantReglement('');
      setMoyenReglement('especes');
      setNoteReglement('');
      await rafraichirFiche(clientSelectionne.id);
    } catch (err) {
      setDetailErreur(err.message);
    } finally {
      setReglementEnCours(false);
    }
  }

  const totalAchats = (clientSelectionne?.orderHistory || []).reduce(
    (sum, o) => sum + Number(o.total_amount),
    0
  );

  return (
    <>
      <div className="entete-page">
        <h1>Clients</h1>
        <button
          className="btn btn-principal"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, boxShadow: '0 6px 16px -6px var(--accent)', fontWeight: 600 }}
          onClick={() => setModaleOuverte(true)}
        >
          <IconPlus />
          Nouveau client
        </button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-filtres">
        <div className="champ-avec-icone champ-avec-icone--pleine-largeur">
          <span className="champ-icone"><IconRecherche /></span>
          <input
            type="text"
            className="champ champ--avec-icone"
            placeholder="Rechercher par nom ou téléphone…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: 4,
            background: 'var(--fond-alterne, rgba(0,0,0,0.03))',
            borderRadius: 999,
            border: '1px solid var(--trait)',
          }}
        >
          {FILTRES_CREANCE.map((f) => {
            const actif = filtreCreance === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFiltreCreance(f.value)}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  padding: '7px 16px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: actif ? 600 : 500,
                  color: actif ? '#fff' : 'var(--encre-douce)',
                  background: actif ? 'var(--accent)' : 'transparent',
                  boxShadow: actif ? '0 4px 10px -3px var(--accent)' : 'none',
                  transition: 'background 0.15s ease, color 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : clientsFiltres.length === 0 ? (
        <p className="etat-vide">
          {clients.length === 0 ? 'Aucun client enregistré. Ajoutez votre premier client.' : 'Aucun client ne correspond à ces filtres.'}
        </p>
      ) : (
        <div className="grille-cartes">
          {clientsFiltres.map((c) => {
            const aCreance = Number(c.balance_due) > 0;
            return (
              <div key={c.id} className="carte-entite">
                <div className="carte-entite-entete">
                  <span className="carte-entite-icone"><IconClient /></span>
                  {aCreance && <span className="tampon tampon-brique">Créance</span>}
                </div>
                <p className="carte-entite-nom">{c.full_name}</p>
                <p className="carte-entite-detail">{c.phone || c.email || 'Aucun contact enregistré'}</p>
                <p className="carte-entite-metrique" style={aCreance ? { color: 'var(--danger)' } : undefined}>
                  {aCreance ? `${Math.round(c.balance_due).toLocaleString('fr-FR')} FCFA` : 'À jour'}
                </p>
                <p className="carte-entite-souslegende">{aCreance ? 'Créance en cours' : 'Aucune créance'}</p>
                <div className="carte-entite-actions">
                  <button
                    className="btn"
                    style={{ flex: 1, justifyContent: 'center', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={() => ouvrirFiche(c)}
                  >
                    <IconDossier />
                    Voir la fiche
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modale d'ajout de client */}
      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Ajouter un client</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="c-name">Nom complet</label>
                <input
                  id="c-name"
                  className="champ"
                  value={nouveauClient.fullName}
                  onChange={(e) => setNouveauClient({ ...nouveauClient, fullName: e.target.value })}
                  placeholder="Aïcha Diallo"
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="c-phone">Téléphone</label>
                <input
                  id="c-phone"
                  className="champ"
                  value={nouveauClient.phone}
                  onChange={(e) => setNouveauClient({ ...nouveauClient, phone: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="c-email">Email</label>
                <input
                  id="c-email"
                  type="email"
                  className="champ"
                  value={nouveauClient.email}
                  onChange={(e) => setNouveauClient({ ...nouveauClient, email: e.target.value })}
                />
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setModaleOuverte(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-principal">
                  Ajouter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Fiche client : coordonnées + historique d'achats */}
      {clientSelectionne && (
        <div className="modale-fond" onClick={() => setClientSelectionne(null)}>
          <div className="modale" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>{clientSelectionne.full_name}</h2>

            <div style={{ display: 'flex', gap: 24, marginBottom: 20, fontSize: 14, color: 'var(--encre-douce)', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{clientSelectionne.phone || 'Téléphone non renseigné'}</span>
              <span>{clientSelectionne.email || 'Email non renseigné'}</span>
              <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => ouvrirEdition(clientSelectionne)}>
                Modifier
              </button>
            </div>

            {detailErreur && <div className="erreur">{detailErreur}</div>}

            {detailChargement ? (
              <p style={{ color: 'var(--encre-douce)' }}>Chargement de l'historique…</p>
            ) : vueReglement ? (
              <>
                <p style={{ fontSize: 14, marginBottom: 16 }}>
                  Créance actuelle : <strong className="chiffre">{Math.round(clientSelectionne.balance_due).toLocaleString('fr-FR')} FCFA</strong>
                </p>
                {detailErreur && <div className="erreur">{detailErreur}</div>}
                <form onSubmit={handleEnregistrerReglement}>
                  <div className="champ-groupe">
                    <label className="etiquette" htmlFor="r-montant">Montant réglé (FCFA)</label>
                    <input
                      id="r-montant"
                      type="number"
                      className="champ"
                      value={montantReglement}
                      onChange={(e) => setMontantReglement(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="champ-groupe">
                    <label className="etiquette" htmlFor="r-moyen">Moyen de paiement</label>
                    <select
                      id="r-moyen"
                      className="champ"
                      value={moyenReglement}
                      onChange={(e) => setMoyenReglement(e.target.value)}
                    >
                      <option value="especes">Espèces</option>
                      <option value="wave">Wave</option>
                      <option value="orange_money">Orange Money</option>
                      <option value="cheque">Chèque</option>
                      <option value="virement">Virement</option>
                    </select>
                  </div>
                  <div className="champ-groupe">
                    <label className="etiquette" htmlFor="r-note">Note (optionnel)</label>
                    <input
                      id="r-note"
                      type="text"
                      className="champ"
                      value={noteReglement}
                      onChange={(e) => setNoteReglement(e.target.value)}
                      placeholder="Ex : versement en espèces le 12/09"
                    />
                  </div>
                  <div className="actions-modale">
                    <button type="button" className="btn" onClick={() => setVueReglement(false)} disabled={reglementEnCours}>
                      Annuler
                    </button>
                    <button type="submit" className="btn btn-principal" disabled={reglementEnCours}>
                      {reglementEnCours ? 'Enregistrement…' : 'Enregistrer le règlement'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div className="ligne-stats" style={{ marginBottom: 20 }}>
                  <div className="stat" style={{ padding: '12px 16px' }}>
                    <span className="etiquette">Commandes</span>
                    <span className="valeur" style={{ fontSize: 20 }}>
                      {(clientSelectionne.orderHistory || []).length}
                    </span>
                  </div>
                  <div className="stat" style={{ padding: '12px 16px' }}>
                    <span className="etiquette">Total des achats</span>
                    <span className="valeur" style={{ fontSize: 20 }}>
                      {totalAchats.toLocaleString('fr-FR')} FCFA
                    </span>
                  </div>
                  <div className="stat" style={{ padding: '12px 16px' }}>
                    <span className="etiquette">Créance</span>
                    <span className="valeur" style={{ fontSize: 20, color: Number(clientSelectionne.balance_due) > 0 ? 'var(--danger)' : undefined }}>
                      {Math.round(clientSelectionne.balance_due || 0).toLocaleString('fr-FR')} FCFA
                    </span>
                  </div>
                </div>

                {Number(clientSelectionne.balance_due) > 0 && (
                  <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button className="btn btn-principal" onClick={() => setVueReglement(true)}>
                      Enregistrer un règlement
                    </button>
                    <button className="btn" onClick={handleEnvoyerReleve} disabled={envoiReleveEnCours || !clientSelectionne.phone}>
                      {envoiReleveEnCours ? 'Préparation…' : 'Envoyer via WhatsApp'}
                    </button>
                    {!clientSelectionne.phone && (
                      <span style={{ fontSize: 12, color: 'var(--encre-douce)' }}>Aucun numéro de téléphone enregistré pour ce client</span>
                    )}
                  </div>
                )}

                <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Historique d'achats</p>
                {(clientSelectionne.orderHistory || []).length === 0 ? (
                  <p className="etat-vide" style={{ padding: '20px 4px' }}>Aucun achat enregistré pour ce client.</p>
                ) : (
                  <table className="registre">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Montant</th>
                        <th>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientSelectionne.orderHistory.map((o) => (
                        <tr key={o.id}>
                          <td>{new Date(o.created_at).toLocaleDateString('fr-FR')}</td>
                          <td className="chiffre">{Number(o.total_amount).toLocaleString('fr-FR')} FCFA</td>
                          <td><StatusBadge status={o.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {(clientSelectionne.creditPayments || []).length > 0 && (
                  <>
                    <p style={{ fontSize: 14, fontWeight: 500, margin: '20px 0 8px' }}>Règlements de créance</p>
                    <table className="registre">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Montant</th>
                          <th>Enregistré par</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientSelectionne.creditPayments.map((r) => (
                          <tr key={r.id}>
                            <td>{new Date(r.created_at).toLocaleDateString('fr-FR')}</td>
                            <td className="chiffre">{Number(r.amount).toLocaleString('fr-FR')} FCFA</td>
                            <td>{r.recorded_by_name || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}

            <div className="actions-modale">
              <button className="btn" onClick={() => { setClientSelectionne(null); setVueReglement(false); }}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
      {clientEnEdition && (
        <div className="modale-fond" onClick={() => setClientEnEdition(null)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Modifier le client</h2>
            <form onSubmit={handleEnregistrerEdition}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="ce-name">Nom complet</label>
                <input
                  id="ce-name"
                  className="champ"
                  value={clientEnEdition.fullName}
                  onChange={(e) => setClientEnEdition({ ...clientEnEdition, fullName: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="ce-phone">Téléphone</label>
                <input
                  id="ce-phone"
                  className="champ"
                  value={clientEnEdition.phone}
                  onChange={(e) => setClientEnEdition({ ...clientEnEdition, phone: e.target.value })}
                  placeholder="77 123 45 67"
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="ce-email">Email</label>
                <input
                  id="ce-email"
                  type="email"
                  className="champ"
                  value={clientEnEdition.email}
                  onChange={(e) => setClientEnEdition({ ...clientEnEdition, email: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="ce-address">Adresse</label>
                <input
                  id="ce-address"
                  className="champ"
                  value={clientEnEdition.address}
                  onChange={(e) => setClientEnEdition({ ...clientEnEdition, address: e.target.value })}
                />
              </div>
              <div className="actions-modale">
                <button type="button" className="btn" onClick={() => setClientEnEdition(null)}>Annuler</button>
                <button type="submit" className="btn btn-principal" disabled={enregistrementEdition}>
                  {enregistrementEdition ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
