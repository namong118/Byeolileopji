"""공개 데이터셋(YOLO txt 형식) → person 1클래스 학습 데이터.

입력:  --src  YOLO 형식 폴더. images/ 와 labels/ 가 짝을 이루면 하위 구조는 상관없다
              (예: train/images + train/labels, images/train + labels/train)
       --person-classes  사람에 해당하는 원본 클래스 번호 (예: 0,1 — fall, person 등)
출력:  <data>/public/<이름>/images/*.jpg, labels/*.txt   (클래스는 모두 0 = person)
       <data>/public/<이름>/import_report.json
       --audit 을 주면 <data>/public/<이름>/audit.csv

다른 클래스 박스는 버린다. 세그멘테이션 다각형 라벨은 감싸는 박스로 바꾼다.
라벨 파일이 없거나 사람 박스가 없는 이미지는 배경 이미지로 들어간다.

주의: 낙상 데이터셋은 넘어진 사람만 라벨하고 서 있는 사람은 비워 둔 경우가 있다. 그대로
학습하면 "서 있는 사람 = 배경" 을 배운다. --audit 은 사전학습 모델이 찾았는데 라벨이 없는
사람이 있는 이미지를 목록으로 남긴다. 목록을 보고 데이터셋을 쓸지 정한다.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import sys
from pathlib import Path

from common import (DEFAULT_WEIGHTS, SESSION_PREFIX_RE, clamp01, data_dir, format_yolo_line, label_path_for,
                    list_images, setup_ultralytics, weights_path)

MARKER = ".byeol_public"
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def convert_line(line: str, person_classes: set[int]) -> str | None:
    """원본 라벨 한 줄 → person 박스 한 줄. 사람 클래스가 아니면 None."""
    parts = line.split()
    if not parts:
        return None
    cls = int(float(parts[0]))
    if cls not in person_classes:
        return None
    values = [float(v) for v in parts[1:]]
    if len(values) == 4:
        cx, cy, w, h = values
        x1, y1, x2, y2 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    elif len(values) >= 6 and len(values) % 2 == 0:  # 다각형 x1 y1 x2 y2 …
        xs, ys = values[0::2], values[1::2]
        x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
    else:
        raise ValueError(f"알 수 없는 라벨 형식: {line!r}")
    x1, y1, x2, y2 = clamp01(x1), clamp01(y1), clamp01(x2), clamp01(y2)
    if x2 <= x1 or y2 <= y1:
        return None
    return format_yolo_line(0, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1)


def output_stem(image: Path, src: Path, name: str) -> str:
    """p_<이름>_<원본 상대 경로>. 녹화 세션 이름(s1_ …)과 겹치지 않게 p_ 로 시작한다."""
    rel = [p for p in image.relative_to(src).with_suffix("").parts if p != "images"]
    stem = f"p_{name}_" + "__".join(rel)
    stem = re.sub(r"[^A-Za-z0-9_.-]", "-", stem)
    assert not SESSION_PREFIX_RE.match(stem)
    return stem


def iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def yolo_to_xyxy(line: str):
    _, cx, cy, w, h = (float(v) for v in line.split())
    return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2


def audit(out: Path, model_name: str, conf: float, device: str) -> tuple[int, int]:
    """사전학습 모델이 찾았는데 라벨(IoU 0.5 이상)이 없는 사람이 있는 이미지를 audit.csv 로 남긴다."""
    setup_ultralytics()
    from ultralytics import YOLO

    model = YOLO(str(weights_path(model_name)))
    rows = []
    images = list_images(out / "images")
    for image in images:
        label_file = label_path_for(image)
        labels = [yolo_to_xyxy(l) for l in label_file.read_text(encoding="utf-8").splitlines() if l.strip()]
        r = model.predict(str(image), classes=[0], conf=conf, device=device, verbose=False)[0]
        dets = [tuple(b) for b in r.boxes.xyxyn.tolist()]
        missing = sum(1 for d in dets if all(iou(d, l) < 0.5 for l in labels))
        if missing:
            rows.append({"image": image.name, "label_boxes": len(labels), "detected": len(dets), "unlabeled_detected": missing})
    with (out / "audit.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["image", "label_boxes", "detected", "unlabeled_detected"])
        writer.writeheader()
        writer.writerows(rows)
    return len(images), len(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, required=True, help="공개 데이터셋 폴더 (YOLO 형식)")
    ap.add_argument("--name", required=True, help="데이터셋 이름 (영문 소문자·숫자·-)")
    ap.add_argument("--person-classes", required=True, help="사람 클래스 번호, 쉼표로 구분 (예: 0,1)")
    ap.add_argument("--out", type=Path, help="출력 상위 폴더 (기본: <data>/public)")
    ap.add_argument("--audit", action="store_true", help="라벨 누락 의심 이미지 목록 만들기 (GPU 사용)")
    ap.add_argument("--audit-conf", type=float, default=0.5)
    ap.add_argument("--model", default=DEFAULT_WEIGHTS)
    ap.add_argument("--device", default="0")
    args = ap.parse_args(argv)

    if not NAME_RE.match(args.name):
        print("--name 은 영문 소문자·숫자·- 만 씁니다.", file=sys.stderr)
        return 1
    person_classes = {int(c) for c in args.person_classes.split(",") if c.strip()}
    src = args.src.resolve()
    out = (args.out or data_dir() / "public") / args.name
    if out.exists():
        if not (out / MARKER).exists():
            print(f"출력 폴더가 이미 있고 이 스크립트가 만든 폴더가 아닙니다: {out}", file=sys.stderr)
            return 1
        shutil.rmtree(out)
    (out / "images").mkdir(parents=True)
    (out / "labels").mkdir(parents=True)
    (out / MARKER).write_text("import_public.py 가 만든 폴더 (다시 실행하면 지우고 새로 만든다)\n", encoding="utf-8")

    images = [p for p in list_images(src) if "images" in p.relative_to(src).parts]
    if not images:
        print(f"images/ 폴더 아래 이미지가 없습니다: {src}", file=sys.stderr)
        return 1
    stats = {"images": 0, "person_boxes": 0, "dropped_boxes": 0, "background_images": 0, "missing_label_files": 0}
    seen: set[str] = set()
    for image in images:
        stem = output_stem(image, src, args.name)
        if stem in seen:
            print(f"출력 이름이 겹칩니다: {stem}", file=sys.stderr)
            return 1
        seen.add(stem)
        label_file = label_path_for(image)
        lines_in = label_file.read_text(encoding="utf-8").splitlines() if label_file.exists() else []
        stats["missing_label_files"] += not label_file.exists()
        lines_out = []
        for line in lines_in:
            if not line.strip():
                continue
            converted = convert_line(line, person_classes)
            if converted is None:
                stats["dropped_boxes"] += 1
            else:
                lines_out.append(converted)
        shutil.copy2(image, out / "images" / f"{stem}{image.suffix.lower()}")
        (out / "labels" / f"{stem}.txt").write_text("\n".join(lines_out) + ("\n" if lines_out else ""), encoding="utf-8")
        stats["images"] += 1
        stats["person_boxes"] += len(lines_out)
        stats["background_images"] += not lines_out

    report = {"name": args.name, "person_classes": sorted(person_classes), **stats}
    if args.audit:
        checked, flagged = audit(out, args.model, args.audit_conf, args.device)
        report["audit"] = {"conf": args.audit_conf, "checked": checked, "images_with_unlabeled_person": flagged}
    (out / "import_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.audit and report["audit"]["images_with_unlabeled_person"]:
        print(f"⚠ 라벨 없는 사람이 검출된 이미지 목록: {out / 'audit.csv'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
