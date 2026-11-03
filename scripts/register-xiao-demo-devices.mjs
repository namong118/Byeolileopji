/**
 * XIAO ESP32-S3 Sense 자세 인식 데모 — 기기 3대 + 데모 보호대상 guardianLink 등록.
 *
 * 실행 (기본은 dry-run: 쓸 문서만 출력하고 Firestore 에 쓰지 않는다):
 *   node scripts/register-xiao-demo-devices.mjs --guardian-uid <보호자 UID>
 *
 * 실제 쓰기 (운영 Firestore 에 쓴다 — 사용자가 직접 실행):
 *   node --env-file=server/cloudflare-worker/.dev.vars \
 *     scripts/register-xiao-demo-devices.mjs --guardian-uid <보호자 UID> --apply
 *   필요한 env: FIREBASE_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (Worker 와 같은 서비스 계정)
 *
 * 쓰는 문서:
 *   devices/xiao-living | xiao-kitchen | xiao-bed   (type=ESP32_POSTURE, location, careRecipientId=데모)
 *   guardianLinks/{uid}_{데모 보호대상}              (앱이 데모 이벤트를 읽기 위한 Rules 연결)
 *
 * 격리:
 *   - 데모 기기는 실제 보호대상이 아니라 데모 보호대상(기본 zz-demo-xiao)에 묶인다.
 *   - Worker Cron(scheduled.js)은 env.CARE_RECIPIENT_ID 한 명만 판정·알림하므로
 *     데모 이벤트는 상태 판정/FCM 에 들어가지 않는다.
 *   - ID 가 "zz-" 로 시작하는 이유: 앱 selectActiveLink() 는 연결이 여러 개면
 *     careRecipientId 사전순 첫 번째를 고른다. 데모 ID 가 실제 ID 보다 뒤로 가야
 *     이미 배포된 모바일 앱이 데모 대상으로 바뀌지 않는다.
 *   - 각 문서는 updateMask PATCH 라 지정한 필드만 쓰고 나머지(lastHeartbeatAt 등)는 보존한다.
 */

import { pathToFileURL } from 'node:url';

export const DEMO_RECIPIENT_ID_DEFAULT = 'zz-demo-xiao';

export const XIAO_DEMO_DEVICES = [
  { deviceId: 'xiao-living', location: '거실' },
  { deviceId: 'xiao-kitchen', location: '부엌' },
  { deviceId: 'xiao-bed', location: '침대' },
];

/** 순수 함수: 써야 할 문서 목록 (네트워크 없음) */
export function buildDemoRegistry({ guardianUid, recipientId = DEMO_RECIPIENT_ID_DEFAULT }) {
  if (typeof guardianUid !== 'string' || guardianUid.trim() === '') {
    throw new Error('guardianUid 가 필요하다 (--guardian-uid)');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(recipientId)) {
    throw new Error(`recipientId 형식 오류: ${recipientId}`);
  }
  const uid = guardianUid.trim();
  const docs = XIAO_DEMO_DEVICES.map(({ deviceId, location }) => ({
    path: `devices/${deviceId}`,
    fields: {
      type: 'ESP32_POSTURE',
      enabled: true,
      careRecipientId: recipientId,
      location,
      demo: true,
    },
  }));
  docs.push({
    path: `guardianLinks/${uid}_${recipientId}`,
    fields: { guardianUid: uid, careRecipientId: recipientId, role: 'demo', enabled: true },
  });
  return docs;
}

function parseArgs(argv) {
  const out = { apply: false, guardianUid: undefined, recipientId: DEMO_RECIPIENT_ID_DEFAULT };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--guardian-uid') out.guardianUid = argv[(i += 1)];
    else if (a === '--recipient-id') out.recipientId = argv[(i += 1)];
    else throw new Error(`알 수 없는 인자: ${a}`);
  }
  return out;
}

async function applyDocs(docs, env) {
  const { getFirestoreAccessToken } = await import(
    '../server/cloudflare-worker/src/firestoreAuth.js'
  );
  const { toFirestoreFields } = await import('../server/cloudflare-worker/src/firestore.js');
  const token = await getFirestoreAccessToken(env);
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  for (const d of docs) {
    const mask = Object.keys(d.fields)
      .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
      .join('&');
    const res = await fetch(`${base}/${d.path}?${mask}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: toFirestoreFields(d.fields) }),
    });
    if (!res.ok) {
      throw new Error(`PATCH ${d.path} 실패: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    console.log(`  ✔ ${d.path}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const docs = buildDemoRegistry(args);
  console.log(`데모 보호대상: ${args.recipientId}`);
  for (const d of docs) console.log(`  ${d.path}  ${JSON.stringify(d.fields)}`);
  console.log(
    `\n⚠ 실제 보호대상 ID 가 "${args.recipientId}" 보다 사전순으로 뒤에 있으면 ` +
      `모바일 앱이 데모 대상을 고를 수 있다 — 쓰기 전에 확인할 것.`,
  );
  if (!args.apply) {
    console.log('\n(dry-run — Firestore 에 쓰지 않았다. 쓰려면 --apply)');
    return;
  }
  if (!process.env.FIREBASE_PROJECT_ID) throw new Error('FIREBASE_PROJECT_ID 가 없다');
  console.log(`\n--apply: project=${process.env.FIREBASE_PROJECT_ID} 에 쓴다`);
  await applyDocs(docs, process.env);
  console.log('완료');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`실패: ${err.message}`);
    process.exit(1);
  });
}
