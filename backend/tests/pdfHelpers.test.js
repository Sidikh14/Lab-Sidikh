const { formatMontant, COULEURS } = require('../utils/pdfHelpers');

describe('formatMontant', () => {
  test('sépare les milliers avec un espace normal (pas insécable)', () => {
    expect(formatMontant(1234567)).toBe('1 234 567');
    expect(formatMontant(1234567)).not.toMatch(/\u00a0|\u202f/);
  });

  test('arrondit à l’entier', () => {
    expect(formatMontant(1999.6)).toBe('2 000');
    expect(formatMontant(0.4)).toBe('0');
  });

  test('gère les négatifs', () => {
    expect(formatMontant(-15000)).toBe('-15 000');
  });

  test('valeurs invalides => 0', () => {
    expect(formatMontant(undefined)).toBe('0');
    expect(formatMontant(null)).toBe('0');
    expect(formatMontant('abc')).toBe('0');
  });

  test('accepte une chaîne numérique (NUMERIC Postgres)', () => {
    expect(formatMontant('12000.000')).toBe('12 000');
  });
});

describe('COULEURS', () => {
  test('expose les clés utilisées par les PDF', () => {
    expect(Object.keys(COULEURS)).toEqual(
      expect.arrayContaining(['encre', 'muted', 'mutedClair', 'bordure', 'fondAlterne'])
    );
  });
});
