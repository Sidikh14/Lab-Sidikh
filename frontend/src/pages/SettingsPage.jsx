import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const SECTEURS_ZAKAT = ['grossiste', 'electromenager'];

function IconEntreprise() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="4" y="8" width="16" height="13" rx="1.5" />
      <path d="M9 21v-5h6v5" />
      <path d="M9 8V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3" />
    </svg>
  );
}

function IconPiece() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5h3.8a1.7 1.7 0 010 3.5h-2.6a1.7 1.7 0 000 3.5h3.8" />
    </svg>
  );
}

// Convertit un fichier image choisi par l'utilisateur en data URI base64
// (PNG/JPEG), pour l'envoyer et le stocker tel quel côté backend — même
// logique que la police déjà intégrée aux PDF, pas de stockage externe.
function fichierVersBase64(fichier) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolve(lecteur.result);
    lecteur.onerror = () => reject(new Error("Impossible de lire l'image."));
    lecteur.readAsDataURL(fichier);
  });
}

export function SettingsPage() {
  const { merchant } = useAuth();
  const voitZakat = SECTEURS_ZAKAT.includes(merchant?.sector);
  const [onglet, setOnglet] = useState('informations');

  const [profil, setProfil] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [enregistrement, setEnregistrement] = useState(false);
  const [nouveauLogo, setNouveauLogo] = useState(null); // data URI en attente d'envoi
  const [apercuLogo, setApercuLogo] = useState(null);

  const [zakat, setZakat] = useState(null);
  const [chargementZakat, setChargementZakat] = useState(false);
  const [erreurZakat, setErreurZakat] = useState('');

  function chargerZakat() {
    setChargementZakat(true);
    setErreurZakat('');
    api
      .getZakat()
      .then(setZakat)
      .catch((err) => setErreurZakat(err.message))
      .finally(() => setChargementZakat(false));
  }

  useEffect(() => {
    if (onglet === 'zakat' && voitZakat && !zakat) chargerZakat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet]);

  function charger() {
    setChargement(true);
    api
      .getMerchantProfile()
      .then((data) => {
        setProfil({
          ninea: data.ninea || '',
          rccm: data.rccm || '',
          address: data.address || '',
          bankDetails: data.bank_details || '',
          mobileMoneyDetails: data.mobile_money_details || '',
          paymentTerms: data.payment_terms || '',
        });
        setApercuLogo(data.logo_data || null);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  async function handleChoisirLogo(e) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    if (!['image/png', 'image/jpeg'].includes(fichier.type)) {
      setErreur('Le logo doit être une image PNG ou JPEG.');
      return;
    }
    if (fichier.size > 1_500_000) {
      setErreur('Le logo doit faire moins de 1,5 Mo.');
      return;
    }
    try {
      const dataUri = await fichierVersBase64(fichier);
      setNouveauLogo(dataUri);
      setApercuLogo(dataUri);
      setErreur('');
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleEnregistrer(e) {
    e.preventDefault();
    setEnregistrement(true);
    setErreur('');
    setMessage('');
    try {
      await api.updateMerchantProfile({
        ...profil,
        logoData: nouveauLogo || '',
      });
      setNouveauLogo(null);
      setMessage('Informations enregistrées avec succès.');
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <>
      <div className="entete-page">
        <h1>Entreprise</h1>
      </div>

      {voitZakat && (
        <div className="onglets">
          <button className={onglet === 'informations' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('informations')}>
            Informations
          </button>
          <button className={onglet === 'zakat' ? 'onglet actif' : 'onglet'} onClick={() => setOnglet('zakat')}>
            Zakat
          </button>
        </div>
      )}

      {onglet === 'informations' && (
        <>

      {erreur && <div className="erreur">{erreur}</div>}
      {message && (
        <div className="tampon tampon-sarcelle" style={{ display: 'block', marginBottom: 16 }}>
          {message}
        </div>
      )}

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : (
        <form onSubmit={handleEnregistrer} style={{ maxWidth: 480 }}>
          <div className="champ-groupe">
            <label className="etiquette">Logo</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {apercuLogo ? (
                <img
                  src={apercuLogo}
                  alt="Logo de l'entreprise"
                  style={{ height: 56, maxWidth: 140, objectFit: 'contain', border: '1px solid var(--trait)', borderRadius: 8, padding: 6 }}
                />
              ) : (
                <span
                  style={{
                    height: 56, width: 56, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '1px dashed var(--trait)', borderRadius: 8, color: 'var(--encre-douce)',
                  }}
                >
                  <IconEntreprise />
                </span>
              )}
              <label className="btn" style={{ cursor: 'pointer' }}>
                Choisir une image
                <input type="file" accept="image/png,image/jpeg" onChange={handleChoisirLogo} style={{ display: 'none' }} />
              </label>
            </div>
          </div>

          <div className="champ-groupe">
            <label className="etiquette" htmlFor="e-adresse">Adresse</label>
            <input
              id="e-adresse"
              className="champ"
              value={profil.address}
              onChange={(e) => setProfil({ ...profil, address: e.target.value })}
              placeholder="Ex : Rue 12, Médina, Dakar"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="e-ninea">NINEA</label>
              <input
                id="e-ninea"
                className="champ"
                value={profil.ninea}
                onChange={(e) => setProfil({ ...profil, ninea: e.target.value })}
              />
            </div>
            <div className="champ-groupe">
              <label className="etiquette" htmlFor="e-rccm">RCCM</label>
              <input
                id="e-rccm"
                className="champ"
                value={profil.rccm}
                onChange={(e) => setProfil({ ...profil, rccm: e.target.value })}
              />
            </div>
          </div>

          <div className="champ-groupe">
            <label className="etiquette" htmlFor="e-banque">Coordonnées bancaires</label>
            <input
              id="e-banque"
              className="champ"
              value={profil.bankDetails}
              onChange={(e) => setProfil({ ...profil, bankDetails: e.target.value })}
              placeholder="Ex : CBAO — IBAN SN08 ..."
            />
          </div>

          <div className="champ-groupe">
            <label className="etiquette" htmlFor="e-mobile-money">Mobile Money (Wave, Orange Money…)</label>
            <input
              id="e-mobile-money"
              className="champ"
              value={profil.mobileMoneyDetails}
              onChange={(e) => setProfil({ ...profil, mobileMoneyDetails: e.target.value })}
              placeholder="Ex : Wave 77 123 45 67 — OM 78 987 65 43"
            />
          </div>

          <div className="champ-groupe">
            <label className="etiquette" htmlFor="e-conditions">Conditions de règlement</label>
            <input
              id="e-conditions"
              className="champ"
              value={profil.paymentTerms}
              onChange={(e) => setProfil({ ...profil, paymentTerms: e.target.value })}
              placeholder="Ex : Paiement à réception de facture, sous 15 jours"
            />
          </div>

          <button type="submit" className="btn btn-principal" disabled={enregistrement}>
            {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>
      )}
        </>
      )}

      {onglet === 'zakat' && voitZakat && (
        <>

          {erreurZakat && <div className="erreur">{erreurZakat}</div>}

          {chargementZakat ? (
            <p style={{ color: 'var(--encre-douce)' }}>Calcul…</p>
          ) : zakat ? (
            <>
              <div className="tampon tampon-sarcelle" style={{ display: 'block', marginBottom: 20 }}>
                Cycle en cours depuis le {new Date(zakat.cycleStart).toLocaleDateString('fr-FR')} —{' '}
                {zakat.joursRestants} jour{zakat.joursRestants > 1 ? 's' : ''} avant la fin du hawl (
                {zakat.dureeHawlJours} jours).
              </div>

              <div className="md-kpis">
                <div className="md-kpi md-kpi--hero">
                  <span className="md-kpi-icone"><IconPiece /></span>
                  <p className="md-kpi-label">Valeur du stock</p>
                  <p className="md-kpi-valeur">{Math.round(zakat.valeurStock).toLocaleString('fr-FR')} <small>FCFA</small></p>
                </div>
                <div className="md-kpi">
                  <span className="md-kpi-icone"><IconPiece /></span>
                  <p className="md-kpi-label">Créances clients</p>
                  <p className="md-kpi-valeur">{Math.round(zakat.creancesClients).toLocaleString('fr-FR')} <small>FCFA</small></p>
                </div>
                <div className="md-kpi">
                  <span className="md-kpi-icone"><IconPiece /></span>
                  <p className="md-kpi-label">Dettes fournisseurs</p>
                  <p className="md-kpi-valeur">− {Math.round(zakat.dettesFournisseurs).toLocaleString('fr-FR')} <small>FCFA</small></p>
                </div>
              </div>

              <div className="modale" style={{ maxWidth: 420, padding: 20 }}>
                <p className="etiquette" style={{ marginBottom: 6 }}>Base zakatable</p>
                <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
                  {Math.round(zakat.base).toLocaleString('fr-FR')} FCFA
                </p>
                <p className="etiquette" style={{ marginBottom: 6 }}>Zakat à verser (2,5 %)</p>
                <p style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent)' }}>
                  {Math.round(zakat.montant).toLocaleString('fr-FR')} FCFA
                </p>
              </div>

              <button type="button" className="btn" style={{ marginTop: 16 }} onClick={chargerZakat}>
                Recalculer
              </button>

              {zakat.historique.length > 0 && (
                <div style={{ marginTop: 32 }}>
                  <h2 style={{ fontSize: 15, marginBottom: 12 }}>Cycles précédents</h2>
                  <table className="registre">
                    <thead>
                      <tr>
                        <th>Du</th>
                        <th>Au</th>
                        <th>Base</th>
                        <th>Zakat versée</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zakat.historique.map((h, i) => (
                        <tr key={i}>
                          <td>{new Date(h.cycle_start).toLocaleDateString('fr-FR')}</td>
                          <td>{new Date(h.closed_at).toLocaleDateString('fr-FR')}</td>
                          <td className="chiffre">{Math.round(h.base).toLocaleString('fr-FR')} FCFA</td>
                          <td className="chiffre">{Math.round(h.montant).toLocaleString('fr-FR')} FCFA</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </>
      )}
    </>
  );
}
