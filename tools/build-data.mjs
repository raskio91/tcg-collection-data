// Costruisce i dati aggiuntivi dell'app (una volta al giorno, su GitHub):
// - set giapponesi completi da TCGCSV (catalogo TCGplayer "Pokemon Japan"), abbinati a TCGdex dove possibile
//   (stessi codici => stesse carte salvate e prezzi Cardmarket)
// - set europei nuovi che TCGdex non ha ancora (TCGCSV "Pokemon")
// Uso: node tools/build-data.mjs <cartella di uscita>
import fs from 'fs';
import path from 'path';

const OUT = process.argv[2] || 'data-out';
const TCSV = 'https://tcgcsv.com/tcgplayer';
const TDX = 'https://api.tcgdex.net/v2';
const UA = { 'User-Agent': 'tcg-collection/1.0 (github.com/raskio91/tcg-collection-data)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let requests = 0;

async function getJSON(url, { tries = 4, gap = 120, ok404 = false } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      requests++;
      const r = await fetch(url, { headers: UA });
      if (r.status === 404 && ok404) return null;
      if (r.ok) { await sleep(gap); return await r.json(); }
    } catch (e) { /* riprova */ }
    await sleep(1500 * (i + 1));
  }
  if (ok404) return null;
  throw new Error('Impossibile scaricare ' + url);
}
const write = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(data)); };
const read = rel => { try { return JSON.parse(fs.readFileSync(path.join(OUT, rel), 'utf8')); } catch (e) { return null; } };
const ext = (p, k) => { const x = (p.extendedData || []).find(e => e.name === k); return x ? String(x.value) : ''; };
const num = s => { const m = String(s || '').match(/^\s*0*(\d+)/); return m ? Number(m[1]) : null; };
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const IMG = pid => `https://tcgplayer-cdn.tcgplayer.com/product/${pid}`;

// versioni speciali stampate con un motivo (Poké Ball, Master Ball…): le teniamo a parte come "edizioni"
const VARIANT_RX = /\s*\((poke ?ball|pokeball|monster ball|master ball|quick ball|love ball|friend ball|dusk ball|team rocket|energy symbol)(?: pattern)?\)/i;
const VARIANT_CODE = { 'poke ball': 'pb', 'pokeball': 'pb', 'monster ball': 'pb', 'master ball': 'mb', 'quick ball': 'qb', 'love ball': 'lb', 'friend ball': 'fb', 'dusk ball': 'db', 'team rocket': 'tr', 'energy symbol': 'en' };
const VARIANT_ORDER = ['pb', 'mb', 'qb', 'lb', 'fb', 'db', 'tr', 'en'];
// raggruppa le carte: base + versioni speciali (le "mirror" sono come le reverse: contano come la carta base)
function splitVariants(cs) {
  const base = cs.filter(c => !c.v || c.v === 'mirror');
  const mirrors = cs.filter(c => c.v === 'mirror');
  const vars = cs.filter(c => c.v && c.v !== 'mirror');
  // se una mirror non ha la sua carta base, la teniamo come carta normale
  const baseNums = new Set(cs.filter(c => !c.v).map(c => c.no));
  const keep = base.filter(c => !c.v || !baseNums.has(c.no));
  return { base: keep, mirrors: mirrors.filter(c => baseNums.has(c.no)), vars };
}

// carte di un gruppo TCGCSV (solo carte, niente buste o box)
async function groupCards(cat, gid) {
  const d = await getJSON(`${TCSV}/${cat}/${gid}/products`);
  const cards = [];
  for (const p of d.results || []) {
    const no = ext(p, 'Number'), rar = ext(p, 'Rarity');
    if (!no && !rar) continue;
    const raw = String(p.name || '');
    const vm = raw.match(VARIANT_RX), mirror = /\(mirror[^)]*\)/i.test(raw);
    const v = vm ? VARIANT_CODE[vm[1].toLowerCase().replace(/\s+/g, ' ')] : (mirror ? 'mirror' : null);
    const base = raw.replace(VARIANT_RX, '').replace(/\(mirror[^)]*\)/ig, '').trim();
    cards.push({ pid: p.productId, name: no ? base.replace(/\s+-\s+[^-]*$/, '').trim() || p.cleanName : (base || p.cleanName), no: no.split('/')[0].trim(), tot: no.includes('/') ? no.split('/')[1].trim() : '', r: rar, v, img: !!p.imageUrl });
  }
  return cards;
}

