// Huerta Viva: avisos diarios con la app cerrada (Web Push).
// GET  → devuelve la clave pública con la que el móvil se apunta a los avisos.
// POST → (solo el cron, con la cabecera x-cron-secret) manda a cada dispositivo sus tareas del día a partir de las 9 de su hora.
// Las claves del servidor se crean solas la primera vez y se guardan en la tabla «ajustes», que solo lee el servidor.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

// La clave de servidor la pone Supabase sola en la función (con el nombre antiguo o el nuevo)
const secreta = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0] as string;
const db = createClient(Deno.env.get("SUPABASE_URL")!, secreta);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
const HORA = 9;
// Solo se manda a servicios de avisos reales (Chrome/Android, Firefox, Safari/iPhone, Edge), nunca a otras direcciones
const PUSH = /^(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
const esPush = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" && !x.port && PUSH.test(x.hostname); } catch { return false; } };
// Iguala dos textos sin dar pistas por el tiempo que tarda
const igual = (a: string, b: string) => a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

async function claves(): Promise<{ publicKey: string; privateKey: string }> {
  const { data } = await db.from("ajustes").select("valor").eq("clave", "vapid").maybeSingle();
  if (data) return JSON.parse(data.valor);
  const k = webpush.generateVAPIDKeys();
  const { error } = await db.from("ajustes").insert({ clave: "vapid", valor: JSON.stringify(k) });
  if (error) { // Otra llamada las creó a la vez
    const { data: d } = await db.from("ajustes").select("valor").eq("clave", "vapid").single();
    return JSON.parse(d!.valor);
  }
  return k;
}

function ahora(tz: string) {
  let p: Record<string, string>;
  try {
    p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
  } catch { return ahora("Europe/Madrid"); }
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: +p.hour };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") return Response.json({ publicKey: (await claves()).publicKey }, { headers: cors });
  if (req.method !== "POST") return new Response("Método no permitido", { status: 405 });

  // El barrido solo lo puede lanzar el cron, que manda la clave guardada en «ajustes»
  const { data: c } = await db.from("ajustes").select("valor").eq("clave", "cron").maybeSingle();
  if (!c?.valor || !igual(req.headers.get("x-cron-secret") || "", c.valor)) return new Response("No autorizado", { status: 401 });
  const k = await claves();

  webpush.setVapidDetails("mailto:huertaviva.app@gmail.com", k.publicKey, k.privateKey);
  const { data: filas, error } = await db.from("avisos").select("endpoint,sub,sched,tz,ultimo");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let enviados = 0;
  for (const f of filas ?? []) {
    const { fecha, hora } = ahora(f.tz || "Europe/Madrid");
    if (hora < HORA || f.ultimo === fecha) continue;
    const tareas = (f.sched || []).filter((x: { date: string }) => x.date <= fecha).map((x: { text: string }) => x.text);
    if (!tareas.length) continue;
    if (!esPush(f.endpoint) || f.sub?.endpoint !== f.endpoint) { await db.from("avisos").delete().eq("endpoint", f.endpoint); continue; }
    const primeras = tareas.slice(0, 3).join(", ");
    const body = tareas.length > 3 ? `${primeras} y ${tareas.length - 3} más` : primeras;
    try {
      const d = webpush.generateRequestDetails(f.sub, JSON.stringify({ title: "Huerta Viva · tareas de hoy", body, date: fecha }), { TTL: 12 * 3600 });
      const r = await fetch(d.endpoint, { method: d.method, headers: d.headers, body: d.body, redirect: "manual" });
      if (r.status === 404 || r.status === 410) await db.from("avisos").delete().eq("endpoint", f.endpoint); // El móvil ya no acepta avisos
      else if (r.ok) { await db.from("avisos").update({ ultimo: fecha }).eq("endpoint", f.endpoint); enviados++; }
      else console.log("aviso", r.status, await r.text());
    } catch (e) { console.log("aviso", e); }
  }
  return Response.json({ enviados });
});
