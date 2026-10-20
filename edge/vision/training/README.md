# 사람 검출 파인튜닝 (YOLO26n, 클래스 `person` 1개)

별일없지 카메라 AI의 사람 검출 모델을 기준선 측정·파인튜닝·장면별 평가하는 스크립트입니다.
기준 문서는 `namong118/physical-ai` 의 `report/model-training-validation.md` (3.3 데이터 준비,
3.4 학습 설정, 4장 검증, 6장 진행 순서)입니다.

- 학습·추론은 이 PC 안에서만 합니다. 영상·이미지를 클라우드로 올리지 않습니다.
- **영상·이미지·라벨·가중치는 커밋하지 않습니다.** 데이터와 결과는 `.env` 로 레포 밖 폴더를 지정해 둡니다.
- 데이터 구성: 학습 = 공개 데이터셋, 검증 = 녹화 세션 1, 시험 = 녹화 세션 2.

| 파일 | 하는 일 |
|---|---|
| `check_env.py` | GPU·버전·폴더 확인, GPU 추론 1회 |
| `extract_frames.py` | 녹화 영상 → 프레임 (초당 1장). 연속 영상은 구간 파일로 장면별로 나눔 |
| `prelabel.py` | 사전학습 `yolo26n.pt` 로 박스 초안 → Label Studio 가져오기 파일 |
| `start_label_studio.py` | Label Studio 를 로컬 전용 설정으로 실행 |
| `label_config.xml` | Label Studio 라벨 설정 (`person` 박스 1종) |
| `ls_to_yolo.py` | Label Studio 내보내기 → 검수 완료 YOLO 라벨 |
| `import_public.py` | 공개 데이터셋(YOLO txt) → `person` 1클래스 |
| `build_dataset.py` | 학습/검증/시험 분할, `data.yaml`, 세션 누수 검사 |
| `eval_scenes.py` | 장면별 P · R · mAP50 · mAP50-95 표 (문서 4.2 형식) |
| `train.py` | `fraction=0.1` 리허설 / 본 학습 (문서 3.4 설정) |
| `common.py` | 경로 설정, 장면 코드, 파일 이름 규칙 (공용) |
| `tests/` | 합성 데이터로 하는 로직 테스트 |

---

## 1. 설치 (Windows)

Python **3.12** 로 venv 두 개를 만듭니다. 학습용과 라벨 도구용을 나누는 이유는 의존성 충돌입니다.
label-studio 는 `setuptools>=83` 과 `opencv-python-headless 4.12` 를 요구하고, torch 는
`setuptools<82`, ultralytics 는 `opencv-python` 을 요구합니다.

```powershell
# 이 폴더에서 (edge/vision/training)
py install 3.12                       # Python 설치 관리자. 이미 있으면 생략

# 학습용
py -V:3.12 -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
.venv\Scripts\python -m pip install -r requirements.txt

# 라벨 도구용
py -V:3.12 -m venv .venv-labelstudio
.venv-labelstudio\Scripts\python -m pip install --upgrade pip
.venv-labelstudio\Scripts\python -m pip install -r requirements-labelstudio.txt
```

GPU 인식 확인:

```powershell
.venv\Scripts\python check_env.py
```

`CUDA 사용 True`, GPU 이름, `사용 이벤트 전송 안 함`, `GPU 추론 N명 검출` 이 나오면 됩니다.
torch 를 CUDA 판이 아닌 기본 판으로 설치하면 `CUDA 사용 False` 로 실패합니다.

확인한 조합 (RTX 3060 12GB, NVIDIA 드라이버 580): Python 3.12.10, torch 2.11.0+cu128,
torchvision 0.26.0+cu128, ultralytics 8.4.175, opencv-python 5.0.0, label-studio 1.23.2.

## 2. 데이터·결과 위치

`.env.example` 을 복사해 같은 폴더에 `.env` 를 만들고, **레포 밖 폴더를 지정**합니다.

