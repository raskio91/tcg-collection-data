// Prezzi per condizione e lingua da CardTrader (offerte in vendita), una volta al giorno.
// Per ogni carta: prezzo "da" (mediana delle 3 offerte più economiche) per lingua + condizione (+ 1ª edizione),
// e per le gradate per ente + voto (letti dalla descrizione dell'offerta).
// Indicizzato per id prodotto Cardmarket (c) e TCGplayer (t): file ct/c/{id%128}.json e ct/t/{id%128}.json
// Uso: CARDTRADER_TOKEN=... node tools/cardtrader.mjs <cartella dati>
import fs from 'fs';
import path from 'path';
const OUT = process.argv[2] || 'data-out';
const T = process.env.CARDTRADER_TOKEN;
if (!T) { console.log('Manca CARDTRADER_TOKEN'); process.exit(1); }
const API = 'https://api.cardtrader.com/api/v2';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;
async function get(p, gap) {
  for (let i = 0; i < 5; i++) {
    let r;
    try { r = await fetch(API + p, { headers: { Authorization: 'Bearer ' + T } }); } catch (e) { await sleep(2000 * (i + 1)); continue; }
    calls++;
    if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }
    if (r.status === 404) return null;
    if (!r.ok) { console.log('HTTP', r.status, p); await sleep(2000 * (i + 1)); continue; }
    const d = await r.json();
    await sleep(gap);
    return d;
  }
  return null;
}
const B = 128;
const LANG = { it: 'it', en: 'en', jp: 'ja', fr: 'fr', de: 'de', es: 'es', pt: 'pt', kr: 'ko', 'zh-CN': 'zh', 'zh-TW': 'zt', nl: 'nl', ru: 'ru', pl: 'pl' };
const COND = { 'Near Mint': 'NM', 'Slightly Played': 'SP', 'Moderately Played': 'MP', 'Played': 'PL', 'Poor': 'PO' };
const GRADERS = { PSA: 'PSA', BGS: 'BGS', BECKETT: 'BGS', CGC: 'CGC', ACE: 'ACE', PCA: 'PCA' };
const GRX = /\b(PSA|BGS|BECKETT|CGC|ACE|PCA)\b[^0-9\]]{0,14}(10|[1-9](?:[.,][05])?)(?![0-9])/i;
function grade(desc) {
  const m = GRX.exec(String(desc || ''));
  if (!m) return null;
  let v = m[2].replace(',', '.'); if (/\.0$/.test(v)) v = v.slice(0, -2);
  return GRADERS[m[1].toUpperCase()] + '|' + v;
}
const t0 = Date.now();
const exps = ((await get('/expansions', 300)) || []).filter(e => e.game_id === 5);
console.log('espansioni', exps.length);
const acc = new Map(); // "c123" / "t456" -> { key: [prezzi] }
let bpTot = 0, offers = 0, gradedOk = 0, gradedAll = 0;
// per numero di carta: alcune carte diverse condividono lo stesso prodotto Cardmarket (es. versione holo e non holo)
const numKey = n => String(n ?? '').trim().toLowerCase().replace(/\/.*$/, '').replace(/^0+(?=\w)/, '') || '?';
const add = (ids, key, cents, num) => { for (const id of ids) { let m = acc.get(id); if (!m) acc.set(id, m = {}); const g = m[num] || (m[num] = {}); (g[key] || (g[key] = [])).push(cents); } };
for (const [n, e] of exps.entries()) {
  const bps = await get(`/blueprints/export?expansion_id=${e.id}`, 150);
  if (!Array.isArray(bps) || !bps.length) continue;
  const ids = new Map();
  for (const b of bps) {
    const k = [...(b.card_market_ids || []).map(x => 'c' + x), ...(b.tcg_player_id ? ['t' + b.tcg_player_id] : [])];
    if (k.length) ids.set(b.id, k);
  }
  bpTot += ids.size;
  if (!ids.size) continue;
  const mp = await get(`/marketplace/products?expansion_id=${e.id}`, 1050);
  if (!mp) continue;
  for (const [bid, list] of Object.entries(mp)) {
    const k = ids.get(Number(bid)); if (!k) continue;
    for (const p of list) {
      const h = p.properties_hash || {}, cents = p.price && p.price.cents;
      if (!cents || (p.price.currency && p.price.currency !== 'EUR') || h.signed || h.altered || h.pokemon_reverse || (p.bundle_size || 1) > 1) continue;
      offers++;
      const l = LANG[h.pokemon_language] || 'x';
      if (p.graded) {
        gradedAll++;
        const g = grade(p.description); if (!g) continue;
        gradedOk++; add(k, 'g|' + g, cents, numKey(h.collector_number));
        continue;
      }
      const c = COND[h.condition]; if (!c) continue;
      add(k, `${l}|${c}${h.first_edition ? '|1' : ''}`, cents, numKey(h.collector_number));
    }
  }
  if (n % 50 === 0) console.log(n, e.name, Math.round((Date.now() - t0) / 1000) + 's');
}
// prezzo "da": mediana delle 3 offerte più economiche; con il numero di offerte
const files = {};
function summarize(m) {
  const o = {};
  for (const [k, arr] of Object.entries(m)) { arr.sort((a, b) => a - b); const low = arr.slice(0, 3); o[k] = [low[Math.floor((low.length - 1) / 2)], arr.length]; }
  // una condizione peggiore non può costare più di una migliore (se la NM costa meno, conviene quella)
  const ORDER = ['NM', 'SP', 'MP', 'PL', 'PO'];
  for (const k of Object.keys(o)) {
    const [l, c, f] = k.split('|'); const i = ORDER.indexOf(c); if (l === 'g' || i <= 0) continue;
    for (let j = 0; j < i; j++) { const b = o[[l, ORDER[j], f].filter(Boolean).join('|')]; if (b && b[0] < o[k][0]) o[k] = [b[0], o[k][1]]; }
  }
  return o;
}
let split = 0;
for (const [id, byNum] of acc) {
  let nums = Object.keys(byNum);
  // offerte senza numero insieme a un solo numero: sono la stessa carta
  if (nums.includes('?') && nums.length === 2) { const n = nums.find(x => x !== '?'); for (const [k, arr] of Object.entries(byNum['?'])) (byNum[n][k] || (byNum[n][k] = [])).push(...arr); delete byNum['?']; nums = [n]; }
  let o;
  if (nums.length === 1) o = summarize(byNum[nums[0]]);
  else { o = {}; for (const n of nums) o['#' + n] = summarize(byNum[n]); split++; }
  const kind = id[0], num = Number(id.slice(1)), f = `ct/${kind}/${num % B}.json`;
  (files[f] || (files[f] = {}))[num] = o;
}
for (const kind of ['c', 't']) { const d = path.join(OUT, 'ct', kind); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
for (const [f, d] of Object.entries(files)) fs.writeFileSync(path.join(OUT, f), JSON.stringify(d));
const meta = { split, updated: new Date().toISOString(), expansions: exps.length, blueprints: bpTot, ids: acc.size, offers, graded: gradedAll, gradedRead: gradedOk, calls, seconds: Math.round((Date.now() - t0) / 1000), buckets: B };
fs.writeFileSync(path.join(OUT, 'ct', 'meta.json'), JSON.stringify(meta));
console.log(JSON.stringify(meta));
