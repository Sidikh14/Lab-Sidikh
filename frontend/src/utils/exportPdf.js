// Export PDF sans dépendance : ouvre le rapport dans une fenêtre mise en page
// pour l'impression ; dans la boîte d'impression, choisir « Enregistrer en PDF ».
// Mise en page de la charte Amaterasu v8 : emblème, titre Plus Jakarta Sans avec filet Soleil,
// tableau à en-tête Marine, lignes alternées Brume, pied « Édité avec Amaterasu ».
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

// Emblème Amaterasu (version claire : Marine + Soleil), repris de amaterasu-emblem-clair.svg.
const EMBLEME_SVG = (taille) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="${taille}" height="${taille}"><circle cx="120" cy="120" r="100" fill="none" stroke="#0F2747" stroke-width="6"/><g fill="#0F2747"><polygon points="120,100 135,74.8 120,40 105,74.8"/><polygon points="105.9,105.9 98.6,77.4 63.4,63.4 77.4,98.6"/><polygon points="100,120 74.8,105 40,120 74.8,135"/><polygon points="105.9,134.1 77.4,141.4 63.4,176.6 98.6,162.6"/><polygon points="120,140 105,165.2 120,200 135,165.2"/><polygon points="134.1,134.1 141.4,162.6 176.6,176.6 162.6,141.4"/><polygon points="140,120 165.2,135 200,120 165.2,105"/><polygon points="134.1,105.9 162.6,98.6 176.6,63.4 141.4,77.4"/></g><g fill="#F2A81D"><polygon points="112.3,101.5 115.1,85.9 100.1,72 99.4,92.4"/><polygon points="101.5,112.3 92.4,99.4 72,100.1 85.9,115.1"/><polygon points="101.5,127.7 85.9,124.9 72,139.9 92.4,140.6"/><polygon points="112.3,138.5 99.4,147.6 100.1,168 115.1,154.1"/><polygon points="127.7,138.5 124.9,154.1 139.9,168 140.6,147.6"/><polygon points="138.5,127.7 147.6,140.6 168,139.9 154.1,124.9"/><polygon points="138.5,112.3 154.1,115.1 168,100.1 147.6,99.4"/><polygon points="127.7,101.5 140.6,92.4 139.9,72 124.9,85.9"/><circle cx="120" cy="120" r="11"/></g></svg>`;

// Les polices de la charte (chargées par le site) sont recopiées dans la fenêtre d'impression.
function reglesPolices() {
  try {
    const regles = [];
    for (const feuille of Array.from(document.styleSheets)) {
      let contenu;
      try { contenu = feuille.cssRules; } catch { continue; }
      for (const regle of Array.from(contenu || [])) {
        if (regle.type === 5 /* FONT_FACE_RULE */) regles.push(regle.cssText);
      }
    }
    return regles.join('\n');
  } catch {
    return '';
  }
}

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
${reglesPolices()}
  @page { size: A4; margin: 20mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Inter', Arial, Helvetica, sans-serif; font-size: 10px; color: #0F2747; margin: 0; }
  header { margin-bottom: 14px; }
  .marque { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .marque span { font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-weight: 800; font-size: 14px; }
  header h1 { font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-weight: 800; font-size: 22px; margin: 0; padding-bottom: 6px; position: relative; }
  header h1::after { content: ''; position: absolute; left: 0; bottom: 0; width: 12mm; height: 2px; background: #F2A81D; }
  header p { margin: 8px 0 0; color: #5A6678; font-size: 9px; }
  h2 { font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-weight: 700; font-size: 12px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { background: #0F2747; color: #fff; text-align: left; padding: 5px 6px; font-size: 7.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  td { padding: 4px 6px; border-bottom: 1px solid #E2E8F0; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #F4F6FA; }
  th.d, td.d { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr { page-break-inside: avoid; }
  tr.fort td { font-weight: 700; background: #DCE8FA; border-bottom: 1px solid #0F2747; }
  section { page-break-inside: auto; }
  footer { margin-top: 18px; padding-top: 6px; border-top: 1px solid #E2E8F0; color: #5A6678; font-size: 8px; display: flex; align-items: center; gap: 5px; }
</style></head><body>
<header>
  <div class="marque">${EMBLEME_SVG(26)}<span>Amaterasu</span></div>
  <h1>${esc(titre)}</h1>
  <p>${esc(entreprise)}${periode ? ` · ${esc(periode)}` : ''}</p>
</header>
${corps}
<footer>${EMBLEME_SVG(11)}<span>Édité avec Amaterasu · le ${aujourdhui} · montants en FCFA</span></footer>
</body></html>`);
  fenetre.document.close();
  fenetre.focus();
  setTimeout(() => fenetre.print(), 400);
}
