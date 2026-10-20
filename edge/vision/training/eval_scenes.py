"""모델 하나를 장면별로 평가해 model-training-validation.md 4.2 형식의 표를 만든다.

입력:  --model  가중치 (사전학습 yolo26n.pt 를 주면 기준선 측정, best.pt 를 주면 파인튜닝 결과)
       --data   build_dataset.py 가 만든 data.yaml
       --split  val (기본) | test (--final 이 있어야 실행 — 시험 세트는 마지막에 한 번만)
출력:  콘솔 표, <runs>/eval/<이름>/scenes.md, scenes.csv, val/all/ (PR 곡선 등 ultralytics 그림)

- P·R·mAP 는 conf=0.001 로 PR 곡선 전체를 구해 계산한다 (문서 4.4). P·R 은 ultralytics 가
  F1 이 가장 높은 conf 에서 계산한 값이다.
- 배경 장면(사람 없음·TV 켜짐)은 정답 박스가 0개라 P·R·mAP 가 정의되지 않는다. 대신
  --bg-conf(기본 0.25) 이상인 오검출 박스 수와 오검출이 난 이미지 수를 따로 표로 낸다.
- all 행은 배경 장면과 전환 동작(transition)을 포함한 세트 전체다. 전환 동작 행은 장면 비교가 아닌 참고용이다.
- 실제 사용 기준 표: --op-conf(기본 0.25) 이상 박스만 남겨 장면별 "찾은 사람 / 정답 사람" 과 오검출 박스 수를 센다.
  예측 박스를 conf 높은 순으로 아직 짝이 없는 정답 박스 중 IoU 가 가장 큰 것과 짝짓고, IoU 가 --op-iou(기본 0.5)
  이상이면 찾은 사람, 아니면 오검출이다.
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import datetime
from pathlib import Path

import yaml

from common import (BACKGROUND_SCENES, SCENES, data_dir, label_path_for, read_yolo_label, runs_dir, setup_ultralytics,
                    weights_path)


def count_instances(images: list[Path]) -> int:
    return sum(len(read_yolo_label(label_path_for(p))) for p in images)


def fmt(v) -> str:
    return "—" if v is None else (f"{v:.3f}" if isinstance(v, float) else str(v))


def run_val(model, yaml_path: Path, args, out_dir: Path, name: str, plots: bool) -> dict:
    m = model.val(data=str(yaml_path), split="val", conf=args.conf, imgsz=args.imgsz, batch=args.batch,
                  device=args.device, plots=plots, save_json=False, verbose=False,
                  project=str(out_dir / "val"), name=name, exist_ok=True)
    return {"P": float(m.box.mp), "R": float(m.box.mr), "mAP50": float(m.box.map50), "mAP50-95": float(m.box.map)}


def iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def match_boxes(gt: list[tuple], preds: list[tuple[tuple, float]], iou_thr: float) -> tuple[int, int]:
    """(찾은 정답 수, 오검출 수). gt 는 xyxy, preds 는 (xyxy, conf). conf 높은 예측부터 정답 하나씩 짝짓는다."""
    free = list(range(len(gt)))
    found = 0
    for box, _ in sorted(preds, key=lambda p: -p[1]):
        best = max(free, key=lambda i: iou(gt[i], box), default=None)
        if best is not None and iou(gt[best], box) >= iou_thr:
            free.remove(best)
            found += 1
    return found, len(preds) - found


def gt_xyxy(image: Path) -> list[tuple[float, float, float, float]]:
    return [(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2) for _, cx, cy, w, h in read_yolo_label(label_path_for(image))]


def operating_counts(model, images: list[Path], args) -> dict[str, tuple[int, int, int]]:
    """이미지 파일 이름별 (정답 사람 수, 찾은 사람 수, 오검출 수) — conf ≥ --op-conf."""
    out = {}
    for path, r in zip(images, model.predict([str(p) for p in images], classes=[0], conf=args.op_conf, imgsz=args.imgsz,
                                             device=args.device, stream=True, verbose=False)):
        gt = gt_xyxy(path)
        preds = [(tuple(b), float(c)) for b, c in zip(r.boxes.xyxyn.tolist(), r.boxes.conf.tolist())]
        out[path.name] = (len(gt), *match_boxes(gt, preds, args.op_iou))
    return out


def scene_yaml(out_dir: Path, base: dict, list_file: Path, scene: str) -> Path:
    path = out_dir / "yaml" / f"{scene}.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    cfg = {"path": base["path"], "train": list_file.as_posix(), "val": list_file.as_posix(), "names": base["names"]}
    path.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return path


def background_fp(model, images: list[Path], args) -> dict:
    boxes = hit_images = 0
    for r in model.predict([str(p) for p in images], classes=[0], conf=args.bg_conf, imgsz=args.imgsz,
                           device=args.device, stream=True, verbose=False):
        n = len(r.boxes)
        boxes += n
        hit_images += n > 0
    return {"images": len(images), "fp_boxes": boxes, "fp_images": hit_images,
            "fp_image_rate": hit_images / len(images) if images else None}


def op_sum(counts) -> dict:
    gt = found = fp = 0
    for g, f, x in counts:
        gt, found, fp = gt + g, found + f, fp + x
    return {"gt": gt, "found": found, "fp": fp}


def default_name(model_arg: str, split: str) -> str:
    p = Path(model_arg)
    stem = p.parent.parent.name if p.stem in ("best", "last") and p.parent.name == "weights" else p.stem
    return f"{stem}_{split}_{datetime.now():%Y%m%d-%H%M%S}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="yolo26n.pt", help="가중치 (기본: 사전학습 yolo26n.pt = 기준선)")
    ap.add_argument("--data", type=Path, help="data.yaml (기본: <data>/datasets/byeol-home/data.yaml)")
    ap.add_argument("--split", choices=["val", "test"], default="val")
    ap.add_argument("--final", action="store_true", help="시험 세트 최종 평가임을 확인 (--split test 에 필요)")
    ap.add_argument("--conf", type=float, default=0.001, help="P·R·mAP 계산용 conf (기본 0.001)")
    ap.add_argument("--bg-conf", type=float, default=0.25, help="배경 장면 오검출 기준 conf (기본 0.25)")
    ap.add_argument("--op-conf", type=float, default=0.25, help="실제 사용 기준 표의 conf (기본 0.25)")
    ap.add_argument("--op-iou", type=float, default=0.5, help="실제 사용 기준 표에서 찾은 것으로 볼 IoU (기본 0.5)")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default="0")
    ap.add_argument("--name", help="결과 폴더 이름 (기본: 모델_split_시각)")
    args = ap.parse_args(argv)

    if args.split == "test" and not args.final:
        print("시험 세트는 학습·설정 조정이 모두 끝난 뒤 한 번만 평가합니다. 맞으면 --final 을 붙여 주세요.", file=sys.stderr)
        return 1
    data_yaml = args.data or data_dir() / "datasets" / "byeol-home" / "data.yaml"
    if not data_yaml.exists():
        print(f"data.yaml 이 없습니다: {data_yaml} (build_dataset.py 먼저)", file=sys.stderr)
        return 1
    base = yaml.safe_load(data_yaml.read_text(encoding="utf-8"))
    root = Path(base["path"])
    scenes_dir = root / "scenes"
    split_images = sorted((root / "images" / args.split).glob("*"))
    if not split_images:
        print(f"{args.split} 세트에 이미지가 없습니다.", file=sys.stderr)
        return 1

    setup_ultralytics()
    from ultralytics import YOLO

    model = YOLO(str(weights_path(args.model)))
    out_dir = runs_dir() / "eval" / (args.name or default_name(args.model, args.split))
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    all_yaml = scene_yaml(out_dir, base, root / "images" / args.split, "all")
    rows.append({"key": "all", "scene": "all", "Images": len(split_images), "Instances": count_instances(split_images),
                 **run_val(model, all_yaml, args, out_dir, "all", plots=True)})
    op = operating_counts(model, split_images, args)
    op_rows = [{"scene": "all", "Images": len(split_images), **op_sum(op.values())}]
    bg_rows = []
    for key, label in SCENES.items():
        list_file = scenes_dir / f"{args.split}_{key}.txt"
        images = [Path(l) for l in list_file.read_text(encoding="utf-8").splitlines() if l.strip()] if list_file.exists() else []
        if images:
            op_rows.append({"scene": label, "Images": len(images), **op_sum(op[p.name] for p in images)})
        row = {"key": key, "scene": label, "Images": len(images), "Instances": count_instances(images) if images else 0,
               "P": None, "R": None, "mAP50": None, "mAP50-95": None}
        if key in BACKGROUND_SCENES:
            if images:
                bg_rows.append({"key": key, "scene": label, **background_fp(model, images, args)})
        elif images and row["Instances"]:
            row.update(run_val(model, scene_yaml(out_dir, base, list_file, key), args, out_dir, key, plots=False))
        rows.append(row)

    cols = ["Images", "Instances", "P", "R", "mAP50", "mAP50-95"]
    lines = [
        f"모델: `{Path(args.model).name}` · 세트: {args.split} · conf={args.conf} · imgsz={args.imgsz}",
        "",
        "| 장면 | " + " | ".join(cols) + " |",
        "|---|" + "---|" * len(cols),
    ]
    for r in rows:
        name = f"**{r['scene']}**" if r["key"] in ("lying", "occluded", "evening", "bg-tv") else r["scene"]
        lines.append(f"| {name} | " + " | ".join(fmt(r[c]) for c in cols) + " |")
    lines += ["", "P·R 은 F1 이 가장 높은 conf 에서의 값. 배경 장면과 이미지가 없는 장면은 \"—\"."]
    lines += ["", f"실제 사용 기준 (conf ≥ {args.op_conf}, IoU ≥ {args.op_iou})", "",
              "| 장면 | Images | 찾은 사람 / 정답 사람 | 오검출 박스 |", "|---|---|---|---|"]
    for o in op_rows:
        lines.append(f"| {o['scene']} | {o['Images']} | {o['found']} / {o['gt']} | {o['fp']} |")
    if bg_rows:
        lines += ["", f"배경 장면 오검출 (conf ≥ {args.bg_conf})", "",
                  "| 장면 | Images | 오검출 박스 | 오검출 이미지 | 오검출 이미지 비율 |", "|---|---|---|---|---|"]
        for b in bg_rows:
            lines.append(f"| {b['scene']} | {b['images']} | {b['fp_boxes']} | {b['fp_images']} | {fmt(b['fp_image_rate'])} |")
    table = "\n".join(lines) + "\n"
    print("\n" + table)
    (out_dir / "scenes.md").write_text(table, encoding="utf-8")
    with (out_dir / "scenes.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["key", "scene", *cols, "fp_boxes", "fp_images", "fp_image_rate"])
        writer.writeheader()
        bg = {b["key"]: b for b in bg_rows}
        for r in rows:
            extra = bg.get(r["key"], {})
            writer.writerow({**{k: r[k] for k in ["key", "scene", *cols]},
                             **{k: extra.get(k) for k in ["fp_boxes", "fp_images", "fp_image_rate"]}})
    with (out_dir / "operating.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["scene", "Images", "found", "gt", "fp"])
        writer.writeheader()
        writer.writerows(op_rows)
    print(f"→ {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
