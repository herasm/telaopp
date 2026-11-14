'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA, 'db.json');
const MAXDB = (+process.env.MAX_DB_MB || 200) * 1048576;   // limite total do banco
const MAXROOM = +process.env.MAX_ROOM || 25;               // pessoas por sala
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
let ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
try { if (process.env.ICE_SERVERS) ICE = JSON.parse(process.env.ICE_SERVERS); } catch (e) { console.warn('ICE_SERVERS inválido, usando STUN padrão'); }

/* ---------- banco simples em memória, salvo em arquivo JSON ---------- */
const db = new Map();   // coleção -> Map(id -> dados)
let size = 0, dirty = false, timer = null;
const len = d => JSON.stringify(d).length;
const bad = k => k === '__proto__' || k === 'constructor' || k === 'prototype';
function merge(a, b) { const o = Object.assign({}, a); for (const k of Object.keys(b)) if (!bad(k)) o[k] = b[k]; return o; }
function dump() { const o = {}; for (const [c, m] of db) o[c] = Object.fromEntries(m); return o; }
function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const c of Object.keys(j)) { const m = new Map(); for (const id of Object.keys(j[c])) { m.set(id, j[c][id]); size += len(j[c][id]); } db.set(c, m); }
    console.log('Banco carregado:', db.size, 'coleções');
  } catch (e) { /* primeira execução */ }
}
function saveNow(sync) {
  timer = null; if (!dirty) return; dirty = false;
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const tmp = FILE + '.tmp', txt = JSON.stringify(dump());
    if (sync) { fs.writeFileSync(tmp, txt); fs.renameSync(tmp, FILE); }
    else fs.writeFile(tmp, txt, e => { if (!e) fs.rename(tmp, FILE, () => {}); });
  } catch (e) { console.error('Não consegui salvar o banco:', e.message); }
}
function touch(coll, id, data) {
  dirty = true; if (!timer) timer = setTimeout(() => saveNow(false), 3000);
  for (const w of wss.clients) {
    const c = w.c; if (!c) continue;
    for (const [sid, s] of c.subs) if (s.coll === coll) send(c, { t: 'chg', sid, set: data ? [{ id, data }] : [], del: data ? [] : [id] });
  }
}

/* ---------- Login opcional com Discord e Google (OAuth2) ---------- */
// Só aparece no site se o provedor estiver configurado (veja o README). Sem as variáveis, nada é mostrado.
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PROV = {
  discord: { id: process.env.DISCORD_CLIENT_ID, secret: process.env.DISCORD_CLIENT_SECRET, auth: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token', info: 'https://discord.com/api/users/@me', scope: 'identify' },
  google: { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', info: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid profile' }
};
const enabled = k => !!(PROV[k] && PROV[k].id && PROV[k].secret);
const sessions = new Map();   // sid -> { provider, pid, name, avatar, uid, exp }
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex').slice(0, 32);
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const uidOf = (k, pid) => parseInt(crypto.createHash('sha256').update(k + ':' + pid).digest('hex').slice(0, 12), 16).toString(36).padStart(8, '0').slice(0, 10);
function cookiesOf(req) { const o = {}; String(req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = c.slice(i + 1).trim(); }); return o; }
const isHttps = req => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!req.socket.encrypted;
const setCookie = (name, val, req, maxAge) => name + '=' + val + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (isHttps(req) ? '; Secure' : '');
function baseUrl(req) { return String(process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || ((isHttps(req) ? 'https' : 'http') + '://' + req.headers.host)).replace(/\/+$/, ''); }
function sessionOf(req) {
  const [sid, sg] = String(cookiesOf(req).telao_sid || '').split('.');
  if (!sid || !sg || !safeEq(sg, sign(sid))) return null;
  const s0 = sessions.get(sid); if (!s0 || s0.exp < Date.now()) { sessions.delete(sid); return null; }
  return s0;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k); }, 3600000).unref();
