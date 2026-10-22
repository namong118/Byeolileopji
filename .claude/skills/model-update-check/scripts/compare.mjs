#!/usr/bin/env node
// lastSeen 이후 항목만 골라낸다. 문자열 비교가 아니라 버전 순서 또는 날짜로 비교한다.
//
// 사용:
//   node compare.mjs --kind version --after 8.4.175 v8.4.176 v8.4.190 v8.4.174
//   node compare.mjs --kind date    --after 2026-10-08 2026-10-14 2026-09-22
//   (--after 를 빼면 첫 실행: 모든 항목을 newer 로 정렬해 돌려준다)
//
// 출력(JSON): { newer: [최신순], notNewer: [...], invalid: [...] }
//
// version: 앞의 영문 접두(v, ncnn- 등)를 떼고 숫자 단위로 비교한다 (8.4.10 > 8.4.9).
//          NCNN 처럼 날짜형 태그(20261020)도 한 자리 숫자 버전으로 비교된다.
//          같은 숫자 뒤에 접미(-rc1, b2 등)가 붙으면 정식판보다 앞선 것으로 본다.
// date:    YYYY-MM-DD 만 받는다. 다른 형식은 먼저 이 형식으로 바꿔서 넘긴다.

function parseArgs(argv) {
  const out = { kind: null, after: null, items: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--kind") out.kind = argv[++i];
    else if (a === "--after") out.after = argv[++i];
    else out.items.push(a);
  }
  return out;
}

function parseVersion(raw) {
  const m = /^[^\d]*(\d+(?:\.\d+)*)(.*)$/.exec(String(raw).trim());
  if (!m) return null;
  return { nums: m[1].split(".").map(Number), suffix: m[2].replace(/^[-.+]/, "") };
}

function compareVersion(a, b) {
  const len = Math.max(a.nums.length, b.nums.length);
  for (let i = 0; i < len; i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (a.suffix === b.suffix) return 0;
  if (!a.suffix) return 1; // 정식판이 접미판보다 뒤
  if (!b.suffix) return -1;
  return a.suffix.localeCompare(b.suffix, "en", { numeric: true });
}

function parseDate(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return t;
}

const { kind, after, items } = parseArgs(process.argv.slice(2));
if (kind !== "version" && kind !== "date") {
  console.error("--kind version|date 가 필요합니다");
  process.exit(2);
}
const parse = kind === "version" ? parseVersion : parseDate;
const cmp = kind === "version" ? compareVersion : (a, b) => a - b;

let base = null;
if (after != null) {
  base = parse(after);
  if (base == null) {
    console.error(`--after 값을 해석할 수 없습니다: ${after}`);
    process.exit(2);
  }
}

const newer = [];
const notNewer = [];
const invalid = [];
for (const raw of items) {
  const p = parse(raw);
  if (p == null) invalid.push(raw);
  else if (base == null || cmp(p, base) > 0) newer.push({ raw, p });
  else notNewer.push(raw);
}
newer.sort((x, y) => cmp(y.p, x.p));

console.log(JSON.stringify({ newer: newer.map((x) => x.raw), notNewer, invalid }, null, 2));
