"""사전학습 yolo26n.pt 로 사람 박스 초안을 만든다 (Label Studio 가져오기용).

입력:  <data>/frames/**/*.jpg   (extract_frames.py 출력)
출력:  <data>/prelabel/tasks.json         Label Studio 가져오기 파일 (초안 박스는 predictions)
       <data>/prelabel/labels/<세션>/<장면>/*.txt   같은 초안의 YOLO 형식 (참고용)

주의: 초안에는 사전학습 모델이 **이미 찾은 사람만** 들어 있다. 누움·가려짐·저녁처럼 모델이
놓치는 장면이 바로 우리가 확인하려는 장면이므로, 검수할 때 빠진 사람을 직접 추가해야 한다.
초안 박스를 그대로 제출하면 기준선 Recall 이 실제보다 높게 나온다.

이미지는 Label Studio 로 업로드하지 않는다. tasks.json 은 로컬 파일 주소
(/data/local-files/?d=<data 폴더 기준 상대 경로>) 로 이미지를 가리킨다.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path
from urllib.parse import quote

from common import (DEFAULT_WEIGHTS, data_dir, format_yolo_line, list_images, parse_frame_name, setup_ultralytics,
                    weights_path)

MODEL_VERSION = "yolo26n-pretrained-draft"


def local_file_url(image: Path, document_root: Path) -> str:
    rel = image.resolve().relative_to(document_root.resolve()).as_posix()
    return "/data/local-files/?d=" + quote(rel, safe="/")


def make_task(image: Path, document_root: Path, width: int, height: int,
              boxes_xyxy: list[tuple[float, float, float, float, float]]) -> dict:
    """픽셀 좌표 박스 (x1, y1, x2, y2, conf) → Label Studio 작업 1개 (초안은 predictions)."""
    result = []
    for x1, y1, x2, y2, conf in boxes_xyxy:
        result.append({
            "id": uuid.uuid4().hex[:10],
            "type": "rectanglelabels",
            "from_name": "label",
            "to_name": "image",
            "original_width": width,
            "original_height": height,
            "image_rotation": 0,
            "value": {
                "x": 100.0 * x1 / width,
                "y": 100.0 * y1 / height,
                "width": 100.0 * (x2 - x1) / width,
                "height": 100.0 * (y2 - y1) / height,
                "rotation": 0,
                "rectanglelabels": ["person"],
            },
            "score": round(conf, 4),
        })
    rel = image.resolve().relative_to(document_root.resolve()).as_posix()
    return {
        "data": {"image": local_file_url(image, document_root), "frame": rel},
        "predictions": [{
            "model_version": MODEL_VERSION,
            "score": round(max((b[4] for b in boxes_xyxy), default=0.0), 4),
            "result": result,
        }],
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--frames", type=Path, help="프레임 폴더 (기본: <data>/frames)")
    ap.add_argument("--out", type=Path, help="출력 폴더 (기본: <data>/prelabel)")
    ap.add_argument("--sessions", nargs="*", help="이 세션만 (예: s1 s2). 기본: 전부")
    ap.add_argument("--model", default=DEFAULT_WEIGHTS, help="초안 모델 (기본 yolo26n.pt)")
    ap.add_argument("--conf", type=float, default=0.25, help="초안 박스 최소 신뢰도 (기본 0.25)")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default="0", help="GPU 번호 또는 cpu (기본 0)")
    args = ap.parse_args(argv)

    root = data_dir()
    frames_dir = args.frames or root / "frames"
    out = args.out or root / "prelabel"
    images = []
    for image in list_images(frames_dir):
        name = parse_frame_name(image.stem)
        if name is None:
            print(f"건너뜀 (파일 이름 규칙 아님): {image.name}", file=sys.stderr)
            continue
        if args.sessions and name.session not in args.sessions:
            continue
        images.append((image, name))
    if not images:
        print(f"프레임이 없습니다: {frames_dir}", file=sys.stderr)
        return 1
    try:
        frames_dir.resolve().relative_to(root.resolve())
    except ValueError:
        print("프레임 폴더가 데이터 폴더 밖에 있어 Label Studio 로컬 파일 주소를 만들 수 없습니다.", file=sys.stderr)
        return 1

    setup_ultralytics()
    from ultralytics import YOLO

    model = YOLO(str(weights_path(args.model)))
    tasks, n_boxes, n_empty = [], 0, 0
    for image, name in images:
        r = model.predict(str(image), classes=[0], conf=args.conf, imgsz=args.imgsz,
                          device=args.device, verbose=False)[0]
        h, w = r.orig_shape
        boxes = [(*b.xyxy[0].tolist(), float(b.conf[0])) for b in r.boxes]
        tasks.append(make_task(image, root, w, h, boxes))

        label = out / "labels" / name.session / name.scene / f"{image.stem}.txt"
        label.parent.mkdir(parents=True, exist_ok=True)
        lines = []
        for x1, y1, x2, y2, _ in boxes:
            lines.append(format_yolo_line(0, (x1 + x2) / 2 / w, (y1 + y2) / 2 / h, (x2 - x1) / w, (y2 - y1) / h))
        label.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        n_boxes += len(boxes)
        n_empty += not boxes

    out.mkdir(parents=True, exist_ok=True)
    tasks_path = out / "tasks.json"
    tasks_path.write_text(json.dumps(tasks, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"프레임 {len(tasks)}장, 초안 박스 {n_boxes}개, 박스 없는 프레임 {n_empty}장 → {tasks_path}")
    print("※ 초안은 모델이 이미 찾은 사람만 담습니다. 검수할 때 빠진 사람을 직접 추가하세요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