| 변수 | 들어가는 것 | 설정이 없을 때 |
|---|---|---|
| `BYEOL_DATA_DIR` | 녹화 영상, 프레임, 라벨, 공개 데이터, 데이터셋, Label Studio DB | `data/` (git 무시) |
| `BYEOL_RUNS_DIR` | 가중치, 학습 결과(`best.pt`), 평가 결과표, ultralytics 전용 설정 | `runs/` (git 무시) |

데이터 폴더 구조 (아래 `<data>`):

```text
<data>/
  raw/<세션>/<장면>/*.mp4|mov     녹화 원본 — 장면별 영상 (직접 넣음)
  raw/<세션>/*.mp4 + *.segments.csv  녹화 원본 — 연속 영상과 구간 파일 (직접 넣음)
  frames/<세션>/<장면>/*.jpg      extract_frames.py
  frames/manifest.csv
  prelabel/tasks.json             prelabel.py
  labels/<세션>/<장면>/*.txt      ls_to_yolo.py (검수 완료)
  public/<이름>/images, labels    import_public.py
  datasets/byeol-home/            build_dataset.py (data.yaml, scenes/, split_report.json)
  label-studio/                   Label Studio DB·내보내기
<runs>/
  weights/yolo26n.pt              사전학습 가중치 (자동 다운로드)
  train/<이름>/weights/best.pt    train.py
  eval/<이름>/scenes.md, .csv     eval_scenes.py
  ultralytics-config/             이 폴더 전용 ultralytics 설정
```

ultralytics 는 원래 PC 전체에서 같이 쓰는 설정 파일을 씁니다. 이 스크립트들은 `YOLO_CONFIG_DIR` 로
`<runs>/ultralytics-config` 의 전용 설정을 쓰게 해서 **사용 이벤트 전송(`sync`)을 끄고**, 가중치
(AMP 검사용 포함)가 레포 폴더에 내려받아지지 않게 합니다. PC 의 전역 설정은 바꾸지 않습니다.

## 3. 녹화 안내

| 항목 | 설정 |
|---|---|
| 방향 | **가로** 촬영 (설치 카메라와 같게. 세로 영상이면 `extract_frames.py` 가 경고) |
| 코덱 | H.264 권장 — 아이폰: 설정 > 카메라 > 포맷 > **"호환성 우선"**. 갤럭시: 카메라 설정 > 고급 동영상 옵션 > **HEVC 끄기**. HEVC 는 이 PC(OpenCV 5.0.0)에서 읽기 확인, 다른 환경은 미검증 |
| 끌 것 | **야간 모드, HDR, 흔들림 보정** — 실제 고정 카메라에는 없는 보정이라 영상 성질이 달라짐 |
| 렌즈 | **광각 0.5x** |
| 고정 | **삼각대** 등으로 고정. 손으로 들고 찍지 않음 |
| 구도 | **방 모서리 높은 곳에서 내려다보는** 구도 (설치 위치와 같게) |

녹화 파일을 넣는 방법은 두 가지입니다. 파일 이름은 상관없습니다.

- **장면별 영상**: `<data>/raw/<세션>/<장면>/` 폴더에 넣기만 하면 됩니다.
- **연속 영상** (여러 장면을 이어서 찍은 영상): `<data>/raw/<세션>/` 에 바로 넣고, 같은 이름의
  구간 파일 `<영상 이름>.segments.csv` 를 옆에 둡니다. 프레임을 직접 보고 구간을 정한 뒤 실행합니다.

- 세션: `s1` (검증용), `s2` (시험용). 세션 = 녹화한 날(회차) 단위입니다.
- 장면 폴더 (이 이름만 허용):

| 폴더 | 장면 | 결과표 행 |
|---|---|---|
| `standing` | 서 있음 · 이동 | 서 있음 · 이동 |
| `sitting` | 앉음 | 앉음 |
| `lying` | 누움 (소파·침대·바닥) | **누움** |
| `occluded` | 몸의 절반 이상이 가구나 이불에 가려짐 | **가려짐** |
| `evening` | 저녁 조명·역광 | **저녁 조명 · 역광** |
| `bg-empty` | 사람 없음 | 배경 (사람 없음) — 오검출 확인 |
| `bg-tv` | TV 켜짐, 사람 없음 | **배경 (TV 켜짐)** — 오검출 확인 |
| `transition` | 일어나는 중·화면 끝에 걸림 등 장면을 정하기 애매함 | 전환 동작 · 화면 끝 (참고) — 장면 비교에 쓰지 않음, all 행에는 포함 |

