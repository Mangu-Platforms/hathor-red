/**
 * Revenue split math — Pillar 3's core promise: artist 80 / platform 20.
 *
 * All amounts are integer cents (NFR-04). The artist share is floored so the
 * remainder cent always lands on the platform side, and the two shares sum
 * exactly to the gross amount for every input.
 */

const ARTIST_SHARE_PCT = 80;

function split(amountCents) {
  // Number() (not parseInt) so fractional cents are rejected, never truncated.
  const amount = Number(amountCents);
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`Invalid amount for revenue split: ${amountCents}`);
  }
  const artistCents = Math.floor((amount * ARTIST_SHARE_PCT) / 100);
  return {
    artistCents,
    platformCents: amount - artistCents,
  };
}

module.exports = { ARTIST_SHARE_PCT, split };
