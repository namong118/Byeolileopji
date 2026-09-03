-- 별일없지 (Byeolil Eopji) — Phase 2 초기 스키마
-- ---------------------------------------------------------------------------
-- 개념 모델
--   care_recipients        보호대상(어르신)
--   devices                센서 / 스마트워치 (동일 모델로 관리)
--   guardian_relationships 보호자(auth user) ↔ 보호대상 관계
--   events                 생활 이벤트 (이번 Phase 의 핵심)
--
-- 시간: 모든 시각은 timestamptz(UTC) 로 저장한다. 표시 변환은 앱에서 한다.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ── updated_at 자동 갱신 트리거 ────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── care_recipients ───────────────────────────────────────────────────────
create table if not exists public.care_recipients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger care_recipients_set_updated_at
  before update on public.care_recipients
  for each row execute function public.set_updated_at();

-- ── devices ───────────────────────────────────────────────────────────────
create table if not exists public.devices (
  id                uuid primary key default gen_random_uuid(),
  care_recipient_id uuid not null references public.care_recipients(id) on delete cascade,
  device_type       text not null
    check (device_type in ('pir_sensor', 'door_sensor', 'watch', 'system')),
  name              text not null,
  location          text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists devices_care_recipient_idx
  on public.devices (care_recipient_id);

create trigger devices_set_updated_at
  before update on public.devices
  for each row execute function public.set_updated_at();

-- ── guardian_relationships ────────────────────────────────────────────────
-- 향후: guardian_user_id = auth.uid() 인 보호자만 해당 보호대상의 데이터 접근.
create table if not exists public.guardian_relationships (
  id                uuid primary key default gen_random_uuid(),
  guardian_user_id  uuid not null references auth.users(id) on delete cascade,
  care_recipient_id uuid not null references public.care_recipients(id) on delete cascade,
  relationship      text,
  created_at        timestamptz not null default now(),
  unique (guardian_user_id, care_recipient_id)
);

create index if not exists guardian_rel_guardian_idx
  on public.guardian_relationships (guardian_user_id);
create index if not exists guardian_rel_recipient_idx
  on public.guardian_relationships (care_recipient_id);

-- ── events ────────────────────────────────────────────────────────────────
create table if not exists public.events (
  id                uuid primary key default gen_random_uuid(),
  care_recipient_id uuid not null references public.care_recipients(id) on delete cascade,
  device_id         uuid references public.devices(id) on delete set null,
  event_type        text not null
    check (event_type in (
      'motion_detected', 'door_opened', 'left_home', 'returned_home',
      'medication_taken', 'medication_missed', 'watch_activity', 'sos_triggered'
    )),
  source            text not null
    check (source in ('sensor', 'watch', 'medication', 'system')),
  location          text,
  payload           jsonb not null default '{}'::jsonb,
  occurred_at       timestamptz not null,
  created_at        timestamptz not null default now()
);

-- 주 조회 패턴: 특정 보호대상의 최근 이벤트
create index if not exists events_recipient_occurred_idx
  on public.events (care_recipient_id, occurred_at desc);

-- ── Row Level Security ────────────────────────────────────────────────────
-- 모든 사용자 데이터 테이블에서 RLS 를 켠다.
-- 아래는 "보호자 인증(auth) 이후" 를 전제로 한 정책이다.
-- Phase 2 에는 아직 로그인 UI 가 없으므로, PoC 를 돌리려면
--   supabase/migrations/20260903000300_dev_only_anon_policies.sql
-- 을 함께 적용해야 한다. (Phase 4 에서 인증 도입 시 그 파일을 되돌린다)

alter table public.care_recipients        enable row level security;
alter table public.devices                enable row level security;
alter table public.guardian_relationships enable row level security;
alter table public.events                 enable row level security;

-- 보호자는 자신과 연결된 관계 행만 볼 수 있다.
create policy guardian_rel_select_own
  on public.guardian_relationships
  for select
  to authenticated
  using (guardian_user_id = auth.uid());

-- 보호자는 자신이 연결된 보호대상만 조회할 수 있다.
create policy care_recipients_select_linked
  on public.care_recipients
  for select
  to authenticated
  using (
    exists (
      select 1 from public.guardian_relationships gr
      where gr.care_recipient_id = care_recipients.id
        and gr.guardian_user_id = auth.uid()
    )
  );

-- 보호자는 연결된 보호대상의 디바이스만 조회할 수 있다.
create policy devices_select_linked
  on public.devices
  for select
  to authenticated
  using (
    exists (
      select 1 from public.guardian_relationships gr
      where gr.care_recipient_id = devices.care_recipient_id
        and gr.guardian_user_id = auth.uid()
    )
  );

-- 보호자는 연결된 보호대상의 이벤트만 조회할 수 있다.
create policy events_select_linked
  on public.events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.guardian_relationships gr
      where gr.care_recipient_id = events.care_recipient_id
        and gr.guardian_user_id = auth.uid()
    )
  );

-- 이벤트 INSERT 도 연결된 보호대상에 한정한다.
-- (Phase 3 에서 ESP32 는 별도 서비스 역할/엣지 함수로 INSERT 하게 되며,
--  일반 보호자 클라이언트의 광범위한 쓰기 권한은 두지 않는다.)
create policy events_insert_linked
  on public.events
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.guardian_relationships gr
      where gr.care_recipient_id = events.care_recipient_id
        and gr.guardian_user_id = auth.uid()
    )
  );
