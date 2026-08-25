-- Migration 005: Creator Commerce Suite — products, purchases, library,
-- fan-club subscriptions, download tokens, revenue ledger
-- Project Olympus M2 (Pillar 3). Additive only.
--
-- Naming note: schema_v2.sql reserves `subscriptions` for platform-level
-- billing tiers, so artist fan clubs use artist_subscription_tiers /
-- artist_subscriptions here.
--
-- Money is always integer cents (NFR-04). Revenue split: artist 80 /
-- platform 20, remainder cent to the platform.

BEGIN;

-- A sellable item. song products link to a song; merch/bundle products may
-- carry external fulfillment metadata instead.
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    artist_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    product_type VARCHAR(20) NOT NULL DEFAULT 'track',  -- track | album | merch
    title VARCHAR(255) NOT NULL,
    description TEXT,
    -- Fixed price in cents. For name-your-price, price_cents is the suggested
    -- price and min_price_cents the floor (0 allowed = free/pay-what-you-want).
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    min_price_cents INTEGER CHECK (min_price_cents >= 0),
    name_your_price BOOLEAN NOT NULL DEFAULT FALSE,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_artist ON products(artist_user_id);
CREATE INDEX IF NOT EXISTS idx_products_song ON products(song_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active) WHERE active = TRUE;

-- One row per checkout. Idempotency: a client-supplied idempotency_key is
-- unique per buyer, so double-submits return the original purchase instead of
-- charging twice (named mechanism, NFR-07).
CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    buyer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    -- pending | completed | failed | refunded
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    provider VARCHAR(20) NOT NULL DEFAULT 'mock',       -- mock | stripe
    provider_ref VARCHAR(255),
    idempotency_key VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(buyer_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_purchases_buyer ON purchases(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id);

-- Permanent entitlements ("Owned-It"). One row per user+song.
CREATE TABLE IF NOT EXISTS user_library (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_user_library_user ON user_library(user_id);

-- One-time tokens for lossless original downloads. Single use is enforced by
-- the atomic conditional UPDATE ... WHERE consumed_at IS NULL (named
-- mechanism, NFR-07); expiry via expires_at.
CREATE TABLE IF NOT EXISTS download_tokens (
    id SERIAL PRIMARY KEY,
    token CHAR(64) NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_download_tokens_user ON download_tokens(user_id);

-- Fan-club tiers an artist offers (e.g. "Inner Circle" $9.99/mo).
CREATE TABLE IF NOT EXISTS artist_subscription_tiers (
    id SERIAL PRIMARY KEY,
    artist_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL CHECK (price_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    perks JSONB NOT NULL DEFAULT '{}',   -- { earlyAccess: true, merchDiscountPct: 10, ... }
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(artist_user_id, name)
);

-- A fan's membership in one artist's tier. One active membership per
-- (fan, artist) enforced by partial unique index below.
CREATE TABLE IF NOT EXISTS artist_subscriptions (
    id SERIAL PRIMARY KEY,
    tier_id INTEGER NOT NULL REFERENCES artist_subscription_tiers(id) ON DELETE CASCADE,
    fan_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- active | canceled | past_due
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    provider VARCHAR(20) NOT NULL DEFAULT 'mock',
    provider_ref VARCHAR(255),
    current_period_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    current_period_end TIMESTAMP,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_subscriptions_one_active
    ON artist_subscriptions(fan_user_id, artist_user_id)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_artist_subscriptions_artist ON artist_subscriptions(artist_user_id);

-- Double-entry-lite revenue ledger. Every completed purchase / subscription
-- period writes one artist credit and one platform credit (sum = gross).
CREATE TABLE IF NOT EXISTS revenue_ledger (
    id SERIAL PRIMARY KEY,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    subscription_id INTEGER REFERENCES artist_subscriptions(id) ON DELETE SET NULL,
    artist_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- artist_share | platform_share
    entry_type VARCHAR(20) NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_revenue_ledger_artist ON revenue_ledger(artist_user_id, created_at DESC);

-- Early access ("Inner Circle" perk): while early_access_until is in the
-- future, streaming is limited to the uploader's active fan-club members.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS early_access_until TIMESTAMP;

COMMIT;
