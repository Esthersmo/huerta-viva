// Datos públicos del proyecto de Supabase (la dirección y la clave «publishable» o «anon»).
// No son secretos: la seguridad la dan las reglas de la base de datos (supabase/esquema.sql).
// Si se dejan vacíos, la app funciona solo en el dispositivo y no muestra «Mi cuenta».
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zviyckrkvynmhukhrvvl.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_4vGsThk-mMsPKKAf9Iw0Gw_Yjjvx5Xw';
// Clave pública del captcha de Cloudflare Turnstile (vacía = sin captcha). Protege «Enviarme un código» de abusos.
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
