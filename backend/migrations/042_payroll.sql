-- Migration 005 : module paie / bulletins de salaire
-- À exécuter dans la console SQL Neon (copier-coller), comme les migrations précédentes.

-- 1) Paramètres fiscaux/sociaux, un jeu de valeurs par commerçant (modifiable
--    depuis la page Réglages paie, sans redéploiement).
--    ⚠️ Les valeurs par défaut ci-dessous sont un point de départ à faire
--    valider par un comptable ou sur impotsetdomaines.gouv.sn avant tout
--    usage réel — les sources en ligne se contredisent sur plusieurs points
--    (nombre de tranches IRPP, base de calcul de l'abattement).
CREATE TABLE IF NOT EXISTS payroll_settings (
  merchant_id UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,

  -- Abattement forfaitaire (frais professionnels), appliqué sur le brut
  -- annuel avant le barème IRPP.
  abattement_taux NUMERIC(5,4) NOT NULL DEFAULT 0.30,
  abattement_plafond_annuel NUMERIC(12,2) NOT NULL DEFAULT 900000,

  -- IPRES (retraite) : parts salariale et patronale, assiette éventuellement
  -- plafonnée (NULL = pas de plafond).
  ipres_taux_salarial NUMERIC(5,4) NOT NULL DEFAULT 0.056,
  ipres_taux_patronal NUMERIC(5,4) NOT NULL DEFAULT 0.084,
  ipres_plafond_mensuel NUMERIC(12,2),

  -- CSS (prestations familiales / accidents du travail) : par défaut
  -- entièrement patronale (courant au Sénégal), mais personnalisable.
  css_taux_salarial NUMERIC(5,4) NOT NULL DEFAULT 0,
  css_taux_patronal NUMERIC(5,4) NOT NULL DEFAULT 0.07,
  css_plafond_mensuel NUMERIC(12,2),

  -- CFCE : impôt patronal forfaitaire sur la masse salariale brute.
  cfce_taux NUMERIC(5,4) NOT NULL DEFAULT 0.03,

  -- Barème IRPP : tableau de tranches ANNUELLES progressives.
  -- Format : [{ "jusqua": <plafond FCFA ou null pour la dernière tranche>, "taux": <0..1> }, ...]
  bareme_irpp JSONB NOT NULL DEFAULT '[
    {"jusqua": 630000, "taux": 0},
    {"jusqua": 1500000, "taux": 0.20},
    {"jusqua": 4000000, "taux": 0.30},
    {"jusqua": null, "taux": 0.35}
  ]'::jsonb,

  -- TRIMF : montant forfaitaire mensuel selon palier de salaire brut.
  -- Format : [{ "jusqua": <plafond FCFA ou null>, "montant": <FCFA> }, ...]
  trimf_bareme JSONB NOT NULL DEFAULT '[
    {"jusqua": 50000, "montant": 0},
    {"jusqua": 100000, "montant": 300},
    {"jusqua": 200000, "montant": 600},
    {"jusqua": 300000, "montant": 1200},
    {"jusqua": 400000, "montant": 1800},
    {"jusqua": 500000, "montant": 2400},
    {"jusqua": null, "montant": 3600}
  ]'::jsonb,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) Primes/indemnités ponctuelles, par employé et par mois (saisies au
--    moment de générer le bulletin, distinctes du salaire de base fixe).
CREATE TABLE IF NOT EXISTS salary_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month VARCHAR(7) NOT NULL, -- 'YYYY-MM'
  label VARCHAR(120) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount <> 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salary_bonuses_user_month ON salary_bonuses(user_id, month);

-- 3) Bulletins générés : un snapshot figé des montants au moment de la
--    génération (le salaire de base ou les taux peuvent changer ensuite
--    sans altérer les bulletins déjà émis).
CREATE TABLE IF NOT EXISTS payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month VARCHAR(7) NOT NULL, -- 'YYYY-MM'

  base_salary NUMERIC(12,2) NOT NULL,
  bonuses_detail JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{label, amount}]
  bonuses_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_salary NUMERIC(12,2) NOT NULL, -- base_salary + bonuses_total

  ipres_salarial NUMERIC(12,2) NOT NULL,
  css_salarial NUMERIC(12,2) NOT NULL,
  revenu_imposable NUMERIC(12,2) NOT NULL,
  irpp NUMERIC(12,2) NOT NULL,
  trimf NUMERIC(12,2) NOT NULL,
  net_a_payer NUMERIC(12,2) NOT NULL,

  ipres_patronal NUMERIC(12,2) NOT NULL,
  css_patronal NUMERIC(12,2) NOT NULL,
  cfce NUMERIC(12,2) NOT NULL,
  cout_total_employeur NUMERIC(12,2) NOT NULL,

  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, month)
);
CREATE INDEX IF NOT EXISTS idx_payslips_merchant_month ON payslips(merchant_id, month);
