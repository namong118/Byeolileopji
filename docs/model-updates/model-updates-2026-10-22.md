# 모델·엔진 업데이트 확인 — 2026-10-22

- 가져오기 도구: parallel-search `web_fetch`
- 확인한 페이지: 5개 (성공 5, 실패 0)
- 실행 구분: **첫 실행** — 페이지별 최근 3개를 기준 항목으로 보고한다 (새 항목이 아니라 다음 확인의 출발점).
  Ultralytics 는 판단 규칙에 따라 고정 버전 이후 전체를 정리한다.
- 영향 표기: **있음** (별일없지에 바로 영향) / **없음** / **확인 필요** (페이지만으로 판단할 수 없음)
- 날짜: GitHub 릴리스 페이지는 올해 릴리스에 연도를 표기하지 않는다 ("20 Oct"). 2026 으로 적었다.
  1회차 발췌에 날짜가 없던 항목은 같은 날 2회차 발췌(같은 도구)에서 확인한 날짜로 채웠다.

## 요약

| 페이지 | 기준 항목 | 있음 | 확인 필요 | 가져오기 |
| --- | --- | --- | --- | --- |
| Gemini API 변경 로그 | 3 | 0 | 0 (강조 절 1) | 성공 |
| Ultralytics 릴리스 | 3 (고정 버전 이후 8개 정리) | 0 | 8 | 성공 |
| MediaPipe 릴리스 | 3 | 0 | 2 | 성공 |
| NCNN 릴리스 | 3 | 0 | 3 | 성공 |
| ONNX Runtime 릴리스 | 3 | 0 | 2 | 성공 |

## ⚠ 강조: 사용 중인 모델의 변경·지원 종료

가져온 범위: 2024-04-09 ~ 2026-10-13 (발췌라서 페이지 전체가 아니다).