예: `<data>/raw/s1/lying/IMG_0012.MOV`, `<data>/raw/s2/bg-tv/tv.mp4`

구간 파일 예 (`<data>/raw/s1/250.segments.csv`). 단위는 초, 시작 포함·끝 미포함, `#` 뒤는 주석입니다.

```text
start,end,scene
3,14,standing
14,16,transition   # 화면 끝에 걸림
27,28,lying
28,36,occluded     # 이불에 상체가 가려짐
```

- 구간에 없는 시각과 `exclude` 구간은 프레임을 저장하지 않습니다 (예: 사람이 아직 들어오지 않은 처음 몇 초).
- 프레임 파일 이름의 시각은 원본 영상 기준입니다. `frames/manifest.csv` 의 `source`·`sec` 로 원본 위치를 찾습니다.
- 모르는 장면, 구간 겹침, 구간 파일 없음은 오류로 멈춥니다.
- 구간 파일을 고친 뒤에는 `extract_frames.py --overwrite` 로 다시 뽑습니다. 그냥 실행하면 멈춥니다.
  다시 뽑으면 예전 구간으로 저장한 프레임은 지워집니다.

촬영 대상의 동의를 받고, 학습·검증이 끝난 원본 영상은 삭제합니다.

## 4. 진행 순서

모든 명령은 이 폴더에서 `.venv\Scripts\python` 으로 실행합니다 (Label Studio 만 `.venv-labelstudio`).

| 순서 | 명령 | 입력 → 출력 |
|---|---|---|
| 1 | `extract_frames.py` | `raw/` → `frames/` (초당 1장, 긴 변 1280px, `--fps`·`--max-side` 로 변경) |
| 2 | `prelabel.py` | `frames/` → `prelabel/tasks.json` (초안) |
| 3 | Label Studio 검수 (5장) | `tasks.json` → JSON 내보내기 |
| 4 | `ls_to_yolo.py <내보내기.json>` | → `labels/` (검수 완료만) |
| 5 | `import_public.py --src … --name … --person-classes …` | 공개 데이터 → `public/<이름>/` |
| 6 | `build_dataset.py` | → `datasets/byeol-home/data.yaml` |
| 7 | `eval_scenes.py` | 사전학습 `yolo26n.pt` **기준선** 장면별 표 (문서 6장 3단계) |
| 8 | 파인튜닝 여부 결정 | 약한 장면(누움·가려짐·저녁) Recall < 0.90 (가정) 일 때만 |
| 9 | `train.py --mode rehearsal` | `fraction=0.1, epochs=3` — 경로·설정이 돌아가는지만 확인 |
| 10 | `train.py --mode full` | 문서 3.4 설정 → `best.pt` |
| 11 | `eval_scenes.py --model <best.pt>` | 검증 세트 비교표 |
| 12 | `eval_scenes.py --model <최종.pt> --split test --final` | 시험 세트 **최종 1회** |

공개 데이터가 아직 없어도 1~4, 6, 7 (기준선 평가)은 할 수 있습니다. 학습 세트가 비어 있으면
`build_dataset.py` 가 알려 주고 `train.py` 는 시작하지 않습니다.

## 5. 라벨링 (Label Studio)

### 실행

```powershell
.venv-labelstudio\Scripts\python start_label_studio.py
```

브라우저에서 `http://127.0.0.1:8080` 을 열고 처음 한 번 계정을 만듭니다 (이 PC 안의 DB 에만 저장).
`start_label_studio.py` 가 설정하는 환경변수:

