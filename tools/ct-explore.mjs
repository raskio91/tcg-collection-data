// Esplorazione API CardTrader (solo statistiche, niente nomi di venditori). Token dal secret CARDTRADER_TOKEN.
import fs from 'fs';
const T = process.env.CARDTRADER_TOKEN;
if (!T) { console.log('Manca il secret CARDTRADER_TOKEN'); process.exit(1); }
const API = 'https://api.cardtrader.com/api/v2';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(path) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + T } });
    if (r.status === 429) { await sleep(3000); continue; }
    const txt = await r.text();
    if (!r.ok) return { _err: r.status, _body: txt.slice(0, 200) };
    await sleep(1100);
    try { return JSON.parse(txt); } catch (e) { return { _err: 'json' }; }
  }
  return { _err: 429 };
}
const out = {};
const info = await get('/info'); out.info = info._err ? info : { ok: true, keys: Object.keys(info) };
const games = await get('/games'); out.games = (games.array || games || []).map ? (games.array || games).map(g => [g.id, g.name, g.display_name]) : games;
const gp = (games.array || games).filter(g => /pok/i.test(g.name + ' ' + g.display_name));
out.pokemonGames = gp.map(g => [g.id, g.name, g.display_name]);
const exps = await get('/expansions');
const pexp = (exps.array || exps).filter(e => gp.some(g => g.id === e.game_id));
out.expansions = { tot: pexp.length, sample: pexp.slice(0, 15).map(e => [e.id, e.game_id, e.code, e.name]), last: pexp.slice(-15).map(e => [e.id, e.game_id, e.code, e.name]) };
const want = [/151/, /surging sparks/i, /base set$/i, /terastal festival/i, /super electric breaker/i];
const pick = []; for (const rx of want) { const e = pexp.find(x => rx.test(x.name)); if (e && !pick.includes(e)) pick.push(e); }
out.picked = pick.map(e => [e.id, e.code, e.name]);
out.sets = [];
for (const e of pick) {
  const bp = await get(`/blueprints/export?expansion_id=${e.id}`);
  const bps = Array.isArray(bp) ? bp : [];
  const cards = bps.filter(b => b.category_id && b.card_market_ids !== undefined);
  const s = { exp: e.name, blueprints: bps.length, err: bp._err || null,
    sampleBlueprint: bps.slice(0, 2).map(b => ({ ...b, image_url: undefined })),
    withCM: bps.filter(b => (b.card_market_ids || []).length).length, withTP: bps.filter(b => b.tcg_player_id).length,
    categories: [...new Set(bps.map(b => b.category_id))] };
  for (const lg of [null, 'it', 'en', 'jp', 'ja']) {
    const mp = await get(`/marketplace/products?expansion_id=${e.id}${lg ? '&language=' + lg : ''}`);
    if (mp._err) { s['mp_' + lg] = mp; continue; }
    const per = Object.values(mp), all = per.flat();
    const props = {}; let graded = 0; const gradedDesc = [];
    for (const p of all) {
      for (const [k, v] of Object.entries(p.properties_hash || {})) { props[k] = props[k] || {}; props[k][String(v)] = (props[k][String(v)] || 0) + 1; }
      if (p.graded) { graded++; if (gradedDesc.length < 12) gradedDesc.push(String(p.description || '').slice(0, 80)); }
    }
    s['mp_' + (lg || 'tutte')] = { blueprintsConOfferte: per.filter(x => x.length).length, offerte: all.length, max25: per.filter(x => x.length >= 25).length,
      valuta: [...new Set(all.map(p => p.price && p.price.currency))], props, graded, gradedDesc,
      esempio: all.slice(0, 2).map(p => ({ blueprint_id: p.blueprint_id, name_en: p.name_en, price: p.price, properties_hash: p.properties_hash, graded: p.graded, quantity: p.quantity })) };
  }
  out.sets.push(s);
}
fs.writeFileSync('ct-explore.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out).slice(0, 3000));
