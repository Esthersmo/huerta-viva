-- Sembradía: avisos diarios con la app cerrada.
-- Se pega entera en Supabase > SQL Editor > New query y se pulsa Run, después de crear la función «avisos».

-- Una fila por móvil u ordenador con los avisos activados: su dirección de avisos y las próximas tareas
create table if not exists public.avisos (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  sub jsonb not null,
  sched jsonb not null default '[]',
  tz text not null default 'Europe/Madrid',
  ultimo date,
  updated_at timestamptz not null default now()
);
alter table public.avisos enable row level security;
drop policy if exists "cada uno sus avisos" on public.avisos;
create policy "cada uno sus avisos" on public.avisos for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Claves del servidor de avisos. Sin reglas: solo la función puede leerlas
create table if not exists public.ajustes (clave text primary key, valor text not null);
alter table public.ajustes enable row level security;

-- Cada hora, a y cinco, la función manda los avisos de las personas para las que ya son las 9 de la mañana
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('avisos-huerta-viva', '5 * * * *', $$
  select net.http_post(
    url := 'https://zviyckrkvynmhukhrvvl.supabase.co/functions/v1/avisos',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