| 환경변수 | 값 | 의미 |
|---|---|---|
| `LABEL_STUDIO_LOCAL_FILES_SERVING_ENABLED` | `true` | 이미지를 업로드하지 않고 로컬 파일로 보여 줌 |
| `LABEL_STUDIO_LOCAL_FILES_DOCUMENT_ROOT` | `<data>` | 로컬 파일 주소(`/data/local-files/?d=…`)의 기준 폴더 |
| `LABEL_STUDIO_BASE_DATA_DIR` | `<data>/label-studio` | DB·내보내기 위치 (기본값은 사용자 폴더) |
| `LABEL_STUDIO_COLLECT_ANALYTICS` | `false` | 사용 통계 전송 끔 |
| `LABEL_STUDIO_SENTRY_DSN`, `LABEL_STUDIO_FRONTEND_SENTRY_DSN` | 빈 값 | 오류 보고(Sentry) 끔 (기본값은 켜져 있음) |
| `LABEL_STUDIO_LATEST_VERSION_CHECK` | `false` | 시작할 때 새 버전 확인(PyPI 접속) 끔 |

서버는 `127.0.0.1` 에서만 열려 같은 네트워크의 다른 기기에서 접속하지 못합니다.
참고: Label Studio 는 사용자 폴더에 무작위 설치 ID 파일(`label-studio/user_id`)을 만듭니다.
위치는 바꿀 수 없고, 사용 통계를 끄면 전송되지 않습니다.

### 프로젝트 만들기 (처음 한 번)

1. Create Project → Labeling Setup → Custom template → `label_config.xml` 내용을 붙여 넣기
2. 프로젝트 Settings → Cloud Storage → Add Source Storage → **Local files**
   - Absolute local path: `<data>/frames` 의 절대 경로
   - "Treat every bucket object as a source file" 켜기
   - **Sync 는 누르지 않습니다.** 누르면 초안 없는 작업이 중복으로 생깁니다. 저장소 연결은 이미지를 보여 줄 권한만 줍니다.
3. Import → `<data>/prelabel/tasks.json` 업로드. 초안 박스가 predictions 로 들어갑니다.

### 검수 원칙

> **초안에는 사전학습 YOLO 가 이미 찾은 사람만 들어 있습니다.**
> 누움·가려짐·저녁처럼 모델이 놓치는 장면이 바로 우리가 확인하려는 약점 장면입니다.
> **박스가 없는 사람을 직접 찾아 추가하는 것이 검수의 핵심**입니다. 초안을 그대로 제출하면
> 놓친 사람이 정답에서도 빠져, 기준선 Recall 이 실제보다 높게 나옵니다.

- 모든 프레임을 열어 확인하고 제출(Submit)합니다. 제출하지 않은 프레임은 데이터셋에서 빠집니다.
- 몸 일부만 보여도 사람이면 보이는 부분에 박스를 그립니다.
- 박스는 보이는 몸을 감싸게 그립니다 (발 위치가 Zone 판정에 쓰임). 회전 박스는 쓰지 않습니다.
- **TV·거울·액자 속 사람의 초안 박스는 지웁니다.** 사람이 아닙니다.
- 사람이 없는 프레임(배경)은 박스 0개로 제출합니다. 빈 라벨이 "사람 없음" 정답입니다.

### 내보내기

Export → **JSON** (JSON-MIN 아님) → 받은 파일을:

```powershell
.venv\Scripts\python ls_to_yolo.py <내보낸 파일.json>
```

사람이 제출한 annotations 만 라벨이 되고, 초안(predictions)은 쓰지 않습니다. 전체 미검수 프레임 수는
`build_dataset.py` 가 보고합니다.

## 6. 공개 데이터 (학습)

라이선스를 확인한 데이터셋을 YOLO txt 형식으로 받아 변환합니다.

```powershell
.venv\Scripts\python import_public.py --src <받은 폴더> --name fall-a --person-classes 0,1 --audit
```

- `--person-classes`: 원본 데이터셋의 클래스 중 사람에 해당하는 번호 (예: `fall`, `person`). 나머지 클래스 박스는 버립니다.
- 세그멘테이션 다각형 라벨은 감싸는 박스로 바꿉니다. 라벨이 없는 이미지는 배경 이미지로 들어갑니다.
- **`--audit` 을 권장합니다.** 낙상 데이터셋은 넘어진 사람만 라벨하고 서 있는 사람은 비워 둔 경우가 있습니다.
  그대로 학습하면 "서 있는 사람 = 배경" 을 배웁니다. `audit.csv` 에 사전학습 모델이 찾았는데 라벨이 없는
  사람이 있는 이미지를 남기니, 비율을 보고 그 데이터셋을 쓸지 정합니다.
