-- 별일없지 — 개발용 seed 데이터
-- ---------------------------------------------------------------------------
-- 고정 UUID 는 앱의 src/config/careContext.ts 값과 일치해야 한다.
-- idempotent: 여러 번 적용해도 안전하다.
--
-- ⚠️ 이 seed 는 개발 편의를 위한 것이다. 운영 환경에서는 적용하지 않는다.
-- ---------------------------------------------------------------------------

insert into public.care_recipients (id, name)
values ('11111111-1111-4111-8111-111111111111', '김영희')
on conflict (id) do nothing;

insert into public.devices (id, care_recipient_id, device_type, name, location)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'pir_sensor',
  '거실 모션센서',
  '거실'
)
on conflict (id) do nothing;
