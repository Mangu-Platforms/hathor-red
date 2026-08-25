const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mime = require('mime-types');

const db = require('../config/database');
const { logger } = require('../utils/logger');
const { isAdmin } = require('../utils/roles');
const { resolveUploadPath } = require('../utils/uploadPath');
const commerceService = require('../services/commerce/commerceService');
const { CommerceError } = commerceService;

function handleError(res, error, context) {
  if (error instanceof CommerceError) {
    return res.status(error.status).json({ error: error.message });
  }
  logger.error(`${context}:`, error);
  return res.status(500).json({ error: 'Internal server error' });
}

/**
 * POST /api/commerce/products — create a sellable product. Track/album
 * products must reference a song the caller uploaded (or caller is admin).
 */
const createProduct = async (req, res) => {
  try {
    const { songId, productType, title, description, priceCents, minPriceCents, nameYourPrice, currency } = req.body;
    const userId = req.user.userId;

    if ((productType === 'track' || productType === 'album') && !songId) {
      return res.status(400).json({ error: 'songId is required for track/album products' });
    }

    if (songId) {
      const songResult = await db.query('SELECT uploaded_by FROM songs WHERE id = $1', [songId]);
      if (songResult.rows.length === 0) return res.status(404).json({ error: 'Song not found' });
      if (songResult.rows[0].uploaded_by !== userId && !(await isAdmin(userId))) {
        return res.status(403).json({ error: 'You can only sell songs you uploaded' });
      }
    }

    if (nameYourPrice && minPriceCents !== undefined && minPriceCents > priceCents) {
      return res.status(400).json({ error: 'Minimum price cannot exceed the suggested price' });
    }

    const result = await db.query(
      `INSERT INTO products (artist_user_id, song_id, product_type, title, description,
                             price_cents, min_price_cents, name_your_price, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId,
        songId || null,
        productType || 'track',
        title,
        description || null,
        priceCents,
        nameYourPrice ? (minPriceCents === undefined ? 0 : minPriceCents) : null,
        Boolean(nameYourPrice),
        (currency || 'USD').toUpperCase(),
      ]
    );

    logger.info({ action: 'product_created', productId: result.rows[0].id, userId });
    res.status(201).json({ product: result.rows[0] });
  } catch (error) {
    handleError(res, error, 'Create product error');
  }
};

/** GET /api/commerce/products — browse products (filter by song or artist). */
const listProducts = async (req, res) => {
  try {
    const { songId, artistId } = req.query;
    const params = [];
    let query = `
      SELECT p.*, s.title AS song_title, s.artist AS song_artist, u.display_name AS seller_name
      FROM products p
      LEFT JOIN songs s ON s.id = p.song_id
      JOIN users u ON u.id = p.artist_user_id
      WHERE p.active = TRUE`;

    if (songId) {
      params.push(parseInt(songId, 10));
      query += ` AND p.song_id = $${params.length}`;
    }
    if (artistId) {
      params.push(parseInt(artistId, 10));
      query += ` AND p.artist_user_id = $${params.length}`;
    }
    query += ' ORDER BY p.created_at DESC LIMIT 100';

    const result = await db.query(query, params);
    res.json({ products: result.rows });
  } catch (error) {
    handleError(res, error, 'List products error');
  }
};

/** PUT /api/commerce/products/:id — owner/admin updates price, status, copy. */
const updateProduct = async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    const userId = req.user.userId;

    const existing = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    if (existing.rows[0].artist_user_id !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Not your product' });
    }

    const allowed = {
      title: req.body.title,
      description: req.body.description,
      price_cents: req.body.priceCents,
      min_price_cents: req.body.minPriceCents,
      name_your_price: req.body.nameYourPrice,
      active: req.body.active,
    };

    const sets = ['updated_at = CURRENT_TIMESTAMP'];
    const params = [productId];
    for (const [column, value] of Object.entries(allowed)) {
      if (value !== undefined) {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (params.length === 1) return res.status(400).json({ error: 'No updatable fields provided' });

    const result = await db.query(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );
    res.json({ product: result.rows[0] });
  } catch (error) {
    handleError(res, error, 'Update product error');
  }
};

/** POST /api/commerce/checkout — buy a product (idempotent). */
const checkoutProduct = async (req, res) => {
  try {
    const { productId, amountCents, idempotencyKey } = req.body;
    const result = await commerceService.checkout({
      buyerUserId: req.user.userId,
      productId,
      amountCents,
      idempotencyKey,
    });

    res.status(result.replayed ? 200 : 201).json({
      message: result.replayed ? 'Purchase already processed' : 'Purchase completed',
      purchase: result.purchase,
      downloadToken: result.downloadToken || null,
    });
  } catch (error) {
    handleError(res, error, 'Checkout error');
  }
};

/** GET /api/commerce/library — the caller's owned tracks. */
const getLibrary = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT l.song_id, l.acquired_at, s.title, s.artist, s.album, s.duration, s.genre, s.cover_url
       FROM user_library l
       JOIN songs s ON s.id = l.song_id
       WHERE l.user_id = $1
       ORDER BY l.acquired_at DESC`,
      [req.user.userId]
    );
    res.json({ library: result.rows });
  } catch (error) {
    handleError(res, error, 'Get library error');
  }
};

