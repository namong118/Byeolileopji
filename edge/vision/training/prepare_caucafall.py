"""CAUCAFall 원본 폴더 → 연속 프레임을 솎아 낸 YOLO 형식 폴더 (import_public.py 입력).

  .venv\\Scripts\\python prepare_caucafall.py --src "<압축 푼 폴더>\\Dataset CAUCAFall\\CAUCAFall"

입력:  --src  Subject.N/<활동>/*.png + 같은 이름 .txt (YOLO 정규화, 클래스 0 nofall · 1 fall, 프레임당 1명)
출력:  --out (기본 <data>/public-raw/caucafall/yolo)/images/<Subject.N>/<활동>/*.png, labels/…/*.txt
       --out/thin_report.json

솎는 기준 (영상 = Subject.N/<활동> 폴더 하나):
  1. 근접 중복 제거: 프레임 순서대로 보면서, 같은 클래스의 마지막으로 남긴 박스와 IoU 가 --dup-iou
     (기본 0.9) 이상이면 버린다. 사람이 거의 움직이지 않은 프레임이다.
  2. 영상별 상한: 남은 프레임 중 fall 은 --max-fall (기본 12), nofall 은 --max-nofall (기본 7) 장까지
     시간 순서에서 고르게 뽑는다.
라벨 파일이 없거나 비어 있는 프레임은 버린다 (배경이 아니라 미라벨일 수 있음). 클래스는 그대로 두고
import_public.py --person-classes 0,1 에서 person 으로 합친다.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from common import data_dir

MARKER = ".byeol_prepare_caucafall"


def box_iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def parse_label(text: str) -> tuple[int, tuple[float, float, float, float]] | None:
    """CAUCAFall 라벨 → (클래스, xyxy). 박스가 정확히 1개가 아니면 None."""
    lines = [l.split() for l in text.splitlines() if l.strip()]
    if len(lines) != 1 or len(lines[0]) != 5:
        return None
    cls = int(lines[0][0])
    cx, cy, w, h = (float(v) for v in lines[0][1:])
    return cls, (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def drop_near_duplicates(frames: list[tuple[int, tuple]], dup_iou: float) -> list[int]:
    """frames: 시간 순서의 (클래스, xyxy). 남길 프레임 번호."""
    last: dict[int, tuple] = {}
    keep = []
    for i, (cls, box) in enumerate(frames):
        if cls not in last or box_iou(box, last[cls]) < dup_iou:
            keep.append(i)
            last[cls] = box
    return keep


def evenly(indices: list[int], k: int) -> list[int]:
    """시간 순서 목록에서 k 개를 고르게 (처음과 끝 포함)."""
    if len(indices) <= k:
        return indices
    if k == 1:
        return [indices[len(indices) // 2]]
    return [indices[round(j * (len(indices) - 1) / (k - 1))] for j in range(k)]


def thin_video(frames: list[tuple[int, tuple]], dup_iou: float, caps: dict[int, int]) -> list[int]:
    kept = drop_near_duplicates(frames, dup_iou)
    out = []
    for cls, cap in caps.items():
        out += evenly([i for i in kept if frames[i][0] == cls], cap)
    return sorted(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, required=True, help="CAUCAFall 폴더 (Subject.1 … Subject.10 이 들어 있는 곳)")
    ap.add_argument("--out", type=Path, help="출력 폴더 (기본: <data>/public-raw/caucafall/yolo)")
    ap.add_argument("--dup-iou", type=float, default=0.9, help="이 IoU 이상이면 근접 중복 (기본 0.9)")
    ap.add_argument("--max-fall", type=int, default=12, help="영상별 fall 프레임 상한 (기본 12)")
    ap.add_argument("--max-nofall", type=int, default=7, help="영상별 nofall 프레임 상한 (기본 7)")
    args = ap.parse_args(argv)

    src = args.src.resolve()
    videos = sorted(p for p in src.glob("Subject.*/*") if p.is_dir())
    if not videos:
        print(f"Subject.N/<활동> 폴더가 없습니다: {src}", file=sys.stderr)
        return 1
    out = args.out or data_dir() / "public-raw" / "caucafall" / "yolo"
    if out.exists():
        if not (out / MARKER).exists():
            print(f"출력 폴더가 이미 있고 이 스크립트가 만든 폴더가 아닙니다: {out}", file=sys.stderr)
            return 1
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / MARKER).write_text("prepare_caucafall.py 가 만든 폴더 (다시 실행하면 지우고 새로 만든다)\n", encoding="utf-8")

    caps = {1: args.max_fall, 0: args.max_nofall}
    totals = {"videos": len(videos), "frames": 0, "unlabeled_frames": 0, "after_dedup": 0, "kept": 0,
              "kept_fall": 0, "kept_nofall": 0}
    per_video = {}
    for video in videos:
        pngs, frames = [], []
        for png in sorted(video.glob("*.png")):
            totals["frames"] += 1
            label = png.with_suffix(".txt")
            parsed = parse_label(label.read_text(encoding="utf-8")) if label.exists() else None
            if parsed is None:
                totals["unlabeled_frames"] += 1
                continue
            pngs.append(png)
            frames.append(parsed)
        totals["after_dedup"] += len(drop_near_duplicates(frames, args.dup_iou))
        kept = thin_video(frames, args.dup_iou, caps)
        rel = video.relative_to(src)
        for i in kept:
            for kind, path in (("images", pngs[i]), ("labels", pngs[i].with_suffix(".txt"))):
                dest = out / kind / rel / path.name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, dest)
        n_fall = sum(frames[i][0] == 1 for i in kept)
        totals["kept"] += len(kept)
        totals["kept_fall"] += n_fall
        totals["kept_nofall"] += len(kept) - n_fall
        per_video[rel.as_posix()] = {"frames": len(pngs), "kept": len(kept), "kept_fall": n_fall}

    report = {"settings": {"dup_iou": args.dup_iou, "max_fall": args.max_fall, "max_nofall": args.max_nofall},
              **totals, "per_video": per_video}
    (out / "thin_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "per_video"}, ensure_ascii=False, indent=2))
    print(f"→ {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
