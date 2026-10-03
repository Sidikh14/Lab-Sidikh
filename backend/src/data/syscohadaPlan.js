// Plan comptable indicatif aligné sur le SYSCOHADA révisé, adapté au commerce.
// À faire valider par l'expert-comptable du commerçant ; le commerçant peut
// ensuite ajouter ses propres sous-comptes depuis le module.
const COMPTES = [
  // Classe 1 — Ressources durables
  ['101', 'Capital social'], ['104', 'Primes liées au capital social'], ['105', 'Écarts de réévaluation'],
  ['111', 'Réserve légale'], ['112', 'Réserves statutaires'], ['118', 'Autres réserves'],
  ['121', 'Report à nouveau créditeur'], ['129', 'Report à nouveau débiteur'],
  ['131', 'Résultat net de l\'exercice : bénéfice'], ['139', 'Résultat net de l\'exercice : perte'],
  ['14', 'Subventions d\'investissement'], ['15', 'Provisions réglementées'],
  ['162', 'Emprunts auprès des établissements de crédit'], ['165', 'Dépôts et cautionnements reçus'],
  ['17', 'Dettes de location-acquisition'], ['18', 'Dettes liées à des participations et comptes de liaison'],
  ['19', 'Provisions pour risques et charges'],
  // Classe 2 — Actif immobilisé
  ['21', 'Immobilisations incorporelles'], ['22', 'Terrains'], ['23', 'Bâtiments, installations techniques et agencements'],
  ['241', 'Matériel et outillage'], ['244', 'Matériel et mobilier de bureau'], ['245', 'Matériel de transport'],
  ['25', 'Avances et acomptes versés sur immobilisations'], ['26', 'Titres de participation'],
  ['275', 'Dépôts et cautionnements versés'],
  ['281', 'Amortissements des immobilisations incorporelles'], ['283', 'Amortissements des bâtiments et installations'],
  ['284', 'Amortissements du matériel'], ['29', 'Dépréciations des immobilisations'],
  // Classe 3 — Stocks
  ['311', 'Marchandises'], ['32', 'Matières premières et fournitures liées'], ['33', 'Autres approvisionnements'],
  ['36', 'Produits finis'], ['38', 'Stocks en cours de route, en consignation ou en dépôt'],
  ['39', 'Dépréciations des stocks'],
  // Classe 4 — Tiers
  ['401', 'Fournisseurs, dettes en compte'], ['402', 'Fournisseurs, effets à payer'], ['408', 'Fournisseurs, factures non parvenues'],
  ['409', 'Fournisseurs débiteurs (avances et acomptes versés)'],
  ['411', 'Clients'], ['411900', 'Clients — assurances (tiers payant)'], ['412', 'Clients, effets à recevoir'], ['418', 'Clients, produits non encore facturés'],
  ['419', 'Clients créditeurs (avances et acomptes reçus)'],
  ['421', 'Personnel, avances et acomptes'], ['422', 'Personnel, rémunérations dues'], ['428', 'Personnel, charges à payer'],
  ['431', 'Sécurité sociale (CSS)'], ['432', 'Caisses de retraite (IPRES)'], ['438', 'Organismes sociaux, charges à payer'],
  ['441', 'État, impôt sur les bénéfices'], ['442', 'État, autres impôts et taxes'], ['443', 'État, TVA facturée'],
  ['444', 'État, TVA due ou crédit de TVA'], ['445', 'État, TVA récupérable'], ['447', 'État, impôts retenus à la source'],
  ['462', 'Associés, comptes courants'], ['471', 'Débiteurs divers'], ['472', 'Créditeurs divers'],
  ['476', 'Charges constatées d\'avance'], ['477', 'Produits constatés d\'avance'],
  ['481', 'Fournisseurs d\'investissements'], ['485', 'Créances sur cessions d\'immobilisations'],
  ['491', 'Dépréciations des comptes clients'],
  // Classe 5 — Trésorerie
  ['511', 'Effets à encaisser'], ['513', 'Chèques à encaisser'],
  ['521', 'Banques'], ['5211', 'Wave'], ['5212', 'Orange Money'],
  ['561', 'Crédits de trésorerie'], ['571', 'Caisse'], ['585', 'Virements de fonds'],
  // Classe 6 — Charges
  ['601', 'Achats de marchandises'], ['602', 'Achats de matières premières'], ['604', 'Achats stockés de matières et fournitures consommables'],
  ['605', 'Autres achats'], ['608', 'Achats d\'emballages'], ['6031', 'Variations des stocks de marchandises'],
  ['611', 'Transports sur achats'], ['612', 'Transports sur ventes'], ['618', 'Autres frais de transport'],
  ['621', 'Sous-traitance générale'], ['622', 'Locations et charges locatives'], ['624', 'Entretien, réparations et maintenance'],
  ['625', 'Primes d\'assurance'], ['627', 'Publicité, publications, relations publiques'], ['628', 'Frais de télécommunications'],
  ['631', 'Frais bancaires'], ['632', 'Rémunérations d\'intermédiaires et de conseils'], ['633', 'Frais de formation du personnel'],
  ['638', 'Autres charges externes'],
  ['641', 'Impôts et taxes directs'], ['645', 'Impôts et taxes indirects'], ['647', 'Pénalités et amendes fiscales'],
  ['651', 'Pertes sur créances clients'], ['658', 'Charges diverses'],
  ['661', 'Rémunérations directes versées au personnel national'], ['663', 'Indemnités et primes versées au personnel'],
  ['664', 'Charges sociales'],
  ['671', 'Intérêts des emprunts'], ['674', 'Autres intérêts'], ['676', 'Pertes de change'], ['678', 'Autres charges financières'],
  ['681', 'Dotations aux amortissements d\'exploitation'], ['691', 'Dotations aux provisions d\'exploitation'],
  // Classe 7 — Produits
  ['701', 'Ventes de marchandises'], ['702', 'Ventes de produits finis'], ['706', 'Services vendus'], ['707', 'Produits accessoires'],
  ['71', 'Subventions d\'exploitation'], ['72', 'Production immobilisée'], ['73', 'Variations de stocks de produits'],
  ['751', 'Profits sur créances clients'], ['758', 'Produits divers'],
  ['771', 'Intérêts de prêts et créances'], ['773', 'Escomptes obtenus'], ['776', 'Gains de change'],
  ['781', 'Transferts de charges d\'exploitation'], ['791', 'Reprises de provisions d\'exploitation'],
  // Classe 8 — Autres charges et produits (HAO, impôts)
  ['81', 'Valeurs comptables des cessions d\'immobilisations'], ['82', 'Produits des cessions d\'immobilisations'],
  ['83', 'Charges hors activités ordinaires (HAO)'], ['84', 'Produits hors activités ordinaires (HAO)'],
  ['85', 'Dotations hors activités ordinaires'], ['86', 'Reprises hors activités ordinaires'],
  ['87', 'Participation des travailleurs'], ['88', 'Subventions d\'équilibre'], ['891', 'Impôts sur les bénéfices de l\'exercice'],
];

const JOURNAUX = [
  ['VT', 'Journal des ventes'], ['AC', 'Journal des achats'], ['CA', 'Journal de caisse'],
  ['BQ', 'Journal de banque'], ['OD', 'Opérations diverses'],
];

module.exports = { COMPTES, JOURNAUX };
