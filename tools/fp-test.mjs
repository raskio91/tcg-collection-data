// Prova di precisione: "foto" simulate di carte vere (luce, riflessi, sfocatura, rotazione, carta fuori riquadro)
// confrontate con tutte le impronte. Uso: node tools/fp-test.mjs <cartella dati> [numero carte]
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import './fpcore.js';
const { variants, best, fingerprint } = globalThis.FPCORE;
const OUT = process.argv[2] || 'data-out', N = Number(process.argv[3] || 300);
const read = rel => JSON.parse(fs.readFileSync(path.join(OUT, rel), 'utf8'));
const cache = read('fp/cache.json');
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const R = (a, b) => a + rnd() * (b - a);
const idx = {};
for (const r of ['eu', 'ja']) { const d = read(`fp/${r}.json`); idx[r] = { n: d.n, h: Buffer.from(d.h, 'base64'), ids: d.ids.split('|'), sets: d.sets, si: Buffer.from(d.si, 'base64') }; }
const hex2 = (h, i) => h.subarray(i * 16, i * 16 + 16).toString('hex');
// carte a caso con immagine
const pick = [];
for (const r of ['eu', 'ja']) { const d = idx[r]; for (let k = 0; k < N / 2; k++) pick.push([r, Math.floor(rnd() * d.n)]); }
const byHash = {}; for (const [u, h] of Object.entries(cache)) if (h !== '-') byHash[h] = u;
const res = { tot: 0, top1: 0, top5: 0, sameArtTop1: 0, dTrue: [], dWrong: [], ms: 0, fails: [], levels: {} };
for (const [r, i] of pick) {
  const d = idx[r], h = hex2(d.h, i), url = byHash[h]; if (!url) continue;
  let buf; try { const x = await fetch(url); if (!x.ok) continue; buf = Buffer.from(await x.arrayBuffer()); } catch (e) { continue; }
  const level = ['facile', 'medio', 'difficile'][res.tot % 3];
  const hard = level === 'difficile' ? 1 : level === 'medio' ? 0.6 : 0.25;
  // foto: sfondo 720x1100, riquadro nominale 600x838 al centro, carta spostata/scalata/ruotata un po'
  const FW = 600, FH = 838, W = 720, H = 1100, fx = (W - FW) / 2, fy = (H - FH) / 2;
  const s = 1 + R(-0.05, 0.03) * hard * 1.4, cw = Math.round(FW * s), chh = Math.round(FH * s);
  const ang = R(-3, 3) * hard;
  let card = await sharp(buf).flatten({ background: '#fff' }).resize(cw, chh, { fit: 'fill' })
    .modulate({ brightness: 1 + R(-0.3, 0.25) * hard, saturation: 1 + R(-0.3, 0.2) * hard, hue: Math.round(R(-8, 8) * hard) })
    .rotate(ang, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const meta = await sharp(card).metadata();
  const left = Math.round(fx + (FW - meta.width) / 2 + R(-0.035, 0.035) * FW * hard), top = Math.round(fy + (FH - meta.height) / 2 + R(-0.035, 0.035) * FH * hard);
  const bg = { r: Math.round(R(20, 200)), g: Math.round(R(20, 200)), b: Math.round(R(20, 200)) };
  const gx = R(0.2, 0.8) * W, gy = R(0.2, 0.8) * H, ga = R(0.15, 0.55) * hard;
  const glare = Buffer.from(`<svg width="${W}" height="${H}"><defs><radialGradient id="g"><stop offset="0" stop-color="#fff" stop-opacity="${ga}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><ellipse cx="${gx}" cy="${gy}" rx="${R(80, 220)}" ry="${R(50, 160)}" fill="url(#g)"/></svg>`);
  let photo = await sharp({ create: { width: W, height: H, channels: 3, background: bg } })
    .composite([{ input: card, left: Math.max(-200, left), top: Math.max(-200, top) }, { input: glare, left: 0, top: 0 }])
    .blur(0.3 + R(0, 1.6) * hard).jpeg({ quality: Math.round(R(60, 88)) }).toBuffer();
  const { data, info } = await sharp(photo).raw().toBuffer({ resolveWithObject: true });
  const t = Date.now();
  const qs = variants(data, info.width, info.height, info.channels, [fx, fy, fx + FW, fy + FH]);
  const top10 = best(qs, d.h, d.n, 10);
  res.ms += Date.now() - t; res.tot++;
  const L = res.levels[level] || (res.levels[level] = { tot: 0, top1: 0, top5: 0 }); L.tot++;
  const same = j => hex2(d.h, j) === h;
  if (top10[0][0] === i) { res.top1++; L.top1++; }
  if (same(top10[0][0])) res.sameArtTop1++;
  if (top10.slice(0, 5).some(([j]) => j === i || same(j))) { res.top5++; L.top5++; }
  // distanza vera (miglior variante contro la carta giusta) e migliore sbagliata (arte diversa)
  let dt = 129; for (const q of qs) { let x = 0; for (let k = 0; k < 16; k++) { let v = q[k] ^ d.h[i * 16 + k]; while (v) { x += v & 1; v >>= 1; } } dt = Math.min(dt, x); }
  const wrong = top10.find(([j]) => j !== i && !same(j));
  res.dTrue.push(dt); if (wrong) res.dWrong.push(wrong[1]);
  if (!same(top10[0][0]) && res.fails.length < 25) res.fails.push({ level, card: d.ids[i], set: d.sets[d.si.readUInt16LE(i * 2)], got: d.ids[top10[0][0]], dTrue: dt, dGot: top10[0][1] });
  if (res.tot <= 12) fs.writeFileSync(`fp-sample-${res.tot}-${level}.jpg`, photo);
}
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))]; };
const out = { cards: res.tot, top1: res.top1, sameArtTop1: res.sameArtTop1, top5: res.top5, levels: res.levels, avgMs: Math.round(res.ms / Math.max(1, res.tot)),
  dTrue: { p10: pct(res.dTrue, .1), p50: pct(res.dTrue, .5), p90: pct(res.dTrue, .9), p95: pct(res.dTrue, .95) },
  dWrong: { p5: pct(res.dWrong, .05), p10: pct(res.dWrong, .1), p50: pct(res.dWrong, .5) },
  histTrue: res.dTrue.reduce((m, x) => (m[Math.floor(x / 4) * 4] = (m[Math.floor(x / 4) * 4] || 0) + 1, m), {}),
  histWrong: res.dWrong.reduce((m, x) => (m[Math.floor(x / 4) * 4] = (m[Math.floor(x / 4) * 4] || 0) + 1, m), {}),
  fails: res.fails };
fs.writeFileSync('fp-test.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
