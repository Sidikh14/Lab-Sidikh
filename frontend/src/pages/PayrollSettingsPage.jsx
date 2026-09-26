import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Les taux sont stockés en base sous forme décimale (0.30 = 30%) mais
// affichés/saisis en pourcentage pour plus de lisibilité — conversion aux
// deux bouts (chargement / enregistrement).
function versPourcentage(valeurDecimale) {
  return valeurDecimale === null || valeurDecimale === undefined ? '' : Number(valeurDecimale) * 100;
}
function versDecimal(valeurPourcentage) {
  return valeurPourcentage === '' || valeurPourcentage === null ? 0 : Number(valeurPourcentage) / 100;
}

export function PayrollSettingsPage() {
  const [chargement, setChargement] = useState(true);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState('');

  const [abattementTaux, setAbattementTaux] = useState('');
  const [abattementPlafond, setAbattementPlafond] = useState('');
  const [ipresTauxSalarial, setIpresTauxSalarial] = useState('');
  const [ipresTauxPatronal, setIpresTauxPatronal] = useState('');
  const [ipresPlafondMensuel, setIpresPlafondMensuel] = useState('');
  const [cssTauxSalarial, setCssTauxSalarial] = useState('');
  const [cssTauxPatronal, setCssTauxPatronal] = useState('');
  const [cssPlafondMensuel, setCssPlafondMensuel] = useState('');
  const [cfceTaux, setCfceTaux] = useState('');
  const [trenchesIrpp, setTranchesIrpp] = useState([]);
  const [paliersTrimf, setPaliersTrimf] = useState([]);

  useEffect(() => {
    api
      .getPayrollSettings()
      .then((r) => {
        setAbattementTaux(versPourcentage(r.abattement_taux));
        setAbattementPlafond(r.abattement_plafond_annuel);
        setIpresTauxSalarial(versPourcentage(r.ipres_taux_salarial));
        setIpresTauxPatronal(versPourcentage(r.ipres_taux_patronal));
        setIpresPlafondMensuel(r.ipres_plafond_mensuel ?? '');
        setCssTauxSalarial(versPourcentage(r.css_taux_salarial));
        setCssTauxPatronal(versPourcentage(r.css_taux_patronal));
        setCssPlafondMensuel(r.css_plafond_mensuel ?? '');
        setCfceTaux(versPourcentage(r.cfce_taux));
        setTranchesIrpp(r.bareme_irpp.map((t) => ({ jusqua: t.jusqua ?? '', taux: t.taux * 100 })));
        setPaliersTrimf(r.trimf_bareme.map((p) => ({ jusqua: p.jusqua ?? '', montant: p.montant })));
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  function modifierTranche(index, champ, valeur) {
    setTranchesIrpp((liste) => liste.map((t, i) => (i === index ? { ...t, [champ]: valeur } : t)));
  }
  function ajouterTranche() {
    setTranchesIrpp((liste) => [...liste, { jusqua: '', taux: 0 }]);
  }
  function retirerTranche(index) {
    setTranchesIrpp((liste) => liste.filter((_, i) => i !== index));
  }

  function modifierPalier(index, champ, valeur) {
    setPaliersTrimf((liste) => liste.map((p, i) => (i === index ? { ...p, [champ]: valeur } : p)));
  }
  function ajouterPalier() {
    setPaliersTrimf((liste) => [...liste, { jusqua: '', montant: 0 }]);
  }
  function retirerPalier(index) {
    setPaliersTrimf((liste) => liste.filter((_, i) => i !== index));
  }

  async function enregistrer(e) {
    e.preventDefault();
    setErreur('');
    setSucces('');
    setEnvoiEnCours(true);
    try {
      await api.updatePayrollSettings({
        abattement_taux: versDecimal(abattementTaux),
        abattement_plafond_annuel: Number(abattementPlafond) || 0,
        ipres_taux_salarial: versDecimal(ipresTauxSalarial),
        ipres_taux_patronal: versDecimal(ipresTauxPatronal),
        ipres_plafond_mensuel: ipresPlafondMensuel === '' ? null : Number(ipresPlafondMensuel),
        css_taux_salarial: versDecimal(cssTauxSalarial),
        css_taux_patronal: versDecimal(cssTauxPatronal),
        css_plafond_mensuel: cssPlafondMensuel === '' ? null : Number(cssPlafondMensuel),
        cfce_taux: versDecimal(cfceTaux),
        bareme_irpp: trenchesIrpp.map((t) => ({
          jusqua: t.jusqua === '' ? null : Number(t.jusqua),
          taux: versDecimal(t.taux),
        })),
        trimf_bareme: paliersTrimf.map((p) => ({
          jusqua: p.jusqua === '' ? null : Number(p.jusqua),
          montant: Number(p.montant) || 0,
        })),
      });
      setSucces('Réglages enregistrés.');
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  if (chargement) return <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>;

  return (
    <>
      <div className="entete-page">
        <h1>Réglages de paie</h1>
      </div>

      <p style={{ fontSize: 13, color: 'var(--encre-douce)', maxWidth: 640, marginBottom: 20 }}>
        Ces taux et barèmes déterminent le calcul brut → net des bulletins de paie. Les valeurs de
        départ sont indicatives — fais-les valider par un comptable ou sur impotsetdomaines.gouv.sn
        avant de t'en servir pour payer réellement tes employés.
      </p>

      {erreur && <div className="erreur">{erreur}</div>}
      {succes && <p style={{ color: 'var(--succes, #1a7f37)', fontSize: 13, marginBottom: 12 }}>{succes}</p>}

      <form onSubmit={enregistrer}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Abattement forfaitaire</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Taux (%)</label>
            <input type="number" step="0.01" className="champ" value={abattementTaux} onChange={(e) => setAbattementTaux(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Plafond annuel (FCFA)</label>
            <input type="number" className="champ" value={abattementPlafond} onChange={(e) => setAbattementPlafond(e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>IPRES (retraite)</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Part salariale (%)</label>
            <input type="number" step="0.01" className="champ" value={ipresTauxSalarial} onChange={(e) => setIpresTauxSalarial(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Part patronale (%)</label>
            <input type="number" step="0.01" className="champ" value={ipresTauxPatronal} onChange={(e) => setIpresTauxPatronal(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Plafond mensuel (FCFA, vide = aucun)</label>
            <input type="number" className="champ" value={ipresPlafondMensuel} onChange={(e) => setIpresPlafondMensuel(e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>CSS (prestations familiales / AT)</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Part salariale (%)</label>
            <input type="number" step="0.01" className="champ" value={cssTauxSalarial} onChange={(e) => setCssTauxSalarial(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Part patronale (%)</label>
            <input type="number" step="0.01" className="champ" value={cssTauxPatronal} onChange={(e) => setCssTauxPatronal(e.target.value)} />
          </div>
          <div className="champ-groupe" style={{ flex: 1 }}>
            <label className="etiquette">Plafond mensuel (FCFA, vide = aucun)</label>
            <input type="number" className="champ" value={cssPlafondMensuel} onChange={(e) => setCssPlafondMensuel(e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>CFCE (patronal)</h2>
        <div className="champ-groupe" style={{ maxWidth: 200, marginBottom: 18 }}>
          <label className="etiquette">Taux (%)</label>
          <input type="number" step="0.01" className="champ" value={cfceTaux} onChange={(e) => setCfceTaux(e.target.value)} />
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Barème IRPP (tranches annuelles progressives)</h2>
        {trenchesIrpp.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <input
              type="number"
              className="champ"
              placeholder="Jusqu'à (FCFA/an) — vide = illimité"
              value={t.jusqua}
              onChange={(e) => modifierTranche(i, 'jusqua', e.target.value)}
              style={{ flex: 2 }}
            />
            <input
              type="number"
              step="0.01"
              className="champ"
              placeholder="Taux (%)"
              value={t.taux}
              onChange={(e) => modifierTranche(i, 'taux', e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn" onClick={() => retirerTranche(i)}>×</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={ajouterTranche} style={{ marginBottom: 22 }}>+ Ajouter une tranche</button>

        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Barème TRIMF (paliers mensuels forfaitaires)</h2>
        {paliersTrimf.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <input
              type="number"
              className="champ"
              placeholder="Jusqu'à (FCFA/mois) — vide = illimité"
              value={p.jusqua}
              onChange={(e) => modifierPalier(i, 'jusqua', e.target.value)}
              style={{ flex: 2 }}
            />
            <input
              type="number"
              className="champ"
              placeholder="Montant (FCFA)"
              value={p.montant}
              onChange={(e) => modifierPalier(i, 'montant', e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn" onClick={() => retirerPalier(i)}>×</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={ajouterPalier} style={{ marginBottom: 22 }}>+ Ajouter un palier</button>

        <div>
          <button type="submit" className="btn btn-principal" disabled={envoiEnCours}>
            {envoiEnCours ? 'Enregistrement…' : 'Enregistrer les réglages'}
          </button>
        </div>
      </form>
    </>
  );
}