async function fetchAvatar(url) {   // baixa a foto da conta e guarda como data URL (a página só aceita imagens do próprio site)
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !(u.hostname === 'cdn.discordapp.com' || u.hostname.endsWith('.googleusercontent.com'))) return '';
    const r = await fetch(u.href, { signal: AbortSignal.timeout(8000) }); if (!r.ok) return '';
    const ct = String(r.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(ct)) return '';
    const b = Buffer.from(await r.arrayBuffer()); if (!b.length || b.length > 400000) return '';
    return 'data:' + ct + ';base64,' + b.toString('base64');
  } catch (e) { return ''; }
}
async function auth(req, res, p) {
  const m = /^\/auth\/(?:(me|logout)|(discord|google)(\/callback)?)$/.exec(p);
  if (!m) return json(res, 404, { error: 'not_found' });
  if (m[1] === 'me' && req.method === 'GET') {
    const s0 = sessionOf(req);
    return json(res, 200, { providers: { discord: enabled('discord'), google: enabled('google') }, user: s0 ? { provider: s0.provider, name: s0.name, uid: s0.uid, avatar: s0.avatar } : null });
  }
  if (m[1] === 'logout' && req.method === 'POST') {
    const sid = String(cookiesOf(req).telao_sid || '').split('.')[0]; if (sid) sessions.delete(sid);
    res.setHeader('Set-Cookie', setCookie('telao_sid', '', req, 0)); return json(res, 200, { ok: true });
  }
  const k = m[2];
  if (!k || req.method !== 'GET' || !enabled(k)) return json(res, 404, { error: 'not_found' });
  const redirect = baseUrl(req) + '/auth/' + k + '/callback';
  if (!m[3]) {
    const st = crypto.randomBytes(16).toString('hex');
    const q = new URLSearchParams({ client_id: PROV[k].id, redirect_uri: redirect, response_type: 'code', scope: PROV[k].scope, state: st });
    res.writeHead(302, { Location: PROV[k].auth + '?' + q, 'Set-Cookie': setCookie('telao_st', st + '.' + sign(st), req, 600), 'cache-control': 'no-store' });
    return res.end();
  }
  const url = new URL(req.url, 'http://x'), code = url.searchParams.get('code'), state = url.searchParams.get('state');
  const [sv, sg] = String(cookiesOf(req).telao_st || '').split('.');
  const clear = setCookie('telao_st', '', req, 0);
  const fail = () => { res.writeHead(302, { Location: '/?login=erro', 'Set-Cookie': clear }); res.end(); };
  if (!code || !state || !sv || !sg || state !== sv || !safeEq(sg, sign(sv))) return fail();
  try {
    const tr = await fetch(PROV[k].token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ client_id: PROV[k].id, client_secret: PROV[k].secret, grant_type: 'authorization_code', code, redirect_uri: redirect }) });
    const tj = await tr.json(); if (!tr.ok || !tj.access_token) throw new Error('token');
    const ir = await fetch(PROV[k].info, { headers: { authorization: 'Bearer ' + tj.access_token }, signal: AbortSignal.timeout(10000) });
    const ij = await ir.json(); if (!ir.ok) throw new Error('perfil');
    let pid, name, pic;
    if (k === 'discord') { pid = ij.id; name = ij.global_name || ij.username; if (ij.avatar) pic = 'https://cdn.discordapp.com/avatars/' + ij.id + '/' + ij.avatar + '.png?size=128'; }
    else { pid = ij.sub; name = ij.name || ij.given_name; pic = ij.picture; }
    if (!pid) throw new Error('perfil');
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { provider: k, pid: String(pid), name: String(name || 'Amigo').slice(0, 20), avatar: pic ? await fetchAvatar(pic) : '', uid: uidOf(k, pid), exp: Date.now() + 30 * 864e5 });
    res.writeHead(302, { Location: '/', 'Set-Cookie': [setCookie('telao_sid', sid + '.' + sign(sid), req, 30 * 86400), clear], 'cache-control': 'no-store' });
    res.end();
  } catch (e) { console.warn('login ' + k + ': falhou (' + e.message + ')'); fail(); }
}

