"""Label Studio 내보내기(JSON) → 검수 완료 YOLO 라벨.

입력:  Label Studio 프로젝트 > Export > "JSON" 으로 받은 파일
출력:  <data>/labels/<세션>/<장면>/<프레임 이름>.txt
       <data>/labels/unreviewed.txt   (내보내기에 들어 있으나 제출이 없거나 취소된 프레임)

사람이 제출한 annotations 만 쓰고, 초안(predictions)은 절대 쓰지 않는다. 검수하지 않은
프레임은 라벨 파일을 만들지 않으므로 build_dataset.py 에서 빠진다. 사람이 없는 프레임은
박스 0개로 제출하면 빈 라벨 파일(배경)이 된다.

Label Studio 의 JSON 내보내기에는 기본적으로 제출이 있는 작업만 들어간다. 그래서 전체 미검수
프레임 수는 이 스크립트가 아니라 build_dataset.py 가 (프레임은 있는데 라벨이 없는 수로) 보고한다.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, unquote, urlparse

from common import clamp01, data_dir, format_yolo_line, parse_frame_name


def frame_of(task: dict) -> str:
    """작업이 가리키는 프레임 파일 이름 (prelabel.py 가 넣은 data.frame, 없으면 이미지 주소에서)."""
    data = task.get("data", {})
    if data.get("frame"):
        return PurePosixPath(data["frame"]).name
    url = data.get("image", "")
    q = parse_qs(urlparse(url).query).get("d")
    return PurePosixPath(unquote(q[0] if q else url)).name


def pick_annotation(task: dict) -> dict | None:
    """취소하지 않은 사람 제출 중 가장 최근 것. 없으면 None (미검수)."""
    done = [a for a in task.get("annotations", []) if not a.get("was_cancelled")]
    if not done:
        return None
    return max(done, key=lambda a: (a.get("updated_at") or a.get("created_at") or "", a.get("id") or 0))


def annotation_to_yolo(annotation: dict) -> list[str]:
    lines = []
    for item in annotation.get("result", []):
        if item.get("type") != "rectanglelabels":
            continue
        v = item["value"]
        labels = v.get("rectanglelabels", [])
        if labels != ["person"]:
            raise ValueError(f"person 이외의 라벨: {labels}")
        if abs(float(v.get("rotation", 0) or 0)) > 1e-6:
            raise ValueError("회전된 박스는 쓰지 않습니다 (rotation 0 으로 다시 그려 주세요)")
        x1, y1 = clamp01(v["x"] / 100), clamp01(v["y"] / 100)
        x2, y2 = clamp01((v["x"] + v["width"]) / 100), clamp01((v["y"] + v["height"]) / 100)
        if x2 <= x1 or y2 <= y1:
            continue
        lines.append(format_yolo_line(0, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1))
    return lines


def convert(tasks: list[dict], labels_dir: Path) -> tuple[int, int, list[str], list[str]]:
    """반환: (라벨 파일 수, 박스 수, 미검수 프레임, 오류)."""
    written, boxes, unreviewed, errors = 0, 0, [], []
    for task in tasks:
        frame = frame_of(task)
        name = parse_frame_name(PurePosixPath(frame).stem)
        if name is None:
            errors.append(f"파일 이름 규칙이 아닌 작업: {frame}")
            continue
        target = labels_dir / name.session / name.scene / f"{PurePosixPath(frame).stem}.txt"
        annotation = pick_annotation(task)
        if annotation is None:
            unreviewed.append(frame)
            target.unlink(missing_ok=True)  # 제출이 취소·삭제된 프레임의 예전 라벨을 남기지 않는다
            continue
        try:
            lines = annotation_to_yolo(annotation)
        except (KeyError, ValueError) as e:
            errors.append(f"{frame}: {e}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        written += 1
        boxes += len(lines)
    return written, boxes, unreviewed, errors


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export", type=Path, help="Label Studio JSON 내보내기 파일")
    ap.add_argument("--out", type=Path, help="라벨 출력 폴더 (기본: <data>/labels)")
    args = ap.parse_args(argv)

    tasks = json.loads(args.export.read_text(encoding="utf-8"))
    if not isinstance(tasks, list) or (tasks and "data" not in tasks[0]):
        print("Label Studio 의 \"JSON\" 형식 내보내기가 아닙니다 (JSON-MIN 이 아닌 JSON 으로 받아 주세요).", file=sys.stderr)
        return 1
    labels_dir = args.out or data_dir() / "labels"
    written, boxes, unreviewed, errors = convert(tasks, labels_dir)

    labels_dir.mkdir(parents=True, exist_ok=True)
    (labels_dir / "unreviewed.txt").write_text("\n".join(unreviewed) + ("\n" if unreviewed else ""), encoding="utf-8")
    print(f"검수 완료 {written}장 (박스 {boxes}개) → {labels_dir}")
    if unreviewed:
        print(f"제출이 없거나 취소된 작업 {len(unreviewed)}장 — 데이터셋에서 빠집니다. 목록: {labels_dir / 'unreviewed.txt'}")
    print("전체 미검수 프레임 수는 build_dataset.py 가 보고합니다.")
    for e in errors:
        print(f"오류: {e}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
