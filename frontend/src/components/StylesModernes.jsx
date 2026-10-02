// Styles partagés du nouveau design (préfixe md-). À placer dans
// src/components/StylesModernes.jsx. Ils s'appuient sur les variables CSS
// existantes (--accent, --trait, --surface, --encre-douce, --danger…).
const CSS = `
.md-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:18px}
.md-kpi{display:flex;flex-direction:column;gap:4px;background:var(--surface,#fff);border:1px solid var(--trait,#e5e7eb);border-radius:14px;padding:12px 14px;transition:border-color .15s,box-shadow .15s}
.md-kpi--clic{cursor:pointer}
.md-kpi--clic:hover{border-color:var(--accent);box-shadow:0 6px 18px rgba(17,24,39,.08)}
.md-kpi-icone{display:flex;align-items:center;justify-content:center;width:30px;height:30px;margin-bottom:6px;border-radius:9px;background:#eef2ff;background:var(--accent-clair,#eef2ff);color:var(--accent)}
.md-kpi--alerte .md-kpi-icone{background:var(--danger-clair,#fef2f2);color:var(--danger,#b91c1c)}
.md-kpi-label{margin:0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--encre-douce)}
.md-kpi-valeur{margin:0;font-size:20px;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums}
.md-kpi-valeur small{font-size:12px;font-weight:500;color:var(--encre-douce)}
.md-kpi-sous{margin:0;font-size:11px;color:var(--encre-douce)}
.md-kpi--hero{background:var(--accent);border-color:var(--accent);color:#fff}
.md-kpi--hero .md-kpi-icone{background:rgba(255,255,255,.18);color:#fff}
.md-kpi--hero .md-kpi-label,.md-kpi--hero .md-kpi-sous,.md-kpi--hero .md-kpi-valeur small{color:rgba(255,255,255,.8)}

.md-outils{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;background:var(--surface,#fff);border:1px solid var(--trait,#e5e7eb);border-radius:14px;padding:12px 14px;margin-bottom:12px}
.md-recherche{flex:1 1 260px;min-width:0;margin-bottom:0}
.md-groupe{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.md-barre-vue{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;margin-bottom:16px}
.md-puces{display:flex;flex-wrap:wrap;gap:8px}
.md-puce{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid var(--trait,#e5e7eb);border-radius:999px;background:var(--surface,#fff);color:var(--encre-douce);font-size:13px;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.md-puce:hover{border-color:var(--accent)}
.md-puce.actif{background:var(--accent);border-color:var(--accent);color:#fff}
.md-puce span{opacity:.75;font-variant-numeric:tabular-nums}
.md-vues{display:flex;border:1px solid var(--trait,#e5e7eb);border-radius:10px;overflow:hidden;background:var(--surface,#fff)}

.md-table{background:var(--surface,#fff);border:1px solid var(--trait,#e5e7eb);border-radius:14px;overflow-x:auto;margin-bottom:20px}
.md-table table{width:100%;margin:0 !important;border-collapse:collapse}
.md-table th{padding:10px 14px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;text-align:left;color:var(--encre-douce);background:var(--fond,#f9fafb);border-bottom:1px solid var(--trait,#e5e7eb)}
.md-table td{padding:12px 14px;border-top:1px solid var(--trait,#e5e7eb);vertical-align:middle}
.md-table tbody tr:first-child td{border-top:none}
.md-table tbody tr:hover td{background:var(--fond,#f9fafb)}
.md-table--interne{border:none;border-radius:10px;margin-bottom:0;background:transparent}

.md-carte{background:var(--surface,#fff);border:1px solid var(--trait,#e5e7eb);border-radius:16px;padding:16px 18px}
.md-carte-tete{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}
.md-carte-tete h2{margin:0;font-size:15px}
.md-titre-section{margin:8px 0 10px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--encre-douce)}

.md-form{max-width:640px;margin-bottom:24px}
.md-form form{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
.md-form form > button{grid-column:1 / -1;justify-self:start}
.md-form h2{margin:0 0 14px;font-size:15px}
@media (max-width:600px){.md-form form{grid-template-columns:1fr}}

.md-liste{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}
.md-ligne{display:grid;grid-template-columns:44px minmax(0,1.5fr) minmax(0,1fr) auto;gap:14px;align-items:center;background:var(--surface,#fff);border:1px solid var(--trait,#e5e7eb);border-radius:14px;padding:12px 16px;transition:box-shadow .15s,border-color .15s}
.md-ligne:hover{border-color:var(--accent);box-shadow:0 6px 18px rgba(17,24,39,.08)}
.md-ligne--prioritaire{border-left:4px solid var(--accent)}
.md-avatar{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;background:#eef2ff;background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
.md-bloc{min-width:0}
.md-titre{margin:0;font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.md-sous{margin:2px 0 0;font-size:13px;color:var(--encre-douce)}
.md-montant{margin:0 0 4px;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.md-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
.md-actions .btn{padding:5px 10px;font-size:13px}
@media (max-width:760px){
  .md-ligne{grid-template-columns:44px minmax(0,1fr)}
  .md-ligne .md-bloc--montant,.md-ligne .md-actions{grid-column:1 / -1}
  .md-actions{justify-content:flex-start}
}


.md-fiche{width:680px;max-width:95vw;max-height:92vh;overflow-y:auto}
.md-fiche-tete{display:flex;align-items:center;gap:14px;margin-bottom:16px}
.md-fiche-tete h2{margin:0;font-size:18px}
.md-fiche-section{padding:14px 0;border-top:1px solid var(--trait,#e5e7eb)}
.md-fiche-section h3{display:flex;align-items:center;gap:10px;margin:0 0 12px;font-size:14px}
.md-fiche-section h3 small{font-size:12px;font-weight:500;color:var(--encre-douce)}
.md-etape{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;font-size:12px;font-weight:700}
.md-fiche-grille{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 12px}
.md-fiche-ligne{display:grid;gap:8px;align-items:center;margin-bottom:8px}
.md-fiche-ligne--prime{grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto auto}
.md-fiche-ligne--retenue{grid-template-columns:minmax(0,1.3fr) minmax(0,1.5fr) minmax(0,1fr) auto}
.md-case{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--encre-douce);white-space:nowrap;cursor:pointer}
.md-aide{margin:6px 0 0;font-size:12px;color:var(--encre-douce)}
.md-info{margin-bottom:12px;padding:10px 12px;border-radius:10px;font-size:13px;background:var(--accent-clair,#eef2ff);color:var(--accent)}
.md-recap{border:1px solid var(--trait,#e5e7eb);border-radius:12px;padding:12px 14px;background:var(--surface,#fff)}
.md-recap-ligne{display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:14px}
.md-recap-ligne--doux{font-size:13px;color:var(--encre-douce);padding-left:12px}
.md-recap-ligne--fort{font-weight:700}
.md-recap-ligne--separe{margin-top:6px;padding-top:10px;border-top:1px dashed var(--trait,#e5e7eb)}
.md-recap-net{display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding:12px 14px;border-radius:10px;background:var(--accent);color:#fff}
.md-recap-net strong{font-size:20px;font-variant-numeric:tabular-nums}
@media (max-width:640px){
  .md-fiche-grille{grid-template-columns:1fr}
  .md-fiche-ligne--prime,.md-fiche-ligne--retenue{grid-template-columns:1fr 1fr}
}
.carte-produit,.carte-entite{border-radius:16px;transition:transform .15s,box-shadow .15s,border-color .15s}
.carte-produit:hover,.carte-entite:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(17,24,39,.09)}
.carte-entite-actions{gap:6px;flex-wrap:wrap}
`;

export function StylesModernes() {
  return <style>{CSS}</style>;
}
