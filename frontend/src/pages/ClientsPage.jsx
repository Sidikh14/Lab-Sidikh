import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useLiveEvent } from '../offline/liveEvents';
import { getSecteurConfig } from '../config/sectorConfig';
import { StylesModernes } from '../components/StylesModernes';

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

function IconMutuelle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 21s-7-4.5-9.5-9C.5 8 2 4 6 4c2 0 3.5 1 4 2.5C10.5 5 12 4 14 4c4 0 5.5 4 3.5 8-2.5 4.5-9.5 9-9.5 9z" />
    </svg>
  );
}

function IconReglement() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 10h20" />
      <path d="M6 15h4" />
    </svg>
  );
}

function IconCorbeille() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </svg>
  );
}

function IconTelecharger() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  );
}

const FILTRES_CREANCE = [
  { value: 'tous', label: 'Tous' },
  { value: 'creance', label: 'Avec créance' },
  { value: 'a_jour', label: 'À jour' },
];

function ClientsTab() {
  const { merchant } = useAuth();
  const estPharmacie = merchant?.sector === 'pharmacie';
  // Vocabulaire selon le secteur (sectorConfig.libelleClient : Patient en pharmacie).
  const mot = getSecteurConfig(merchant?.sector).libelleClient.toLowerCase();

  const [clients, setClients] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouveauClient, setNouveauClient] = useState({ fullName: '', phone: '', email: '', insurerId: '', insuranceCoveragePercent: '' });

  // Mutuelles/tiers payant — pharmacie uniquement.
  const [mutuelles, setMutuelles] = useState([]);
  useEffect(() => {
    if (estPharmacie) {
      api.getInsurers().then(setMutuelles).catch((err) => setErreur(err.message));
    }
  }, [estPharmacie]);


  const [clientSelectionne, setClientSelectionne] = useState(null);
  const [detailChargement, setDetailChargement] = useState(false);
  const [detailErreur, setDetailErreur] = useState('');
  const [vueReglement, setVueReglement] = useState(false);
  const [montantReglement, setMontantReglement] = useState('');
  const [moyenReglement, setMoyenReglement] = useState('especes');
  const [noteReglement, setNoteReglement] = useState('');
  const [reglementEnCours, setReglementEnCours] = useState(false);
  const [envoiReleveEnCours, setEnvoiReleveEnCours] = useState(false);
  const [telechargementFacturesEnCours, setTelechargementFacturesEnCours] = useState(false);
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

  async function handleTelechargerFacturesImpayees() {
    setTelechargementFacturesEnCours(true);
    setDetailErreur('');
    try {
      await api.downloadClientUnpaidInvoicesPdf(clientSelectionne.id);
    } catch (err) {
      setDetailErreur(err.message);
    } finally {
      setTelechargementFacturesEnCours(false);
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
      setErreur(`Le nom du ${mot} est requis.`);
      return;
    }
    try {
      await api.createClient({
        ...nouveauClient,
        insurerId: nouveauClient.insurerId || null,
        insuranceCoveragePercent: nouveauClient.insurerId && nouveauClient.insuranceCoveragePercent !== ''
          ? Number(nouveauClient.insuranceCoveragePercent)
          : null,
      });
      setModaleOuverte(false);
      setNouveauClient({ fullName: '', phone: '', email: '', insurerId: '', insuranceCoveragePercent: '' });
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
      insurerId: client.insurer_id || '',
      insuranceCoveragePercent: client.insurance_coverage_percent ?? '',
    });
  }

  async function handleEnregistrerEdition(e) {
    e.preventDefault();
    if (!clientEnEdition.fullName) {
      setDetailErreur(`Le nom du ${mot} est requis.`);
      return;
    }
    setEnregistrementEdition(true);
    try {
      await api.updateClient(clientSelectionne.id, {
        ...clientEnEdition,
        insurerId: clientEnEdition.insurerId || null,
        insuranceCoveragePercent: clientEnEdition.insurerId && clientEnEdition.insuranceCoveragePercent !== ''
          ? Number(clientEnEdition.insuranceCoveragePercent)
          : null,
      });
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

  const nbCreances = clients.filter((c) => Number(c.balance_due) > 0).length;
  const totalCreances = clients.reduce((t, c) => t + Number(c.balance_due || 0), 0);
  const compteCreance = (v) => (v === 'tous' ? clients.length : v === 'creance' ? nbCreances : clients.length - nbCreances);

  return (
    <>
      <StylesModernes />

      <div className="md-kpis">
        <div className="md-kpi md-kpi--hero">
          <span className="md-kpi-icone"><IconClient /></span>
          <p className="md-kpi-label">{mot.charAt(0).toUpperCase() + mot.slice(1)}s</p>
          <p className="md-kpi-valeur">{clients.length}</p>
        </div>
        <div className={'md-kpi' + (totalCreances > 0 ? ' md-kpi--alerte' : '')}>
          <span className="md-kpi-icone"><IconReglement /></span>
          <p className="md-kpi-label">Créances en cours</p>
          <p className="md-kpi-valeur">{Math.round(totalCreances).toLocaleString('fr-FR')} <small>FCFA</small></p>
          <p className="md-kpi-sous">{nbCreances} {mot}(s) concerné(s)</p>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="md-outils">
        <div className="champ-avec-icone md-recherche">
          <span className="champ-icone"><IconRecherche /></span>
          <input
            type="text"
            className="champ champ--avec-icone"
            placeholder="Rechercher par nom ou téléphone…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <button className="btn btn-principal" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} onClick={() => setModaleOuverte(true)}>
          <IconPlus />
          Nouveau {mot}
        </button>
      </div>

      <div className="md-barre-vue">
        <div className="md-puces">
          {FILTRES_CREANCE.map((f) => (
            <button
              key={f.value}
              type="button"
              className={'md-puce' + (filtreCreance === f.value ? ' actif' : '')}
              onClick={() => setFiltreCreance(f.value)}
            >
              {f.label} <span>{compteCreance(f.value)}</span>
            </button>
          ))}
        </div>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : clientsFiltres.length === 0 ? (
        <p className="etat-vide">
          {clients.length === 0 ? `Aucun ${mot} enregistré. Ajoutez votre premier ${mot}.` : `Aucun ${mot} ne correspond à ces filtres.`}
        </p>
      ) : (
        <div className="md-liste">
          {clientsFiltres.map((c) => {
            const aCreance = Number(c.balance_due) > 0;
            return (
              <div key={c.id} className={'md-ligne' + (aCreance ? ' md-ligne--prioritaire' : '')}>
                <div className="md-avatar">{(c.full_name || '?').trim()[0].toUpperCase()}</div>

                <div className="md-bloc">
                  <p className="md-titre">{c.full_name}</p>
                  <p className="md-sous">{c.phone || c.email || 'Aucun contact enregistré'}</p>
                </div>

                <div className="md-bloc md-bloc--montant">
                  <p className="md-montant" style={aCreance ? { color: 'var(--danger)' } : undefined}>
                    {aCreance ? `${Math.round(c.balance_due).toLocaleString('fr-FR')} FCFA` : 'À jour'}
                  </p>
                  <span className={`tampon ${aCreance ? 'tampon-brique' : 'tampon-sarcelle'}`}>
                    {aCreance ? 'Créance en cours' : 'Aucune créance'}
                  </span>
                </div>

                <div className="md-actions">
                  <button className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => ouvrirFiche(c)}>
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
            <h2>Ajouter un {mot}</h2>
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
              {estPharmacie && (
                <>
                  <div className="champ-groupe">
                    <label className="etiquette" htmlFor="c-insurer">Mutuelle / tiers payant</label>
                    <select
                      id="c-insurer"
                      className="champ"
                      value={nouveauClient.insurerId}
                      onChange={(e) => setNouveauClient({ ...nouveauClient, insurerId: e.target.value })}
                    >
                      <option value="">Aucune ({mot} sans mutuelle)</option>
                      {mutuelles.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  {nouveauClient.insurerId && (
                    <div className="champ-groupe">
                      <label className="etiquette" htmlFor="c-coverage">% pris en charge par la mutuelle</label>
                      <input
                        id="c-coverage"
                        type="number"
                        min="0"
                        max="100"
                        className="champ"
                        value={nouveauClient.insuranceCoveragePercent}
                        onChange={(e) => setNouveauClient({ ...nouveauClient, insuranceCoveragePercent: e.target.value })}
                        placeholder="Ex : 70"
                      />
                    </div>
                  )}
                </>
              )}
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
                <div className="md-kpis">
                  <div className="md-kpi">
                    <p className="md-kpi-label">Commandes</p>
                    <p className="md-kpi-valeur">{(clientSelectionne.orderHistory || []).length}</p>
                  </div>
                  <div className="md-kpi">
                    <p className="md-kpi-label">Total des achats</p>
                    <p className="md-kpi-valeur">{Math.round(totalAchats).toLocaleString('fr-FR')} <small>FCFA</small></p>
                  </div>
                  <div className={'md-kpi' + (Number(clientSelectionne.balance_due) > 0 ? ' md-kpi--alerte' : '')}>
                    <p className="md-kpi-label">Créance</p>
                    <p className="md-kpi-valeur" style={Number(clientSelectionne.balance_due) > 0 ? { color: 'var(--danger)' } : undefined}>
                      {Math.round(clientSelectionne.balance_due || 0).toLocaleString('fr-FR')} <small>FCFA</small>
                    </p>
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
                    <button className="btn" onClick={handleTelechargerFacturesImpayees} disabled={telechargementFacturesEnCours}>
                      {telechargementFacturesEnCours ? 'Préparation…' : 'Télécharger les factures impayées'}
                    </button>
                    {!clientSelectionne.phone && (
                      <span style={{ fontSize: 12, color: 'var(--encre-douce)' }}>Aucun numéro de téléphone enregistré pour ce {mot}</span>
                    )}
                  </div>
                )}

                {estPharmacie && (clientSelectionne.prescriptions || []).length > 0 && (
                  <>
                    <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Ordonnances</p>
                    <div style={{ marginBottom: 20 }}>
                      {clientSelectionne.prescriptions.map((o) => (
                        <div key={o.id} style={{ padding: '10px 12px', border: '1px solid var(--trait)', borderRadius: 'var(--rayon-petit)', marginBottom: 8 }}>
                          <p style={{ fontSize: 13, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <strong>Ordonnance du {new Date(o.prescription_date).toLocaleDateString('fr-FR')}</strong>
                            {o.doctor_name && <span style={{ color: 'var(--encre-douce)' }}>Dr {o.doctor_name}</span>}
                            {o.is_renewable && <span className="tampon">Renouvelable</span>}
                            {o.expired && <span className="tampon tampon-brique">Expirée</span>}
                          </p>
                          {o.is_renewable && o.valid_until && (
                            <p style={{ fontSize: 12, color: 'var(--encre-douce)', margin: '0 0 4px' }}>
                              Valable jusqu'au {new Date(o.valid_until).toLocaleDateString('fr-FR')}
                            </p>
                          )}
                          {(o.items || []).map((it) => {
                            const reste = Math.max(0, Number(it.prescribed) - Number(it.delivered));
                            return (
                              <p key={it.productId} style={{ fontSize: 13, margin: '1px 0' }}>
                                {it.productName} : délivré <span className="chiffre">{Number(it.delivered)}</span> / <span className="chiffre">{Number(it.prescribed)}</span>
                                {' '}— <strong style={{ color: reste === 0 ? 'var(--brique, #b45309)' : undefined }}>reste {reste}</strong>
                              </p>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Historique d'achats</p>
                {(clientSelectionne.orderHistory || []).length === 0 ? (
                  <p className="etat-vide" style={{ padding: '20px 4px' }}>Aucun achat enregistré pour ce {mot}.</p>
                ) : (
                  <table className="registre">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Montant</th>
                        <th>Statut</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientSelectionne.orderHistory.map((o) => (
                        <tr key={o.id}>
                          <td>{new Date(o.created_at).toLocaleDateString('fr-FR')}</td>
                          <td className="chiffre">{Number(o.total_amount).toLocaleString('fr-FR')} FCFA</td>
                          <td><StatusBadge status={o.status} /></td>
                          <td>
                            <button
                              className="btn"
                              style={{ padding: '4px 10px', fontSize: 12 }}
                              onClick={() => api.previewOrderReceipt(o.id).catch((err) => setDetailErreur(err.message))}
                            >
                              Facture
                            </button>
                          </td>
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
            <h2>Modifier le {mot}</h2>
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
              {estPharmacie && (
                <>
                  <div className="champ-groupe">
                    <label className="etiquette" htmlFor="ce-insurer">Mutuelle / tiers payant</label>
                    <select
                      id="ce-insurer"
                      className="champ"
                      value={clientEnEdition.insurerId}
                      onChange={(e) => setClientEnEdition({ ...clientEnEdition, insurerId: e.target.value })}
                    >
                      <option value="">Aucune ({mot} sans mutuelle)</option>
                      {mutuelles.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  {clientEnEdition.insurerId && (
                    <div className="champ-groupe">
                      <label className="etiquette" htmlFor="ce-coverage">% pris en charge par la mutuelle</label>
                      <input
                        id="ce-coverage"
                        type="number"
                        min="0"
                        max="100"
                        className="champ"
                        value={clientEnEdition.insuranceCoveragePercent}
                        onChange={(e) => setClientEnEdition({ ...clientEnEdition, insuranceCoveragePercent: e.target.value })}
                        placeholder="Ex : 70"
                      />
                    </div>
                  )}
                </>
              )}
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

function MutuellesTab() {
  const { user } = useAuth();
  const estManager = user?.role === 'manager';
  // Le règlement d'une mutuelle entre directement dans la caisse d'une
  // boutique (voir insurers_routes.js) : le gérant est déjà rattaché à une
  // seule boutique, mais le manager qui en gère plusieurs doit préciser
  // laquelle a reçu ce règlement.
  const [boutiques, setBoutiques] = useState([]);
  const [boutiqueReglement, setBoutiqueReglement] = useState('');
  useEffect(() => {
    if (estManager) api.getWarehouses().then(setBoutiques).catch(() => {});
  }, [estManager]);

  const [mutuelles, setMutuelles] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouveau, setNouveau] = useState({ name: '', phone: '', email: '', address: '' });

  const [mutuelleSelectionnee, setMutuelleSelectionnee] = useState(null);
  const [detailMutuelle, setDetailMutuelle] = useState(null);
  const [montantReglement, setMontantReglement] = useState('');
  const [moyenReglement, setMoyenReglement] = useState('especes');
  const [enregistrementReglement, setEnregistrementReglement] = useState(false);

  const [mois, setMois] = useState(() => new Date().toISOString().slice(0, 7));
  const [exportEnCours, setExportEnCours] = useState(false);

  const [recherche, setRecherche] = useState('');
  const [filtreCreance, setFiltreCreance] = useState('tous');

  function charger() {
    setChargement(true);
    api
      .getInsurers()
      .then(setMutuelles)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);
  useLiveEvent('activity:created', () => charger());

  const mutuellesFiltrees = useMemo(() => {
    return mutuelles.filter((m) => {
      const correspondRecherche =
        m.name.toLowerCase().includes(recherche.toLowerCase()) ||
        (m.phone || '').toLowerCase().includes(recherche.toLowerCase());
      const correspondCreance =
        filtreCreance === 'tous' ||
        (filtreCreance === 'creance' && Number(m.debt) > 0) ||
        (filtreCreance === 'a_jour' && Number(m.debt) <= 0);
      return correspondRecherche && correspondCreance;
    });
  }, [mutuelles, recherche, filtreCreance]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!nouveau.name) {
      setErreur('Le nom de la mutuelle est requis.');
      return;
    }
    try {
      await api.createInsurer(nouveau);
      setModaleOuverte(false);
      setNouveau({ name: '', phone: '', email: '', address: '' });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimer(mutuelle) {
    if (!window.confirm(`Retirer "${mutuelle.name}" de la liste des mutuelles ?`)) return;
    try {
      await api.deleteInsurer(mutuelle.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  function ouvrirDetail(mutuelle) {
    setMutuelleSelectionnee(mutuelle);
    setMontantReglement('');
    setMoyenReglement('especes');
    setBoutiqueReglement('');
    api
      .getInsurer(mutuelle.id)
      .then(setDetailMutuelle)
      .catch((err) => setErreur(err.message));
  }

  async function handleEnregistrerReglement(e) {
    e.preventDefault();
    if (!Number(montantReglement) || Number(montantReglement) <= 0) {
      setErreur('Montant de règlement invalide.');
      return;
    }
    if (estManager && !boutiqueReglement) {
      setErreur('Choisissez la boutique qui a reçu ce règlement.');
      return;
    }
    setEnregistrementReglement(true);
    try {
      await api.createInsurerPayment(mutuelleSelectionnee.id, {
        amount: Number(montantReglement),
        paymentMethod: moyenReglement,
        ...(estManager ? { warehouseId: boutiqueReglement } : {}),
      });
      const detail = await api.getInsurer(mutuelleSelectionnee.id);
      setDetailMutuelle(detail);
      setMontantReglement('');
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementReglement(false);
    }
  }

  async function handleExporterEtat() {
    if (!mois) {
      setErreur('Choisissez un mois.');
      return;
    }
    setExportEnCours(true);
    try {
      await api.downloadInsurerStatementPdf(mutuelleSelectionnee.id, mois);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setExportEnCours(false);
    }
  }

  const nbCreancesMutuelles = mutuelles.filter((m) => Number(m.debt) > 0).length;
  const totalCreancesMutuelles = mutuelles.reduce((t, m) => t + Number(m.debt || 0), 0);
  const compteCreanceMutuelle = (v) =>
    v === 'tous' ? mutuelles.length : v === 'creance' ? nbCreancesMutuelles : mutuelles.length - nbCreancesMutuelles;

  return (
    <>
      <StylesModernes />

      <div className="md-kpis">
        <div className="md-kpi md-kpi--hero">
          <span className="md-kpi-icone"><IconMutuelle /></span>
          <p className="md-kpi-label">Mutuelles</p>
          <p className="md-kpi-valeur">{mutuelles.length}</p>
        </div>
        <div className={'md-kpi' + (totalCreancesMutuelles > 0 ? ' md-kpi--alerte' : '')}>
          <span className="md-kpi-icone"><IconReglement /></span>
          <p className="md-kpi-label">À recevoir</p>
          <p className="md-kpi-valeur">{Math.round(totalCreancesMutuelles).toLocaleString('fr-FR')} <small>FCFA</small></p>
          <p className="md-kpi-sous">{nbCreancesMutuelles} mutuelle(s) avec créance</p>
        </div>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="md-outils">
        <div className="champ-avec-icone md-recherche">
          <span className="champ-icone"><IconRecherche /></span>
          <input
            type="text"
            className="champ champ--avec-icone"
            placeholder="Rechercher par nom ou téléphone…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <button className="btn btn-principal" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} onClick={() => setModaleOuverte(true)}>
          <IconPlus />
          Nouvelle mutuelle
        </button>
      </div>

      <div className="md-barre-vue">
        <div className="md-puces">
          {FILTRES_CREANCE.map((f) => (
            <button
              key={f.value}
              type="button"
              className={'md-puce' + (filtreCreance === f.value ? ' actif' : '')}
              onClick={() => setFiltreCreance(f.value)}
            >
              {f.label} <span>{compteCreanceMutuelle(f.value)}</span>
            </button>
          ))}
        </div>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : mutuellesFiltrees.length === 0 ? (
        <p className="etat-vide">
          {mutuelles.length === 0 ? 'Aucune mutuelle enregistrée pour le moment.' : 'Aucune mutuelle ne correspond à ces filtres.'}
        </p>
      ) : (
        <div className="md-liste">
          {mutuellesFiltrees.map((m) => {
            const aCreance = Number(m.debt) > 0;
            return (
              <div key={m.id} className={'md-ligne' + (aCreance ? ' md-ligne--prioritaire' : '')}>
                <div className="md-avatar">{(m.name || '?').trim()[0].toUpperCase()}</div>

                <div className="md-bloc">
                  <p className="md-titre">{m.name}</p>
                  <p className="md-sous">{m.phone || m.email || 'Aucun contact enregistré'}</p>
                </div>

                <div className="md-bloc md-bloc--montant">
                  <p className="md-montant" style={aCreance ? { color: 'var(--danger)' } : undefined}>
                    {Math.round(Number(m.debt) || 0).toLocaleString('fr-FR')} FCFA
                  </p>
                  <span className={`tampon ${aCreance ? 'tampon-brique' : 'tampon-sarcelle'}`}>
                    {aCreance ? 'Doit être réglée' : 'Aucune créance'}
                  </span>
                </div>

                <div className="md-actions">
                  <button className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => ouvrirDetail(m)}>
                    <IconReglement />
                    Détail / Règlement
                  </button>
                  <button className="btn" onClick={() => handleSupprimer(m)} title="Retirer cette mutuelle">
                    <IconCorbeille />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Ajouter une mutuelle</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="m-name">Nom</label>
                <input
                  id="m-name"
                  className="champ"
                  value={nouveau.name}
                  onChange={(e) => setNouveau({ ...nouveau, name: e.target.value })}
                  placeholder="IPM Santé Plus"
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="m-phone">Téléphone</label>
                <input
                  id="m-phone"
                  className="champ"
                  value={nouveau.phone}
                  onChange={(e) => setNouveau({ ...nouveau, phone: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="m-email">Email</label>
                <input
                  id="m-email"
                  type="email"
                  className="champ"
                  value={nouveau.email}
                  onChange={(e) => setNouveau({ ...nouveau, email: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="m-address">Adresse</label>
                <input
                  id="m-address"
                  className="champ"
                  value={nouveau.address}
                  onChange={(e) => setNouveau({ ...nouveau, address: e.target.value })}
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

      {mutuelleSelectionnee && (
        <div className="modale-fond" onClick={() => { setMutuelleSelectionnee(null); setDetailMutuelle(null); }}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>{mutuelleSelectionnee.name}</h2>
            {!detailMutuelle ? (
              <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
            ) : (
              <>
                <p style={{ fontSize: 15, marginBottom: 16 }}>
                  Créance actuelle : <strong className="chiffre">{Math.round(detailMutuelle.debt).toLocaleString('fr-FR')} FCFA</strong>
                </p>

                <form onSubmit={handleEnregistrerReglement}>
                  {estManager && (
                    <div className="champ-groupe">
                      <label className="etiquette" htmlFor="mr-boutique">Boutique ayant reçu le règlement</label>
                      <select
                        id="mr-boutique"
                        className="champ"
                        value={boutiqueReglement}
                        onChange={(e) => setBoutiqueReglement(e.target.value)}
                      >
                        <option value="">Choisir…</option>
                        {boutiques.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="champ-groupe">
                    <label className="etiquette" htmlFor="mr-montant">Montant du règlement reçu (FCFA)</label>
                    <input
                      id="mr-montant"
                      type="number"
                      className="champ"
                      value={montantReglement}
                      onChange={(e) => setMontantReglement(e.target.value)}
                    />
                  </div>
                  <div className="champ-groupe">
                    <label className="etiquette" htmlFor="mr-moyen">Moyen de paiement</label>
                    <select
                      id="mr-moyen"
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
                  <div className="actions-modale">
                    <button type="button" className="btn" onClick={() => { setMutuelleSelectionnee(null); setDetailMutuelle(null); }}>
                      Fermer
                    </button>
                    <button type="submit" className="btn btn-principal" disabled={enregistrementReglement}>
                      {enregistrementReglement ? 'Enregistrement…' : 'Enregistrer le règlement'}
                    </button>
                  </div>
                </form>

                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--trait)' }}>
                  <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 13 }}>État mensuel (à transmettre pour remboursement)</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="month"
                      className="champ"
                      style={{ width: 160 }}
                      value={mois}
                      onChange={(e) => setMois(e.target.value)}
                    />
                    <button
                      className="btn"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                      onClick={handleExporterEtat}
                      disabled={exportEnCours}
                    >
                      <IconTelecharger />
                      {exportEnCours ? 'Génération…' : 'Télécharger le PDF'}
                    </button>
                  </div>
                </div>

                {detailMutuelle.claims.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 14, marginTop: 20, marginBottom: 8 }}>Prises en charge récentes</h3>
                    <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                      {detailMutuelle.claims.map((c) => (
                        <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--encre-douce)' }}>
                          <span>{new Date(c.created_at).toLocaleDateString('fr-FR')} — #{c.order_seq} · {c.client_name}</span>
                          <span className="chiffre">{Math.round(c.amount).toLocaleString('fr-FR')} FCFA</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {detailMutuelle.payments.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 14, marginTop: 20, marginBottom: 8 }}>Historique des règlements reçus</h3>
                    <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                      {detailMutuelle.payments.map((p) => (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--encre-douce)' }}>
                          <span>{new Date(p.paid_at).toLocaleDateString('fr-FR')} — {p.user_name}{p.notes ? ` (${p.notes})` : ''}</span>
                          <span className="chiffre">{Math.round(p.amount).toLocaleString('fr-FR')} FCFA</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function ClientsPage() {
  const { merchant } = useAuth();
  const estPharmacie = merchant?.sector === 'pharmacie';
  const libelleClients = `${getSecteurConfig(merchant?.sector).libelleClient}s`;
  const [onglet, setOnglet] = useState('clients');

  return (
    <>
      <div className="entete-page">
        <h1>{libelleClients}</h1>
      </div>

      {estPharmacie && (
        <div className="onglets" style={{ marginBottom: 20 }}>
          <button className={onglet === 'clients' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('clients')}>
            {libelleClients}
          </button>
          <button className={onglet === 'mutuelles' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('mutuelles')}>
            Mutuelles / Tiers payant
          </button>
        </div>
      )}

      {estPharmacie && onglet === 'mutuelles' ? <MutuellesTab /> : <ClientsTab />}
    </>
  );
}
