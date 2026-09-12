import { useEffect, useState } from 'react';
import { api } from '../api/client';

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [nouveau, setNouveau] = useState({ name: '', phone: '', email: '', address: '' });
  const [fournisseurDette, setFournisseurDette] = useState(null);
  const [detailFournisseur, setDetailFournisseur] = useState(null);
  const [montantReglement, setMontantReglement] = useState('');
  const [enregistrementReglement, setEnregistrementReglement] = useState(false);

  function charger() {
    setChargement(true);
    api
      .getSuppliers()
      .then(setSuppliers)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!nouveau.name) {
      setErreur('Le nom du fournisseur est requis.');
      return;
    }
    try {
      await api.createSupplier(nouveau);
      setModaleOuverte(false);
      setNouveau({ name: '', phone: '', email: '', address: '' });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimer(supplier) {
    if (!window.confirm(`Retirer "${supplier.name}" de la liste des fournisseurs ?`)) return;
    try {
      await api.deleteSupplier(supplier.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  function ouvrirReglement(supplier) {
    setFournisseurDette(supplier);
    setMontantReglement('');
    api
      .getSupplier(supplier.id)
      .then(setDetailFournisseur)
      .catch((err) => setErreur(err.message));
  }

  async function handleEnregistrerReglement(e) {
    e.preventDefault();
    if (!Number(montantReglement) || Number(montantReglement) <= 0) {
      setErreur('Montant de règlement invalide.');
      return;
    }
    setEnregistrementReglement(true);
    try {
      await api.createSupplierPayment(fournisseurDette.id, { amount: Number(montantReglement) });
      const detail = await api.getSupplier(fournisseurDette.id);
      setDetailFournisseur(detail);
      setMontantReglement('');
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementReglement(false);
    }
  }

  return (
    <>
      <div className="entete-page">
        <h1>Fournisseurs</h1>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="barre-outils">
        <span style={{ color: 'var(--encre-douce)', fontSize: 14 }}>{suppliers.length} fournisseur(s)</span>
        <button className="btn btn-principal" onClick={() => setModaleOuverte(true)}>
          Ajouter un fournisseur
        </button>
      </div>

      {chargement ? (
        <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
      ) : suppliers.length === 0 ? (
        <p className="etat-vide">Aucun fournisseur enregistré pour le moment.</p>
      ) : (
        <table className="registre">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Téléphone</th>
              <th>Email</th>
              <th>Dette</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="chiffre">{s.phone || '—'}</td>
                <td>{s.email || '—'}</td>
                <td className="chiffre" style={{ color: Number(s.debt) > 0 ? 'var(--brique, #b3423a)' : undefined, fontWeight: Number(s.debt) > 0 ? 600 : 400 }}>
                  {Math.round(Number(s.debt) || 0).toLocaleString('fr-FR')} FCFA
                </td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => ouvrirReglement(s)}>
                    Enregistrer un règlement
                  </button>
                  <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => handleSupprimer(s)}>
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modaleOuverte && (
        <div className="modale-fond" onClick={() => setModaleOuverte(false)}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Ajouter un fournisseur</h2>
            <form onSubmit={handleCreate}>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="f-name">Nom</label>
                <input
                  id="f-name"
                  className="champ"
                  value={nouveau.name}
                  onChange={(e) => setNouveau({ ...nouveau, name: e.target.value })}
                  placeholder="Grossiste Baol"
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="f-phone">Téléphone</label>
                <input
                  id="f-phone"
                  className="champ"
                  value={nouveau.phone}
                  onChange={(e) => setNouveau({ ...nouveau, phone: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="f-email">Email</label>
                <input
                  id="f-email"
                  type="email"
                  className="champ"
                  value={nouveau.email}
                  onChange={(e) => setNouveau({ ...nouveau, email: e.target.value })}
                />
              </div>
              <div className="champ-groupe">
                <label className="etiquette" htmlFor="f-address">Adresse</label>
                <input
                  id="f-address"
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
      {fournisseurDette && (
        <div className="modale-fond" onClick={() => { setFournisseurDette(null); setDetailFournisseur(null); }}>
          <div className="modale" onClick={(e) => e.stopPropagation()}>
            <h2>Dette de {fournisseurDette.name}</h2>
            {!detailFournisseur ? (
              <p style={{ color: 'var(--encre-douce)' }}>Chargement…</p>
            ) : (
              <>
                <p style={{ fontSize: 15, marginBottom: 16 }}>
                  Dette actuelle : <strong className="chiffre">{Math.round(detailFournisseur.debt).toLocaleString('fr-FR')} FCFA</strong>
                </p>
                <form onSubmit={handleEnregistrerReglement}>
                  <div className="champ-groupe">
                    <label className="etiquette" htmlFor="fr-montant">Montant du règlement (FCFA)</label>
                    <input
                      id="fr-montant"
                      type="number"
                      className="champ"
                      value={montantReglement}
                      onChange={(e) => setMontantReglement(e.target.value)}
                    />
                  </div>
                  <div className="actions-modale">
                    <button type="button" className="btn" onClick={() => { setFournisseurDette(null); setDetailFournisseur(null); }}>
                      Fermer
                    </button>
                    <button type="submit" className="btn btn-principal" disabled={enregistrementReglement}>
                      {enregistrementReglement ? 'Enregistrement…' : 'Enregistrer le règlement'}
                    </button>
                  </div>
                </form>

                {detailFournisseur.payments.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 14, marginTop: 20, marginBottom: 8 }}>Historique des règlements</h3>
                    <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                      {detailFournisseur.payments.map((p) => (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--encre-douce)' }}>
                          <span>{new Date(p.paid_at).toLocaleDateString('fr-FR')} · {p.user_name}</span>
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
