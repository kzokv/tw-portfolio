export function sweepSlidingWindowBucket(
  bucket: Map<string, number[]>,
  windowMs: number,
  now = Date.now(),
): void {
  for (const [ip, timestamps] of bucket) {
    if (timestamps.every((ts) => now - ts >= windowMs)) {
      bucket.delete(ip);
    }
  }
}
