"""녹화 영상 → 프레임 (기본 초당 1장).

입력:  <data>/raw/<세션>/<장면>/*.mp4|mov|m4v      예) raw/s1/lying/IMG_0012.MOV
출력:  <data>/frames/<세션>/<장면>/<세션>_<장면>_<클립>_t<0.1초 단위 시각>.jpg
       <data>/frames/manifest.csv  (프레임 ↔ 원본 영상·시각)

클립 번호(c01, c02 …)는 manifest 에 저장해 두고 재사용한다. 나중에 영상을 추가해도
이미 뽑은 프레임의 이름이 바뀌지 않는다.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import cv2

from common import SCENES, SESSION_RE, VIDEO_EXTS, FrameName, data_dir

MANIFEST_FIELDS = ["frame", "session", "scene", "clip", "source", "sec", "width", "height"]


def load_manifest(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def assign_clips(videos: list[tuple[str, str, Path]], manifest: list[dict]) -> dict[tuple[str, str, str], str]:
    """(세션, 장면, 원본 파일 이름) → 클립 번호. 기존 번호는 유지하고 새 영상에 다음 번호를 준다."""
    clips: dict[tuple[str, str, str], str] = {}
    for row in manifest:
        clips[(row["session"], row["scene"], row["source"])] = row["clip"]
    for session, scene, video in videos:
        key = (session, scene, video.name)
        if key in clips:
            continue
        used = [int(c[1:]) for (s, sc, _), c in clips.items() if s == session and sc == scene]
        clips[key] = f"c{(max(used) + 1 if used else 1):02d}"
    return clips


def find_videos(raw: Path) -> list[tuple[str, str, Path]]:
    """raw/<세션>/<장면>/ 아래 영상 목록. 폴더 이름이 규칙과 다르면 오류."""
    videos, errors = [], []
    for session_dir in sorted(p for p in raw.iterdir() if p.is_dir()):
        if not SESSION_RE.match(session_dir.name):
            errors.append(f"세션 폴더 이름은 s1, s2 … 형식이어야 합니다: {session_dir.name}")
            continue
        for scene_dir in sorted(p for p in session_dir.iterdir() if p.is_dir()):
            if scene_dir.name not in SCENES:
                errors.append(f"모르는 장면 폴더: {session_dir.name}/{scene_dir.name} (허용: {', '.join(SCENES)})")
                continue
            for video in sorted(scene_dir.iterdir()):
                if video.suffix.lower() in VIDEO_EXTS:
                    videos.append((session_dir.name, scene_dir.name, video))
    if errors:
        raise SystemExit("\n".join(errors))
    return videos


def resize_max_side(frame, max_side: int):
    h, w = frame.shape[:2]
    if max_side <= 0 or max(h, w) <= max_side:
        return frame
    scale = max_side / max(h, w)
    return cv2.resize(frame, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)


def extract_video(video: Path, out_dir: Path, name: FrameName, every_sec: float, max_side: int, overwrite: bool) -> list[dict]:
    """영상 시각 기준으로 every_sec 마다 1장씩 저장한다 (폰 영상의 가변 프레임레이트 대응)."""
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError(f"영상을 열 수 없습니다 (코덱 확인 — H.264 권장): {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    out_dir.mkdir(parents=True, exist_ok=True)
    rows, index, next_t = [], 0, 0.0
    try:
        while cap.grab():
            msec = cap.get(cv2.CAP_PROP_POS_MSEC)
            t = msec / 1000.0 if msec > 0 or index == 0 else index / fps
            index += 1
            if t + 1e-6 < next_t:
                continue
            ok, frame = cap.retrieve()
            if not ok:
                continue
            ds = int(round(next_t * 10))
            next_t += every_sec
            frame = resize_max_side(frame, max_side)
            h, w = frame.shape[:2]
            stem = FrameName(name.session, name.scene, name.clip, ds).stem
            target = out_dir / f"{stem}.jpg"
            if overwrite or not target.exists():
                # JPG 로 다시 저장하므로 원본의 위치·기기 메타데이터는 남지 않는다.
                cv2.imwrite(str(target), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            rows.append({"frame": target.name, "session": name.session, "scene": name.scene, "clip": name.clip,
                         "source": video.name, "sec": ds / 10, "width": w, "height": h})
    finally:
        cap.release()
    if not rows:
        raise RuntimeError(f"프레임을 하나도 읽지 못했습니다 (코덱 확인 — HEVC 는 읽지 못할 수 있음): {video}")
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, help="녹화 영상 폴더 (기본: <data>/raw)")
    ap.add_argument("--out", type=Path, help="프레임 출력 폴더 (기본: <data>/frames)")
    ap.add_argument("--fps", type=float, default=1.0, help="초당 몇 장 (기본 1)")
    ap.add_argument("--max-side", type=int, default=1280, help="긴 변 최대 픽셀, 0이면 원본 크기 (기본 1280)")
    ap.add_argument("--overwrite", action="store_true", help="이미 처리한 영상도 다시 뽑아 덮어쓰기")
    args = ap.parse_args(argv)

    raw = args.raw or data_dir() / "raw"
    out = args.out or data_dir() / "frames"
    if not raw.exists():
        print(f"녹화 폴더가 없습니다: {raw}\n<세션>/<장면>/ 폴더에 영상을 넣어 주세요.", file=sys.stderr)
        return 1
    if args.fps <= 0:
        print("--fps 는 0보다 커야 합니다.", file=sys.stderr)
        return 1

    videos = find_videos(raw)
    manifest_path = out / "manifest.csv"
    old_rows = load_manifest(manifest_path)
    clips = assign_clips(videos, old_rows)

    processed = {(r["session"], r["scene"], r["source"]) for r in old_rows}
    new_rows: list[dict] = []
    skipped = 0
    for session, scene, video in videos:
        if (session, scene, video.name) in processed and not args.overwrite:
            skipped += 1  # 이미 뽑은 영상 — 다시 뽑으려면 --overwrite
            continue
        name = FrameName(session, scene, clips[(session, scene, video.name)], 0)
        rows = extract_video(video, out / session / scene, name, 1.0 / args.fps, args.max_side, args.overwrite)
        w, h = rows[0]["width"], rows[0]["height"]
        note = "  ⚠ 세로 영상 — 설치 카메라와 같게 가로로 녹화하세요" if h > w else ""
        print(f"{session}/{scene}/{video.name} → {name.clip}: {len(rows)}장 ({w}x{h}){note}")
        new_rows.extend(rows)

    # 이번에 처리한 영상의 행은 새로 쓰고, 나머지(이전에 처리한 영상) 행은 유지한다.
    done = {(r["session"], r["scene"], r["source"]) for r in new_rows}
    kept = [r for r in old_rows if (r["session"], r["scene"], r["source"]) not in done]
    out.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=MANIFEST_FIELDS)
        writer.writeheader()
        writer.writerows(kept + new_rows)
    print(f"새 영상 {len(videos) - skipped}개, 프레임 {len(new_rows)}장 → {out}"
          + (f" (이미 처리한 영상 {skipped}개는 건너뜀 — 다시 뽑으려면 --overwrite)" if skipped else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
