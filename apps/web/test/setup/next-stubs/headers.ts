/** Stub for next/headers. */
export const cookies = () => Promise.resolve({
  get: () => undefined,
  getAll: () => [],
  has: () => false,
  set: () => {},
  delete: () => {},
});
export const headers = () => new Map();
