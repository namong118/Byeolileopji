"""YOLO26n 사람 검출 파인튜닝 (model-training-validation.md 3.4 설정 그대로).

  python train.py --mode rehearsal   fraction=0.1, epochs=3, imgsz=640  — 경로·설정이 돌아가는지만 확인
  python train.py --mode full        epochs=300, patience=15, batch=-1, cache=True, freeze=10, imgsz=640

입력:  data.yaml (기본: <data>/datasets/byeol-home/data.yaml), 시작 가중치 yolo26n.pt
출력:  <runs>/train/<이름>/weights/best.pt, last.pt, results.csv, 학습 곡선

시작 전에 학습·검증 라벨 수를 확인한다. data.yaml 경로가 틀려도 ultralytics 는 에러 없이
라벨 0개로 학습을 끝내기 때문이다 (문서 3.5).
리허설 결과는 성능 판단에 쓰지 않는다.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

from common import (DEFAULT_WEIGHTS, LabelError, data_dir, label_path_for, list_images, read_yolo_label, runs_dir,
                    setup_ultralytics, weights_path)

REHEARSAL = {"fraction": 0.1, "epochs": 3, "imgsz": 640}
FULL = {"imgsz": 640, "epochs": 300, "patience": 15, "batch": -1, "cache": True, "freeze": 10}


def train_kwargs(mode: str, lr0: float | None, optimizer: str | None, cache: str | None,
                 freeze: int | None = None) -> dict:
    kwargs = dict(REHEARSAL if mode == "rehearsal" else FULL)
    if lr0 is not None:
        # optimizer=auto 는 lr0 를 덮어쓴다 (문서 3.4). lr0 를 바꿀 때는 optimizer 를 반드시 명시한다.
        if not optimizer or optimizer.lower() == "auto":
            raise ValueError("--lr0 를 줄 때는 --optimizer 도 지정하세요 (auto 는 lr0 를 덮어씁니다). 예: --optimizer SGD")
        kwargs["lr0"] = lr0
    if optimizer:
        kwargs["optimizer"] = optimizer
    if cache is not None and mode == "full":
        kwargs["cache"] = {"true": True, "false": False}.get(cache.lower(), cache)  # ram 부족하면 disk
    if freeze is not None:
        kwargs["freeze"] = freeze  # 앞에서부터 freeze 개 층 고정 (yolo26n: 0–10 backbone, 11–22 neck, 23 Detect)
    return kwargs


def count_split(root: Path, rel: str) -> tuple[int, int]:
    images = list_images(root / rel)
    boxes = 0
    for image in images:
        boxes += len(read_yolo_label(label_path_for(image)))
    return len(images), boxes


def preflight(data_yaml: Path) -> None:
    cfg = yaml.safe_load(data_yaml.read_text(encoding="utf-8"))
    if cfg.get("names") not in ({0: "person"}, ["person"]):
        raise SystemExit(f"클래스는 person 1개여야 합니다: {cfg.get('names')}")
    root = Path(cfg["path"])
    for split in ("train", "val"):
        try:
            n_images, n_boxes = count_split(root, cfg[split])
        except LabelError as e:
            raise SystemExit(f"라벨 오류: {e}")
        print(f"사전 점검 {split}: 이미지 {n_images}장, 사람 박스 {n_boxes}개")
        if n_images == 0 or n_boxes == 0:
            raise SystemExit(f"{split} 세트에 이미지나 라벨이 없습니다 — data.yaml 경로와 build_dataset.py 결과를 확인하세요.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["rehearsal", "full"], required=True)
    ap.add_argument("--data", type=Path, help="data.yaml (기본: <data>/datasets/byeol-home/data.yaml)")
    ap.add_argument("--model", default=DEFAULT_WEIGHTS, help="시작 가중치 (기본 yolo26n.pt)")
    ap.add_argument("--name", help="결과 폴더 이름 (기본: rehearsal / full)")
    ap.add_argument("--lr0", type=float, help="초기 학습률 (줄 때는 --optimizer 필수)")
    ap.add_argument("--optimizer", help="SGD, AdamW 등 (기본 auto)")
    ap.add_argument("--cache", help="full 모드 캐시: true(기본, RAM) / disk / false")
    ap.add_argument("--freeze", type=int, help="고정할 앞쪽 층 수 (기본: full 10)")
    ap.add_argument("--device", default="0")
    args = ap.parse_args(argv)

    try:
        kwargs = train_kwargs(args.mode, args.lr0, args.optimizer, args.cache, args.freeze)
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1
    data_yaml = args.data or data_dir() / "datasets" / "byeol-home" / "data.yaml"
    if not data_yaml.exists():
        print(f"data.yaml 이 없습니다: {data_yaml} (build_dataset.py 먼저)", file=sys.stderr)
        return 1
    preflight(data_yaml)

    setup_ultralytics()
    from ultralytics import YOLO

    model = YOLO(str(weights_path(args.model)))
    print(f"학습 설정 ({args.mode}): {kwargs}")
    model.train(data=str(data_yaml), device=args.device, project=str(runs_dir() / "train"),
                name=args.name or args.mode, **kwargs)
    save_dir = Path(model.trainer.save_dir)
    print(f"→ {save_dir}")
    best = save_dir / "weights" / "best.pt"
    if best.exists():
        print(f"장면별 평가: python eval_scenes.py --model \"{best}\"")
    return 0


if __name__ == "__main__":  # Windows 에서 데이터로더 다중 프로세스가 스크립트를 다시 import 하므로 필요
    sys.exit(main())
