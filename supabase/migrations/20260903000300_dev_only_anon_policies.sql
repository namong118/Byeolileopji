-- ═══════════════════════════════════════════════════════════════════════════
--  ⚠️  DEVELOPMENT ONLY  —  운영 환경에 적용 금지
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Phase 2 에는 아직 보호자 로그인(Supabase Auth)이 없다.
-- 20260903000100_initial_schema.sql 의 정책은 auth.uid() 를 요구하므로,
-- 로그인 없는 PoC 앱(anon key)은 아무 데이터도 읽지/쓰지 못한다.
--
-- 이 파일은 PoC 가 동작하도록 anon 역할에 임시로 넓은 권한을 준다.
--
-- Phase 4(인증 도입) 에서 반드시 되돌린다:
--   20260903000400_drop_dev_anon_policies.sql 를 만들어 아래 정책을 DROP 하고,
--   guardian_relationships 에 실제 보호자↔보호대상 행을 추가한다.
--
-- 이 상태는 "누구나 anon key 로 이벤트를 읽고 쓸 수 있는" 상태다.
-- Production-ready 가 아니다.
-- ═══════════════════════════════════════════════════════════════════════════

-- events: anon 읽기/쓰기 (DEVELOPMENT ONLY)
create policy dev_anon_events_select
  on public.events for select
  to anon
  using (true);

create policy dev_anon_events_insert
  on public.events for insert
  to anon
  with check (true);

-- care_recipients / devices: anon 읽기 (DEVELOPMENT ONLY)
create policy dev_anon_care_recipients_select
  on public.care_recipients for select
  to anon
  using (true);

create policy dev_anon_devices_select
  on public.devices for select
  to anon
  using (true);
