// Row ids that are unique across devices, so phone and PC rows never collide when they sync.
// ~ milliseconds * 1024 + random: fits safely in a JS number (< 2^53) until the 2200s.
let last = 0;
export function newId() {
  let id = Date.now() * 1024 + Math.floor(Math.random() * 1024);
  if (id <= last) id = last + 1;
  last = id;
  return id;
}

/** Stable positive integer id (< 2^53) from a string, distinct from newId()'s range. */
export function stableId(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x5bd1e995); }
  return ((h1 >>> 0) % 0x1fffff) * 0x100000000 + (h2 >>> 0) + 1; // up to ~9e15
}