- 출력 파일 이름은 `p_<이름>_…` 로 시작해 녹화 세션 이름과 섞이지 않습니다.

## 7. 데이터셋 · 평가 · 학습

```powershell
.venv\Scripts\python build_dataset.py                       # 기본: 검증 s1, 시험 s2, 공개 데이터 전부
.venv\Scripts\python eval_scenes.py                         # 기준선 (사전학습 yolo26n.pt, 검증 세트)
.venv\Scripts\python train.py --mode rehearsal
.venv\Scripts\python train.py --mode full
.venv\Scripts\python eval_scenes.py --model <runs>\train\full\weights\best.pt
.venv\Scripts\python eval_scenes.py --model <최종 가중치> --split test --final
```

`build_dataset.py` 검사 (하나라도 걸리면 데이터셋을 만들지 않음):
- 검증과 시험에 같은 녹화 세션이 없다
- 학습 세트에 녹화 세션 이름(`s1_…`) 파일이 없다
- 세 세트 사이에 내용이 같은 이미지(해시)가 없다
- 라벨이 모두 클래스 0, 값 5개, 좌표 0~1

`eval_scenes.py`:
- 모델 하나를 받아 장면별 `Images · Instances · P · R · mAP50 · mAP50-95` 표를 냅니다 (`scenes.md`, `scenes.csv`).
- `conf=0.001` 로 PR 곡선 전체를 구합니다 (문서 4.4). P·R 은 ultralytics 가 F1 최대 conf 에서 계산한 값입니다.
- 배경 장면은 정답 박스가 0개라 P·R·mAP 가 정의되지 않습니다. 대신 `--bg-conf` (기본 0.25) 이상
  오검출 박스 수와 오검출 이미지 수를 따로 표로 냅니다.
- 시험 세트는 `--final` 을 붙여야 실행됩니다. 학습·설정 조정이 끝난 뒤 한 번만 씁니다.

`train.py`:

| 모드 | 설정 |
|---|---|
| `rehearsal` | `fraction=0.1, epochs=3, imgsz=640` (성능 판단용 아님) |
| `full` | `imgsz=640, epochs=300, patience=15, batch=-1, cache=True, freeze=10`, optimizer·amp·warmup 은 기본값 |

- 시작 전에 학습·검증 이미지와 박스 수를 확인하고, 0개면 멈춥니다. data.yaml 경로가 틀려도 ultralytics 는 에러 없이 라벨 0개로 학습을 끝내기 때문입니다.
- `--lr0` 를 줄 때는 `--optimizer` 도 지정해야 합니다. `auto` 는 lr0 를 덮어씁니다.
- `cache=True` 는 이미지를 RAM 에 올립니다. 공개 데이터가 커서 RAM 이 부족하면 `--cache disk` 를 씁니다.

## 8. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `extract_frames.py` 가 "프레임을 하나도 읽지 못했습니다" | HEVC 영상일 수 있음 (이 PC 의 OpenCV 5.0.0 에서는 읽힘, 다른 환경은 미검증) → 폰 설정을 H.264 로 바꿔 다시 녹화 (3장) |
| 세로 영상 경고 | 가로로 다시 녹화 |
| Label Studio 에서 이미지가 안 보임 (404) | 프로젝트에 Local files 저장소를 연결했는지, 경로가 `<data>/frames` 인지 (5장) |
| 아무것도 예측하지 못함 | `conf=0.1` 로 낮춰 박스가 나오는지, `split_report.json` 의 라벨 수 (문서 3.5) |

## 9. 테스트

```powershell
.venv\Scripts\python -m unittest discover -s tests -v
```

합성 영상·이미지·라벨만 씁니다 (GPU·실제 데이터 불필요). 파일 이름 규칙, 프레임 추출, 연속 영상 구간 분할,
Label Studio 변환, 공개 데이터 변환, 세션 누수·중복 이미지·라벨 검사, 학습 설정을 확인합니다.
