---
name: model-update-check
description: 별일없지가 쓰는 모델·엔진(Gemini API, Ultralytics YOLO26, MediaPipe, NCNN, ONNX Runtime)의 변경 로그·릴리스 페이지를 parallel-search 로 가져와, 지난번 확인 이후 새로 생긴 항목만 골라 영향 판단 보고서(docs/model-updates/model-updates-YYYY-MM-DD.md)를 쓰고 상태 파일을 갱신한다. "모델 업데이트 확인", "새 버전 나왔어?", "Gemini 지원 종료 공지 있어?", "ultralytics/ncnn/onnxruntime 릴리스 확인", "엔진 변경 로그 봐줘" 처럼 이 모델·엔진들의 업데이트·지원 중단·새 릴리스를 묻는 요청이면 이름을 정확히 말하지 않아도 이 스킬을 쓴다.
---

# 모델 업데이트 확인

별일없지가 쓰거나 쓸 예정인 모델·엔진의 개발 문서 페이지를 가져와, 지난번 확인 이후 새로 생긴
항목만 보고한다. 목적은 "지원 종료로 챗봇이 멈춤", "고정 버전을 올렸더니 학습 결과가 달라짐" 같은
일을 미리 알아채는 것이다. 그래서 보고서는 **페이지에서 확인한 사실**과 **별일없지에 주는 영향**을
구분해서 쓴다.

## 파일

| 경로 | 역할 |
| --- | --- |
| `.claude/skills/model-update-check/pages.md` | 확인할 페이지 목록, 페이지별 쓰는 방식·판단 규칙 |
| `.claude/skills/model-update-check/report-template.md` | 보고서 틀 |
| `.claude/skills/model-update-check/scripts/compare.mjs` | lastSeen 이후 항목 고르기 (버전 순서·날짜 비교) |
| `docs/model-updates/state.json` | 페이지별 마지막 확인일·마지막으로 본 항목 (커밋해서 세션 간 공유) |
| `docs/model-updates/model-updates-YYYY-MM-DD.md` | 보고서 (새 항목이 있을 때만) |

## 동작 순서

### 1. 목록과 상태 읽기

- `pages.md` 를 읽는다. 매번 새로 읽는다 (사용자가 페이지를 추가·삭제했을 수 있다).
- `docs/model-updates/state.json` 을 읽는다. 파일이 없거나 페이지 `id` 가 없으면 그 페이지는 **첫 실행**이다.
- `pages.md` 에서 실행할 때 읽으라고 한 값(예: Ultralytics 고정 버전 → `edge/vision/training/requirements.txt`)을 읽는다.

### 2. 페이지 가져오기 — `mcp__parallel-search__web_fetch` 만 쓴다

- 페이지마다 `web_fetch` 를 **따로, 한 번에 동시에** 호출한다 (`urls` 에 그 페이지 URL 하나).
- `objective` 에는 무엇을 뽑을지 적는다 (200자 이내). 예:
  - 변경 로그: `Most recent dated changelog entries: date, model names, what changed, deprecation/shutdown notices`
  - GitHub 릴리스: `Most recent releases: tag/version, release date, main changes (skip asset/download tables)`
  - 강조 키워드가 있으면 objective 에 키워드를 넣는다.
  - 첫 실행이 아니면 objective 에 lastSeen 을 넣는다 (예: `... all entries on or after 2026-10-13`).
    `web_fetch` 는 페이지 전체가 아니라 objective 에 맞춘 **발췌**를 돌려주고, 같은 요청이라도 매번 발췌 범위가
    달라진다 (2026-10-22 시험: 두 번째 요청에서 Gemini 최신 절 2026-10-13 이 빠짐). lastSeen 을 기준점으로
    주면 그 뒤 항목이 빠질 가능성이 줄어든다.
- 마지막 본 항목(또는 Ultralytics 고정 버전)이 첫 페이지 결과에 없고 `pages.md` 에 **추가 URL** 이
  있으면, 추가 URL 을 같은 도구로 이어서 가져온다.
- **가져오기 실패**: `errors` 에 그 URL 이 있음 / 발췌가 비어 있음 / 항목(버전·날짜)을 하나도 찾지 못함.
  실패한 페이지는 WebFetch·브라우저·`gh`·검색 등 **다른 방법으로 대신하지 않는다.** 보고서의
  "가져오지 못한 페이지" 절에 URL 과 이유(에러 문구 그대로)를 적고, 상태는 갱신하지 않는다.
  대신 가져온 내용은 출처가 다르고 같은 기준으로 검증되지 않기 때문이다.

### 3. 항목 뽑기

페이지마다 항목 목록을 만든다: 날짜, 버전(변경 로그는 없음 → `—`), 요약, 원문 링크.

- 날짜는 `YYYY-MM-DD` 로 바꾼다. 페이지에 날짜가 없으면 `날짜 미표시` 로 쓴다 (지어내지 않는다).
- 원문 링크: GitHub 는 발췌에 있는 `releases/tag/<태그>` 링크, 없으면
  `https://github.com/<owner>/<repo>/releases/tag/<태그>` (태그 이름이 발췌에 그대로 있을 때만).
  변경 로그는 페이지 URL (발췌에 날짜 앵커 링크가 있으면 그것).
