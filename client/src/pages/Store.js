import React, { useEffect, useState } from 'react';
import { commerceService, newIdempotencyKey } from '../services/olympus';
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

  useEffect(() => {
    commerceService.listProducts()
      .then((data) => setProducts(data.products || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="oly-page">
      <h1>Store</h1>
      <div className="oly-sub">Buy directly from artists — 80% of every sale goes to them.</div>
      {loading ? (
        <div className="oly-empty">Loading store…</div>
      ) : products.length === 0 ? (
        <div className="oly-empty">No products listed yet. Artists can sell tracks from their dashboard.</div>
      ) : (
        <div className="oly-grid">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
};

export default Store;
