jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../config/redis', () => ({
  redisClient: { isReady: false },
  getRedisClient: jest.fn(() => null),
  connectRedis: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (req, res, next) => next(),
}));

const db = require('../config/database');
const commerceService = require('../services/commerce/commerceService');
const { CommerceError, resolveChargeAmount } = commerceService;
const { MOCK_DECLINE_CENTS } = require('../services/commerce/paymentProvider');

describe('resolveChargeAmount (pricing rules)', () => {
  const fixed = { price_cents: 1000, min_price_cents: null, name_your_price: false };
  const nyp = { price_cents: 1000, min_price_cents: 300, name_your_price: true };
  const free = { price_cents: 0, min_price_cents: 0, name_your_price: true };

  it('fixed price: charges the listed price when amount omitted', () => {
    expect(resolveChargeAmount(fixed, undefined)).toBe(1000);
    expect(resolveChargeAmount(fixed, 1000)).toBe(1000);
  });

  it('fixed price: rejects a mismatched amount', () => {
    expect(() => resolveChargeAmount(fixed, 500)).toThrow(CommerceError);
    expect(() => resolveChargeAmount(fixed, 1500)).toThrow('fixed price');
  });

  it('name-your-price: accepts >= minimum, defaults to suggested', () => {
    expect(resolveChargeAmount(nyp, 300)).toBe(300);
    expect(resolveChargeAmount(nyp, 5000)).toBe(5000);
    expect(resolveChargeAmount(nyp, undefined)).toBe(1000);
  });

  it('name-your-price: rejects below-minimum and negative amounts', () => {
    expect(() => resolveChargeAmount(nyp, 299)).toThrow('minimum');
    expect(() => resolveChargeAmount(nyp, -1)).toThrow(CommerceError);
  });

  it('allows $0 when the artist set a zero minimum', () => {
    expect(resolveChargeAmount(free, 0)).toBe(0);
  });
});

