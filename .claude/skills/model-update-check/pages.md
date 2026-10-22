# 확인할 페이지 목록

페이지를 추가·삭제할 때는 이 파일만 고친다. 각 페이지는 `## <id>` 절 하나다.
`id` 는 `docs/model-updates/state.json` 의 키로 쓰이므로, 한 번 정한 뒤에는 바꾸지 않는다
(바꾸면 그 페이지는 첫 실행으로 다시 취급된다).

절마다 쓰는 항목:

- **이름**: 보고서에 쓰는 이름
- **URL**: 가져올 페이지
- **추가 URL** (선택): 마지막 본 항목이나 기준 버전이 첫 페이지에 없을 때만 이어서 가져올 페이지
- **항목 기준**: `version` (버전 순서로 비교) 또는 `date` (날짜로 비교)
- **강조 키워드** (선택): 이 단어가 나오는 항목은 보고서에서 따로 강조한다
- **쓰는 방식**: 별일없지에서 이것을 어떻게 쓰는지. 영향 판단의 근거다
- **판단 규칙** (선택): 이 페이지에만 적용하는 영향 판단·보고 방식

---

## gemini-api-changelog

- **이름**: Gemini API 변경 로그
- **URL**: https://ai.google.dev/gemini-api/docs/changelog
  (영어 원문. 한국어 `?hl=ko` 페이지는 갱신이 늦을 수 있어 쓰지 않는다. 보고서는 한국어로 쓴다.)
- **항목 기준**: `date` (각 절 제목의 날짜, 예: "October 8, 2026" → `2026-10-08`)
- **강조 키워드**: `gemini-3.5-flash-lite`, `gemini-embedding-2`
- **쓰는 방식**: `namong118/physical-ai` 홈페이지 챗봇이 `gemini-3.5-flash-lite` (답변 생성) 와
  `gemini-embedding-2` (임베딩) 를 쓴다. 이 레포(앱·Worker·펌웨어)는 Gemini 를 쓰지 않는다.
- **판단 규칙**:
  - 강조 키워드 두 모델의 지원 중단(deprecation)·종료(shutdown)·리디렉션·가격·요청 형식 변경은 "있음".
  - 두 모델이 쓰는 API(GenerateContent, 임베딩, File Search 등)의 브레이킹 체인지는 "확인 필요"
    (챗봇이 그 기능을 쓰는지는 이 페이지에서 확인할 수 없다).
  - 그 밖의 새 모델 출시·다른 모델 종료는 "없음".
  - 새 항목 밖이라도 가져온 범위에서 강조 키워드 모델의 지원 중단·종료 공지를 찾아 강조 절에 싣는다.
    이미 보고한 공지는 상태 파일 `reportedNotices` 에 있으므로 다시 싣지 않는다.

## ultralytics

- **이름**: Ultralytics 릴리스
- **URL**: https://github.com/ultralytics/ultralytics/releases
- **추가 URL**: https://github.com/ultralytics/ultralytics/releases?page=2 ,
  https://github.com/ultralytics/ultralytics/releases?page=3
- **항목 기준**: `version` (태그, 예: `v8.4.176`)
- **강조 키워드**: `YOLO26`, `YOLO26n`, `YOLO26n-pose`, `export`, `NCNN`, `ONNX`, `train`, `breaking`
- **쓰는 방식**: `edge/vision/training/` 학습·평가 스크립트가 `ultralytics` 를 고정 버전으로 쓴다
  (고정 버전은 `edge/vision/training/requirements.txt` 에서 실행할 때마다 읽는다. 작성 시점 `8.4.175`).
  사전학습 가중치 `yolo26n.pt` 로 사람 검출을 파인튜닝했다. `YOLO26n-pose` 는 자세 판단 후보.
  추론 엔진 후보(NCNN·ONNX Runtime)로 넘기려면 Ultralytics `export` 를 쓴다.
