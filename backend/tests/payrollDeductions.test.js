const {
  RetenueError,
  normaliserRetenues,
  totauxRetenues,
  verifierAbsences,
  appliquerRetenues,
} = require('../src/utils/payrollDeductions');

describe('normaliserRetenues', () => {
  test('ignore ce qui n’est pas un tableau', () => {
    expect(normaliserRetenues(undefined)).toEqual([]);
    expect(normaliserRetenues('abc')).toEqual([]);
  });

  test('supprime les montants nuls, négatifs ou invalides', () => {
    const r = normaliserRetenues([
      { type: 'avance', label: 'Avance', amount: 0 },
      { type: 'avance', label: 'Avance', amount: -500 },
      { type: 'avance', label: 'Avance', amount: 'abc' },
      { type: 'avance', label: 'Avance', amount: 10000 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].amount).toBe(10000);
  });

  test('type inconnu => "autre", libellé vide => libellé du type', () => {
    const r = normaliserRetenues([
      { type: 'bidon', label: 'Cotisation tontine', amount: 2000 },
      { type: 'pret', label: '   ', amount: 5000 },
    ]);
    expect(r[0].type).toBe('autre');
    expect(r[1].label).toBe('Remboursement de prêt');
  });
});

describe('totauxRetenues', () => {
  test('sépare les absences (sur le brut) des autres retenues (sur le net)', () => {
    const t = totauxRetenues([
      { type: 'absence', label: 'x', amount: 20000 },
      { type: 'avance', label: 'x', amount: 30000 },
      { type: 'pret', label: 'x', amount: 10000 },
    ]);
    expect(t).toEqual({ absences: 20000, autres: 40000 });
  });
});

describe('verifierAbsences', () => {
  test('refuse des absences supérieures au salaire de base', () => {
    expect(() => verifierAbsences(100000, [{ type: 'absence', label: 'x', amount: 150000 }])).toThrow(RetenueError);
  });
  test('accepte des absences raisonnables', () => {
    expect(verifierAbsences(100000, [{ type: 'absence', label: 'x', amount: 25000 }])).toBe(25000);
  });
});

describe('appliquerRetenues', () => {
  // Résultat fictif de calculerBulletin() pour un salaire de 280 000 (300 000 - 20 000 d'absence)
  const resultat = { base_salary: 280000, gross_salary: 280000, net_a_payer: 230000, irpp: 30000 };

  test('déduit avances et prêts du net, et ne touche pas au brut', () => {
    const retenues = [
      { type: 'absence', label: 'Absence 2 jours', amount: 20000 },
      { type: 'avance', label: 'Avance', amount: 30000 },
      { type: 'pret', label: 'Prêt', amount: 10000 },
    ];
    const final = appliquerRetenues(resultat, 300000, retenues);
    expect(final.net_a_payer).toBe(190000); // 230 000 - 30 000 - 10 000
    expect(final.gross_salary).toBe(280000); // brut inchangé par les avances
    expect(final.base_salary).toBe(300000); // salaire de base contractuel restitué
    expect(final.absences_total).toBe(20000);
    expect(final.deductions_total).toBe(40000);
    expect(final.deductions_detail).toHaveLength(3);
  });

  test('sans retenue, le net est inchangé', () => {
    const final = appliquerRetenues(resultat, 280000, []);
    expect(final.net_a_payer).toBe(230000);
    expect(final.deductions_total).toBe(0);
  });

  test('refuse des retenues supérieures au net', () => {
    expect(() => appliquerRetenues(resultat, 300000, [{ type: 'avance', label: 'x', amount: 250000 }])).toThrow(RetenueError);
  });

  test('autorise des retenues égales au net (net à zéro)', () => {
    const final = appliquerRetenues(resultat, 300000, [{ type: 'avance', label: 'x', amount: 230000 }]);
    expect(final.net_a_payer).toBe(0);
  });

  test('ne modifie pas l’objet d’origine', () => {
    appliquerRetenues(resultat, 300000, [{ type: 'avance', label: 'x', amount: 1000 }]);
    expect(resultat.net_a_payer).toBe(230000);
  });
});
