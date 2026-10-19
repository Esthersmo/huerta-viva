-- Huerta Viva: base de datos para las cuentas.
-- Se pega entera en Supabase > SQL Editor > New query y se pulsa Run. Solo hace falta una vez.

-- Un huerto por usuario: plantas, riegos, zona y datos de las fotos (sin la imagen)
create table if not exists public.huertos (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.huertos enable row level security;
drop policy if exists "cada uno su huerto" on public.huertos;
create policy "cada uno su huerto" on public.huertos for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Las fotos van a un almacén privado, en una carpeta por usuario
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', false)
  on conflict (id) do nothing;
drop policy if exists "fotos propias" on storage.objects;
create policy "fotos propias" on storage.objects for all to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Borrar la cuenta desde la app (la app borra antes las fotos)
create or replace function public.borrar_cuenta() returns void
  language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;
revoke execute on function public.borrar_cuenta() from public, anon;
grant execute on function public.borrar_cuenta() to authenticated;
