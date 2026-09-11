import React, { useEffect, useState, useCallback } from 'react';
import { commerceService, newIdempotencyKey } from '../services/olympus';
import { getFeatures } from '../services/api';
import './Olympus.css';

const formatPrice = (cents, currency = 'USD') => {
  if (cents === 0) return 'Free / Name your price';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
};

const ProductCard = ({ product, onBought }) => {
  const [buying, setBuying] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [message, setMessage] = useState(null);
  // One idempotency key per purchase ATTEMPT, not per click: a retry after a
  // network error reuses the key so the server replays instead of re-charging.
  const idemKey = React.useRef(null);

  const buy = async () => {
    setBuying(true);
    setMessage(null);
    if (!idemKey.current) idemKey.current = newIdempotencyKey();
    try {
      const amountCents = product.name_your_price && customAmount !== ''
        ? Math.round(parseFloat(customAmount) * 100)
        : undefined;
      const result = await commerceService.checkout(product.id, amountCents, idemKey.current);
      idemKey.current = null; // next purchase is a new attempt
      setMessage({ ok: true, text: result.downloadToken ? 'Purchased! Download ready in your Library.' : 'Purchased!' });
      if (onBought) onBought(result);
    } catch (err) {
      // A definitive server response (e.g. 402 decline) ends the attempt; a
      // network failure keeps the key so the retry hits the replay path.
      if (err.response) idemKey.current = null;
      setMessage({ ok: false, text: err.response?.data?.error || 'Purchase failed — retry is safe' });
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="oly-card">
      <h3>{product.title}</h3>
      <div className="muted">
        {product.song_title ? `${product.song_title} — ${product.song_artist}` : product.product_type}
        {' · '}sold by {product.seller_name || 'artist'}
      </div>
      <div className="oly-price">{formatPrice(product.price_cents, product.currency)}</div>
      {product.name_your_price && (
        <input
          className="oly-input"
          type="number"
          min={((product.min_price_cents || 0) / 100).toFixed(2)}
          step="0.01"
          placeholder={`Name your price (min ${formatPrice(product.min_price_cents || 0, product.currency)})`}
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
        />
      )}
      <button className="oly-btn" onClick={buy} disabled={buying}>
        {buying ? 'Processing…' : 'Buy — artist keeps 80%'}
      </button>
      {message && <div className={`oly-msg ${message.ok ? 'ok' : 'err'}`}>{message.text}</div>}
    </div>
  );
};

const Store = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [features, setFeatures] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getFeatures()
      .then((f) => {
        if (!cancelled) setFeatures(f);
      })
      .catch(() => {
        if (!cancelled) setFeatures(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const commerceOff = features != null && features.commerce === false;
  const workerLive = features == null ? null : Boolean(features.workerLive);

  const load = useCallback(async () => {
    // dose-1.18: when FEATURE_COMMERCE is known-off, do not hit the API
    // (routes are not mounted). Same honesty pattern as Search/Radar (dose-1.14/1.17).
    if (features != null && features.commerce === false) {
      setProducts([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await commerceService.listProducts();
      setProducts(data.products || []);
    } catch (err) {
      setProducts([]);
      const status = err.response?.status;
      if (status === 404) {
        setError('Store is not available on this server (commerce feature flag off or route missing).');
      } else {
        setError(err.response?.data?.error || 'Could not load store. Try again later.');
      }
    } finally {
      setLoading(false);
    }
  }, [features]);

  useEffect(() => {
    // Wait until features resolve so we can skip the call when commerce is off.
    if (features == null) return;
    load();
  }, [load, features]);

  const emptyHint = (() => {
    if (commerceOff) {
      return 'Commerce is disabled on this server (FEATURE_COMMERCE). Store routes are not mounted.';
    }
    const parts = [
      'No products listed yet. Artists list tracks from Artist Hub when commerce is enabled.',
    ];
    if (features?.worker === false) {
      parts.push('Background worker flag is off — subscription expiry jobs will not run.');
    } else if (workerLive === false) {
      parts.push('Background job worker is not running — some commerce jobs may stall.');
    }
    return parts.join(' ');
  })();

  return (
    <div className="oly-page">
      <h1>Store</h1>
      <div className="oly-sub">Buy directly from artists — 80% of every sale goes to them.</div>

      {/* dose-1.18: explicit banner when commerce is off (match Search/Radar) */}
      {commerceOff && (
        <div className="oly-empty" style={{ marginBottom: 16 }} role="status">
          Commerce is disabled on this server (FEATURE_COMMERCE). Store routes are not mounted.
        </div>
      )}
      {workerLive === false && !commerceOff && (
        <div className="oly-empty" style={{ marginBottom: 16 }} role="status">
          Background job worker is not running — subscription expiry and some commerce jobs may
          stall until the worker is up (see Settings → Platform status).
        </div>
      )}

      {features == null || (loading && !commerceOff) ? (
        <div className="oly-empty">Loading store…</div>
      ) : commerceOff ? (
        null
      ) : error ? (
        <div className="oly-empty">{error}</div>
      ) : products.length === 0 ? (
        <div className="oly-empty">{emptyHint}</div>
      ) : (
        <div className="oly-grid">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
};

export default Store;
