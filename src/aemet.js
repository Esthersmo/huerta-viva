// Datos oficiales de AEMET OpenData (https://opendata.aemet.es).
// Cada usuario pega su propia clave gratuita; se guarda solo en su dispositivo.
// Las respuestas se guardan en caché para no gastar peticiones (AEMET limita las llamadas por minuto).
import {store} from './store.js';

const API = 'https://opendata.aemet.es/opendata/api';
const DAY = 864e5;

export const getKey = () => store.getItem('hv.aemetKey') || '';
export const setKey = k => store.setItem('hv.aemetKey', (k || '').trim());

function cacheGet(k, ttl) {
  try { const c = JSON.parse(store.getItem(k) || 'null'); if (c && Date.now() - c.t < ttl) return c.v; } catch (e) {}
  return undefined;
}
const cacheSet = (k, v) => { try { store.setItem(k, JSON.stringify({t: Date.now(), v})); } catch (e) {} };

// AEMET sirve parte de los datos en ISO-8859-15
async function readJSON(r) {
  const buf = await r.arrayBuffer();
  const cs = /charset=([\w-]+)/i.exec(r.headers.get('content-type') || '')?.[1];
  let txt = new TextDecoder(cs && /8859|latin/i.test(cs) ? 'iso-8859-15' : 'utf-8').decode(buf);
  if (txt.includes('�')) txt = new TextDecoder('iso-8859-15').decode(buf);
  return JSON.parse(txt);
}

export class AemetError extends Error {
  constructor(kind, msg) { super(msg); this.kind = kind; }
}