// epoche giapponesi (per raggruppare i set come le serie)
const ERAS = [
  ['2025-07-01', 'MEGA'], ['2022-11-01', 'Scarlatto e Violetto'], ['2019-11-01', 'Spada e Scudo'], ['2016-11-01', 'Sole e Luna'],
  ['2013-11-01', 'XY'], ['2010-09-01', 'Nero e Bianco'], ['2009-06-01', 'HeartGold SoulSilver / LEGEND'],
  ['2006-09-01', 'Diamante e Perla / Platino'], ['2004-02-01', 'PCG'], ['2002-12-01', 'ADV'], ['2001-11-01', 'Pokémon-e'],
  ['2001-07-01', 'VS / web'], ['1999-11-01', 'Neo'], ['1996-01-01', 'Originale'],
];
const eraOf = d => (ERAS.find(e => d >= e[0]) || ERAS[ERAS.length - 1])[1];

// set giapponesi vintage di TCGdex che hanno codici diversi da TCGplayer
const JA_BY_NAME = {
  PMCG1: 'Expansion Pack', PMCG2: 'Pokemon Jungle', PMCG3: 'Mystery of the Fossils', PMCG4: 'Rocket Gang',
  PMCG5: "Leaders' Stadium", PMCG6: 'Challenge from the Darkness', neo1: 'Gold, Silver, to a New World...',
  neo2: 'Crossing the Ruins...', neo3: 'Awakening Legends', neo4: 'Darkness, and to Light...', VS1: 'Pokemon VS',
  web1: 'Pokemon Web', E1: 'Base Expansion Pack', E2: 'The Town on No Map', E3: 'Wind from the Sea', E4: 'Split Earth',
  E5: 'Mysterious Mountains', ADV1: 'ADV Expansion Pack', ADV2: 'Miracle of the Desert', ADV3: 'Rulers of the Heavens',
  ADV4: 'Magma VS Aqua: Two Ambitions', ADV5: 'Undone Seal', PCG1: 'Flight of Legends', PCG2: 'Clash of the Blue Sky',
  PCG3: 'Rocket Gang Strikes Back', PCG4: 'Golden Sky, Silvery Ocean', PCG5: 'Mirage Forest', PCG6: 'Holon Research Tower',
  PCG7: 'Holon Phantom', PCG8: 'Miracle Crystal', PCG9: 'Offense and Defense of the Furthest Ends',
  L1a: 'HeartGold Collection', L1b: 'SoulSilver Collection', XY1a: 'Collection X', XY1b: 'Collection Y',
  XY5a: 'Gaia Volcano', XY5b: 'Tidal Storm', XY8a: 'Blue Shock', XY8b: 'Red Flash', XY11a: 'Fever-Burst Fighter',
  XY11b: 'Cruel Traitor',
};

