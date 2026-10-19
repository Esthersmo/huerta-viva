// Datos públicos del proyecto de Supabase (la dirección y la clave «publishable» o «anon»).
// No son secretos: la seguridad la dan las reglas de la base de datos (supabase/esquema.sql).
// Mientras estén vacíos, la app funciona solo en el dispositivo y no muestra «Mi cuenta».
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || '';
