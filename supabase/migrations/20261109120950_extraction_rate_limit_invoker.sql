-- claim_extraction() passa a rodar como a própria pessoa (security invoker),
-- sem acesso privilegiado. Continua impossível zerar o contador: inserir só
-- gasta o próprio limite e só dá para apagar eventos que já não contam (> 2 dias).
create policy "extraction_events_insert_own" on public.extraction_events
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "extraction_events_delete_expired_own" on public.extraction_events
  for delete to authenticated
  using ((select auth.uid()) = user_id and created_at < now() - interval '2 days');

grant insert, delete on public.extraction_events to authenticated;

alter function public.claim_extraction() security invoker;