- `gemini-3.5-flash-lite`: **지원 중단·종료 공지 없음.**
  - 2026-07-21: `gemini-3.5-flash-lite` 정식 버전(GA) 출시. 같은 절에 "샘플링 파라미터 `temperature`, `top_p`,
    `top_k` 가 deprecated" 공지가 함께 있다. 이 공지가 `gemini-3.5-flash-lite` 에도 적용되는지는 발췌에서
    확인되지 않는다 (자세한 내용은 Gemini 3.6 Flash 가이드를 보라고만 되어 있음).
    → **확인 필요** — 홈페이지 챗봇(`namong118/physical-ai` 의 `supabase/functions/site-chat/index.ts` 162줄)이
    `generationConfig` 에 `temperature: 0` 을 넘기고 있다 (사용자 확인). 이 deprecated 공지가 `gemini-3.5-flash-lite`
    에 적용되는지는 페이지에서 확인되지 않아 "확인 필요" 로 둔다. physical-ai 세션에서 따로 확인할 예정.
    [원문](https://ai.google.dev/gemini-api/docs/changelog)
  - 2026-09-18: Gemini 2.5 접근 제한 공지에서 "새 프로젝트는 3.5 Flash-Lite 또는 3.8 Flash 를 쓰라" 고 권장. 변경 아님.
  - 참고: 2026-10-08 의 "Gemini 3.5 Flash deprecation" 은 `gemini-3.5-flash` (Flash-Lite 아님) 에 대한 공지다.
- `gemini-embedding-2`: **가져온 발췌에 지원 중단·종료 공지 없음.** 영어 원문 발췌에는 이 모델이 나오는 절이 없었다
  (2026-03-10 의 `gemini-embedding-2-preview` 출시만 있음).

## 페이지별 기준 항목

### Gemini API 변경 로그

| 날짜 | 버전 | 요약 | 원문 |
| --- | --- | --- | --- |
| 2026-10-13 | — | `gemini-4-argon` 정식 버전(GA) 출시. 복잡한 코딩·에이전트·수학·과학용 | [링크](https://ai.google.dev/gemini-api/docs/changelog) |
| 2026-10-08 | — | `gemini-3.7-flash` deprecated → `gemini-3.8-flash` 로 자동 라우팅. `gemini-3.5-flash` deprecated → `gemini-3.6-flash` 로 대체. 같은 구간 발췌에 `deep-research-pro-preview-12-2025` 에이전트 2026-10-23 종료 공지 (발췌가 끊겨 있어 어느 날짜 절인지는 확인 필요) | [링크](https://ai.google.dev/gemini-api/docs/changelog) |
| 2026-10-06 | — | `gemini-nano-banana-2.1` (이미지 생성·편집) GA. `gemini-3.1-flash-image` deprecated (종료일 미정) | [링크](https://ai.google.dev/gemini-api/docs/changelog) |

- **영향**
  - 2026-10-13: **없음** — 새 모델 출시. 챗봇이 쓰는 두 모델과 무관.
  - 2026-10-08: **없음** — 중단 대상은 `gemini-3.7-flash`, `gemini-3.5-flash` 로 챗봇이 쓰는 `gemini-3.5-flash-lite` 가 아니다.
  - 2026-10-06: **없음** — 이미지 생성 모델. 챗봇은 쓰지 않는다.

### Ultralytics 릴리스

- 고정 버전: `8.4.175` (`edge/vision/training/requirements.txt`) → 이후 나온 릴리스 **8개** (`v8.4.176`~`v8.4.183`).
  고정 버전이 가져온 범위 안에 있어 개수는 빠짐없다. 1회차 발췌에 없던 날짜와 `v8.4.176` 태그는 2회차 발췌로 확인했다.
- 첫 실행 기준 항목: `v8.4.183`, `v8.4.182`, `v8.4.181`
- 따로 볼 항목 (YOLO26 / 학습·export(NCNN, ONNX) / 호환성 깨짐) — 고정 버전 이후 8개가 모두 해당한다.
  "호환성이 깨진다" 고 명시한 변경은 발췌에 없다.

| 날짜 | 버전 | 구분 | 요약 | 원문 | 영향 |
| --- | --- | --- | --- | --- | --- |
| 2026-10-20 | v8.4.183 | YOLO26 · 학습 | Axelera Voyager SDK 1.9.0 으로 모든 YOLO26 작업 export·예측·검증. LiteRT export 의 Intel CPU/NPU 실행. 학습 warmup·gradient accumulation 경계 사례, MPS 메모리 증가 수정 | [링크](https://github.com/ultralytics/ultralytics/releases/tag/v8.4.183) | **확인 필요** — 학습 warmup 수정은 고정 버전을 올리면 학습 결과가 달라질 수 있다. Axelera·LiteRT 는 쓰지 않음 |
| 2026-10-18 | v8.4.182 | 학습 | 라벨 검증이 음수 너비·높이 박스를 거부. 데이터셋 캐시 버전이 올라 기존 캐시를 다시 스캔 | [링크](https://github.com/ultralytics/ultralytics/releases/tag/v8.4.182) | **확인 필요** — 올리면 학습 데이터 캐시가 다시 만들어진다. 우리 라벨에 음수 박스가 있는지는 페이지로 알 수 없다 |
| 2026-10-17 | v8.4.181 | 학습 | 데이터셋 탐색이 `.yaml` 을 `.yml` 보다 먼저 봄, 소스 목록 대소문자 무시, 비 UTF-8 파일명 해시 지원. 모델 구조 변경 없음 | [링크](https://github.com/ultralytics/ultralytics/releases/tag/v8.4.181) | **확인 필요** — 데이터셋 로딩 동작 변경 |
| 2026-10-17 | v8.4.180 | YOLO26 | YOLO26-pose 학습 시 박스 겹침과 키포인트 OKS 를 함께 써서 양성 매칭 (기본 켜짐, YOLO26-pose 에만 적용) | [링크](https://github.com/ultralytics/ultralytics/releases/tag/v8.4.180) | **확인 필요** — `YOLO26n-pose` 는 자세 판단 후보. 학습 결과가 이전 버전과 달라진다 |
| 2026-10-17 | v8.4.179 | YOLO26 · export | `rknn-toolkit2` 2.5 미만으로 제한, YOLO26 pose loss 수치 안정성 개선, `torch.compile` 폴백, ONNX INT8 양자화 문서 | [링크](https://github.com/ultralytics/ultralytics/releases/tag/v8.4.179) | **확인 필요** — YOLO26 pose 학습 변경 |
| 2026-10-16 | v8.4.178 | export | static export 의 직사각형 입력 크기를 검증에 반영, MPS 의 dynamic ONNX 실행 수정. YOLO27 문서 성능 수치 갱신 | [링크](https://github.com/ultralytics/ultralytics/releases/tag/v8.4.178) | **확인 필요** — export 모델 검증 동작 변경. YOLO27 문서가 있다는 것은 페이지에서 확인했으나 우리 모델 선택에 주는 영향은 판단하지 않음 |
| 2026-10-13 | v8.4.177 | export · 학습 | ONNX GPU 추론이 심볼릭 출력 shape 에서 폴백, OpenVINO NPU 입력 크기 고정, 짧은 학습도 optimizer step 수행, RMSprop 체크포인트 수정 | [링크](https://github.com/ultralytics/ultralytics/releases/tag/v8.4.177) | **확인 필요** — 학습·ONNX export 동작 변경 |
| 2026-10-12 | v8.4.176 (본문 대응은 확인 필요) | YOLO26 · export | 릴리스 제목: YOLO-World 체크포인트에서 CLIP 제외 (328 MB → 26 MB). 1회차 발췌의 태그 없는 본문(PR 번호가 v8.4.175~v8.4.176 사이): YOLO26 segmentation mAP 를 떨어뜨린 마스크 임계값 변경을 되돌림, ONNX GPU 추론의 사용자 입력 이름 지원, YOLOE 파인튜닝 분류 헤드 유지 | [링크](https://github.com/ultralytics/ultralytics/releases/tag/v8.4.176) | **확인 필요** — 검출(detect) 이 아니라 segmentation 관련이지만 ONNX 추론 변경 포함 |

- 나머지 패치: 없음 (고정 버전 이후 릴리스가 모두 위 분류에 해당).
- 공통: 고정 버전(`==8.4.175`)이라 지금 학습 환경은 자동으로 바뀌지 않는다. 버전을 올릴 때 위 항목을 보고
  s1 기준으로 다시 측정할지 정하면 된다.

### MediaPipe 릴리스

| 날짜 | 버전 | 요약 | 원문 |
| --- | --- | --- | --- |
| 2026-10-14 | v1.1.1 | Flutter SDK 용 C 라이브러리, macOS GPU interactive segmentation 수정, LiteRT `GetOptions()` API 로 이전 | [링크](https://github.com/google-ai-edge/mediapipe/releases/tag/v1.1.1) |
| 2026-10-07 | v1.1.0 | Bazel 빌드에 Python 3.13·3.14 지원, LiteRT v2.2.0, Universal Embedder·Semantic Retriever 추가. `HolisticLandmarker` 충돌 수정, `LandmarksSmoothingCalculator` 해상도 변경 시 랜드마크 흔들림 수정 | [링크](https://github.com/google-ai-edge/mediapipe/releases/tag/v1.1.0) |
| 2026-07-28 | v1.0.0 | 1.0 메이저 버전. Text Embedder Gecko 지원, Running Mode 표준 enum 상수, Tasks C·Python API 네임스페이스 규칙 강제 | [링크](https://github.com/google-ai-edge/mediapipe/releases/tag/v1.0.0) |

- **영향** (레포에 쓰는 코드 없음, 자세 판단 후보)
  - v1.1.1: **없음** — Flutter·macOS·LiteRT 내부 API 변경.
  - v1.1.0: **확인 필요** — 랜드마크(자세 포함 가능) 처리 수정과 Python 지원 범위 변경. Pose Landmarker 에 해당하는지는 발췌로 확인되지 않는다.
  - v1.0.0: **확인 필요** — Python API 네임스페이스 강제·enum 변경은 0.10.x 예제 코드와 호환되지 않을 수 있다 (발췌에 호환성 언급 없음).

### NCNN 릴리스

| 날짜 | 버전 | 요약 | 원문 |
| --- | --- | --- | --- |
| 2026-10-20 | 20261020 | 네이티브 batch 추론 (CPU/Vulkan, C/Python API, pnnx), Vulkan int8 경로 (Convolution·GEMM 등), pnnx 변환 개선 (ONNX fp16/bool 상수, attention 융합, PyTorch 2.14 CI) | [링크](https://github.com/Tencent/ncnn/releases/tag/20261020) |
| 2026-05-26 | 20260526 | ARM SDPA 추가, ARMv8.4 BF16 으로 GEMM·Convolution·InnerProduct·MHA 최적화, ERF/ELU/GELU/SELU NEON·fp16, AArch64 `exp_ps` 최적화, GEMM `m == 1` (batch=1) 최적화, pnnx PyTorch 2.10/2.11 호환 | [링크](https://github.com/Tencent/ncnn/releases/tag/20260526) |
| 2026-01-13 | 20260113 | ARM NEON 수학 함수 FMA 우선 사용, x86 AVX512 GEMM·SDPA 최적화, C API 버전·옵션 함수 추가 | [링크](https://github.com/Tencent/ncnn/releases/tag/20260113) |

- **영향** (추론 엔진 1순위 후보, 레포에 쓰는 코드 없음)
  - 20261020: **확인 필요** — 성능(Vulkan int8)·모델 변환(pnnx) 변경. 우리 대상 기기에서 쓰이는지는 페이지로 알 수 없다.
  - 20260526: **확인 필요** — ARM 성능 변경 (BF16 은 ARMv8.4 이상, NEON·batch=1 최적화). 대상 Raspberry Pi 의 CPU 에 해당하는지는 이 페이지에 없다.
  - 20260113: **확인 필요** — ARM NEON 성능 변경.

### ONNX Runtime 릴리스

| 날짜 | 버전 | 요약 | 원문 |
| --- | --- | --- | --- |
| 2026-10-09 | v1.31.0 | Arm KleidiAI SVE2.1 FP16 GEMM, x86 FP16 LayerNorm/RMSNorm, RISC-V 커널 추가. **ACL EP(Arm Compute Library) deprecated**. `GatherBlockQuantized` 범위 밖 인덱스 동작 변경. ONNX 의존성 1.22.0 유지 | [링크](https://github.com/microsoft/onnxruntime/releases/tag/v1.31.0) |
| 2026-09-10 | v1.30.0 | 생성형 AI 추론 확장, CPU·GPU 성능 개선, Go 바인딩. 대응 커널 없는 CPU FP16 노드가 FP32 로 폴백. WebGPU 플러그인 EP 가 Linux AArch64 패키징 지원 | [링크](https://github.com/microsoft/onnxruntime/releases/tag/v1.30.0) |
| 2026-09-10 | v1.29.1 | v1.29.0 패치: GroupQueryAttention·KV-cache 레이아웃, 플러그인 EP 성능 도구, 그래프·옵티마이저 수정 | [링크](https://github.com/microsoft/onnxruntime/releases/tag/v1.29.1) |

- 이전 계열 패치: `v1.28.3` (2026-10-02), `v1.28.2` (2026-09-03), `v1.28.1` (2026-08-18). 플러그인 EP 릴리스는 제외.
- **영향** (추론 엔진 2순위 후보, 레포에 쓰는 코드 없음)
  - v1.31.0: **확인 필요** — ARM 성능 변경과 ARM 용 실행 제공자(ACL EP) 중단 예고. 우리가 ACL EP 를 쓸 계획인지는 이 페이지에 없다.
  - v1.30.0: **확인 필요** — CPU FP16 처리 변경, AArch64 패키징 변경 (WebGPU 플러그인에 한정).
  - v1.29.1: **없음** — 생성형 모델(GQA·KV-cache)·플러그인 도구 관련.

## 가져오지 못한 페이지

없음.

## 다음 확인 기준 (state.json 에 기록한 값)

| 페이지 | lastSeen | lastChecked |
| --- | --- | --- |
| gemini-api-changelog | 2026-10-13 | 2026-10-22 |
| ultralytics | v8.4.183 | 2026-10-22 |
| mediapipe | v1.1.1 | 2026-10-22 |
| ncnn | 20261020 | 2026-10-22 |
| onnxruntime | v1.31.0 | 2026-10-22 |
