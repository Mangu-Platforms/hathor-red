/**
 * Payment provider abstraction (DEC-003).
 *
 * - `mock` (default): deterministic in-process provider — no network, no
 *   credentials, marks every reference `mock_…` so downstream reporting can
 *   exclude simulated revenue. Declines are triggerable for tests via the
 *   reserved decline amount.
 * - `stripe`: activated only when STRIPE_SECRET_KEY is set. Talks to the
 *   Stripe REST API with native fetch (no SDK dependency); Stripe Connect
 *   payouts are the production upgrade path.
 *
 * The interface is intentionally tiny: createCharge / cancelRecurring. A
 * provider result is { ok, providerRef, error? } and never throws for a
 * decline — only for infrastructure failures.
 */

const crypto = require('crypto');
const { logger } = require('../../utils/logger');

// Reserved amount that always declines on the mock provider (tests, demos).
const MOCK_DECLINE_CENTS = 999999;

const mockProvider = {
  name: 'mock',

  async createCharge({ amountCents, currency = 'USD', idempotencyKey, description = '' }) {
    if (parseInt(amountCents, 10) === MOCK_DECLINE_CENTS) {
      return { ok: false, providerRef: null, error: 'card_declined (mock reserved amount)' };
    }
    const ref = `mock_${crypto
      .createHash('sha256')
      .update(`${idempotencyKey}:${amountCents}:${currency}:${description}`)
      .digest('hex')
      .slice(0, 24)}`;
    return { ok: true, providerRef: ref };
  },

  async cancelRecurring() {
    return { ok: true };
  },
};

function buildStripeProvider(secretKey) {
  const base = 'https://api.stripe.com/v1';

  async function stripeRequest(path, params, idempotencyKey) {
    const body = new URLSearchParams(params).toString();
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body,
    });
    const json = await response.json();
    if (!response.ok) {
      const message = json?.error?.message || `Stripe error ${response.status}`;
      return { ok: false, error: message, json };
    }
    return { ok: true, json };
  }

  return {
    name: 'stripe',

    async createCharge({ amountCents, currency = 'USD', idempotencyKey, description = '' }) {
      const result = await stripeRequest(
        '/payment_intents',
        {
          amount: String(amountCents),
          currency: currency.toLowerCase(),
          description,
          'automatic_payment_methods[enabled]': 'true',
          confirm: 'false',
        },
        idempotencyKey
      );
      if (!result.ok) return { ok: false, providerRef: null, error: result.error };
      return { ok: true, providerRef: result.json.id };
    },

    async cancelRecurring({ providerRef }) {
      if (!providerRef) return { ok: true };
      const result = await stripeRequest(`/subscriptions/${encodeURIComponent(providerRef)}`, {
        cancel_at_period_end: 'true',
      });
      return { ok: result.ok, error: result.ok ? undefined : result.error };
    },
  };
}

let cachedProvider = null;

function getProvider() {
  if (cachedProvider) return cachedProvider;
  if (process.env.STRIPE_SECRET_KEY) {
    cachedProvider = buildStripeProvider(process.env.STRIPE_SECRET_KEY);
    logger.info('Payment provider: stripe');
  } else {
    cachedProvider = mockProvider;
    logger.info('Payment provider: mock (no STRIPE_SECRET_KEY — simulated payments)');
  }
  return cachedProvider;
}

/** Test hook. */
function resetProviderForTests() {
  cachedProvider = null;
}

module.exports = {
  MOCK_DECLINE_CENTS,
  mockProvider,
  buildStripeProvider,
  getProvider,
  resetProviderForTests,
};
