import { useEffect, useState } from 'react';
import { api } from '../api/client';

function IconEntreprise() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="4" y="8" width="16" height="13" rx="1.5" />
      <path d="M9 21v-5h6v5" />
      <path d="M9 8V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3" />
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
  const [profil, setProfil] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [enregistrement, setEnregistrement] = useState(false);
  const [nouveauLogo, setNouveauLogo] = useState(null); // data URI en attente d'envoi
  const [apercuLogo, setApercuLogo] = useState(null);

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

      <p style={{ fontSize: 13, color: 'var(--encre-douce)', marginBottom: 20, maxWidth: 640 }}>
        Ces informations apparaissent automatiquement sur les factures (logo, NINEA, RCCM, adresse en
        entête ; coordonnées bancaires, Mobile Money et conditions de règlement en pied de page) pour
        des documents plus professionnels.
      </p>

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
  );
}
