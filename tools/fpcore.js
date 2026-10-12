// Impronta di una carta (stesso codice nell'app e su GitHub): due "pHash" da 64 bit
//  - carta intera
//  - zona dell'illustrazione
// Funziona su pixel RGBA o RGB grezzi, senza librerie.
(function (G) {
  const N = 32, K = 8;
  // zona dell'illustrazione (frazioni della carta)
  const ART = [0.08, 0.1, 0.92, 0.48];
  // coseni per la DCT 32x32 (solo le prime K frequenze)
  const COS = new Float64Array(K * N);
  for (let u = 0; u < K; u++) for (let x = 0; x < N; x++) COS[u * N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));

  // media dei pixel di un rettangolo (coordinate in pixel, anche frazionarie) su una griglia N x N, in scala di grigi
  function gridGray(px, w, h, ch, x0, y0, x1, y1) {
    const out = new Float64Array(N * N);
    const cw = (x1 - x0) / N, chh = (y1 - y0) / N;
    for (let gy = 0; gy < N; gy++) {
      const ya = Math.max(0, Math.floor(y0 + gy * chh)), yb = Math.min(h, Math.max(ya + 1, Math.floor(y0 + (gy + 1) * chh)));
      for (let gx = 0; gx < N; gx++) {
        const xa = Math.max(0, Math.floor(x0 + gx * cw)), xb = Math.min(w, Math.max(xa + 1, Math.floor(x0 + (gx + 1) * cw)));
        let s = 0, n = 0;
        for (let y = ya; y < yb; y++) {
          let i = (y * w + xa) * ch;
          for (let x = xa; x < xb; x++, i += ch) { s += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; n++; }
        }
        out[gy * N + gx] = n ? s / n : 0;
      }
    }
    return out;
  }
  // pHash: DCT 2D, frequenze basse 8x8 senza la componente continua, soglia sulla mediana
  function phash(g, out, off) {
    const tmp = new Float64Array(K * N);
    for (let u = 0; u < K; u++) for (let y = 0; y < N; y++) { let s = 0; for (let x = 0; x < N; x++) s += g[y * N + x] * COS[u * N + x]; tmp[u * N + y] = s; }
    const c = [];
    for (let v = 0; v < K; v++) for (let u = 0; u < K; u++) { if (!u && !v) continue; let s = 0; for (let y = 0; y < N; y++) s += tmp[u * N + y] * COS[v * N + y]; c.push(s); }
    c.push(0); // 63 coefficienti + 1 bit fisso = 64
    const med = c.slice(0, 63).sort((a, b) => a - b)[31];
    for (let b = 0; b < 64; b++) if (c[b] > med) out[off + (b >> 3)] |= 1 << (b & 7);
  }
  // rect = [x0, y0, x1, y1] in pixel: dove sta la carta nell'immagine (default: tutta)
  function fingerprint(px, w, h, ch, rect) {
    const [x0, y0, x1, y1] = rect || [0, 0, w, h];
    const cw = x1 - x0, chh = y1 - y0;
    const out = new Uint8Array(16);
    phash(gridGray(px, w, h, ch, x0, y0, x1, y1), out, 0);
    phash(gridGray(px, w, h, ch, x0 + ART[0] * cw, y0 + ART[1] * chh, x0 + ART[2] * cw, y0 + ART[3] * chh), out, 8);
    return out;
  }
  const POP = new Uint8Array(256); for (let i = 1; i < 256; i++) POP[i] = POP[i >> 1] + (i & 1);
  // distanza tra un'impronta e la carta i dell'indice (h = Uint8Array con 16 byte per carta)
  function dist(q, h, i) {
    let d = 0; const o = i * 16;
    for (let k = 0; k < 16; k++) d += POP[q[k] ^ h[o + k]];
    return d;
  }
  // varianti della stessa foto spostate/ingrandite un po' (la carta non è mai perfettamente nel riquadro)
  function variants(px, w, h, ch, rect) {
    const [x0, y0, x1, y1] = rect || [0, 0, w, h];
    const cw = x1 - x0, chh = y1 - y0, out = [];
    for (const s of [1, 0.95, 0.9, 1.04]) for (const dx of [0, -0.025, 0.025]) for (const dy of [0, -0.025, 0.025]) {
      const nw = cw * s, nh = chh * s, cx = x0 + cw / 2 + dx * cw, cy = y0 + chh / 2 + dy * chh;
      out.push(fingerprint(px, w, h, ch, [cx - nw / 2, cy - nh / 2, cx + nw / 2, cy + nh / 2]));
    }
    return out;
  }
  // migliori carte: per ognuna la distanza minima tra le varianti. keep(i) filtra (es. solo un set)
  function best(qs, h, n, top = 10, keep) {
    const res = [];
    let worst = Infinity;
    for (let i = 0; i < n; i++) {
      if (keep && !keep(i)) continue;
      let d = 129;
      for (const q of qs) { const x = dist(q, h, i); if (x < d) d = x; }
      if (res.length < top || d < worst) {
        res.push([i, d]); res.sort((a, b) => a[1] - b[1]);
        if (res.length > top) res.pop();
        worst = res[res.length - 1][1];
      }
    }
    return res;
  }
  G.FPCORE = { fingerprint, variants, best, dist, ART };
})(typeof globalThis !== 'undefined' ? globalThis : window);
