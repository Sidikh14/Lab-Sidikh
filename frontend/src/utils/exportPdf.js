// Export PDF sans dépendance : ouvre le rapport dans une fenêtre mise en page
// pour l'impression ; dans la boîte d'impression, choisir « Enregistrer en PDF ».
//
// exporterPdf({
//   entreprise: 'Nom du commerce', titre: 'Grand livre', periode: 'Du 01/01/2026 au 02/10/2026',
//   sections: [{
//     titre: 'Compte 411001 — Client X',                        // facultatif
//     colonnes: [{ label: 'Date' }, { label: 'Montant', align: 'right' }],
//     lignes: [['01/10/2026', '1 000'], { fort: true, cells: ['Total', '1 000'] }],
//   }],
// })

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function exporterPdf({ entreprise, titre, periode, sections }) {
  const fenetre = window.open('', '_blank');
  if (!fenetre) {
    window.alert("Autorisez les fenêtres pop-up pour exporter en PDF.");
    return;
  }
  const corps = sections
    .map((s) => {
      const entete = (s.colonnes || [])
        .map((c) => `<th class="${c.align === 'right' ? 'd' : ''}">${esc(c.label)}</th>`)
        .join('');
      const lignes = (s.lignes || [])
        .map((l) => {
          const cells = Array.isArray(l) ? l : l.cells;
          const fort = !Array.isArray(l) && l.fort;
          const tds = cells
            .map((v, i) => `<td class="${(s.colonnes?.[i]?.align === 'right') ? 'd' : ''}">${esc(v)}</td>`)
            .join('');
          return `<tr class="${fort ? 'fort' : ''}">${tds}</tr>`;
        })
        .join('');
      return `<section>${s.titre ? `<h2>${esc(s.titre)}</h2>` : ''}
        <table><thead><tr>${entete}</tr></thead><tbody>${lignes}</tbody></table></section>`;
    })
    .join('');

  const aujourdhui = new Date().toLocaleDateString('fr-FR');
  fenetre.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${esc(titre)} — ${esc(entreprise)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #111; margin: 0; }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
  header h1 { font-size: 17px; margin: 0 0 2px; }
  header p { margin: 0; color: #444; }
  h2 { font-size: 12px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { background: #eee; text-align: left; padding: 4px 6px; border-bottom: 1px solid #999; }
  td { padding: 3px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th.d, td.d { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr { page-break-inside: avoid; }
  tr.fort td { font-weight: 700; background: #f5f5f5; }
  section { page-break-inside: auto; }
  footer { margin-top: 18px; color: #666; font-size: 9.5px; }
</style></head><body>
<header><h1>${esc(titre)}</h1><p>${esc(entreprise)}${periode ? ` · ${esc(periode)}` : ''}</p></header>
${corps}
<footer>Édité le ${aujourdhui} · montants en FCFA</footer>
</body></html>`);
  fenetre.document.close();
  fenetre.focus();
  setTimeout(() => fenetre.print(), 400);
}