async function japan() {
  const groups = (await getJSON(`${TCSV}/85/groups`)).results;
  // TCGdex giapponese: set e carte (numero -> id)
  const tdxList = (await getJSON(`${TDX}/ja/sets`, { gap: 30 })) || [];
  const tdxSets = {};
  for (const s of tdxList) {
    const d = await getJSON(`${TDX}/ja/sets/${encodeURIComponent(s.id)}`, { gap: 30, ok404: true });
    tdxSets[s.id] = { id: s.id, count: (s.cardCount && (s.cardCount.official || s.cardCount.total)) || 0, cards: (d && d.cards) || [] };
  }
  const byAb = new Map(); for (const g of groups) { const k = norm(g.abbreviation); if (k) { if (!byAb.has(k)) byAb.set(k, []); byAb.get(k).push(g); } }
  const byName = new Map();
  for (const g of groups) { byName.set(norm(g.name.replace(/^[^:]{1,12}:\s*/, '')), g); byName.set(norm(g.name), g); }

  const sets = [], search = [], matched = {}, report = { matchedSets: 0, matchedCards: 0, cards: 0 };
  const groupCardsCache = {};
  const cardsOf = async g => groupCardsCache[g.groupId] || (groupCardsCache[g.groupId] = await groupCards(85, g.groupId));

  // abbinamento set TCGdex -> gruppo TCGplayer
  for (const t of Object.values(tdxSets)) {
    let cands = JA_BY_NAME[t.id] ? [byName.get(norm(JA_BY_NAME[t.id]))].filter(Boolean) : (byAb.get(norm(t.id)) || []);
    cands = cands.filter(g => !matched[g.groupId]);
    if (!cands.length) continue;
    let best = null, bestScore = -Infinity;
    for (const g of cands) {
      const cs = await cardsOf(g);
      const nums = new Set(cs.map(c => num(c.no)).filter(n => n != null));
      const hit = t.cards.filter(c => nums.has(num(c.localId))).length;
      const score = hit * 10 - Math.abs(cs.length - (t.cards.length || t.count)) - (/deck|kit|half/i.test(g.name) ? 50 : 0);
      if (score > bestScore) { bestScore = score; best = g; }
    }
    if (best) matched[best.groupId] = t;
  }

  for (const g of groups) {
    const cs = await cardsOf(g);
    if (!cs.length) continue;
    const t = matched[g.groupId];
    const id = t ? t.id : 'tp' + g.groupId;
    const tdxByNum = new Map(); if (t) for (const c of t.cards) { const n = num(c.localId); if (n != null && !tdxByNum.has(n)) tdxByNum.set(n, c); }
    const used = new Set();
    const sp = splitVariants(cs);
    const cards = sp.base.map(c => {
      const n = num(c.no), tc = n != null ? tdxByNum.get(n) : null;
      let cid;
      if (tc && !used.has(tc.id)) { cid = tc.id; used.add(tc.id); report.matchedCards++; } else cid = `${id}-tp${c.pid}`;
      report.cards++;
      return { id: cid, localId: c.no, name: c.name, image: IMG(c.pid), r: c.r };
    }).sort((a, b) => String(a.localId).localeCompare(String(b.localId), undefined, { numeric: true }) || a.name.localeCompare(b.name));
    const official = num((cs.find(c => c.tot) || {}).tot) || 0;
    const date = (g.publishedOn || '').slice(0, 10);
    // versioni speciali: legate alla carta base con lo stesso numero
    const baseByNo = new Map(); for (const c of cards) if (!baseByNo.has(c.localId)) baseByNo.set(c.localId, c);
    const variants = {}, moved = {};
    for (const c of sp.vars) {
      const b = baseByNo.get(c.no); if (!b) continue;
      (variants[c.v] || (variants[c.v] = {}))[b.id] = c.img ? c.pid : 0;
      moved[`${id}-tp${c.pid}`] = `${b.id}@${c.v}`;
    }
    for (const c of sp.mirrors) { const b = baseByNo.get(c.no); if (b) moved[`${id}-tp${c.pid}`] = b.id; }
    const ev = {}; for (const k of VARIANT_ORDER) if (variants[k]) ev[k] = Object.keys(variants[k]).length;
    const set = { id, gid: g.groupId, name: g.abbreviation ? g.name.replace(/^[^:]{1,12}:\s*/, '') : g.name, ab: g.abbreviation || '', d: date, era: eraOf(date), n: cards.length, official };
    if (Object.keys(ev).length) set.ev = ev;
    if (t) report.matchedSets++;
    sets.push(set);
    write(`jp/s/${id}.json`, Object.assign({}, set, { cards, variants, moved }));
    for (const c of cards) search.push([id, c.id, c.name, c.localId, c.image.slice(c.image.lastIndexOf('/') + 1)]);
  }
  sets.sort((a, b) => b.d.localeCompare(a.d));
  report.variantSets = sets.filter(x => x.ev).map(x => `${x.id} ${x.name} ${JSON.stringify(x.ev)}`);
  write('jp/sets.json', sets);
  write('jp/search.json', search);
  report.sets = sets.length; report.tdxSets = Object.keys(tdxSets).length;
  report.tdxUnmatched = Object.keys(tdxSets).filter(id => !Object.values(matched).some(t => t.id === id));
  return report;
}

