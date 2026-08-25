/**
 * Commerce domain logic (Pillar 3): checkout, entitlements, download tokens,
 * fan-club subscriptions, revenue ledger.
 *
 * Named idempotency/single-use mechanisms (NFR-07):
 * - checkout: UNIQUE(buyer_user_id, idempotency_key) on purchases — a replay
 *   returns the original purchase instead of double-charging.
 * - download tokens: atomic UPDATE … WHERE consumed_at IS NULL — exactly one
 *   redeemer wins under concurrency.
 * - one active fan-club membership per (fan, artist): partial unique index.
 */

const crypto = require('crypto');
const db = require('../../config/database');
const { logger } = require('../../utils/logger');
const { getProvider } = require('./paymentProvider');
const { split } = require('./revenueSplit');

const DOWNLOAD_TOKEN_TTL_HOURS = 24 * 7;
const SUBSCRIPTION_PERIOD_DAYS = 30;

class CommerceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolve the amount a buyer must be charged for a product. Pure. Throws
 * CommerceError(400) on rule violations.
 */
function resolveChargeAmount(product, requestedCents) {
  const price = parseInt(product.price_cents, 10);
  const min = product.min_price_cents === null || product.min_price_cents === undefined
    ? 0
    : parseInt(product.min_price_cents, 10);

  if (product.name_your_price) {
    const amount = requestedCents === undefined || requestedCents === null
      ? price
      : parseInt(requestedCents, 10);
    if (!Number.isInteger(amount) || amount < 0) {
      throw new CommerceError(400, 'Invalid amount');
    }
    if (amount < min) {
      throw new CommerceError(400, `Amount below the artist's minimum (${min} cents)`);
    }
    return amount;
  }

  if (requestedCents !== undefined && requestedCents !== null && parseInt(requestedCents, 10) !== price) {
    throw new CommerceError(400, 'Amount does not match the fixed price');
  }
  return price;
}

async function writeLedgerEntries({ purchaseId = null, subscriptionId = null, artistUserId, amountCents, currency }) {
  const shares = split(amountCents);
  await db.query(
    `INSERT INTO revenue_ledger (purchase_id, subscription_id, artist_user_id, entry_type, amount_cents, currency)
     VALUES ($1, $2, $3, 'artist_share', $4, $6),
            ($1, $2, $3, 'platform_share', $5, $6)`,
    [purchaseId, subscriptionId, artistUserId, shares.artistCents, shares.platformCents, currency]
  );
  return shares;
}

async function grantLibraryEntitlement({ userId, songId, purchaseId }) {
  await db.query(
    `INSERT INTO user_library (user_id, song_id, purchase_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, song_id) DO NOTHING`,
    [userId, songId, purchaseId]
  );
}

async function issueDownloadToken({ userId, songId, purchaseId = null }) {
  const token = crypto.randomBytes(32).toString('hex');
  const result = await db.query(
    `INSERT INTO download_tokens (token, user_id, song_id, purchase_id, expires_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + ($5 || ' hours')::interval)
     RETURNING token, expires_at`,
    [token, userId, songId, purchaseId, String(DOWNLOAD_TOKEN_TTL_HOURS)]
  );
  return result.rows[0];
}

/**
 * Redeem a download token. Single-use: the conditional UPDATE consumes it
 * atomically; a second caller gets null.
 */
async function redeemDownloadToken(token) {
  const result = await db.query(
    `UPDATE download_tokens
     SET consumed_at = CURRENT_TIMESTAMP
     WHERE token = $1 AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     RETURNING *`,
    [token]
  );
  return result.rows[0] || null;
}

/**
 * Checkout: validate price rules, charge via the active provider, grant the
 * entitlement, write the 80/20 ledger. Idempotent per (buyer, idempotencyKey).
 */
