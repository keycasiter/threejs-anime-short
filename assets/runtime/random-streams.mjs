/**
 * Stable non-cryptographic uint32 seeds and independent Mulberry32 cursors.
 * Every stream(id,purpose) starts a NEW cursor; retain it to draw a sequence.
 * Give persistent object IDs and separate purposes such as layout/texture/color.
 * Changing draw counts, ordering, or another purpose cannot consume this cursor.
 * Hash collisions remain possible (32 bits); unsuitable for security/unique IDs.
 */
export function createRandomStreams(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('seed must be a uint32 (unsigned 32-bit integer)');
  }

  function deriveSeed(id,purpose) {
    for (const [name,value] of [['id',id],['purpose',purpose]]) {
      if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a nonempty string`);
    }
    // FNV-1a of seed bytes and a JSON tuple of UTF-16 strings. JSON framing avoids
    // concatenation ambiguity and preserves all JS string code units, even lone
    // surrogates. Hashing both bytes of each code unit is independent of locale.
    let hash=2166136261;
    const byte=value => { hash=Math.imul(hash^(value&255),16777619)>>>0; };
    for(let shift=0;shift<32;shift+=8) byte(seed>>>shift);
    const tuple=JSON.stringify([id,purpose]);
    for(let i=0;i<tuple.length;i++) {const code=tuple.charCodeAt(i);byte(code);byte(code>>>8);}
    return hash>>>0;
  }

  function stream(id,purpose) {
    let state=deriveSeed(id,purpose);
    return () => {
      state=(state+0x6d2b79f5)>>>0;
      let value=Math.imul(state^(state>>>15),state|1);
      value^=value+Math.imul(value^(value>>>7),value|61);
      return ((value^(value>>>14))>>>0)/4294967296;
    };
  }
  return {stream,deriveSeed};
}