async function europe() {
  const groups = (await getJSON(`${TCSV}/3/groups`)).results;
  const series = (await getJSON(`${TDX}/en/series`, { gap: 30 })) || [];
  const tdxNames = new Map();
  for (const s of series) {
    const d = await getJSON(`${TDX}/en/series/${encodeURIComponent(s.id)}`, { gap: 30, ok404: true });
    for (const st of (d && d.sets) || []) tdxNames.set(norm(st.name), st.id);
  }
  const strip = n => n.replace(/^[A-Za-z0-9.\- ]{1,8}:\s*/, '');
  const recent = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  const prev = read('eu/extra.json') || { sets: [], migrate: {} };
  const out = { sets: [], migrate: prev.migrate || {} };
  for (const g of groups) {
    const date = (g.publishedOn || '').slice(0, 10);
    if (date < recent) continue;
    const key = norm(strip(g.name));
    if (tdxNames.has(key) || tdxNames.has(norm(g.name))) continue;
    if (/deck|kit|promo|exclusive|box|tin|bundle|collection|code card|jumbo|miscellaneous|products/i.test(g.name)) continue;
    const cs = (await groupCards(3, g.groupId)).filter(c => !c.v);
    if (cs.length < 30) continue;
    const id = 'tp' + g.groupId;
    const cards = cs.map(c => ({ id: `${id}-tp${c.pid}`, localId: c.no, name: c.name, image: IMG(c.pid), r: c.r, n: num(c.no) }))
      .sort((a, b) => String(a.localId).localeCompare(String(b.localId), undefined, { numeric: true }));
    out.sets.push({ id, gid: g.groupId, name: strip(g.name), d: date, n: cards.length, official: num((cs.find(c => c.tot) || {}).tot) || 0, cards });
  }
  // set che erano "extra" e ora sono su TCGdex: istruzioni per spostare le carte segnate
  for (const old of prev.sets || []) {
    if (out.sets.some(s => s.id === old.id)) continue;
    const tid = tdxNames.get(norm(old.name));
    if (!tid) continue;
    const d = await getJSON(`${TDX}/en/sets/${encodeURIComponent(tid)}`, { gap: 30, ok404: true });
    const map = {};
    const byNum = new Map(((d && d.cards) || []).map(c => [num(c.localId), c.id]));
    for (const c of old.cards) { const nid = byNum.get(c.n); if (nid) map[c.id] = nid; }
    out.migrate[old.id] = { set: tid, cards: map };
  }
  write('eu/extra.json', out);

  // carte europee senza immagine su TCGdex: immagine da TCGplayer (stesso set; stesso numero o stesso nome)
  const ALIAS = { '30th-c': '30th Celebration: Classic Collection', '30th': '30th Celebration' };
  const STOP = new Set(['the', 'and', 'pokemon', 'set', 'of', 'series', 'tcg']);
  const toks = n => new Set(String(n).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' ').split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w)));
  const sim = (a, b) => { const A = toks(a), B = toks(b); let i = 0; for (const x of A) if (B.has(x)) i++; return i / Math.max(1, Math.min(A.size, B.size)) - Math.abs(A.size - B.size) * 0.05; };
  const key = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '').replace(/([A-Z])0+(?=\d)/g, '$1');
  const cname = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
  const matchCards = (lack, cs) => {
    const byKey = new Map(), byNum = new Map(), byName = new Map(), nameOf = new Map();
    for (const c of cs.filter(x => !x.v)) {
      nameOf.set(c.pid, cname(c.name));
      const k = key(c.no); if (k && !byKey.has(k)) byKey.set(k, c.pid);
      const n = num(c.no); if (n != null && !byNum.has(n)) byNum.set(n, c.pid);
      const nm = cname(c.name); byName.set(nm, byName.has(nm) ? null : c.pid);
    }
    const out = {};
    for (const c of lack) {
      const nm = cname(c.name);
      const k = byKey.get(key(c.localId)) || byNum.get(num(c.localId));
      // il nome deve coincidere: il solo numero può indicare una carta diversa
      const pid = (k && nameOf.get(k) === nm) ? k : (byName.get(nm) || null);
      if (pid) out[c.id] = pid;
    }
    return out;
  };
  const tdxSeriesSets = [];
  for (const s of series) {
    if (s.id === 'tcgp') continue;
    const d = await getJSON(`${TDX}/en/series/${encodeURIComponent(s.id)}`, { gap: 30, ok404: true });
    for (const st of (d && d.sets) || []) tdxSeriesSets.push(st);
  }
  const img = {}, missing = {}, used = {}, fill = {}, partial = {}, empty = [];
  for (const st of tdxSeriesSets) {
    const sid = st.id;
    const d = await getJSON(`${TDX}/en/sets/${encodeURIComponent(sid)}`, { gap: 30, ok404: true });
    const tdxCards = (d && d.cards) || [];
    const expected = (st.cardCount && (st.cardCount.total || st.cardCount.official)) || 0;
    const target = ALIAS[sid] || st.name;
    const year = (String(target).match(/\b(19|20)\d\d\b/) || [])[0];
    const cands = groups.filter(g => !year || !/\b(19|20)\d\d\b/.test(g.name) || g.name.includes(year))
      .map(g => [g, sim(target, strip(g.name))]).filter(x => x[1] >= 0.75).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]);
    if (tdxCards.length < expected) partial[sid] = `${tdxCards.length}/${expected}`;
    // set senza nessuna carta su TCGdex: elenco completo da TCGplayer
    if (!tdxCards.length) {
      let bestG = null, bestDiff = Infinity, bestCs = [];
      for (const g of cands) {
        const cs = (await groupCards(3, g.groupId)).filter(c => !c.v);
        const diff = Math.abs(cs.length - expected);
        if (cs.length && diff < bestDiff) { bestDiff = diff; bestG = g; bestCs = cs; }
      }
      if (bestG && (!expected || bestDiff <= Math.max(3, expected * 0.5))) {
        fill[sid] = bestCs.map(c => ({ id: `${sid}-tp${c.pid}`, localId: c.no, name: c.name, image: IMG(c.pid), r: c.r }))
          .sort((a, b) => String(a.localId).localeCompare(String(b.localId), undefined, { numeric: true }) || a.name.localeCompare(b.name));
        used[sid] = bestG.name + ' (elenco completo)';
      } else empty.push(sid);
      continue;
    }
    const lack = tdxCards.filter(c => !c.image);
    if (!lack.length) continue;
    let best = {}, bestG = null;
    for (const g of cands) {
      const m = matchCards(lack, await groupCards(3, g.groupId));
      if (Object.keys(m).length > Object.keys(best).length) { best = m; bestG = g; }
    }
    // almeno metà delle carte abbinate, altrimenti è probabilmente il set sbagliato
    if (bestG && Object.keys(best).length >= Math.ceil(lack.length / 2)) { Object.assign(img, best); used[sid] = bestG.name; }
    const left = lack.length - (used[sid] ? Object.keys(best).length : 0);
    if (left) missing[sid] = left;
  }
  write('eu/img.json', img);
  write('eu/fill.json', fill);
  write('eu/empty.json', empty);

  // versioni speciali (Poké Ball, Master Ball…) dei set europei recenti
  const euVar = {};
  for (const g of groups.filter(x => (x.publishedOn || '') >= '2022-01-01')) {
    const cs = await groupCards(3, g.groupId);
    const vars = cs.filter(c => c.v && c.v !== 'mirror');
    if (!vars.length) continue;
    const st = tdxSeriesSets.map(x => [x, sim(strip(g.name), x.name)]).filter(x => x[1] >= 0.75).sort((a, b) => b[1] - a[1])[0];
    if (!st) continue;
    const d = await getJSON(`${TDX}/en/sets/${encodeURIComponent(st[0].id)}`, { gap: 30, ok404: true });
    const byN = new Map(); for (const c of (d && d.cards) || []) { const n = num(c.localId); if (n != null && !byN.has(n)) byN.set(n, c.id); }
    const variants = {};
    for (const c of vars) { const cid = byN.get(num(c.no)); if (cid) (variants[c.v] || (variants[c.v] = {}))[cid] = c.img ? c.pid : 0; }
    const ev = {}; for (const k of VARIANT_ORDER) if (variants[k]) ev[k] = Object.keys(variants[k]).length;
    if (Object.keys(ev).length) euVar[st[0].id] = { group: g.name, ev, variants };
  }
  write('eu/variants.json', euVar);
  return { variants: Object.fromEntries(Object.entries(euVar).map(([k, v]) => [k, v.group + ' ' + JSON.stringify(v.ev)])), filled: Object.fromEntries(Object.entries(fill).map(([k, v]) => [k, v.length])), empty, partial, extra: out.sets.map(s => `${s.name} (${s.n})`), migrate: Object.keys(out.migrate), images: Object.keys(img).length, stillMissing: missing, groupsUsed: used };
}

const report = { started: new Date().toISOString() };
report.japan = await japan();
report.europe = await europe();
report.requests = requests;
report.updated = new Date().toISOString();
write('meta.json', { updated: report.updated });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
