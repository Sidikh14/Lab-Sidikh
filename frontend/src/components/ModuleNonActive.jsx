// Message affiché quand un manager ouvre un module que l'owner n'a pas (encore) activé.
export function ModuleNonActive({ nom, onFermer }) {
  return (
    <div className="modale-fond" onClick={onFermer}>
      <div className="modale" style={{ maxWidth: 420, width: '94%' }} onClick={(e) => e.stopPropagation()}>
        <h2>Module non activé</h2>
        <p style={{ fontSize: 14.5, lineHeight: 1.5 }}>
          Vous n'avez pas accès au module <strong>{nom}</strong>. Rapprochez-vous de l'administrateur
          d'Amaterasu pour y avoir accès.
        </p>
        <div className="actions-modale">
          <button type="button" className="btn btn-principal" onClick={onFermer}>J'ai compris</button>
        </div>
      </div>
    </div>
  );
}

// Version « page entière » (accès direct par l'adresse du module).
export function PageModuleNonActive({ nom }) {
  return (
    <div>
      <div className="entete-page"><h1>{nom}</h1></div>
      <p className="etat-vide" style={{ maxWidth: 520 }}>
        Vous n'avez pas accès au module {nom}. Rapprochez-vous de l'administrateur d'Amaterasu pour y avoir accès.
      </p>
    </div>
  );
}
