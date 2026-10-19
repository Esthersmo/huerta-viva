// Cuenta y sincronización con Supabase.
// Los datos siguen viviendo en el dispositivo (la app funciona sin conexión); con sesión iniciada se copian a la nube
// y se mezclan con lo que haya hecho la misma persona en otros dispositivos.
// La mezcla es «a tres bandas»: se compara cada planta y cada foto con la última versión sincronizada (hv.syncBase)
// para saber qué cambió aquí, qué cambió fuera y qué se borró.
import {store, onStoreChange} from './store.js';
import {SUPABASE_URL, SUPABASE_KEY} from './cloud-config.js';

export const cloudOn = !!(SUPABASE_URL && SUPABASE_KEY);
const SYNCED = ['hv.plants', 'hv.photos', 'hv.zone', 'hv.alt', 'hv.cp'];
const BUCKET = 'fotos', AUTH_KEY = 'hv.auth';

let sb = null, user = null, askMerge = null, firstChoice = null, timer = null, running = null, again = false, applying = false, onRefresh = () => {};
let status = {state: 'off', at: null, error: null};
const subs = new Set();
export function onCloud(fn) { subs.add(fn); fn(status, user); }
function setStatus(st) { status = {...status, ...st}; subs.forEach(f => f(status, user)); }
export const currentUser = () => user;
// Al entrar por primera vez en un dispositivo que ya tiene plantas propias, la app pregunta si juntarlas con las de la cuenta
export const setMergeAsker = fn => { askMerge = fn; };

const get = (k, d) => { try { const v = store.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const put = (k, v) => store.setItem(k, JSON.stringify(v));
// Comparación que no depende del orden de las claves
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const empty = () => ({plants: {}, photos: {}, zona: null});

export async function client() {
  if (!sb) {
    const {createClient} = await import('@supabase/supabase-js');
    sb = createClient(SUPABASE_URL, SUPABASE_KEY, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: AUTH_KEY}});
  }
  return sb;
}

// Lo que hay en este dispositivo, en el formato de la nube (sin las plantas de ejemplo ni la imagen de las fotos)
function localDoc() {
  const plants = get('hv.plants', []).filter(p => !p.ej), ids = new Set(plants.map(p => p.id));
  const photos = {}, srcs = {};
  for (const [pid, list] of Object.entries(get('hv.photos', {})))
    if (ids.has(pid)) for (const x of list || []) { photos[x.id] = {plant: pid, date: x.date}; srcs[x.id] = x.src; }
  return {doc: {plants: Object.fromEntries(plants.map(p => [p.id, p])), photos, zona: {zone: get('hv.zone', null), alt: get('hv.alt', null), cp: get('hv.cp', null)}}, srcs};
}

function mergeMap(base, loc, rem, both) {
  const out = {};
  for (const k of new Set([...Object.keys(loc), ...Object.keys(rem), ...Object.keys(base)])) {
    const b = base[k], l = loc[k], r = rem[k];
    const v = same(l, b) ? r : same(r, b) ? l : (l && r && both) ? both(l, r) : (l ?? r);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
// Si la misma planta cambió en los dos sitios, gana lo de aquí, pero se juntan las tareas anotadas (la fecha más reciente)
function mergePlant(l, r) {
  const log = {...(r.log || {})};
  for (const [a, d] of Object.entries(l.log || {})) if (!log[a] || d > log[a]) log[a] = d;
  return {...r, ...l, log};
}
export function merge(base, loc, rem) {
  const first = !base; base = base || empty();
  return {
    plants: mergeMap(base.plants, loc.plants, rem.plants, mergePlant),
    photos: mergeMap(base.photos, loc.photos, rem.photos),
    // Al entrar por primera vez en un dispositivo manda la zona guardada en la nube
    zona: first ? (rem.zona || loc.zona) : (same(loc.zona, base.zona) ? rem.zona : loc.zona) || loc.zona,
  };
}

const toDataUrl = blob => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(blob); });
const path = id => `${user.id}/${id}.jpg`;

function applyLocal(m, srcs) {
  const own = Object.values(m.plants), cur = get('hv.plants', []);
  const plants = own.length ? own : cur.filter(p => p.ej);
  const photos = {};
  if (!own.length) { const old = get('hv.photos', {}); for (const p of plants) if (old[p.id]) photos[p.id] = old[p.id]; }
  for (const [id, x] of Object.entries(m.photos)) (photos[x.plant] = photos[x.plant] || []).push({id, date: x.date, src: srcs[id]});
  applying = true;
  try {
    put('hv.plants', plants); put('hv.photos', photos);
    if (m.zona) { put('hv.zone', m.zona.zone); put('hv.alt', m.zona.alt); put('hv.cp', m.zona.cp); }
  } finally { applying = false; }
  onRefresh();
}

