// Catalogue de départ — secteur pharmacie
// Généré à partir de la Liste Nationale des Médicaments et Produits Essentiels
// du Sénégal (LNMPE, révision 2022 — ARP/MSAS). 966 produits.
// unitPrice à 0 pour tous : les prix réels sont saisis ensuite par le pharmacien.

const CATEGORIES_PHARMACIE = [
  "ANTI-INFECTIEUX",
  "ANESTHESIQUES",
  "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
  "ANTI-ALLERGIQUES ET ANAPHYLAXIE",
  "ANTIDOTES",
  "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
  "MEDICAMENTS AGISSANT SUR LE SANG",
  "DERIVES SUCCEDANES DU SANG",
  "APPAREIL CARDIOVASCULAIRE",
  "DERMATOLOGIE",
  "MYORELAXANTS",
  "OCYTOCIQUES / TOCOLYTIQUES",
  "TUBE DIGESTIF",
  "APPAREIL RESPIRATOIRE",
  "PRODUITS BUCCODENTAIRES",
  "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
  "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
  "OPHTALMOLOGIE",
  "VITAMINES ET SELS MINERAUX",
  "SOLVANT",
  "INSULINES ET ANTIDIABETIQUES",
  "AUTRES HORMONES ET SUCCEDANES SYNTHETIQUES",
  "ANTICANCEREUX",
  "ALIMENTATION PARENTERALE ET ENTERALE",
  "ORL",
  "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
  "PRODUITS PHYTOSANITAIRES",
  "PRODUITS DE LABORATOIRE",
  "PATHOLOGIE RENALE",
  "MEDICAMENTS GERIATRIQUES",
  "SANTE OCULAIRE (PROGRAMME NATIONAL)",
  "AUTRES PRODUITS DE SANTE"
];