async function checkout({ buyerUserId, productId, amountCents, idempotencyKey }) {
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new CommerceError(400, 'idempotencyKey is required');
  }

  const existing = await db.query(
    'SELECT * FROM purchases WHERE buyer_user_id = $1 AND idempotency_key = $2',
    [buyerUserId, idempotencyKey]
  );
  if (existing.rows.length > 0) {
    return { purchase: existing.rows[0], replayed: true };
  }

  const productResult = await db.query(
    'SELECT * FROM products WHERE id = $1 AND active = TRUE',
    [productId]
  );
  const product = productResult.rows[0];
  if (!product) throw new CommerceError(404, 'Product not found or inactive');
  if (product.artist_user_id === buyerUserId) {
    throw new CommerceError(400, 'You cannot buy your own product');
  }

  const charge = resolveChargeAmount(product, amountCents);
  const provider = getProvider();

  const inserted = await db.query(
    `INSERT INTO purchases (product_id, buyer_user_id, amount_cents, currency, status, provider, idempotency_key)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)
     ON CONFLICT (buyer_user_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [productId, buyerUserId, charge, product.currency, provider.name, idempotencyKey]
  );
  if (inserted.rows.length === 0) {
    // Concurrent replay raced us between the SELECT and the INSERT.
    const raced = await db.query(
      'SELECT * FROM purchases WHERE buyer_user_id = $1 AND idempotency_key = $2',
      [buyerUserId, idempotencyKey]
    );
    return { purchase: raced.rows[0], replayed: true };
  }
  const purchase = inserted.rows[0];

  // Zero-amount checkouts (free / name-your-price $0) skip the charge call.
  let outcome = { ok: true, providerRef: null };
  if (charge > 0) {
    outcome = await provider.createCharge({
      amountCents: charge,
      currency: product.currency,
      idempotencyKey: `purchase:${purchase.id}`,
      description: `Mangu purchase: ${product.title}`,
    });
  }

  if (!outcome.ok) {
    await db.query(
      `UPDATE purchases SET status = 'failed', provider_ref = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [purchase.id, outcome.providerRef]
    );
    throw new CommerceError(402, `Payment failed: ${outcome.error || 'declined'}`);
  }

  await db.query(
    `UPDATE purchases SET status = 'completed', provider_ref = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [purchase.id, outcome.providerRef]
  );

  const shares = await writeLedgerEntries({
    purchaseId: purchase.id,
    artistUserId: product.artist_user_id,
    amountCents: charge,
    currency: product.currency,
  });

  let downloadToken = null;
  if (product.song_id) {
    await grantLibraryEntitlement({ userId: buyerUserId, songId: product.song_id, purchaseId: purchase.id });
    downloadToken = await issueDownloadToken({
      userId: buyerUserId,
      songId: product.song_id,
      purchaseId: purchase.id,
    });
  }

  logger.info({
    action: 'purchase_completed',
    purchaseId: purchase.id,
    productId,
    buyerUserId,
    amountCents: charge,
    artistCents: shares.artistCents,
  });

  return {
    purchase: { ...purchase, status: 'completed', provider_ref: outcome.providerRef },
    amountCents: charge,
    shares,
    downloadToken,
    replayed: false,
  };
}

/** Subscribe a fan to an artist tier; charges the first period immediately. */
async function subscribe({ fanUserId, tierId }) {
  const tierResult = await db.query(
    'SELECT * FROM artist_subscription_tiers WHERE id = $1 AND active = TRUE',
    [tierId]
  );
  const tier = tierResult.rows[0];
  if (!tier) throw new CommerceError(404, 'Tier not found or inactive');
  if (tier.artist_user_id === fanUserId) {
    throw new CommerceError(400, 'You cannot subscribe to yourself');
  }

  const active = await db.query(
    `SELECT id FROM artist_subscriptions
     WHERE fan_user_id = $1 AND artist_user_id = $2 AND status = 'active'`,
    [fanUserId, tier.artist_user_id]
  );
  if (active.rows.length > 0) {
    throw new CommerceError(409, 'Already subscribed to this artist');
  }

  const provider = getProvider();
  const outcome = await provider.createCharge({
    amountCents: parseInt(tier.price_cents, 10),
    currency: tier.currency,
    idempotencyKey: `sub:${fanUserId}:${tierId}:first`,
    description: `Mangu fan club: ${tier.name}`,
  });
  if (!outcome.ok) {
    throw new CommerceError(402, `Payment failed: ${outcome.error || 'declined'}`);
  }

  let subscription;
  try {
    const inserted = await db.query(
      `INSERT INTO artist_subscriptions
         (tier_id, fan_user_id, artist_user_id, status, provider, provider_ref,
          current_period_start, current_period_end)
       VALUES ($1, $2, $3, 'active', $4, $5, CURRENT_TIMESTAMP,
               CURRENT_TIMESTAMP + ($6 || ' days')::interval)
       RETURNING *`,
      [tierId, fanUserId, tier.artist_user_id, provider.name, outcome.providerRef, String(SUBSCRIPTION_PERIOD_DAYS)]
    );
    subscription = inserted.rows[0];
  } catch (err) {
    // Partial unique index caught a concurrent double-subscribe.
    if (String(err.code) === '23505') {
      throw new CommerceError(409, 'Already subscribed to this artist');
    }
    throw err;
  }

  await writeLedgerEntries({
    subscriptionId: subscription.id,
    artistUserId: tier.artist_user_id,
    amountCents: parseInt(tier.price_cents, 10),
    currency: tier.currency,
  });

  logger.info({ action: 'subscription_created', subscriptionId: subscription.id, tierId, fanUserId });
  return { subscription, tier };
}

async function cancelSubscription({ fanUserId, subscriptionId }) {
  const result = await db.query(
    `UPDATE artist_subscriptions
     SET cancel_at_period_end = TRUE, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND fan_user_id = $2 AND status = 'active'
     RETURNING *`,
    [subscriptionId, fanUserId]
  );
  const subscription = result.rows[0];
  if (!subscription) throw new CommerceError(404, 'Active subscription not found');

  const provider = getProvider();
  try {
    await provider.cancelRecurring({ providerRef: subscription.provider_ref });
  } catch (err) {
    // Local state is authoritative; provider sync can be retried by ops.
    logger.warn(`Provider cancel failed (local cancel recorded): ${err.message}`);
  }
  return subscription;
}

/**
 * Does `userId` hold an active fan-club membership with `artistUserId`?
 * Returns the perks object or null. Powers early-access gating.
 */
async function getFanClubPerks(userId, artistUserId) {
  const result = await db.query(
    `SELECT t.perks FROM artist_subscriptions s
     JOIN artist_subscription_tiers t ON t.id = s.tier_id
     WHERE s.fan_user_id = $1 AND s.artist_user_id = $2 AND s.status = 'active'
       AND (s.current_period_end IS NULL OR s.current_period_end > CURRENT_TIMESTAMP)`,
    [userId, artistUserId]
  );
  return result.rows.length > 0 ? result.rows[0].perks : null;
}

/**
 * Early-access gate: a song with early_access_until in the future streams only
 * for its uploader and the uploader's active fan-club members (and library
 * owners, who bought it outright).
 */
async function canAccessSong(userId, song) {
  if (!song.early_access_until) return true;
  if (new Date(song.early_access_until).getTime() <= Date.now()) return true;
  if (song.uploaded_by === userId) return true;

  const owned = await db.query(
    'SELECT id FROM user_library WHERE user_id = $1 AND song_id = $2',
    [userId, song.id]
  );
  if (owned.rows.length > 0) return true;

  const perks = await getFanClubPerks(userId, song.uploaded_by);
  return perks !== null;
}

/** Artist revenue summary from the ledger. */
async function revenueSummary(artistUserId) {
  const result = await db.query(
    `SELECT entry_type, currency, COUNT(*) AS entries, COALESCE(SUM(amount_cents), 0) AS total_cents
     FROM revenue_ledger
     WHERE artist_user_id = $1 AND entry_type = 'artist_share'
     GROUP BY entry_type, currency`,
    [artistUserId]
  );
  return result.rows.map((row) => ({
    entryType: row.entry_type,
    currency: row.currency,
    entries: parseInt(row.entries, 10),
    totalCents: parseInt(row.total_cents, 10),
  }));
}

module.exports = {
  CommerceError,
  DOWNLOAD_TOKEN_TTL_HOURS,
  SUBSCRIPTION_PERIOD_DAYS,
  resolveChargeAmount,
  checkout,
  subscribe,
  cancelSubscription,
  getFanClubPerks,
  canAccessSong,
  redeemDownloadToken,
  issueDownloadToken,
  grantLibraryEntitlement,
  revenueSummary,
};