describe('checkout', () => {
  beforeEach(() => jest.clearAllMocks());

  const product = {
    id: 10,
    artist_user_id: 7,
    song_id: 42,
    title: 'Test Track',
    price_cents: 1000,
    min_price_cents: null,
    name_your_price: false,
    currency: 'USD',
  };

  function mockCheckoutDb({ existingPurchase = [], productRows = [product] } = {}) {
    const calls = [];
    db.query.mockImplementation((sql, params) => {
      calls.push([sql, params]);
      if (sql.includes('SELECT * FROM purchases')) return Promise.resolve({ rows: existingPurchase });
      if (sql.includes('SELECT * FROM products')) return Promise.resolve({ rows: productRows });
      if (sql.includes('INSERT INTO purchases')) {
        return Promise.resolve({ rows: [{ id: 501, product_id: 10, buyer_user_id: 1, amount_cents: params[2], status: 'pending' }] });
      }
      if (sql.includes('INSERT INTO download_tokens')) {
        return Promise.resolve({ rows: [{ token: 'a'.repeat(64), expires_at: new Date().toISOString() }] });
      }
      return Promise.resolve({ rows: [] });
    });
    return calls;
  }

  it('completes a purchase: charge, 80/20 ledger, library grant, download token', async () => {
    const calls = mockCheckoutDb();

    const result = await commerceService.checkout({
      buyerUserId: 1,
      productId: 10,
      idempotencyKey: 'key-12345678',
    });

    expect(result.replayed).toBe(false);
    expect(result.purchase.status).toBe('completed');
    expect(result.shares).toEqual({ artistCents: 800, platformCents: 200 });
    expect(result.downloadToken.token).toHaveLength(64);

    const ledger = calls.find(([sql]) => sql.includes('INSERT INTO revenue_ledger'));
    expect(ledger).toBeTruthy();
    expect(ledger[1]).toEqual(expect.arrayContaining([800, 200, 'USD']));

    const grant = calls.find(([sql]) => sql.includes('INSERT INTO user_library'));
    expect(grant[1]).toEqual([1, 42, 501]);
  });

  it('replays idempotently instead of double-charging', async () => {
    mockCheckoutDb({ existingPurchase: [{ id: 500, status: 'completed' }] });

    const result = await commerceService.checkout({
      buyerUserId: 1,
      productId: 10,
      idempotencyKey: 'key-12345678',
    });

    expect(result.replayed).toBe(true);
    expect(result.purchase.id).toBe(500);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO purchases'))).toBe(false);
  });

  it('marks the purchase failed on a decline and surfaces 402', async () => {
    const declineProduct = { ...product, price_cents: MOCK_DECLINE_CENTS };
    const calls = mockCheckoutDb({ productRows: [declineProduct] });

    await expect(
      commerceService.checkout({ buyerUserId: 1, productId: 10, idempotencyKey: 'key-12345678' })
    ).rejects.toMatchObject({ status: 402 });

    const failUpdate = calls.find(([sql]) => sql.includes(`status = 'failed'`));
    expect(failUpdate).toBeTruthy();
    expect(calls.some(([sql]) => sql.includes('INSERT INTO revenue_ledger'))).toBe(false);
  });

  it('refuses to buy your own product', async () => {
    mockCheckoutDb();
    await expect(
      commerceService.checkout({ buyerUserId: 7, productId: 10, idempotencyKey: 'key-12345678' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('requires an idempotency key', async () => {
    await expect(
      commerceService.checkout({ buyerUserId: 1, productId: 10 })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('skips the provider charge entirely for $0 checkouts', async () => {
    const freeProduct = { ...product, price_cents: 0, min_price_cents: 0, name_your_price: true };
    const calls = mockCheckoutDb({ productRows: [freeProduct] });

    const result = await commerceService.checkout({
      buyerUserId: 1,
      productId: 10,
      amountCents: 0,
      idempotencyKey: 'key-12345678',
    });

    expect(result.purchase.status).toBe('completed');
    expect(result.shares).toEqual({ artistCents: 0, platformCents: 0 });
    // ledger still records the $0 sale for attribution
    expect(calls.some(([sql]) => sql.includes('INSERT INTO revenue_ledger'))).toBe(true);
  });
});

describe('download token single use', () => {
  beforeEach(() => jest.clearAllMocks());

  it('consumes atomically via the conditional UPDATE', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ token: 'x'.repeat(64), song_id: 42 }] })
      .mockResolvedValueOnce({ rows: [] });

    const first = await commerceService.redeemDownloadToken('x'.repeat(64));
    const second = await commerceService.redeemDownloadToken('x'.repeat(64));

    expect(first.song_id).toBe(42);
    expect(second).toBeNull();
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('consumed_at IS NULL');
    expect(sql).toContain('expires_at > CURRENT_TIMESTAMP');
  });
});

describe('early-access gating (canAccessSong)', () => {
  beforeEach(() => jest.clearAllMocks());

  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();

  it('allows everyone when no early-access window is set or it expired', async () => {
    expect(await commerceService.canAccessSong(1, { id: 5, early_access_until: null, uploaded_by: 9 })).toBe(true);
    expect(await commerceService.canAccessSong(1, { id: 5, early_access_until: past, uploaded_by: 9 })).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('always allows the uploader', async () => {
    expect(await commerceService.canAccessSong(9, { id: 5, early_access_until: future, uploaded_by: 9 })).toBe(true);
  });

  it('allows library owners', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    expect(await commerceService.canAccessSong(1, { id: 5, early_access_until: future, uploaded_by: 9 })).toBe(true);
  });

  it('allows active fan-club members and blocks everyone else', async () => {
    // not in library, has active membership
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ perks: { earlyAccess: true } }] });
    expect(await commerceService.canAccessSong(1, { id: 5, early_access_until: future, uploaded_by: 9 })).toBe(true);

    // not in library, no membership
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await commerceService.canAccessSong(1, { id: 5, early_access_until: future, uploaded_by: 9 })).toBe(false);
  });
});

describe('subscribe', () => {
  beforeEach(() => jest.clearAllMocks());

  const tier = {
    id: 3,
    artist_user_id: 7,
    name: 'Inner Circle',
    price_cents: 999,
    currency: 'USD',
    perks: { earlyAccess: true },
  };

  it('charges the first period and writes the 80/20 ledger', async () => {
    const calls = [];
    db.query.mockImplementation((sql, params) => {
      calls.push([sql, params]);
      if (sql.includes('FROM artist_subscription_tiers')) return Promise.resolve({ rows: [tier] });
      if (sql.includes(`status = 'active'`) && sql.includes('SELECT id FROM artist_subscriptions')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('INSERT INTO artist_subscriptions')) {
        return Promise.resolve({ rows: [{ id: 88, tier_id: 3, fan_user_id: 1, status: 'active' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await commerceService.subscribe({ fanUserId: 1, tierId: 3 });

    expect(result.subscription.id).toBe(88);
    const ledger = calls.find(([sql]) => sql.includes('INSERT INTO revenue_ledger'));
    expect(ledger[1]).toEqual(expect.arrayContaining([799, 200]));
  });

  it('rejects double-subscribing to the same artist', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM artist_subscription_tiers')) return Promise.resolve({ rows: [tier] });
      if (sql.includes('SELECT id FROM artist_subscriptions')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });

    await expect(commerceService.subscribe({ fanUserId: 1, tierId: 3 })).rejects.toMatchObject({ status: 409 });
  });

  it('rejects subscribing to yourself', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM artist_subscription_tiers')) return Promise.resolve({ rows: [tier] });
      return Promise.resolve({ rows: [] });
    });
    await expect(commerceService.subscribe({ fanUserId: 7, tierId: 3 })).rejects.toMatchObject({ status: 400 });
  });
});