/** POST /api/commerce/download-token — mint a fresh one-time token for an owned song. */
const requestDownloadToken = async (req, res) => {
  try {
    const { songId } = req.body;
    const userId = req.user.userId;

    const owned = await db.query(
      `SELECT 1 FROM user_library WHERE user_id = $1 AND song_id = $2
       UNION
       SELECT 1 FROM songs WHERE id = $2 AND uploaded_by = $1`,
      [userId, songId]
    );
    if (owned.rows.length === 0) {
      return res.status(403).json({ error: 'You do not own this track' });
    }

    const token = await commerceService.issueDownloadToken({ userId, songId });
    res.status(201).json({
      downloadToken: token.token,
      expiresAt: token.expires_at,
      url: `/api/commerce/download/${token.token}`,
    });
  } catch (error) {
    handleError(res, error, 'Request download token error');
  }
};

/**
 * GET /api/commerce/download/:token — redeem a one-time token and stream the
 * original file as an attachment. The token itself is the credential.
 */
const downloadByToken = async (req, res) => {
  try {
    const redeemed = await commerceService.redeemDownloadToken(req.params.token);
    if (!redeemed) {
      return res.status(410).json({ error: 'Download token invalid, expired, or already used' });
    }

    const songResult = await db.query('SELECT title, artist, file_path FROM songs WHERE id = $1', [redeemed.song_id]);
    if (songResult.rows.length === 0) return res.status(404).json({ error: 'Song not found' });
    const song = songResult.rows[0];

    const filePath = resolveUploadPath(song.file_path);
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return res.status(404).json({ error: 'Audio file missing' });
    }

    const ext = path.extname(filePath) || '.mp3';
    const safeName = `${song.artist} - ${song.title}`.replace(/[^\w\s.-]/g, '').slice(0, 120);
    res.setHeader('Content-Type', mime.lookup(filePath) || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}${ext}"`);

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    handleError(res, error, 'Download by token error');
  }
};

/** POST /api/commerce/tiers — artist creates a fan-club tier. */
const createTier = async (req, res) => {
  try {
    const { name, description, priceCents, perks } = req.body;
    const result = await db.query(
      `INSERT INTO artist_subscription_tiers (artist_user_id, name, description, price_cents, perks)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (artist_user_id, name) DO NOTHING
       RETURNING *`,
      [req.user.userId, name, description || null, priceCents, JSON.stringify(perks || {})]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'You already have a tier with this name' });
    }
    res.status(201).json({ tier: result.rows[0] });
  } catch (error) {
    handleError(res, error, 'Create tier error');
  }
};

