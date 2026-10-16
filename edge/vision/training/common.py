"""학습 스크립트 공용 — 경로 설정, 장면 코드, 프레임 파일 이름 규칙, 라벨 검사."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

TRAINING_DIR = Path(__file__).resolve().parent

# 장면 코드 → 결과표 행 이름. 순서가 결과표 행 순서다 (model-training-validation.md 4.2).
SCENES: dict[str, str] = {
    "standing": "서 있음 · 이동",
    "sitting": "앉음",
    "lying": "누움",
    "occluded": "가려짐 (조리대 · 식탁)",
    "evening": "저녁 조명 · 역광",
    "bg-empty": "배경 (사람 없음)",
    "bg-tv": "배경 (TV 켜짐)",
}
# 사람이 없는 장면. 정답 박스가 0개라 P·R·mAP 대신 오검출 수로 본다.
BACKGROUND_SCENES = {"bg-empty", "bg-tv"}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v"}

SESSION_RE = re.compile(r"^s\d+$")
FRAME_NAME_RE = re.compile(r"^(s\d+)_([a-z-]+)_(c\d{2,})_t(\d{5,})$")
# 공개 데이터 파일 이름이 녹화 세션 이름처럼 보이면 안 된다 (누수 검사).
SESSION_PREFIX_RE = re.compile(r"^s\d+_")

DEFAULT_WEIGHTS = "yolo26n.pt"


def _load_dotenv() -> None:
    """training/.env 의 KEY=VALUE 를 환경변수로 (이미 있는 환경변수가 우선). Label Studio venv 에서도 쓰려고 직접 읽는다."""
    env_file = TRAINING_DIR / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def _dir_from_env(name: str, default: str) -> Path:
    _load_dotenv()
    value = os.environ.get(name, "").strip()
    path = Path(value) if value else TRAINING_DIR / default
    if not path.is_absolute():
        path = TRAINING_DIR / path
    return path.resolve()


def data_dir() -> Path:
    """영상·프레임·라벨·데이터셋 위치. .env 의 BYEOL_DATA_DIR, 없으면 training/data."""
    return _dir_from_env("BYEOL_DATA_DIR", "data")


def runs_dir() -> Path:
    """가중치·학습·평가 결과 위치. .env 의 BYEOL_RUNS_DIR, 없으면 training/runs."""
    return _dir_from_env("BYEOL_RUNS_DIR", "runs")


def setup_ultralytics() -> None:
    """ultralytics 를 import 하기 전에 호출한다. 이 학습 폴더 전용 설정 파일을 쓰게 한다.

    - 사용 이벤트 전송(sync)을 끈다.
    - 가중치(AMP 검사용 포함)·결과·데이터셋 기본 위치를 <runs>·<data> 아래로 둔다.
    PC 의 전역 ultralytics 설정 파일은 다른 프로젝트가 같이 쓰므로 건드리지 않는다.
    """
    if os.environ.get("BYEOL_ULTRALYTICS_READY") == "1":
        return
    config_dir = runs_dir() / "ultralytics-config"
    # 폴더가 없으면 ultralytics 가 /tmp 등 다른 위치로 대신 쓰므로 먼저 만든다.
    (config_dir / "Ultralytics").mkdir(parents=True, exist_ok=True)
    os.environ["YOLO_CONFIG_DIR"] = str(config_dir)
    wanted = {
        "sync": False,
        "weights_dir": str(runs_dir() / "weights"),
        "runs_dir": str(runs_dir()),
        "datasets_dir": str(data_dir() / "datasets"),
    }
    settings_file = config_dir / "Ultralytics" / "settings.json"
    try:
        current = json.loads(settings_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        current = {}
    if any(current.get(k) != v for k, v in wanted.items()):
        # 설정은 import 시점에 읽히므로 별도 프로세스에서 먼저 써 둔다.
        code = "import json, sys; from ultralytics.utils import SETTINGS; SETTINGS.update(json.loads(sys.argv[1]))"
        subprocess.run([sys.executable, "-c", code, json.dumps(wanted)], check=True, env=os.environ.copy(),
                       stdout=subprocess.DEVNULL)
    if "ultralytics" in sys.modules:
        raise RuntimeError("setup_ultralytics() 는 ultralytics 를 import 하기 전에 호출해야 합니다.")
    os.environ["BYEOL_ULTRALYTICS_READY"] = "1"


def weights_path(name: str = DEFAULT_WEIGHTS) -> Path:
    """사전학습 가중치 경로. 없으면 ultralytics 가 이 위치로 내려받는다."""
    if Path(name).is_absolute() or Path(name).exists():
        return Path(name)
    setup_ultralytics()
    target = runs_dir() / "weights" / name
    if not target.exists():
        from ultralytics.utils.downloads import attempt_download_asset

        target.parent.mkdir(parents=True, exist_ok=True)
        attempt_download_asset(target)
    return target


@dataclass(frozen=True)
class FrameName:
    session: str
    scene: str
    clip: str
    ds: int  # 영상 시작부터의 시각, 0.1초 단위 (t00120 = 12.0초)

    @property
    def stem(self) -> str:
        return f"{self.session}_{self.scene}_{self.clip}_t{self.ds:05d}"


def parse_frame_name(stem: str) -> FrameName | None:
    """`s1_lying_c01_t00120` → FrameName. 규칙에 맞지 않거나 모르는 장면이면 None."""
    m = FRAME_NAME_RE.match(stem)
    if not m or m.group(2) not in SCENES:
        return None
    return FrameName(m.group(1), m.group(2), m.group(3), int(m.group(4)))


def list_images(folder: Path) -> list[Path]:
    if not folder.exists():
        return []
    return sorted(p for p in folder.rglob("*") if p.suffix.lower() in IMAGE_EXTS)


def label_path_for(image: Path) -> Path:
    """ultralytics 규칙: 경로의 마지막 images 폴더를 labels 로, 확장자를 .txt 로."""
    parts = list(image.parts)
    for i in range(len(parts) - 1, -1, -1):
        if parts[i] == "images":
            parts[i] = "labels"
            return Path(*parts).with_suffix(".txt")
    raise ValueError(f"경로에 images 폴더가 없습니다: {image}")


class LabelError(ValueError):
    pass


def read_yolo_label(path: Path, num_classes: int = 1) -> list[tuple[int, float, float, float, float]]:
    """YOLO 박스 라벨을 읽고 검사한다. 파일이 없으면 박스 0개(배경)."""
    if not path.exists():
        return []
    boxes = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) != 5:
            raise LabelError(f"{path}:{n} 값이 5개가 아닙니다: {line!r}")
        try:
            cls = int(parts[0])
            cx, cy, w, h = (float(v) for v in parts[1:])
        except ValueError as e:
            raise LabelError(f"{path}:{n} 숫자가 아닙니다: {line!r}") from e
        if not 0 <= cls < num_classes:
            raise LabelError(f"{path}:{n} 클래스 번호 {cls} (허용: 0~{num_classes - 1})")
        if not all(0.0 <= v <= 1.0 for v in (cx, cy, w, h)) or w <= 0 or h <= 0:
            raise LabelError(f"{path}:{n} 좌표가 0~1 범위를 벗어납니다: {line!r}")
        boxes.append((cls, cx, cy, w, h))
    return boxes


def format_yolo_line(cls: int, cx: float, cy: float, w: float, h: float) -> str:
    return f"{cls} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"


def clamp01(v: float) -> float:
    return min(1.0, max(0.0, v))