- **판단 규칙**:
  - 패치 릴리스가 잦다. 보고서에는 다음을 나눠서 쓴다.
    1. 고정 버전 이후 나온 버전 수 (가져온 범위 기준. 고정 버전이 가져온 범위에 없으면 "N개 이상").
    2. 따로 뽑아 보여줄 항목: YOLO26 관련 / 학습·export(NCNN, ONNX) 관련 / 호환성이 깨지는 변경.
       항목마다 날짜·버전·요약·원문 링크·영향을 쓴다.
    3. 나머지 패치: 버전 목록만 한 줄로.
  - YOLO26 가중치·학습·export 동작 변경은 "확인 필요" (고정 버전을 올릴 때 다시 측정해야 하므로).
    호환성이 깨지는 변경도 "확인 필요". 나머지 패치는 "없음" (고정 버전이라 자동으로 바뀌지 않는다).

## mediapipe

- **이름**: MediaPipe 릴리스
- **URL**: https://github.com/google-ai-edge/mediapipe/releases
- **항목 기준**: `version` (태그, 예: `v0.10.x`)
- **강조 키워드**: `Pose`, `Pose Landmarker`, `Raspberry Pi`, `ARM`, `aarch64`, `Python`
- **쓰는 방식**: 레포에 쓰는 코드가 없다. Vision 자세 판단의 후보로만 본다.
- **판단 규칙**: 레포에서 쓰지 않으므로 기본은 "없음". 자세 인식(Pose) 기능 변경, ARM·Raspberry Pi
  지원, 성능 관련 변경은 "확인 필요".

## ncnn

- **이름**: NCNN 릴리스
- **URL**: https://github.com/Tencent/ncnn/releases
- **항목 기준**: `version` (날짜형 태그, 예: `20261020`. 버전 순서로 비교하면 날짜 순서와 같다)
- **강조 키워드**: `ARM`, `aarch64`, `arm64`, `Raspberry Pi`, `NEON`, `Vulkan`, `YOLO`, `pnnx`, `performance`
- **쓰는 방식**: 추론 엔진 1순위 후보 (`namong118/physical-ai` 레포 `report/inference-engine-selection.md`).
  이 레포에는 아직 쓰는 코드가 없다 (실시간 Vision 파이프라인 미구현).
- **판단 규칙**: ARM·Raspberry Pi·성능 관련 변경, 모델 변환(pnnx)·YOLO 지원 변경은 "확인 필요".
  그 밖은 "없음". 릴리스 본문이 중국어여도 요약은 한국어로 쓴다.

## onnxruntime

- **이름**: ONNX Runtime 릴리스
- **URL**: https://github.com/microsoft/onnxruntime/releases
- **항목 기준**: `version` (코어 태그 `vX.Y.Z` 만. `plugin-ep-cuda/…`, `plugin-ep-webgpu/…` 같은 플러그인 EP
  릴리스는 번호 체계가 달라 비교·보고에서 뺀다)
- **강조 키워드**: `ARM`, `aarch64`, `arm64`, `Raspberry Pi`, `Linux ARM`, `XNNPACK`, `performance`, `Python`, `deprecat`
- **참고**: 버전 순서로 비교하므로, lastSeen 보다 낮은 이전 계열 패치(예: lastSeen `v1.31.0` 이후에 나온
  `v1.28.4`)는 새 항목으로 잡지 않는다. 보고서의 이 페이지 절에 "이전 계열 패치: `<버전>` (날짜)" 로 한 줄만 적는다.
- **쓰는 방식**: 추론 엔진 2순위 후보 (`namong118/physical-ai` 레포 `report/inference-engine-selection.md`).
  이 레포에는 아직 쓰는 코드가 없다.
- **판단 규칙**: ARM·Raspberry Pi·성능 관련 변경, ARM Linux Python 패키지 지원 변경은 "확인 필요".
  그 밖은 "없음".