/** GET /api/commerce/artists/:id/tiers — an artist's active tiers. */
const listTiers = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT t.*, u.display_name AS artist_name
       FROM artist_subscription_tiers t
       JOIN users u ON u.id = t.artist_user_id
       WHERE t.artist_user_id = $1 AND t.active = TRUE
       ORDER BY t.price_cents ASC`,
      [parseInt(req.params.id, 10)]
    );
    res.json({ tiers: result.rows });
  } catch (error) {
    handleError(res, error, 'List tiers error');
  }
};

/** POST /api/commerce/subscribe — join a fan-club tier. */
const subscribeTier = async (req, res) => {
  try {
    const { subscription, tier } = await commerceService.subscribe({
      fanUserId: req.user.userId,
      tierId: req.body.tierId,
    });
    res.status(201).json({
      message: `Welcome to ${tier.name}`,
      subscription,
    });
  } catch (error) {
    handleError(res, error, 'Subscribe error');
  }
};

/** POST /api/commerce/subscriptions/:id/cancel — cancel at period end. */
const cancelSubscription = async (req, res) => {
  try {
    const subscription = await commerceService.cancelSubscription({
      fanUserId: req.user.userId,
      subscriptionId: parseInt(req.params.id, 10),
    });
    res.json({ message: 'Subscription will end at the current period', subscription });
  } catch (error) {
    handleError(res, error, 'Cancel subscription error');
  }
};

/** GET /api/commerce/subscriptions — the caller's memberships. */
const mySubscriptions = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, t.name AS tier_name, t.price_cents, t.perks, u.display_name AS artist_name
       FROM artist_subscriptions s
       JOIN artist_subscription_tiers t ON t.id = s.tier_id
       JOIN users u ON u.id = s.artist_user_id
       WHERE s.fan_user_id = $1
       ORDER BY s.created_at DESC`,
      [req.user.userId]
    );
    res.json({ subscriptions: result.rows });
  } catch (error) {
    handleError(res, error, 'My subscriptions error');
  }
};

/** GET /api/commerce/revenue — the caller's artist revenue summary (80% side). */
const getRevenue = async (req, res) => {
  try {
    let artistUserId = req.user.userId;
    if (req.query.artistId && (await isAdmin(req.user.userId))) {
      artistUserId = parseInt(req.query.artistId, 10);
    }
    const summary = await commerceService.revenueSummary(artistUserId);
    const recent = await db.query(
      `SELECT r.amount_cents, r.currency, r.created_at, p.product_id, r.subscription_id
       FROM revenue_ledger r
       LEFT JOIN purchases p ON p.id = r.purchase_id
       WHERE r.artist_user_id = $1 AND r.entry_type = 'artist_share'
       ORDER BY r.created_at DESC LIMIT 50`,
      [artistUserId]
    );
    res.json({ summary, recent: recent.rows });
  } catch (error) {
    handleError(res, error, 'Get revenue error');
  }
};

/** PUT /api/commerce/songs/:id/early-access — set/clear the early-access window. */
const setEarlyAccess = async (req, res) => {
  try {
    const songId = parseInt(req.params.id, 10);
    const userId = req.user.userId;
    const { until } = req.body;

    const songResult = await db.query('SELECT uploaded_by FROM songs WHERE id = $1', [songId]);
    if (songResult.rows.length === 0) return res.status(404).json({ error: 'Song not found' });
    if (songResult.rows[0].uploaded_by !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: 'You can only manage songs you uploaded' });
    }

    const result = await db.query(
      'UPDATE songs SET early_access_until = $2 WHERE id = $1 RETURNING id, early_access_until',
      [songId, until || null]
    );
    res.json({ song: result.rows[0] });
  } catch (error) {
    handleError(res, error, 'Set early access error');
  }
};

module.exports = {
  createProduct,
  listProducts,
  updateProduct,
  checkoutProduct,
  getLibrary,
  requestDownloadToken,
  downloadByToken,
  createTier,
  listTiers,
  subscribeTier,
  cancelSubscription,
  mySubscriptions,
  getRevenue,
  setEarlyAccess,
};