/* ---------- IA da Capri (a chave fica só aqui, no servidor) ---------- */
const GKEY = process.env.GEMINI_API_KEY || '';
const GMODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const GTHINK = ['low', 'medium', 'high'].includes(process.env.GEMINI_THINKING) ? process.env.GEMINI_THINKING : 'low';   // nível de raciocínio nos pedidos rápidos
const hits = new Map();   // ip -> horários das últimas chamadas
let gHits = [];
function limited(ip) {
  const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < 60000);
  gHits = gHits.filter(t => now - t < 60000);
  if (a.length >= 10 || gHits.length >= 60) { hits.set(ip, a); return true; }
  a.push(now); gHits.push(now); hits.set(ip, a); return false;
}
setInterval(() => { const now = Date.now(); for (const [ip, a] of hits) if (!a.some(t => now - t < 60000)) hits.delete(ip); }, 60000).unref();
const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
function api(req, res, p) {
  if (p === '/api/ai/status' && req.method === 'GET') return json(res, 200, { enabled: !!GKEY });
  if (p !== '/api/ai' || req.method !== 'POST') return json(res, 404, { error: 'not_found' });
  if (!GKEY) return json(res, 503, { error: 'no_key' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (limited(ip)) return json(res, 429, { error: 'rate_limited' });
  let n = 0; const parts = [];
  req.on('data', c => { n += c.length; if (n > 30000) req.destroy(); else parts.push(c); });
  req.on('end', async () => {
    let body; try { body = JSON.parse(Buffer.concat(parts).toString()); } catch (e) { return json(res, 400, { error: 'bad_request' }); }
    const prompt = body && typeof body.prompt === 'string' ? body.prompt.slice(0, 12000) : '';
    if (!prompt) return json(res, 400, { error: 'bad_request' });
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 25000);
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(GMODEL) + ':generateContent', {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': GKEY },
        // Gemini 3.x: sem temperature (o padrão 1.0 é o recomendado) e com nível de raciocínio explícito.
        // maxOutputTokens inclui os tokens de raciocínio, por isso o valor é folgado.
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: body.tier === 'default' ? 'medium' : GTHINK } } })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.warn('IA: erro', r.status, (j.error && j.error.message || '').slice(0, 120)); return json(res, r.status === 429 ? 429 : 502, { error: r.status === 429 ? 'rate_limited' : 'upstream' }); }
      const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).filter(x => !x.thought).map(x => x.text || '').join('').trim();
      json(res, 200, { text });
    } catch (e) { json(res, 502, { error: 'upstream' }); }
    finally { clearTimeout(to); }
  });
}

/* ---------- servidor HTTP (arquivos estáticos) ---------- */
const server = http.createServer((req, res) => {
  let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (p.startsWith('/api/')) return api(req, res, p);
  if (p.startsWith('/auth/')) return auth(req, res, p);
  if (p === '/ice') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify({ iceServers: ICE })); }
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404'); }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(f)] || 'application/octet-stream',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': CSP, 'cache-control': p === '/index.html' ? 'no-cache' : 'public, max-age=300'
    });
    res.end(b);
  });
});

/* ---------- WebSocket: salas, presença, sinalização, banco ---------- */
const wss = new WebSocketServer({ server, maxPayload: 600 * 1024 });
const rooms = new Map();   // código -> Set(clientes)
const RC = /^[a-z0-9][a-z0-9_.-]{1,47}$/, CN = /^[A-Za-z0-9_.:@+~-]{1,80}$/, DI = /^[A-Za-z0-9_.:@+~-]{1,200}$/, TP = /^[a-z0-9_-]{1,20}$/;
const send = (c, o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); };

function bcast(room) {
  const r = rooms.get(room); if (!r) return;
  const peers = [...r].map(x => ({ id: x.id, p: x.p }));
  for (const x of r) send(x, { t: 'peers', peers });
}
function leave(c) {
  if (!c.room) return;
  const r = rooms.get(c.room), room = c.room; c.room = null; c.p = {};
  if (r) { r.delete(c); if (!r.size) rooms.delete(room); else bcast(room); }
}
function reply(c, m, ok, x) { send(c, Object.assign({ t: 'dbr', rid: m.rid, ok }, typeof x === 'string' ? { err: x } : x)); }
const cmp = (k, desc) => (a, b) => { const x = a.data && a.data[k], y = b.data && b.data[k]; return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1); };

