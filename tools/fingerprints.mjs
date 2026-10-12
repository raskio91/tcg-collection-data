// Impronte delle immagini di tutte le carte (per riconoscerle con la fotocamera dell'app).
// Pubblica solo numeri (16 byte per carta), non le immagini.
// Incrementale: rielabora solo le immagini nuove (cache in fp/cache.json).
// Uso: node tools/fingerprints.mjs <cartella dati>   (dopo build-data.mjs)
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import './fpcore.js';
const { fingerprint } = globalThis.FPCORE;

const OUT = process.argv[2] || 'data-out';
const TDX = 'https://api.tcgdex.net/v2';
const UA = { 'User-Agent': 'collezione-pokemon/1.0 (github.com/raskio91/pokemon-collectables)' };
const LIMIT_MIN = Number(process.env.FP_MINUTES || 50); // tempo massimo per le immagini nuove (il resto il giorno dopo)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = rel => { try { return JSON.parse(fs.readFileSync(path.join(OUT, rel), 'utf8')); } catch (e) { return null; } };
const write = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(data)); };
async function getJSON(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, { headers: UA }); if (r.status === 404) return null; if (r.ok) return await r.json(); } catch (e) { /* riprova */ }
    await sleep(1500 * (i + 1));
  }
  return null;
}
async function pool(items, n, fn) { const q = items.slice(); await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }
const TP = pid => `https://tcgplayer-cdn.tcgplayer.com/product/${pid}`;
// url dell'immagine piccola, come nell'app
const small = base => (String(base).includes('tcgplayer-cdn') ? `${base}_200w.jpg` : `${base}/low.png`);

// ---- elenco carte: [regione, set, carta, immagine]
const list = { eu: [], ja: [] };
// Europa: TCGdex (inglese) + immagini TCGplayer dove TCGdex non ce l'ha + set completati/extra
const img = read('eu/img.json') || {}, fill = read('eu/fill.json') || {}, extra = read('eu/extra.json') || { sets: [] };
const series = (await getJSON(`${TDX}/en/series`)) || [];
const setIds = [];
for (const s of series) {
  if (s.id === 'tcgp') continue;
  const d = await getJSON(`${TDX}/en/series/${encodeURIComponent(s.id)}`);
  for (const st of (d && d.sets) || []) setIds.push(st.id);
}
// set solo italiani (pochi): stessi id di carta
const itSets = ((await getJSON(`${TDX}/it/sets`)) || []).map(s => s.id).filter(id => !setIds.includes(id) && !/^(A|B|P-A)\d/.test(id));
await pool([...setIds.map(id => ['en', id]), ...itSets.map(id => ['it', id])], 6, async ([l, sid]) => {
  const d = await getJSON(`${TDX}/${l}/sets/${encodeURIComponent(sid)}`);
  for (const c of (d && d.cards) || []) {
    const base = c.image || (img[c.id] ? TP(img[c.id]) : null);
    if (base) list.eu.push([sid, c.id, small(base)]);
  }
});
for (const [sid, cs] of Object.entries(fill)) for (const c of cs) if (c.image) list.eu.push([sid, c.id, small(c.image)]);
for (const s of extra.sets || []) for (const c of s.cards || []) if (c.image) list.eu.push([s.id, c.id, small(c.image)]);
// Giappone: dai file dei set
for (const s of read('jp/sets.json') || []) {
  const d = read(`jp/s/${s.id}.json`);
  for (const c of (d && d.cards) || []) if (c.image) list.ja.push([s.id, c.id, small(c.image)]);
}
console.log('carte', list.eu.length, list.ja.length);

// ---- impronte (cache per url)
const old = read('fp/cache.json') || {};
const cache = {};
const todo = [], inTodo = new Set();
for (const r of ['eu', 'ja']) for (const [, , url] of list[r]) {
  if (old[url]) cache[url] = old[url]; else if (!inTodo.has(url)) { inTodo.add(url); todo.push(url); }
}
console.log('da calcolare', todo.length);
const t0 = Date.now();
let done = 0, fail = 0;
await pool(todo, 16, async url => {
  if (Date.now() - t0 > LIMIT_MIN * 60000) return;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 404 || r.status === 403) { cache[url] = '-'; fail++; return; }
      if (!r.ok) { await sleep(1000 * (i + 1)); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const { data, info } = await sharp(buf).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      cache[url] = Buffer.from(fingerprint(data, info.width, info.height, info.channels)).toString('hex');
      done++;
      return;
    } catch (e) { await sleep(1000 * (i + 1)); }
  }
  fail++;
});
console.log('calcolate', done, 'non riuscite', fail, 'in', Math.round((Date.now() - t0) / 1000), 's');

// ---- file per l'app: fp/eu.json e fp/ja.json
for (const r of ['eu', 'ja']) {
  const sets = [], si = [], ids = [], h = [];
  const seen = new Set();
  for (const [sid, cid, url] of list[r]) {
    const x = cache[url];
    if (!x || x === '-' || seen.has(sid + '|' + cid)) continue;
    seen.add(sid + '|' + cid);
    let k = sets.indexOf(sid); if (k < 0) { k = sets.length; sets.push(sid); }
    si.push(k); ids.push(cid); h.push(x);
  }
  const hb = Buffer.from(h.join(''), 'hex');
  const sb = Buffer.alloc(si.length * 2); si.forEach((v, i) => sb.writeUInt16LE(v, i * 2));
  write(`fp/${r}.json`, { v: 1, made: new Date().toISOString(), n: ids.length, sets, si: sb.toString('base64'), ids: ids.join('|'), h: hb.toString('base64') });
  console.log(r, ids.length, 'carte con impronta su', list[r].length);
}
write('fp/cache.json', cache);
const left = todo.filter(u => !cache[u]).length;
const rep = read('report.json') || {};
rep.fingerprints = { eu: list.eu.length, ja: list.ja.length, nuove: done, nonRiuscite: fail, rimandate: left };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rep, null, 1));
