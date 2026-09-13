import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';

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
  const [noteReglement, setNoteReglement] = useState('');
  const [reglementEnCours, setReglementEnCours] = useState(false);
  const [envoiReleveEnCours, setEnvoiReleveEnCours] = useState(false);
  const [clientEnEdition, setClientEnEdition] = useState(null);
  const [enregistrementEdition, setEnregistrementEdition] = useState(false);

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
      await api.recordCreditPayment(clientSelectionne.id, { amount: montant, note: noteReglement || undefined });
      setVueReglement(false);
      setMontantReglement('');
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
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-outils">
        <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{clients.length} client(s)</span>
        <button className="btn btn-principal" onClick={() => setModaleOuverte(true)}>
          Ajouter un client
        </button>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : clients.length === 0 ? (
        <p className="etat-vide">Aucun client enregistré. Ajoutez votre premier client.</p>
      ) : (
        <table className="registre">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Téléphone</th>
              <th>Email</th>
              <th>Créance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td>{c.full_name}</td>
                <td className="chiffre">{c.phone || '—'}</td>
                <td>{c.email || '—'}</td>
                <td className="chiffre" style={Number(c.balance_due) > 0 ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>
                  {Number(c.balance_due) > 0 ? `${Math.round(c.balance_due).toLocaleString('fr-FR')} FCFA` : '—'}
                </td>
                <td>
                  <button
                    className="btn"
                    style={{ padding: '5px 10px', fontSize: 13 }}
                    onClick={() => ouvrirFiche(c)}
                  >
                    Voir la fiche
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
