-- Sembradía: límites y protecciones. Se ejecuta después de esquema.sql y avisos.sql.
-- Se puede ejecutar más de una vez sin problema.

-- 1. El cron manda una clave secreta que solo conoce la base de datos; sin ella la función no envía avisos
insert into public.ajustes (clave, valor)
  values ('cron', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (clave) do nothing;
select cron.schedule('avisos-huerta-viva', '5 * * * *', $$
  select net.http_post(
    url := 'https://zviyckrkvynmhukhrvvl.supabase.co/functions/v1/avisos',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select valor from public.ajustes where clave = 'cron')),
    body := '{}'::jsonb
  );
$$);

-- 2. Avisos: solo direcciones de servicios de avisos reales, tamaño acotado y como mucho 10 dispositivos por persona
alter table public.avisos drop constraint if exists avisos_endpoint_push;
alter table public.avisos add constraint avisos_endpoint_push check (
  length(endpoint) < 1000 and endpoint ~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'
) not valid;
alter table public.avisos drop constraint if exists avisos_tamano;
alter table public.avisos add constraint avisos_tamano check (
  pg_column_size(sub) < 4096 and jsonb_typeof(sched) = 'array' and jsonb_array_length(sched) <= 1000
  and pg_column_size(sched) < 200000 and length(tz) < 64
) not valid;
create or replace function public.avisos_maximo() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.avisos where user_id = new.user_id and endpoint <> new.endpoint) >= 10 then
    raise exception 'Demasiados dispositivos con avisos';
  end if;
  return new;
end $$;
drop trigger if exists avisos_maximo on public.avisos;
create trigger avisos_maximo before insert on public.avisos for each row execute function public.avisos_maximo();

-- 3. Huerto: como mucho 1 MB de datos por persona (las fotos van aparte)
alter table public.huertos drop constraint if exists huertos_tamano;
alter table public.huertos add constraint huertos_tamano check (pg_column_size(data) < 1000000) not valid;

-- 4. Fotos: solo JPEG de hasta 600 KB (la app las reduce a unos 150 KB) y como mucho 500 por persona
update storage.buckets set file_size_limit = 614400, allowed_mime_types = array['image/jpeg'] where id = 'fotos';
drop policy if exists "fotos propias" on storage.objects;
drop policy if exists "fotos: ver las propias" on storage.objects;
drop policy if exists "fotos: subir hasta 500" on storage.objects;
drop policy if exists "fotos: cambiar las propias" on storage.objects;
drop policy if exists "fotos: borrar las propias" on storage.objects;
create policy "fotos: ver las propias" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos: subir hasta 500" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text and length(name) < 120
    and (select count(*) from storage.objects o
         where o.bucket_id = 'fotos' and (storage.foldername(o.name))[1] = auth.uid()::text) < 500
  );
create policy "fotos: cambiar las propias" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos: borrar las propias" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 5. Comprobación: al final se ve cómo ha quedado todo
select 'cron' as que, command as detalle from cron.job where jobname = 'avisos-huerta-viva'
union all select 'fotos', format('máx %s bytes, tipos %s, pública: %s', file_size_limit, allowed_mime_types, public) from storage.buckets where id = 'fotos'
union all select 'regla ' || tablename, policyname from pg_policies where schemaname in ('public', 'storage') and (tablename in ('huertos', 'avisos') or policyname like 'fotos%')
union all select 'seguridad por filas', format('%s: %s', relname, relrowsecurity) from pg_class where oid in ('public.huertos'::regclass, 'public.avisos'::regclass, 'public.ajustes'::regclass);
