// Shared unbiased deck index sampler; no RNG vector feature.
export class RngError extends Error {}
function rangeError(min, max) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return 'min/max must be safe integers';
  const width = max - min + 1;
  if (width < 1) return `max below min: empty range ${min}..${max}`;
  if (width > 0x1_0000_0000) return 'range width must not exceed 2^32';
  return null;
}
export function drawInRange(min, max, source = cryptoSource) {
  const error = rangeError(min, max);
  if (error) throw new RngError(error);

  const range = max - min + 1;
  if (range === 1) return min;

  const limit = Math.floor(0x1_0000_0000 / range) * range;
  let value;
  do {
    value = source();
    if (!Number.isInteger(value) || value < 0 || value >= 0x1_0000_0000) {
      throw new RngError('random source must return an unsigned 32-bit integer');
    }
  } while (value >= limit);
  return min + (value % range);
}
function cryptoSource() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0];
}