const PRODUITS_PHARMACIE = [
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Amikacine 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Amoxicilline 500mg gélule",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Amoxicilline 1 g comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Amoxicillicine 250mg comprimé dispersible",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Amoxicilline 250mg suspension buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Amoxicilline+Acide Clavulanique 500mg/62,5mg Sachet",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Amoxicilline+Acide Clavulanique 1000mg/125mg Sachet",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ampicilline 1g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Azithromycine 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Benzathine -benzylpénicilline 2,4mui injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Benzathine-benzylpénicilline 1,2mui injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Benzylpénicilline 1mui injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Céfazoline 1g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Céfixime 200mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Céfixime 100mg/5ml suspension. buvable.",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Céfotaxime 1 g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ceftriaxone 1g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ciprofloxacine 250mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ciprofloxacine 200mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ciprofloxacine 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ciprofloxacine 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Doxycycline 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Erythromycine 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Gentamicine 80mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Oxacilline 1g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Flucloxacilline 250mg/5ml suspension buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Flucloxacilline 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Flucloxacilline 125mg/5ml suspension buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Imipénèmes 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Phénoxyméthylpénicilline 1000000 UI comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Sulfaméthoxazole + Triméthoprime 400mg/80mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Sulfaméthoxazole + Triméthoprime 200mg/40mg suspension . buvable.",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Sulfaméthoxazole + Triméthoprime 800mg/160mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Vancomycine 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Thiamphénicol 750mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Imipéneme +Cilastatine 500mg/500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Amoxicilline + Acide Clavulanique 100 mg / 12,5 mg / ml sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Amoxicilline+Acide Clavulanique 500mg/62,5mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Céfuroxime 750mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Cyclosérine 250mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ethambutol 400mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ethionamide 250mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Isoniazide 300mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Lévofloxacine 250mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Pyrazinamide 400mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Clofazimine 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Rifampicine/Isoniazide/Pyrazinam ide 75/50/150 mg comp.disp",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Rifampicine/Isoniazide 75/50 mg comp.disp",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Bédaquiline 100 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Linézolide 600 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "pyridoxine 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Delamanid 50mg comprimé dispersible",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Clofazimine 50mg comprimé dispersible",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ethionamide 125mg comprimé dispersible",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Cyclosérine 125mg comprimé dispersible",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Lévofloxacine 100mg comprimé dispersible",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ethambutol 100mg comp.disp",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Pyrazinamide 150mg comprimé dispersible",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Rifampicine/Isoniazide 150mg/75mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Isoniazide 300mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Rifapentine+Isoniazide (300/300)mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Rifampicine/Isoniazide/Pyrazinam ide/ethambutol 150mg/75mg/4 00mg/275mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Isoniazide 100mg comprimé disp",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ethambutol 100mg comp.disp",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Rifampicine/Isoniazide 75mg/50mg comprimé dispersible",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Rifampicine/Isoniazide/Pyrazinam ide 75/50/150 mg comp.disp",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Clofazimine 50mg et 100mg capsule molle",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Dapsone 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Rifampicine 300mg gélule",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Artésunate/Amodiaquine 25 mg/67,5mg; B/3cp comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Artésunate/Amodiaquine 50mg/135mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Artésunate/Amodiaquine 100mg/270mg; B/3cp comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Artésunate/Amodiaquine 100mg/270mg; B/6cp comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Artéméther/Luméfantrine 20mg/120mg; B18cp comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Artéméther/Luméfantrine 20mg/120mg; B/12cp comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Artémèther/luméfantrine 80mg/480mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Artéméther/Luméfantrine 20mg/120mg; B/6cp comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "DihydroArtémisinine/Pipéraquine 40mg/320mg; B/9cp comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Artésunate 30mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Artésunate 60mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Artéméther 80mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Artesunate 100mg suppositoire",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Sulfadoxine + Pyriméthamine 500mg/25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Sulfadoxine/Pyriméthamine + Amodiaquine 500mg/25mg + 153mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Sulfadoxine/Pyriméthamine + Amodiaquine 250mg/12,5mg + 76,5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Quinine 400mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Primaquine 7,5 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Métronidazole 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Métronidazole 250mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Métronidazole 500mg comprimé gynécologique",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Métronidazole 200mg/5ml suspension buvable.",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Métronidazole 500mg/100ml perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Amphotéricine B liposomale 50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Amphotéricine B 250mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Amphotéricine B 1000µg/ml suspension buvable.",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Fluconazole 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Fluconazole 2mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Fluconazole 50mg/5ml suspension buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Griséofulvine 250mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Griséofulvine 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Kétoconazole 200mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Nystatine 100.000UI comprimé gynécologique",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Terbinafine 250mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Albendazole 400mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Albendazole 200mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Albendazole 4% suspension buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Mébendazole 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Mébendazole 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Mébendazole 100mg/5ml suspension buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ivermectine 3mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Praziquantel 600mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Aciclovir 200mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Aciclovir 250mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Valaciclovir 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ganciclovir 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ténofovir 300mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Sofosbuvir 400mg comprimé 13",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ténofovir + Emtricitabine 300mg/200mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ténofovir + Lamivudine 300mg/300mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Zidovudine + Lamivudine 60mg/30mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Zidovudine + Lamivudine + Abacavir 300mg/150mg/ 300mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Abacavir+Lamivudine 600mg/300mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Abacavir+Lamivudine 120mg/60mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Abacavir+Lamivudine 60mg/30mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Efavirenz 200mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Atazanavir + Ritonavir 300mg/100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Darunavir 600mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Darunavir + Ritonavir 400mg/100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Lopinavir + Ritonavir 200mg/50mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Lopinavir + Ritonavir 80mg/20mg sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Lopinavir + Ritonavir 100mg/25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Lopinavir + Ritonavir 40mg/10mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ritonavir 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ténofovir+Emtricitabine+Efaviren z 300mg/200mg/ 600mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ténofovir+Emtricitabine+Efaviren z 300mg/200mg/ 400mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ténofovir+Lamivudine+Efavirenz 300mg/300mg/ 600mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ténofovir+Lamivudine+Efavirenz 300mg/300mg/ 400mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Raltégravir 400mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Dolutégravir 50mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Dolutégravir 10mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ténofovir + Lamivudine +Dolutégravir 300mg/300mg/ 50mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ténofovir alafenamide +Emtricitabine +Dolutégravir 25mg/200mg/5 0mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "Ténofovir alafenamide +Emtricitabine 25mg/200mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-INFECTIEUX",
    "name": "abacavir + Lamivudine +Dolutégravir 600mg/300mg/ 50mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Oxygène inhalation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Protoxyde d’azote inhalation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Isoflurane 184.5 g/mol inhalation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Sévoflurane 2mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "desflurane 2mg/ml inhalation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Kétamine 50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Propofol 20mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Etomidate 20mg/10ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Diazépam 10mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Midazolam 5mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Midazolam 50mg/10ml Injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Thiopental 1g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Dexmedetomidine 100microgram/ ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Dropéridol 2,5mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Bupivacaïne hyperbare 0,50% injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Bupivacaïne isobare 5mg/1ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Lidocaïne 2% injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Lidocaïne 1% injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Lidocaïne 2% gel urétral",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Lidocaïne épinéphrine 2% injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Ropivacaïne 2mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "mepivacain 20mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Atropine 0,25mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Atropine 0,50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Dropéridol 5mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Néostigmine 0,5mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Suxaméthonium ( succinylcholine) 10mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Rocuronium 10mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Rocuronium 50mg/5ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Vécuronium bromure 10mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Atracurium bésilate 50mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Fentanyl 0,5mg/10mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Fentanyl 0,1mg/20mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Sufentanil 10µmg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Morphine chlorhydrate 10mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Nalbuphine 20mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Nefopam 20mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANESTHESIQUES",
    "name": "Tramadol 100mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Acétylsalicylate de lysine 1,8g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Acétylsalicylate de lysine 100mg poudre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Acétylsalicylate de lysine 250mg poudre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Acide acétylsalicylique 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Acide acétylsalicylique 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Acide méfénamique 250mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Acide niflumique 3% pommade",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Ibuprofène 400mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Ibuprofène 100mg/5ml sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Indométacine 25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Kétoprofène 100mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Diclofénac 50mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Paracétamol 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Paracétamol 125mg/5ml sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Paracétamol 1g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Paracétamol 0,5g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Prednisone 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Prednisone 20mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Buprénorphine 0,2mg comprimé perlingual",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Morphine chlorhydrate 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Morphine chlorhydrate 10mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Morphine chlorhydrate 20mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Morphine chlorhydrate 30mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Morphine chlorhydrate LP 10mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Morphine chlorhydrate LP 20mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Morphine chlorhydrate LP 30mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Morphine 10mg poudre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Morphine chlorhydrate LP 60 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Méthadone 5mg gélule",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Méthadone 5mg sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANALGESIQUES, ANTIPYRETIQUES, ANTI-INFLAMMATOIRES",
    "name": "Sufentanil 10µg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-ALLERGIQUES ET ANAPHYLAXIE",
    "name": "Cétirizine 10mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-ALLERGIQUES ET ANAPHYLAXIE",
    "name": "Dexaméthasone 4mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-ALLERGIQUES ET ANAPHYLAXIE",
    "name": "Dexchlorphéniramine 2mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-ALLERGIQUES ET ANAPHYLAXIE",
    "name": "Dexchlorphéniramine 0,01% sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-ALLERGIQUES ET ANAPHYLAXIE",
    "name": "Hydrocortisone 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-ALLERGIQUES ET ANAPHYLAXIE",
    "name": "Hydrocortisone 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-ALLERGIQUES ET ANAPHYLAXIE",
    "name": "Méthylprednisolone 40mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-ALLERGIQUES ET ANAPHYLAXIE",
    "name": "Prométhazine 50mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTI-ALLERGIQUES ET ANAPHYLAXIE",
    "name": "Prométhazine 25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "charbon activé Solution Buvable 12g/60ml solution buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "Charbon 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "Disulfurame 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "Flumazénil 0,5mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "N-acétylcystéine 5g/25ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "Naloxone 0,4mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "Pralidoxime 200mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "EDTA disodique calcique 500mg/10mL injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "Déferoxamine 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "Glucagon 1mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "Sulfate de Protamine 1000 UAH/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "Intralipide 20%/250ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "les concentres de complexe prothrombinique humaine 25U/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTIDOTES",
    "name": "Succimer 100mg Capsule orale",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Sulfate de magnésium 20% injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Acide valproïque 200mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Acide valproïque 400mg/4ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Valproate de sodium LP 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Valproate de sodium 200mg/5ml solution buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Amitriptyline 40mg/ml gouttes orales",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Carbamazépine 200mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Chlorpromazine 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Chlorpromazine 25mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Clonazépam 2mg gouttes",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Clonazepam 1mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Clonazépam 2mg comprime",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Diazepam 10mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Diazépam 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Phénytoïne 30mg/5ml solution buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Phénytoïne 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Fluphénazine 25mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Fluphénazine 125mg/5ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Halopéridol 0,50% gouttes orales",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Halopéridol 5mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Lévomépromazine 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Lévomépromazine 25mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Phénobarbital 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Phénobarbital 200mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Phénobarbital 15mg/5ml solution buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Trihexyphénidyle 0,40% gouttes",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Trihexyphénidyle 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Tropatépine 10mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PSYCHOTROPES / ANTICONVULSANTS / ANTIEPILEPTIQUES",
    "name": "Tropatépine 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Acide folique 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Acide folique 2mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Chélateurs de fer 125mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Chélateurs de fer 250mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Chélateurs de fer 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Cyanocobalamine 1mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Erythropoïétine 2000UI/0,5ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Erythropoïétine 4000UI/0,5ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Erythropoïétine 5000UI/0,5ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Erythropoïétine 10000UI/0,5ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Sels ferreux pédiatrique 50mg/5ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Epoétine bêta 50µg/0,3ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Epoétine bêta 75µg/0,3ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Epoétine bêta 100µg/0,3ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Epoétine bêta 150µg/0,3ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Epoétine bêta 200µg/0,3ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Epoétine bêta 50µg/0,3ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Epoétine bêta 250µg/0,3ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Fer ferrique 100mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Fer + acide folique 60mg/0,4mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Sels ferreux adulte 80mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Sels ferreux forme adule 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Sels ferreux adulte 100mg Comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Sels ferreux pédiatrique 33mg Poudre/sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Sels ferreux pédiatrique 50mg/5ml Comprimé/Sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Etamsylate 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Etamsylate 250mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Misoprostol 200 µg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Acide tranexamique 1g ampoule buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Acide tranexamique 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Acide tranexamique 500g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Phytoménadione 2mg/0,2ml solution acqueuse injectable et buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Phytoménadione 10mg/ml solution injectable et buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "fluindione 20mg comprime",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Acénocoumarol 4mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Acénocoumarol 1mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Rivaroxaban 10mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Enoxaparine 2000 ui anti Xa injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Enoxaparine 4000 ui anti Xa injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Enoxaparine 6000 ui anti Xa injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Enoxaparine 8000 ui anti Xa injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Enoxaparine 10000 ui anti Xa injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Héparinate non fractionnée 250UI/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Héparinate de sodium 25000ui/5ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Streptokinase 1.500.000ui injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Altéplase 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Tenecteplase 10 000 U/10 ml Injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Clopidogrel 75mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Ticagrelol 90mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Allupurinol 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS AGISSANT SUR LE SANG",
    "name": "Allupurinol 300mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Gélatine fluide modifiée perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Concentré de facteur VIII 500UI injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Concentré de facteur VIII 1000UI injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Concentré de facteur VIII 250UI injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Concentré de facteur IX 500UI injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Concentré de facteur IX 1000UI injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Immunoglobuline anti-D 250UI injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Immunoglobuline anti-D 1000UI injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Immunoglobuline polyvalent 250UI injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Facteurs antihémophilliques A et B injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Hydroxyéthylamidon perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Trocard de mallarmé 15 G (aiguille medullograme)",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERIVES SUCCEDANES DU SANG",
    "name": "Trocard de mallarmé 18 G (aiguille medullograme)",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Diltiazem 60mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Diltiazem 200mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Dinitrate d’isosorbide 10mg/10ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Dinitrate d’isosorbide 10mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Trinitrate de glycérine 0,15mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Trinitrate de glycérine 0,15mg spray",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Nitroglycerine 5mg Patch",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Nitroglycerine 10mg Patch",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Altizide + spironolactone 15mg/25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amlodipine 10mg gélules",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amlodipine 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Bisoprolol 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Bisoprolol 10mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Carvedilol 6,5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Carvedilol 25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "perindopril 5mg comprime",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "perindopril 10mg comprime",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Ramipril 2,5mg comprime",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Ramipril 10mg comprime",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Valsartan 80mg comprime",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Valsartan 160mg comprime",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Candésartan 8mg comprime",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Candésartan 16mg comprime",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Clonidine 0,15mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Furosémide 40mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Furosémide 250mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Furosémide 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Furosémide 20mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Hydrochlorothiazide 25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Indapamide 1,25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Indapamide 2,5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Méthyldopa 250mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Méthyldopa 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Labétalol 5mg Injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Nicardipine 10mg/10ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Nicardipine 20mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Nicardipine 50mg gélule",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Nifédipine 20mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Propranolol 5mg/5ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Propranolol 40mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Spironolactone 75mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Spironolactone 50 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Spironolactone 25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amlodipine/Perindopril 5mg/5mg comprime",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amlodipine/Perindopril 10mg/10mg comprime",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amlodipine/Valsartan 5mg/80mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amlodipine/Valsartan 10mg/160mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Ramipril/Hydrochlorothiazide 5mg/12,5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Ramipril/Hydrochlorothiazide 10mg/25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Valsartan/Hydrochlorothiazide 80mg/12,5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Valsartan/Hydrochlorothiazide 160mg/25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amlodipine/Indapamide 5mg/1,5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amlodipine/Indapamide 10mg/1,5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amlodipine/Indapamide/Perindop ril 5mg/1,25mg/5 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amlodipine/Indapamide/Perindop ril 10mg/2,5mg/10 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amlodipine/Valsartan/Hydrochlor othiazide 5mg/160mg/12, 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amlodipine/Valsartan/Hydrochlor othiazide 10mg/160mg/2 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amiodarone 200mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Amiodarone 150mg/3ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Digoxine 0,25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Digoxine 0,5mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Digoxine 5µg/0,1ml gouttes",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Digoxine 0,125mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Dopamine 200mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Noradrénaline 2ml/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Dobutamine 250mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Epinéphrine 0,25mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Hydrocortisone 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Ephédrine 30mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "phenylephedrine 0,5mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Isoprénaline 0,20 mg/1 ml Injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Alprostadil 0,5mg/1ml Injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Vérapamil 5 mg/2 mL Injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Atorvastatine 10 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Atorvastatine 20 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Rosuvastatine 10 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Rosuvastatine 20 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL CARDIOVASCULAIRE",
    "name": "Ezetimibe 10 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Econazole 1% crème",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Griseofulvine pommade",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Griséofulvine 500 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Terbinafine 1% crème",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Béthamétasone 0,10% crème",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Clobétasone 0,05% crème",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Hydrocortison 1% crème",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Mupirocine 2% pommade",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Alcool 95° liquide",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Alcool 70° liquide",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Alcool iodé solution",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Compresses imprégnées à la polyvidone iodée",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Eau oxygénée 10V liquide",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Eosine aqueuse 0,02 Solution",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Ether rectifié (dermique) liquide",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Formaldéhyde 1g liquide",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Hypochlorite de sodium 8°CF solution",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Hypochlorite de sodium + Permanganate de Potassium 500mg/100mL de Cl actif solution",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Oxyde de zinc",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Polyvidone iodé 10% solution",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Violet de gentiane 250mg poudre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "chlorhexidine 7,10% gel",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Creme solaire crème",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Talc poudre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Vaseline pommade",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Benzoate de benzyle 12,50% solution",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Vaseline salicylée 5% pommade",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "DERMATOLOGIE",
    "name": "Vaseline salicylée 10% pommade",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MYORELAXANTS",
    "name": "Thiocolchicoside 4mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OCYTOCIQUES / TOCOLYTIQUES",
    "name": "Ocytocine 5ui injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OCYTOCIQUES / TOCOLYTIQUES",
    "name": "Carbétocine 100 mcg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OCYTOCIQUES / TOCOLYTIQUES",
    "name": "Salbutamol 0,5mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OCYTOCIQUES / TOCOLYTIQUES",
    "name": "Salbutamol 2mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OCYTOCIQUES / TOCOLYTIQUES",
    "name": "Salbutamol 1mg suppositoire",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OCYTOCIQUES / TOCOLYTIQUES",
    "name": "Bétamethasone 4mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Cimétidine 200mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Oméprazole 40 mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Oméprazole 10mg gélule",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Oméprazole 20mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Sels d’Aluminium et de Magnésium 400mg/400mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Granisétron chlorhydrate 3mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Granisétron chlorhydrate 1mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Ondasétron 8 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Métopimazine 5 mg suppositoire",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Métopimazine sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Métopimazine 10mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Lévosulpiride 25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Lévosulpiride 25mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Lévosulpiride 25mg/ml sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Anti-infl.+Astrigent+Anest local 100g pommade",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Diosmines + flavonoides",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Atropine 0,25mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Phloroglucinol +trimethylphloroglucinol 40mg/0,04mg par 4ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Phloroglucinol +trimethylphloroglucinol 80mg/80mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Paraffine liquide 215g/225g gelée buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Lactulose 10 g suspension buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Lactulose 10g gelée buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Sels de réhydratation orale faible osmolarité Glucose 13,5g/L ; NaCl 2,6g/L; KCl 1,5 g/L, Citrate trisodique poudre en sachet",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Kit SRO/Zinc dihydraté 2,9g/L",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "ReSoMal 294 mEq/L",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "TUBE DIGESTIF",
    "name": "Zinc (sulfate) 20mg comprimé dispersible et sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Carbocystéine 5% sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Carbocystéine 2% sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Terpine+codéine 100mg/5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Dextromethorphane 1,5mg/ml sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "dextromethorphane +phenylephrine 15 mg / 5 ml sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Oxomémazine+guaïfénésine (1,65mg/33,3m g)/ml sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Salbutamol 0,5mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Salbutamol 2mg/5ml sirop",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Salbutamol 2mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Salbutamol 100ug/bouffee spray( Aerosol)",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Salbutamol 2,5mg/2,5ml nebulisation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Salbutamol 5mg/2,5ml nebulisation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Terbutaline 0,5mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Terbutaline 5mg/2ml nebulisation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Terbutaline 2,5mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Terbutaline 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Fluticasone propionate + formaterol fumarate 50 mcg /5 mcg inhalation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Fluticasone propionate + formaterol fumarate 125 mcg /5 mcg inhalation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "budesonide 0,5 mg /2ml nebulisation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "budesonide 1 mg /2ml nebulisation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "MONTELUKAST 5, 10 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "thiotropium 18 mcg inhalation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "propionate fluticasone + salméterol 500 mg/50 microns Diskus",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "propionate fluticasone + salméterol 250 mg/50 microns Diskus",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Bromure d'ipratropium O,5 mg nebulisation",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "APPAREIL RESPIRATOIRE",
    "name": "Citrate de cafeine 250mg/1ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "lidocaine+eugénol",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "Solution antiseptique pour bain de bouche",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "Lidocaïne % injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "Lidocaine 3% injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "Lidocaïne adrénalinée injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "eugénol liquide",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "ciment verre ionomére type Poudre + liquide",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "hydroxyde de calcium poudre /liquide",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "patte fluorée 1000 à 1500 ppm pate dentrifrice",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "Oxyde de zinc leger 500g",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "Pharmaéthyl",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "Pulpéryl Solution",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "Carpules d’anesthésie ( articaine) ampoule injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "Carpules d’anesthésie (mepivacaine) 3% ampoule injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS BUCCODENTAIRES",
    "name": "Rockless",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Sérum anti-D injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Sérum antirabique injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Sérum antitétanique injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Sérum antilymphocytaire 25mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Sérum antilymphocytaire 20mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Sérum antivenimeux polyvalent injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "vaccin anti rougeole-rubeole",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "vaccin ROR",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin antiamaril injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin antihépatite B injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin Antiméningo A, C, Y, W135 injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin Antiméningo W135 injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin antipneumococcique injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin antipoliomyélitique oral",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin antipoliomyélitique injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin antirabique injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin antitétanique injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin antituberculeux injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin Anti-papillomavirus injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin antirotavirus orale",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin anticovid injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PREPARATIONS IMMUNOLOGIQUES (SERUMS / VACCINS)",
    "name": "Vaccin Pentavalent BASIQUE injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Bicarbonate de sodium 14%o perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Bicarbonate de sodium 42%o perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Chlorure de potassium 10% perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Chlorure de sodium 9%o perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Chlorure de calcium perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Chlorure de magnésium perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Chlorure de sodium (irrigation vésicale litres) 9%o perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Chlorure de sodium 10% perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Gluconate de calcium 100mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Glucose 5% perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Glucose 10% perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Glucose 30% perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Ringer Lactate perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Mannitol 20% perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Albumine humaine 5% perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "EQUILIBRE HYDRIQUE, ELECTROLYTIQUE ET ACIDO-BASIQUE",
    "name": "Albumine humaine 20%",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Aciclovir 3% pommade ophtalmique",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Cétoxonium 0,25% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Chloramphénicol + Dexaméthasone collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Chlortétracycline ou Tétracycline 1% pommade ophtalmique",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Fluorescéine 1% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Gentamicine 0,30% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Néomycine + Polymyxine 340.000ui+1Mui collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Norfloxacine 0,30% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Dexaméthasone 0,10% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Diclofénac 0,10% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Hydrocortisone 1% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Indométacine 0,10% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Oxybuprocaïne 40mg collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Lidocaine 2% + adrénaline Inj injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "lignocaine HCL Plain 2%/ 20ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Amethocaine hydrochoride 0,5%/10ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Tétracaïne 0,005 collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Acétazolamide 250mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Acétazolamide 500mg/5ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Brinzolamide 10mg/ml collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Cartéolol 15mg collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Pilocarpine 2% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Timolol 0,25% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Latanoprost 0,50% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Timolol 0,50% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Atropine 1% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Atropine 0,50% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Epinéphrine 2% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Tropicamide + phénylephrine 5ml 0,8%+5% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Visqueux en seringue pré rempli 2%",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Gentamycine 80mg 2ml 80mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Dexaméthasone 8mg 2ml 8mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Pilocarpine 0,50% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Cyclopentolate 0,50% collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Tropicamide 5mg/ml collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Picloxydine 5mg collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Carbomère 980 (larmes artificielles) 10mg gel ophtalmique",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Cromoglycate 7mg collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Lévocabastine 2,5mg collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Fluorescéine 2mg collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Tropicamide 50mg collyre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "OPHTALMOLOGIE",
    "name": "Ranibizumab 10mg/ml solution pour injection intravitréenne",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "VITAMINES ET SELS MINERAUX",
    "name": "Acide ascorbique 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "VITAMINES ET SELS MINERAUX",
    "name": "Acide ascorbique 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "VITAMINES ET SELS MINERAUX",
    "name": "Calcium gluconate 10% injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "VITAMINES ET SELS MINERAUX",
    "name": "Calcium Vit D3 500/400 UI comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "VITAMINES ET SELS MINERAUX",
    "name": "Cyanocobalamine 1mg/2ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "VITAMINES ET SELS MINERAUX",
    "name": "Pyridoxine 250mg/5ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "VITAMINES ET SELS MINERAUX",
    "name": "Rétinol 100.000ui capsules",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "VITAMINES ET SELS MINERAUX",
    "name": "Rétinol 200.000ui capsules",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SOLVANT",
    "name": "Eau pour préparation injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "Glimépiride mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "Glimépiride 4 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "Gliclazide 60 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "Insuline Mixte 30% 100UI injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "Insuline Lente 100UI injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "Insuline Rapide 100UI injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "Insuline analogue pour injection action rapide à stylo prérempli jetable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "Insuline analogue pour injection action lente à stylo prérempli jetable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "Insuline analogue pour injection action mixte à stylo prérempli jetable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "Metformine 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "Metformine 850mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "gliclazide /metformine 60/850 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "INSULINES ET ANTIDIABETIQUES",
    "name": "gliclazide /metformine 60/1000 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES HORMONES ET SUCCEDANES SYNTHETIQUES",
    "name": "Carbimazole 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES HORMONES ET SUCCEDANES SYNTHETIQUES",
    "name": "Carbimazole 20mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES HORMONES ET SUCCEDANES SYNTHETIQUES",
    "name": "Cortisone 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES HORMONES ET SUCCEDANES SYNTHETIQUES",
    "name": "Cyprotérone 50mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES HORMONES ET SUCCEDANES SYNTHETIQUES",
    "name": "Progesterone 200 mg ovule",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES HORMONES ET SUCCEDANES SYNTHETIQUES",
    "name": "Bicalutamide 50mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES HORMONES ET SUCCEDANES SYNTHETIQUES",
    "name": "hydrocortisone 10 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES HORMONES ET SUCCEDANES SYNTHETIQUES",
    "name": "Goséréline 3,6 mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES HORMONES ET SUCCEDANES SYNTHETIQUES",
    "name": "Lévothyroxine 50µg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES HORMONES ET SUCCEDANES SYNTHETIQUES",
    "name": "Lévothyroxine 100µg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES HORMONES ET SUCCEDANES SYNTHETIQUES",
    "name": "Cabergoline 0,5 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Bléomycine 15mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Carboplatine 450mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Carboplatine 150mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Chlormétine 10mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Cisplatine 10mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Cisplatine 25mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Cisplatine 50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Cyclophosphamide 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Cyclophosphamide 25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Cyclophosphamide 50 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Doxorubicine 10mg ;50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Epirubicine 20mg ; 50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Etoposide 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Fluorouracil 500mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Hydroxycarbamide 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Melphalan 2mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Melphalan 50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Méthotrexate 50mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Méthotrexate 20mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Méthotrexate 10mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Ledertrexate 5mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Méthotrexate 2,5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Méthotrexate 20mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Paclitaxel 30mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Paclitaxel 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Tamoxifène 20mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Vinblastine 10mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Vincristine 1mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Vincristine 2mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Bevacizumab 400mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Trastuzumab 150mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Rituximab 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Rituximab 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Capecitabine 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Ibandronate 50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Ibandronate 6mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Filgrastim 300µg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Acide Zolédronique 4mg perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Triptoréline 0,1 mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Folinate de calcium 50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Folinate de calcium 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Actinomycine 0,5mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Pemetrexed 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Pemetrexed 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Thalidomide 50mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Fluoro-5 uracil 250mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Fluoro-5 uracil 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Anastrozole 1mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Gemcitabine 200mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Gemcitabine 1000mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Letrozole 2,5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Sunitinib 12,5mg gélule",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Azacitidine 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Mercaptopurine 50mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Thioguanine 40mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Cytarabine 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Ifosfamide 1g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Ifosfamide 3g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Oxaliplatine 50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Oxaliplatine 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Dacarbazine 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Dacarbazine 200mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Témozolomide 100mg gélule",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Irinotécan 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Irinotécan 500mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Irinotécan 40mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Topotécan 4mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Daunorubicine 50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Vinorelbine 50mg",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Vinorelbine 10mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "L Asparaginase 10.000unités injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Pegfilgastrim 6mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Mesna 1g injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Fludarabine 50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Busulphan 60mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Chorambucil 2mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Oxaliplatine 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Bendamustine 2,5mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Carmustine 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Procarbazine 50mg gélule",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Docetaxel 80mg",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Docetaxel 160mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Bortézomib 3,5mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Idarubicine 5mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Brentuximab vedotin 50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Daratumumab 20mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Lénalidomide 25mg gélule",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Ciclosporine 50mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Trétinoïne 10mg gélule",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Arsénic trrioxyde 10mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Atézolizumab 1200mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Pembrolizumab 50mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Pembrolizumab 100mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Erlotinib 150mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ANTICANCEREUX",
    "name": "Chloraminophène 2mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ALIMENTATION PARENTERALE ET ENTERALE",
    "name": "Acides aminés essentiels perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ALIMENTATION PARENTERALE ET ENTERALE",
    "name": "Acides gras essentiels perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ALIMENTATION PARENTERALE ET ENTERALE",
    "name": "Complexe vitaminique perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ALIMENTATION PARENTERALE ET ENTERALE",
    "name": "Mélange ternaire (protide, glucide, lipide) perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ALIMENTATION PARENTERALE ET ENTERALE",
    "name": "Oligo-éléments perfusion",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ALIMENTATION PARENTERALE ET ENTERALE",
    "name": "ASPE",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ALIMENTATION PARENTERALE ET ENTERALE",
    "name": "ATPE",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ALIMENTATION PARENTERALE ET ENTERALE",
    "name": "F100",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ALIMENTATION PARENTERALE ET ENTERALE",
    "name": "F75",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ORL",
    "name": "Fénoxazoline 15mg/flacon goutte auriculaire",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ORL",
    "name": "Phénazone + Lidocaïne (4g/1g)/100g goutte auriculaire",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "ORL",
    "name": "Xylométazoline 0,5%o goutte nasale",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "Dispositifs intra-utérins TCU 380 A",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "Préservatif féminin",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "Préservatif masculin",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "collier",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "Ethinylestradiol+levonorgestrel+f umarate ferreux 0,03mg/0,15mg /75mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "Levonorgestrel 0,75mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "Levonorgestrel 1,5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "Levonorgestrel 0,03mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "Etonogestrel 68mg implant/1batonne t",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "Levonorgestrel 2x 0,75mg implant/2batonne ts",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "Acétate médroxyprogestérone 150mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "Anneau vaginal a progestérone 2g anneau",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "CONTRACEPTIFS ET MEDICAMENTS ENDOCRINIENS",
    "name": "Acétate médroxyprogestérone 104mg/0,65 ml injectable sous cutané",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS PHYTOSANITAIRES",
    "name": "Chlorpyrimiphos méthyl (CE et PP)",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS PHYTOSANITAIRES",
    "name": "Crésilol",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS PHYTOSANITAIRES",
    "name": "Deltamétrine",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS PHYTOSANITAIRES",
    "name": "Elicide",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS PHYTOSANITAIRES",
    "name": "Moustiquaires imprégnées",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS PHYTOSANITAIRES",
    "name": "Perméthrine",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Réactif de charge virale VIH",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Appareil et Bandelettes pour lecture hémocue Bandelette",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Reactif de charge virale hepatite B/C",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test rapide de dépistage hépatite",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test de diagnostic rapide du paludisme HRP2 Cassette",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test de diagnostic rapide du paludisme pLDH Cassette",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test de glucose oxydase",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test de protéine urinaire",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test tuberculine",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test moléculaire de détection de l'ADN du BK",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test moléculaire de détection de l'ARN /ADN hépatites",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test moléculaire de détection de l'ARN VIH",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test moléculaire de détection de l'ARN SARSCOV",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test MTBDR_SL (sensibilté MycoBactéries)",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Tests rapide chlamydia",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Tests rapide de confirmation VIH",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Tests de dépistage antigène HBs",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Tests gonococciques",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Tests sérologiques syphilis / HIV",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Tests sérologiques syphilis /HIV COMBO",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test de screening dépistage rapide VIH 1 et COMBO",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Tests immunologiques dosage CD4",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Test de screening dépistage rapide VIH 1 et",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "test de contrôle du groupe sanguin Cassette",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "TDR drépano",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PRODUITS DE LABORATOIRE",
    "name": "Tests sérologiques syphilis",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Bicarbonate 1g ; 500mg",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Calciférol 0,25µg ; 0,5µg ; 1µg ;",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Carbonate de calcium 1g",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Cyclosporine 25mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Cyclosporine 100mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Cyclosporine 50mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Cinacalcet 120mg",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Cyclophosphamide 500mg",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Polystyrène sulfonate de Potassium poudre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Furosémide 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Prednisolone 20mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Prednisolone 25mg/ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Methylprednisolone 80mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Methylprednisolone 120mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Methoxy polyéthyléne glycol epoeitine beta 50µg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "cholecalciferol 100000 UI ampoule buvable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Cinacalcet 30mg",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "fer carboxymaltose 1000 mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "fer saccharose 100 mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Micophénolate mofétil 1g",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "alphacalcidiol 0,25mcg; 0,5,1 mcg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "chorure de sodium 1G injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "chlorure de potassium 600 mg injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "chlorure de potassium 1G injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Sévélamer chlorhydrate 400mg",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Azathioprine 50mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Basiliximab 20mg inj",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Basiliximab 10mg inj",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Micophénolate mofétil 1g comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Micophénolate mofétil 500mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Solution de conservation d'organes poche de 5litres solution",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Tacrolimus 0,5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Tacrolimus 2mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Tacrolimus 1mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Tacrolimus 4mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "interferon pegyle injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "thymoglobuline 25 mg /5ml injectable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Aiguilles artère veine",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Concentré d’acide",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Concentré de bicarbonate",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Lignes artère veine",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Set de branchement et de débranchement",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Kit hémodialyse",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Reins Artificiels",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Catheter jugulaire",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Catheter fémoral",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Cassettes",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Extraneal",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Bouchon staysafe",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Minicap bétadiné",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Intranéale",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Nutrinéale",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Poche hypertonique DPCA 3,86 POCHE 2L",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Poche hypertonique DPA 3,86 POCHE 5L",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Poche isotonique DPA 1,36 POCHE 5L",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Poche isotonique DPCA 1,36 POCHE 2L",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Kit dialyse péritoneale",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Poche intermediare DPA 2,27 POCHE 5L",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "PATHOLOGIE RENALE",
    "name": "Poche intermediare DPCA 2,27 POCHE 2L",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS GERIATRIQUES",
    "name": "Alfuzosine 5mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS GERIATRIQUES",
    "name": "Alfuzosine 10mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS GERIATRIQUES",
    "name": "Levodopa/ benserazide chlorhydrate 50 mg / 12,5 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS GERIATRIQUES",
    "name": "Levodopa/ benserazide chlorhydrate 100 mg / 25 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS GERIATRIQUES",
    "name": "Levodopa/ benserazide chlorhydrate 200mg / 50 mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS GERIATRIQUES",
    "name": "Donepézil chlorhydrate 10mg",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS GERIATRIQUES",
    "name": "Donepézil chlorhydrate 5mg",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS GERIATRIQUES",
    "name": "Extrait de ginko biloba 40mg",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS GERIATRIQUES",
    "name": "Piracétam 800mg comprimé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "MEDICAMENTS GERIATRIQUES",
    "name": "Antigrippal",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "Substance viscoélastique (méthylcellulose)",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "Implant chambre postérieure",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "SNRM polyamide noir serti 30cm 6,2 mm-3/8 cr – code 87770- U SP=10/0",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "SNRM soie de traction noir serti 75cm 16 mm-3/8 cr – code f2250- USP=3/0",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "SNRM soie de traction noir serti 30cm 6,6 mm-3/8 cr – code f7752- USP=8/0",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "SRT polyglactine 910-(vicryl monofil) serti 30cm 6,6 mm-3/8 cr – code jv7440- USP=10/0",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "SRT polyglactine 910-(vicryl monofil) serti 45cm 7,6 mm-3/8 cr – code jv551- USP=6/0",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "Microéponge chirurgical",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "Couteaux 30° et 45°",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "Pince à monofilament",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "Canule à double courant",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "Néosynéphrine",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "Nandrolone",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "Acétazolamide",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "Goniosol",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "SANTE OCULAIRE (PROGRAMME NATIONAL)",
    "name": "Refractosol",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Poche à sang simple",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Poche à sang double",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Poche à sang triple",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Bande platrée",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Gaze pièce",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Seringue 5 CC",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Seringue 10 CC",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Seringue 20 CC",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Seringue 60 CC",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Perfuseur",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Catheter 16G",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Catheter 18G",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Catheter 20 G",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Catheter 22 G",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Catheter 24 G",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Transfuseur",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Gant de chirurgie",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Fil de suture resorbable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Sonde de gavage",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Films radio",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Films numérique",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Iopamidols",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Test de diagnostique de la méningite",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Test de diagnostique du choléra",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Mini prolongateur",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Prolongateur",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Sonde nasogastrique \"feeding\"",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Sonde JJ Sonde prostatique silicone 3voies",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Sonde d'intubation de différents calibres",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Sonde urinaire pédiatrique et adulte",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Sonde d'aspiration pédiatrique et adulte",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "sonde pour autosondage",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Drains thoraciques",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Valve de Hemlich",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Electrodes pediatriques",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Electrodes",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Bandelettes urinaires multiparamètriques",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Bandelette et lecteur corps cétoniques",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Robinet à voies",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Lunettes d'oxygènes",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Masque simple d'oxygène",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Masque à haute concentration",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Nébulisateur",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Ambu pédiatrique",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Poire pour aspiration",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Masque facial pédiatrique",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Coton",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Compresse",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Jersey",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Sparadrap",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Boîte de sécurité seringue",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Aiguille pour ponction lombaire",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Abaisse langue pediatrique et adulte",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Gant d'examen latex",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Pèse personne pediatrique et adulte",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Aspirateur de mucosités",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Ballon de ventilation pour le nouveau né avec masque",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Tensiomètre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Thermomètre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Garrot",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Plateau inox",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Microperfuseur",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Lame de Bistouri",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Ciseau",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Pince hémostatique",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Pince à disséquer",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Boîte à instrument",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Amidotrizoate sodium et meglumine",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Eugenol fl/250ml",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Pharmaéthyl fl/210g",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Oxyde de zinc",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Mercure tridistillé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Aiguille dentaire",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Anesthésique dentaire en carpule",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Pulperyl",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Rocklès solution",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Détartrine 45g",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Lamelle couvre-objet 22x22",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Fils de suture non resorbable",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Bandelette test proteine/glucose",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Boîte de pétris",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Tube pour prélèvement de sang",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Catheter voie centrale 3fr.4fr.5fr,7fr , mono et biluminaire",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Aiguille intra osseuse de Cook",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Laryngoscope avec lame F00,F0,F1,F2,F3 droite et courbe",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Aiguilles para apicales dentaires",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Aiguilles intra septales dentaires",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Aiguilles tronculaires",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Ventouse",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Catheter d'hemodialyse tunnelisé",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Catheter voie centrale",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Ultrafiltre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Dialyseur",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Aiguille de médullogramme",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Bracelet pédiatrique",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Clamp de barre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Laryngoscope à fibre optique",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Matériel de base kit PNT",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Fournitures renouvelables KIT PNT",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Crachoirs",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Cartouches de GeneXpert",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "Colorant à l'Auramine",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "extracteur d'oxygene",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "oxymétre",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "thermoflash",
    "unitPrice": 0,
    "tvaApplicable": true
  },
  {
    "categorie": "AUTRES PRODUITS DE SANTE",
    "name": "poche à urine videngeable",
    "unitPrice": 0,
    "tvaApplicable": true
  }
];

module.exports = { CATEGORIES_PHARMACIE, PRODUITS_PHARMACIE };
