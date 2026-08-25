const { split, ARTIST_SHARE_PCT } = require('../services/commerce/revenueSplit');
const { mockProvider, MOCK_DECLINE_CENTS } = require('../services/commerce/paymentProvider');

describe('revenueSplit', () => {
  it('gives the artist 80%', () => {
    expect(ARTIST_SHARE_PCT).toBe(80);
    expect(split(1000)).toEqual({ artistCents: 800, platformCents: 200 });
    expect(split(999)).toEqual({ artistCents: 799, platformCents: 200 });
  });

  it('always sums exactly to the gross with no float drift (property)', () => {
    for (let amount = 0; amount <= 5000; amount += 1) {
      const { artistCents, platformCents } = split(amount);
      expect(artistCents + platformCents).toBe(amount);
      expect(Number.isInteger(artistCents)).toBe(true);
      expect(artistCents).toBeGreaterThanOrEqual(0);
    }
    // spot-check large amounts
    for (const amount of [123456789, 999999999]) {
      const { artistCents, platformCents } = split(amount);
      expect(artistCents + platformCents).toBe(amount);
    }
  });

  it('gives the remainder cent to the platform, never the artist more than 80%', () => {
    for (const amount of [1, 3, 7, 99, 101, 12345]) {
      const { artistCents } = split(amount);
      expect(artistCents).toBeLessThanOrEqual((amount * 80) / 100);
    }
  });

  it('rejects invalid amounts', () => {
    expect(() => split(-1)).toThrow();
    expect(() => split('abc')).toThrow();
    expect(() => split(1.5)).toThrow();
  });
});

describe('mock payment provider', () => {
  it('succeeds deterministically with a stable reference', async () => {
    const a = await mockProvider.createCharge({ amountCents: 500, idempotencyKey: 'k1' });
    const b = await mockProvider.createCharge({ amountCents: 500, idempotencyKey: 'k1' });
    expect(a.ok).toBe(true);
    expect(a.providerRef).toMatch(/^mock_[0-9a-f]{24}$/);
    expect(a.providerRef).toBe(b.providerRef);
  });

  it('declines the reserved decline amount without throwing', async () => {
    const result = await mockProvider.createCharge({ amountCents: MOCK_DECLINE_CENTS, idempotencyKey: 'k2' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('declined');
  });
});