// Las peticiones a AEMET van en dos pasos: la API devuelve la dirección de los datos
async function get(path) {
  const key = getKey();
  if (!key) throw new AemetError('nokey', 'Falta la clave de AEMET');
  let r;
  try { r = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`); }
  catch (e) { throw new AemetError('net', 'No se pudo conectar con AEMET'); }
  if (r.status === 401 || r.status === 403) throw new AemetError('key', 'AEMET no acepta la clave');
  if (r.status === 429) throw new AemetError('busy', 'AEMET está saturado; vuelve a intentarlo en un minuto');
  const head = await readJSON(r);
  if (Array.isArray(head)) return head; // algunos maestros vienen directos
  if (head.estado === 401) throw new AemetError('key', 'AEMET no acepta la clave');
  if (head.estado === 429) throw new AemetError('busy', 'AEMET está saturado; vuelve a intentarlo en un minuto');
  if (!head.datos) throw new AemetError('nodata', head.descripcion || 'AEMET no tiene datos');
  let d;
  try { d = await fetch(head.datos); } catch (e) { throw new AemetError('net', 'No se pudo conectar con AEMET'); }
  if (!d.ok) throw new AemetError('nodata', 'AEMET no tiene datos');
  return readJSON(d);
}

async function cached(k, ttl, fn) {
  const c = cacheGet(k, ttl); if (c !== undefined) return c;
  const v = await fn(); cacheSet(k, v); return v;
}

// ---------- Utilidades ----------
const num = v => { if (v == null || v === '') return null; const n = +String(v).replace(',', '.'); return isNaN(n) ? null : n; };
// Coordenadas del inventario de estaciones: "364130N", "0060754W"
function dms(s) {
  const m = /^(\d+)(\d\d)(\d\d)([NSEW])$/.exec(String(s || '').trim()); if (!m) return num(s);
  const v = +m[1] + m[2] / 60 + m[3] / 3600; return /[SW]/.test(m[4]) ? -v : v;
}
export function km(a, b, c, d) {
  const R = 6371, r = x => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- Municipio y estaciones ----------
// «JEREZ DE LA FRONTERA AEROPUERTO» → «Jerez de la Frontera Aeropuerto»
const nice = n => String(n || '').toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (m, a, c) => a + c.toUpperCase()).replace(/\b(De|La|Las|Los|Del|El|Y|En)\b/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase());
async function municipio(lat, lon) {
  const list = await cached('hv.aemet.muni', 60 * DAY, async () =>
    (await get('/maestro/municipios')).map(m => [String(m.id).replace(/\D/g, '').padStart(5, '0'), m.nombre, num(m.latitud_dec), num(m.longitud_dec)])
      .filter(m => m[2] != null && m[3] != null));
  let best = null, bd = Infinity;
  for (const m of list) { const d = km(lat, lon, m[2], m[3]); if (d < bd) { bd = d; best = m; } }
  return best && {id: best[0], name: best[1]};
}
async function stations() {
  return cached('hv.aemet.est', 60 * DAY, async () =>
    (await get('/valores/climatologicos/inventarioestaciones/todasestaciones')).map(s => [s.indicativo, nice(s.nombre), dms(s.latitud), dms(s.longitud), num(s.altitud)])
      .filter(s => s[2] != null && s[3] != null));
}
const nearest = (list, lat, lon) => list.map(s => ({id: s[0], name: s[1], alt: s[4], km: km(lat, lon, s[2], s[3])})).sort((a, b) => a.km - b.km);

// ---------- Previsión de 7 días ----------
async function forecast(muni) {
  return cached('hv.aemet.prev.' + muni, 3 * 3600e3, async () => {
    const d = await get(`/prediccion/especifica/municipio/diaria/${muni}`);
    const dias = d?.[0]?.prediccion?.dia || [];
    return dias.map(x => {
      const pp = (x.probPrecipitacion || []).map(p => num(p.value)).filter(v => v != null);
      const sky = (x.estadoCielo || []).find(e => e.descripcion && (!e.periodo || e.periodo === '00-24' || e.periodo === '12-24'))?.descripcion || '';
      return {date: String(x.fecha).slice(0, 10), max: num(x.temperatura?.maxima), min: num(x.temperatura?.minima), rain: pp.length ? Math.max(...pp) : null, sky};
    }).filter(x => x.max != null || x.min != null);
  });
}

// ---------- Fechas medias de helada (normales 1991-2020 de la estación más cercana) ----------
function field(o, re) {
  const ks = Object.keys(o).filter(k => re.test(k));
  const k = ks.find(k => /_md$/.test(k)) || ks.find(k => /_mn$/.test(k)) || ks.find(k => !/_(q\d|max|min|s)$/.test(k.replace(re, ''))) || ks[0];
  return k == null ? null : num(o[k]);
}
const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// Probabilidad diaria de helada interpolada entre los centros de cada mes
function dailyFrost(monthly) {
  const mid = DIM.map((n, i) => DIM.slice(0, i).reduce((a, b) => a + b, 0) + n / 2);
  const p = [];
  for (let d = 0; d < 365; d++) {
    let i = mid.findIndex(m => m > d); if (i === -1) i = 12;
    const a = (i + 11) % 12, b = i % 12, ma = i === 0 ? mid[11] - 365 : mid[a], mb = i === 12 ? mid[0] + 365 : mid[b];
    const w = (d - ma) / (mb - ma); p.push(Math.min(1, Math.max(0, monthly[a] + (monthly[b] - monthly[a]) * w)));
  }
  return p;
}
// Día del año (0 = 1 de enero) de la fecha mediana: el día a partir del cual la probabilidad de volver a helar (o de que ya haya helado) es del 50 %
export function frostDates(monthly) {
  if (!monthly || monthly.every(v => !v)) return {none: true};
  const p = dailyFrost(monthly), L = Math.log(2);
  // Primavera: de 1 ene a 31 jul; la última helada es el último día con suma de lo que queda ≥ ln2
  let s = 0, last = null; for (let d = 211; d >= 0; d--) { s += p[d]; if (s >= L) { last = d; break; } }
  s = 0; let first = null; for (let d = 212; d < 365; d++) { s += p[d]; if (s >= L) { first = d; break; } }
  if (last == null && first == null) return {none: true};
  return {last, first, days: Math.round(monthly.reduce((a, b) => a + b, 0) * 30.4)};
}
async function normals(st) {
  return cached('hv.aemet.norm.' + st, 365 * DAY, async () => {
    const d = await get(`/valores/climatologicos/normales/estacion/${st}`);
    const rows = (Array.isArray(d) ? d : []).filter(r => +r.mes >= 1 && +r.mes <= 12).sort((a, b) => a.mes - b.mes);
    if (rows.length < 12) throw new AemetError('nodata', 'Sin normales');
    const nt = rows.map(r => field(r, /^nt_00/)), tmin = rows.map(r => field(r, /^tm_min/));
    // Días de helada al mes → probabilidad diaria; si faltan, se estima con la mínima media (desviación típica de 3 °C)
    const phi = x => 1 / (1 + Math.exp(-1.702 * x));
    const prob = nt.every(v => v != null) ? nt.map((v, i) => v / DIM[i]) : tmin.every(v => v != null) ? tmin.map(t => phi(-t / 3)) : null;
    if (!prob) throw new AemetError('nodata', 'Sin normales');
    return {prob, tmin};
  });
}

// ---------- Temperatura del suelo (estaciones cercanas que la miden) ----------
async function obs(st) {
  return cached('hv.aemet.obs.' + st, 3600e3, async () => {
    const d = await get(`/observacion/convencional/datos/estacion/${st}`);
    return (Array.isArray(d) ? d : []).map(o => ({t: o.fint, ta: num(o.ta), s5: num(o.tss5cm), s20: num(o.tss20cm)}));
  });
}

// Lo reúne todo para un punto; cada parte puede fallar sin tumbar las demás
export async function weatherFor(lat, lon, alt) {
  const out = {errors: []};
  const muni = await municipio(lat, lon);
  out.muni = muni;
  try { out.forecast = await forecast(muni.id); } catch (e) { out.errors.push(e); }
  let near = [];
  try { near = nearest(await stations(), lat, lon); } catch (e) { out.errors.push(e); }
  // Heladas: la estación con normales más cercana (prueba hasta 3)
  for (const s of near.slice(0, 3)) {
    try { const n = await normals(s.id); out.frost = {...frostDates(n.prob), station: s}; break; } catch (e) { if (e.kind !== 'nodata') { out.errors.push(e); break; } }
  }
  // Suelo: medida real si hay una estación a menos de 40 km que la tenga
  for (const s of near.filter(s => s.km <= 40).slice(0, 4)) {
    try {
      const o = await obs(s.id); const last = [...o].reverse().find(x => x.s5 != null || x.s20 != null);
      if (last) { out.soil = {t: last.s5 ?? last.s20, depth: last.s5 != null ? 5 : 20, station: s, when: last.t}; break; }
      if (!out.airMean) { const ta = o.map(x => x.ta).filter(v => v != null); if (ta.length >= 12) out.airMean = ta.reduce((a, b) => a + b, 0) / ta.length; }
    } catch (e) { if (e.kind !== 'nodata') break; }
  }
  // Estimación: a 5-10 cm el suelo sigue la media del aire de los últimos días
  if (!out.soil) {
    const f = (out.forecast || []).slice(0, 3).filter(x => x.max != null && x.min != null);
    const m = out.airMean ?? (f.length ? f.reduce((a, x) => a + (x.max + x.min) / 2, 0) / f.length : null);
    if (m != null) out.soil = {t: Math.round(m * 10) / 10, estimated: true};
  }
  return out;
}
