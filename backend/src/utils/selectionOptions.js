// Contrôle des choix du client sur un plat (cuisson, sauces, suppléments, formules).
// Les règles viennent de product_option_groups (mode, obligatoire, min, max) et de product_options.
// Le serveur refait toujours ce contrôle : il ne fait jamais confiance au prix envoyé par le téléphone.
//
// groupes : [{ id, name, mode: 'unique'|'multiple', required, min, max, options: [{ id, name, priceDelta }] }]
// choix   : [{ groupId, optionIds: [id, ...] }]

function validerSelections(groupes, choix) {
  const erreurs = [];
  let supplement = 0;
  const retenues = [];

  for (const c of choix || []) {
    if (!groupes.some((g) => g.id === c.groupId)) erreurs.push('Groupe d\'options inconnu pour ce plat.');
  }

  for (const g of groupes) {
    const demandes = (choix || []).find((c) => c.groupId === g.id)?.optionIds || [];
    if (new Set(demandes).size !== demandes.length) {
      erreurs.push(`${g.name} : une option est choisie deux fois.`);
    }
    const uniques = [...new Set(demandes)];
    const options = uniques.map((id) => g.options.find((o) => o.id === id));
    if (options.some((o) => !o)) erreurs.push(`${g.name} : option inconnue.`);

    const valides = options.filter(Boolean);
    const n = valides.length;
    if (g.mode === 'unique' && n > 1) erreurs.push(`${g.name} : un seul choix possible.`);
    if (n > g.max) erreurs.push(`${g.name} : ${g.max} choix maximum.`);
    if (n < g.min) erreurs.push(`${g.name} : ${g.min} choix minimum.`);
    if (g.required && n < 1) erreurs.push(`${g.name} : choix obligatoire.`);

    for (const o of valides) {
      supplement += Number(o.priceDelta) || 0;
      retenues.push({ groupe: g.name, option: o.name, priceDelta: Number(o.priceDelta) || 0 });
    }
  }
  return { ok: erreurs.length === 0, erreurs, supplement, retenues };
}

module.exports = { validerSelections };
