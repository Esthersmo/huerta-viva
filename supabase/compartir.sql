-- Sembradía: compartir con un enlace de solo lectura.
-- Cada enlace guarda una copia fija (datos y fotos) de una planta o un huerto tal como estaban al compartirlo.
-- Se pega entera en Supabase > SQL Editor > New query y se pulsa Run. Se puede ejecutar más de una vez.

-- 1. Los enlaces: un código largo al azar, de quién es, qué es y la copia de los datos
create table if not exists public.compartidos (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{20,40}$'),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  tipo text not null check (tipo in ('planta', 'huerto')),
  titulo text not null check (length(titulo) between 1 and 80),
  data jsonb not null check (pg_column_size(data) < 100000),
  creado timestamptz not null default now()
);
alter table public.compartidos enable row level security;
drop policy if exists "compartidos: los propios" on public.compartidos;
drop policy if exists "compartidos: crear hasta 200" on public.compartidos;
drop policy if exists "compartidos: borrar los propios" on public.compartidos;
-- Cada persona ve y borra solo los suyos, y como mucho tiene 200
create policy "compartidos: los propios" on public.compartidos for select to authenticated using (auth.uid() = user_id);
create policy "compartidos: crear hasta 200" on public.compartidos for insert to authenticated
  with check (auth.uid() = user_id and (select count(*) from public.compartidos c where c.user_id = auth.uid()) < 200);
create policy "compartidos: borrar los propios" on public.compartidos for delete to authenticated using (auth.uid() = user_id);

-- Quien recibe el enlace lee solo ese, por su código (no puede ver la lista de todos)
create or replace function public.ver_compartido(p_id text) returns table (tipo text, titulo text, data jsonb, creado timestamptz)
  language sql stable security definer set search_path = '' as $$
  select c.tipo, c.titulo, c.data, c.creado from public.compartidos c where c.id = p_id;
$$;
revoke execute on function public.ver_compartido(text) from public;
grant execute on function public.ver_compartido(text) to anon, authenticated;

-- 2. Las fotos de los enlaces: almacén público (solo se ven sabiendo la dirección exacta), una carpeta por persona.
-- Solo JPEG de hasta 600 KB y como mucho 1000 por persona.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('compartidas', 'compartidas', true, 614400, array['image/jpeg'])
  on conflict (id) do update set public = true, file_size_limit = 614400, allowed_mime_types = array['image/jpeg'];
drop policy if exists "compartidas: ver las propias" on storage.objects;
drop policy if exists "compartidas: subir hasta 1000" on storage.objects;
drop policy if exists "compartidas: borrar las propias" on storage.objects;
create policy "compartidas: ver las propias" on storage.objects for select to authenticated
  using (bucket_id = 'compartidas' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "compartidas: subir hasta 1000" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'compartidas' and (storage.foldername(name))[1] = auth.uid()::text and length(name) < 120
    and (select count(*) from storage.objects o
         where o.bucket_id = 'compartidas' and (storage.foldername(o.name))[1] = auth.uid()::text) < 1000
  );
create policy "compartidas: borrar las propias" on storage.objects for delete to authenticated
  using (bucket_id = 'compartidas' and (storage.foldername(name))[1] = auth.uid()::text);
