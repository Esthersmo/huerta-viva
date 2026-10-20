// Compartir con un enlace de solo lectura: se guarda en la nube una copia fija de una planta o un huerto
// (tabla «compartidos» y fotos en el almacén público «compartidas»). Quien abre el enlace ve esa copia en ver.html,
// aunque después cambie el original. Hace falta haber iniciado sesión.
import {client, currentUser} from './cloud.js';
import {SUPABASE_URL} from './cloud-config.js';

const BUCKET = 'compartidas', MAX_FOTOS = 12;
// Código al azar de 22 caracteres: imposible de adivinar
function newId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const linkUrl = id => new URL(`ver.html?c=${id}`, location.href.split(/[?#]/)[0].replace(/[^/]*$/, '')).href;
export const photoUrl = path => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

// fotos: [{src (data URL), ...datos}] → se suben y en los datos queda {p: ruta, ...datos}
export async function createLink(tipo, titulo, data, fotos = []) {
  const u = currentUser(); if (!u) throw new Error('login');
  const c = await client(), id = newId(), up = [];
  try {
    for (const [i, f] of fotos.slice(-MAX_FOTOS).entries()) {
      const {src, ...rest} = f, path = `${u.id}/${id}/${i}.jpg`;
      const blob = await (await fetch(src)).blob();
      const {error} = await c.storage.from(BUCKET).upload(path, blob, {contentType: 'image/jpeg'});
      if (error) throw error;
      up.push({p: path, ...rest});
    }
    const {error} = await c.from('compartidos').insert({id, tipo, titulo: String(titulo).slice(0, 80) || 'Sembradía', data: {...data, fotos: up}});
    if (error) throw error;
  } catch (e) {
    if (up.length) c.storage.from(BUCKET).remove(up.map(f => f.p)).catch(() => {});
    throw e;
  }
  return linkUrl(id);
}
export async function listLinks() {
  const c = await client();
  const {data, error} = await c.from('compartidos').select('id,tipo,titulo,creado').order('creado', {ascending: false});
  if (error) throw error;
  return data;
}
export async function deleteLink(id) {
  const c = await client(), u = currentUser();
  const {data} = await c.storage.from(BUCKET).list(`${u.id}/${id}`, {limit: 100});
  if (data?.length) await c.storage.from(BUCKET).remove(data.map(f => `${u.id}/${id}/${f.name}`));
  const {error} = await c.from('compartidos').delete().eq('id', id);
  if (error) throw error;
}
// Abre el menú de compartir del móvil con el enlace; si no se puede, lo copia.
// Si preparar el enlace tardó, el navegador pide otro toque (como con las imágenes)
export async function sendLink(url, title, text) {
  const go = async () => {
    if (navigator.share) { try { await navigator.share({title, text, url}); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancel'; } }
    try { await navigator.clipboard.writeText(url); return 'copied'; } catch (e) { return 'blocked'; }
  };
  if (navigator.userActivation && !navigator.userActivation.isActive) return {again: go};
  const r = await go(); return r === 'blocked' ? {again: go} : r;
}