- 요약은 발췌에 있는 내용만 한국어로 줄여 쓴다. 발췌가 잘려 내용을 알 수 없으면 `요약 확인 필요 (발췌에 본문 없음)`.

### 4. 새 항목 고르기 — `compare.mjs` 로 비교한다

`v8.4.9` 와 `v8.4.175`, `20260526` 과 `20261020` 같은 값은 문자열로 비교하면 틀린다.
그래서 직접 비교하지 말고 스크립트에 맡긴다 (레포 루트에서 실행).

```bash
# lastSeen 이후 (버전)
node .claude/skills/model-update-check/scripts/compare.mjs --kind version --after <lastSeen> <항목 버전들...>
# lastSeen 이후 (날짜, YYYY-MM-DD)
node .claude/skills/model-update-check/scripts/compare.mjs --kind date --after <lastSeen> <항목 날짜들...>
# 첫 실행: --after 없이 → 최신순 정렬만
node .claude/skills/model-update-check/scripts/compare.mjs --kind version <항목 버전들...>
```

- 출력의 `newer` 가 새 항목 (최신순). `invalid` 가 있으면 그 값은 형식이 맞지 않는 것이니 원문을 다시 본다.
- **첫 실행**: `newer` 의 앞 3개를 "기준 항목"으로 보고한다 (새 항목이라 부르지 않는다).
- **이후 실행**: `newer` 전부가 새 항목. lastSeen 자체가 가져온 범위(추가 URL 포함)에 없으면 다음처럼 한다.
  1. 가져온 항목이 모두 lastSeen 보다 오래됨 → 발췌가 최신 부분을 빠뜨린 것이다. 같은 도구로 objective 를
     `Entries dated on or after <lastSeen> (newest first)` 처럼 좁혀 **한 번만** 다시 가져온다.
     그래도 없으면 그 페이지는 "가져오기 불완전" 으로 보고하고 상태(`lastChecked` 포함)를 갱신하지 않는다.
  2. lastSeen 보다 새 항목은 있는데 lastSeen 이 없음 → 그 사이가 빠졌을 수 있다. 보이는 새 항목을 보고하고
     `확인 필요: 마지막 본 항목(<값>)이 가져온 범위에 없음 — 그 사이 항목이 빠졌을 수 있음` 을 적는다.
- Ultralytics 고정 버전 이후 버전 수도 같은 스크립트로 센다 (`--after <고정 버전>`).

### 5. 영향 판단

새 항목(첫 실행이면 기준 항목)마다 **있음 / 없음 / 확인 필요** 와 이유를 쓴다.

- 근거는 두 가지뿐이다: 이번에 가져온 페이지 내용, `pages.md` 의 "쓰는 방식"·"판단 규칙".
- 페이지에서 직접 확인되지 않는 것을 판단에 쓰려면 "확인 필요" 로 둔다. 예: "챗봇이 그 API 기능을
  쓰는지", "성능이 실제로 좋아지는지" 는 이 페이지만으로 알 수 없다.
- 이유는 한 문장으로, 어느 사실에 근거했는지 드러나게 쓴다.

### 6. 결과 내기

- **새 항목이 하나도 없고 실패한 페이지도 없음**: 보고서를 만들지 않는다. 사용자에게 `변경 없음` 과
  확인한 페이지 수만 알린다.
- **새 항목은 없고 실패한 페이지만 있음**: 보고서를 만들지 않는다. `변경 없음 (단, 가져오지 못한 페이지: …)` 로 알린다.
- **새 항목이 있음 (또는 첫 실행)**: `report-template.md` 를 따라 보고서를 쓴다.
  - 경로 `docs/model-updates/model-updates-YYYY-MM-DD.md` (오늘 날짜). 같은 이름이 있으면 덮어쓰지
    않고 `-2`, `-3` 을 붙인다.
  - 보고서는 한국어로 쓴다. 모델 이름·버전·API 이름은 원문 그대로 둔다.
  - 공개 레포다. 키 값, 개인 정보, 로컬 경로를 쓰지 않는다.

### 7. 상태 갱신

`docs/model-updates/state.json` 을 쓴다. 가져오기에 **성공한 페이지만** 바꾼다.

```json
{
  "schemaVersion": 1,
  "pages": {
    "<id>": {
      "kind": "version | date",
      "lastChecked": "YYYY-MM-DD",
      "lastSeen": "<가장 최신 항목의 버전 또는 날짜>",
      "reportedNotices": ["<날짜> <모델>: <공지 한 줄>"]
    }
  }
}
```

- `lastChecked` 는 새 항목이 없어도 오늘로 바꾼다.
- `lastSeen` 은 가져온 항목 중 가장 최신 값이다 (새 항목이 없으면 그대로).
- `reportedNotices` 는 강조 키워드 공지를 보고했을 때만 쓴다 (Gemini). 같은 공지를 다음에 다시 싣지 않기 위해서다.
- `pages.md` 에서 삭제된 페이지의 기록은 지우지 않고 둔다 (다시 추가하면 이어서 쓴다).

### 8. 사용자에게 알리기

짧게: 보고서 경로(만들었으면), 페이지별 새 항목 수, "있음"·"확인 필요" 항목, 가져오지 못한 페이지.
보고서 내용 전체를 다시 붙이지 않는다. 커밋은 사용자가 요청할 때만 한다.