async function syncOnce() {
  const c = await client();
  const {data: row, error} = await c.from('huertos').select('data,rev').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  const rem = {...empty(), ...(row?.data || {})};
  const saved = get('hv.syncBase', null), base = saved?.uid === user.id ? saved.doc : null;
  const local = localDoc();
  let loc = local.doc;
  if (!base && askMerge && Object.keys(loc.plants).length && Object.keys(rem.plants).length) {
    firstChoice = firstChoice || await askMerge(Object.keys(loc.plants).length, Object.keys(rem.plants).length);
    if (firstChoice === 'cuenta') loc = {...empty(), zona: rem.zona || loc.zona};
  }
  const m = merge(base, loc, rem);
  const srcs = {...local.srcs};

  // Fotos: se suben las nuevas de aquí y se bajan las nuevas de fuera
  for (const id of Object.keys(m.photos)) {
    if (srcs[id] && !rem.photos[id]) {
      const blob = await (await fetch(srcs[id])).blob();
      const {error: e} = await c.storage.from(BUCKET).upload(path(id), blob, {upsert: true, contentType: 'image/jpeg'});
      if (e) throw e;
    } else if (!srcs[id]) {
      const {data: blob, error: e} = await c.storage.from(BUCKET).download(path(id));
      if (e) throw e;
      srcs[id] = await toDataUrl(blob);
    }
  }

  const data = {v: 1, ...m};
  if (!row || !same(data, row.data)) {
    const rev = (row?.rev || 0) + 1;
    if (!row) {
      const {error: e} = await c.from('huertos').insert({user_id: user.id, data, rev});
      if (e) { if (e.code === '23505') return false; throw e; }
    } else {
      const {data: upd, error: e} = await c.from('huertos').update({data, rev, updated_at: new Date().toISOString()}).eq('user_id', user.id).eq('rev', row.rev).select('rev');
      if (e) throw e;
      if (!upd.length) return false; // Otro dispositivo guardó a la vez: se vuelve a empezar
    }
    const gone = Object.keys(rem.photos).filter(id => !m.photos[id]);
    if (gone.length) c.storage.from(BUCKET).remove(gone.map(path)).catch(() => {});
  }

  // Si se tocó algo aquí mientras tanto, no se pisa: se repite la sincronización
  if (!same(localDoc().doc, local.doc)) return false;
  if (!same(m, local.doc)) applyLocal(m, srcs);
  put('hv.syncBase', {uid: user.id, doc: m});
  firstChoice = null;
  return true;
}

export function syncNow() {
  if (!user) return Promise.resolve();
  if (running) { again = true; return running; }
  clearTimeout(timer);
  setStatus({state: 'syncing', error: null});
  running = (async () => {
    try {
      let ok = false;
      for (let i = 0; i < 4 && !ok; i++) ok = await syncOnce();
      setStatus(ok ? {state: 'ok', at: new Date()} : {state: 'error', error: 'conflict'});
    } catch (e) {
      console.warn('Sincronización', e);
      setStatus({state: navigator.onLine === false ? 'offline' : 'error', error: e?.message || String(e)});
    } finally {
      running = null;
      if (again) { again = false; schedule(500); }
    }
  })();
  return running;
}
function schedule(ms) { if (!user) return; clearTimeout(timer); timer = setTimeout(syncNow, ms); }

export async function initCloud(refresh) {
  if (!cloudOn) return;
  onRefresh = refresh || onRefresh;
  onStoreChange(k => { if (!applying && SYNCED.includes(k)) schedule(2500); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(300); });
  addEventListener('online', () => schedule(300));
  // Sin sesión guardada no hace falta cargar Supabase al abrir la app
  // (o si se vuelve de entrar con Google, que trae ?code= en la dirección)
  const back = new URLSearchParams(location.search).has('code');
  let had = back; try { had = had || !!localStorage.getItem(AUTH_KEY); } catch (e) {}
  if (!had) { setStatus({state: 'off'}); return; }
  const c = await client();
  const {data} = await c.auth.getSession();
  user = data.session?.user || null;
  if (back) { const u = new URL(location.href); u.searchParams.delete('code'); history.replaceState(null, '', u); if (user) onLogin(); }
  setStatus({state: user ? 'idle' : 'off'});
  if (user) schedule(0);
}

let onLogin = () => {};
export const setOnLogin = fn => { onLogin = fn; };
// Entrar con Google: la página va a Google y vuelve con ?code=, que initCloud recoge
export async function googleEnabled() {
  try { const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {headers: {apikey: SUPABASE_KEY}}); return !!(await r.json()).external?.google; } catch (e) { return false; }
}
export async function signInGoogle() {
  const c = await client();
  const {error} = await c.auth.signInWithOAuth({provider: 'google', options: {redirectTo: location.origin + location.pathname}});
  if (error) throw error;
}
export async function sendCode(email) {
  const c = await client();
  const {error} = await c.auth.signInWithOtp({email, options: {shouldCreateUser: true}});
  if (error) throw error;
}
export async function verifyCode(email, token) {
  const c = await client();
  const {data, error} = await c.auth.verifyOtp({email, token, type: 'email'});
  if (error) throw error;
  user = data.user;
  setStatus({state: 'idle'});
  await syncNow();
}
let beforeOut = async () => {};
export const onBeforeSignOut = fn => { beforeOut = fn; };
export async function signOut() {
  const c = await client();
  try { await beforeOut(); } catch (e) {}
  await c.auth.signOut({scope: 'local'});
  user = null; firstChoice = null; clearTimeout(timer);
  try { store.setItem('hv.syncBase', 'null'); } catch (e) {}
  setStatus({state: 'off', at: null, error: null});
}
// Borra fotos, huerto y cuenta. Lo que hay en este dispositivo se queda.
export async function deleteAccount() {
  const c = await client();
  for (;;) {
    const {data, error} = await c.storage.from(BUCKET).list(user.id, {limit: 100});
    if (error) throw error;
    if (!data.length) break;
    const {error: e} = await c.storage.from(BUCKET).remove(data.map(f => `${user.id}/${f.name}`));
    if (e) throw e;
  }
  const {error} = await c.rpc('borrar_cuenta');
  if (error) throw error;
  await signOut();
}
