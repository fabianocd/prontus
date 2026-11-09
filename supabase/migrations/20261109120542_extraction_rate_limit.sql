-- Limite de leituras da ficha com IA (Gemini): 10 por hora e 30 por dia
-- (janelas móveis de 1 h e 24 h). A cota do Gemini é uma só para o app todo,
-- então uma conta não pode gastá-la sozinha.
create table public.extraction_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index extraction_events_user_created_idx
  on public.extraction_events (user_id, created_at desc);

alter table public.extraction_events enable row level security;

-- Só leitura dos próprios eventos. Inserir passa por claim_extraction();
-- sem update/delete, para ninguém zerar o próprio contador.
create policy "extraction_events_select_own" on public.extraction_events
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.extraction_events from anon, authenticated;
grant select on public.extraction_events to authenticated;

-- Uso atual da pessoa logada. blocked_by = 'hour' | 'day' | null;
-- retry_after_seconds = quanto falta para liberar (0 se não está bloqueada).
create function public.get_extraction_quota()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with recent as (
    select created_at
    from public.extraction_events
    where user_id = (select auth.uid())
      and created_at > now() - interval '24 hours'
  ),
  usage as (
    select
      count(*) filter (where created_at > now() - interval '1 hour') as hour_used,
      count(*) as day_used,
      min(created_at) filter (where created_at > now() - interval '1 hour') as hour_oldest,
      min(created_at) as day_oldest
    from recent
  )
  select jsonb_build_object(
    'hour_limit', 10,
    'day_limit', 30,
    'hour_used', hour_used,
    'day_used', day_used,
    'blocked_by', case
      when day_used >= 30 then 'day'
      when hour_used >= 10 then 'hour'
    end,
    'retry_after_seconds', greatest(
      0,
      case when day_used >= 30
        then ceil(extract(epoch from day_oldest + interval '24 hours' - now())) else 0 end,
      case when hour_used >= 10
        then ceil(extract(epoch from hour_oldest + interval '1 hour' - now())) else 0 end
    )::int
  )
  from usage;
$$;

-- Confere o limite e registra a leitura numa transação, com trava por
-- usuário (várias abas ao mesmo tempo não passam do limite).
create function public.claim_extraction()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  quota jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('extraction:' || uid::text, 0));

  -- Eventos antigos não contam mais para nenhuma janela.
  delete from public.extraction_events
  where user_id = uid and created_at < now() - interval '2 days';

  quota := public.get_extraction_quota();
  if quota ->> 'blocked_by' is not null then
    return quota || jsonb_build_object('allowed', false);
  end if;

  insert into public.extraction_events (user_id) values (uid);
  return public.get_extraction_quota() || jsonb_build_object('allowed', true);
end;
$$;

revoke execute on function public.get_extraction_quota() from public, anon;
revoke execute on function public.claim_extraction() from public, anon;
grant execute on function public.get_extraction_quota() to authenticated;
grant execute on function public.claim_extraction() to authenticated;