function dbop(c, m) {
  const op = m.op, coll = m.coll;
  if (op === 'unsub') return void c.subs.delete(m.sid);
  if (typeof coll !== 'string' || !CN.test(coll)) return reply(c, m, false, 'coleção inválida');
  if (op === 'sub') {
    if (typeof m.sid !== 'number' || (c.subs.size >= 60 && !c.subs.has(m.sid))) return;
    c.subs.set(m.sid, { coll });
    let docs = [...(db.get(coll) || new Map())].map(([id, data]) => ({ id, data }));
    if (typeof m.ob === 'string') docs.sort(cmp(m.ob, m.dir === 'desc'));
    if (m.lim > 0) docs = docs.slice(0, Math.min(m.lim | 0, 500));
    return send(c, { t: 'snap', sid: m.sid, docs });
  }
  const id = op === 'add' ? crypto.randomBytes(8).toString('hex') : m.id;
  if (typeof id !== 'string' || !DI.test(id)) return reply(c, m, false, 'id inválido');
  const mp = db.get(coll);
  if (op === 'get') return mp && mp.has(id) ? reply(c, m, true, { exists: true, data: mp.get(id) }) : reply(c, m, true, { exists: false });
  if (op === 'delete') {
    if (mp && mp.has(id)) { size -= len(mp.get(id)); mp.delete(id); if (!mp.size) db.delete(coll); touch(coll, id, null); }
    return reply(c, m, true, { id });
  }
  if (op === 'set' || op === 'update' || op === 'add') {
    const d = m.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return reply(c, m, false, 'dados inválidos');
    const m2 = mp || new Map();
    const nd = op === 'update' && m2.has(id) ? merge(m2.get(id), d) : JSON.parse(JSON.stringify(d));
    const l = len(nd), old = m2.has(id) ? len(m2.get(id)) : 0;
    if (l > 300000) return reply(c, m, false, 'documento grande demais');
    if (size - old + l > MAXDB) return reply(c, m, false, 'banco cheio');
    m2.set(id, nd); db.set(coll, m2); size += l - old;
    touch(coll, id, nd);
    if (coll.startsWith('chat-') && m2.size > 2000) {   // guarda só as 2000 mensagens mais recentes de cada canal
      const old2 = [...m2].sort((a, b) => ((a[1].ts || 0) - (b[1].ts || 0))).slice(0, 200);
      for (const [oid, od] of old2) { size -= len(od); m2.delete(oid); touch(coll, oid, null); }
    }
    return reply(c, m, true, { id });
  }
  reply(c, m, false, 'operação desconhecida');
}

function handle(c, m) {
  switch (m.t) {
    case 'ping': return send(c, { t: 'pong' });
    case 'join': {
      if (typeof m.room !== 'string' || !RC.test(m.room)) return;
      leave(c);
      let r = rooms.get(m.room); if (!r) rooms.set(m.room, r = new Set());
      if (r.size >= MAXROOM) { if (!r.size) rooms.delete(m.room); return send(c, { t: 'full' }); }
      r.add(c); c.room = m.room; c.p = {}; return bcast(m.room);
    }
    case 'leave': return leave(c);
    case 'pres': {
      if (!c.room || !m.p || typeof m.p !== 'object' || Array.isArray(m.p)) return;
      const n = merge(c.p, m.p); if (len(n) > 3000) return;
      c.p = n; return bcast(c.room);
    }
    case 'emit': {
      if (!c.room || typeof m.topic !== 'string' || !TP.test(m.topic) || len(m.data) > 100000) return;
      const r = rooms.get(c.room); if (!r) return;
      for (const x of r) if (x !== c) send(x, { t: 'ev', topic: m.topic, data: m.data, peer: c.id });
      return;
    }
    case 'db': return dbop(c, m);
  }
}

wss.on('connection', ws => {
  const c = { ws, id: crypto.randomBytes(5).toString('hex'), room: null, p: {}, subs: new Map(), n: 0, alive: true };
  ws.c = c;
  const rl = setInterval(() => { c.n = 0; }, 1000);
  send(c, { t: 'id', id: c.id });
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', raw => {
    if (++c.n > 400) return ws.terminate();
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    try { handle(c, m); } catch (e) { console.error(e); }
  });
  ws.on('close', () => { clearInterval(rl); leave(c); c.subs.clear(); });
  ws.on('error', () => {});
});
setInterval(() => { for (const w of wss.clients) { if (w.c && !w.c.alive) { w.terminate(); continue; } if (w.c) w.c.alive = false; try { w.ping(); } catch (e) {} } }, 30000).unref();

load();
server.listen(PORT, () => console.log('Telão rodando na porta', PORT));
const bye = () => { saveNow(true); process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
