"""녹화 영상 → 프레임 (기본 초당 1장).

입력 (두 방식을 같이 써도 된다):
  장면별 영상:  <data>/raw/<세션>/<장면>/*.mp4|mov|m4v      예) raw/s1/lying/IMG_0012.MOV
  연속 영상:    <data>/raw/<세션>/*.mp4|mov|m4v + 같은 이름의 .segments.csv
               예) raw/s1/250.mp4 + raw/s1/250.segments.csv
               여러 장면을 이어서 찍은 영상을 구간 파일의 시각에 따라 장면별로 나눈다.
출력:  <data>/frames/<세션>/<장면>/<세션>_<장면>_<클립>_t<0.1초 단위 시각>.jpg
       <data>/frames/manifest.csv  (프레임 ↔ 원본 영상·시각)

구간 파일 (초 단위, 시작 포함·끝 미포함, # 뒤는 주석):
  start,end,scene
  3,14,standing
  14,16,transition
구간에 없는 시각과 scene 이 exclude 인 구간은 프레임을 저장하지 않는다.
파일 이름의 시각은 원본 영상 기준이라 manifest 의 source·sec 로 원본 위치를 찾을 수 있다.

클립 번호(c01, c02 …)는 manifest 에 저장해 두고 재사용한다. 나중에 영상을 추가해도
이미 뽑은 프레임의 이름이 바뀌지 않는다.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2

from common import SCENES, SESSION_RE, VIDEO_EXTS, FrameName, data_dir

MANIFEST_FIELDS = ["frame", "session", "scene", "clip", "source", "sec", "width", "height", "segments"]
SEGMENTS_SUFFIX = ".segments.csv"
EXCLUDE = "exclude"


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    scene: str


@dataclass(frozen=True)
class Video:
    session: str
    path: Path
    scene: str | None = None  # 장면별 영상의 장면. 연속 영상이면 None 이고 segments 로 나눈다.
    segments: tuple[Segment, ...] = ()
    segments_hash: str = ""

    @property
    def continuous(self) -> bool:
        return self.scene is None


def load_manifest(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def segments_path_for(video: Path) -> Path:
    return video.with_name(video.stem + SEGMENTS_SUFFIX)


def parse_segments(path: Path) -> list[Segment]:
    """구간 파일을 읽고 검사한다. 형식 오류·모르는 장면·겹침이면 ValueError."""
    lines = [line.split("#", 1)[0].strip() for line in path.read_text(encoding="utf-8-sig").splitlines()]
    rows = list(csv.reader(line for line in lines if line))
    if not rows or [c.strip() for c in rows[0]] != ["start", "end", "scene"]:
        raise ValueError(f"{path.name}: 첫 줄은 start,end,scene 이어야 합니다")
    segments = []
    for row in rows[1:]:
        if len(row) != 3:
            raise ValueError(f"{path.name}: 값이 3개가 아닙니다: {','.join(row)}")
        try:
            start, end = float(row[0]), float(row[1])
        except ValueError as e:
            raise ValueError(f"{path.name}: 시각이 숫자가 아닙니다: {','.join(row)}") from e
        scene = row[2].strip()
        if scene != EXCLUDE and scene not in SCENES:
            raise ValueError(f"{path.name}: 모르는 장면 {scene!r} (허용: {', '.join(SCENES)}, {EXCLUDE})")
        if not 0 <= start < end:
            raise ValueError(f"{path.name}: 시작이 끝보다 앞서야 합니다: {','.join(row)}")
        segments.append(Segment(start, end, scene))
    segments.sort(key=lambda s: s.start)
    for a, b in zip(segments, segments[1:]):
        if b.start < a.end:
            raise ValueError(f"{path.name}: 구간이 겹칩니다: {a.start:g}–{a.end:g} {a.scene} / {b.start:g}–{b.end:g} {b.scene}")
    return segments


def scene_at(segments: tuple[Segment, ...] | list[Segment], sec: float) -> str | None:
    """sec 가 들어가는 구간의 장면. 구간 밖이거나 exclude 면 None."""
    for s in segments:
        if s.start <= sec + 1e-6 < s.end:
            return None if s.scene == EXCLUDE else s.scene
    return None


def assign_clips(keys: list[tuple[str, str, str]], manifest: list[dict]) -> dict[tuple[str, str, str], str]:
    """(세션, 장면, 원본 파일 이름) → 클립 번호. 기존 번호는 유지하고 새 영상에 다음 번호를 준다."""
    clips: dict[tuple[str, str, str], str] = {}
    for row in manifest:
        clips[(row["session"], row["scene"], row["source"])] = row["clip"]
    for key in keys:
        if key in clips:
            continue
        session, scene, _ = key
        used = [int(c[1:]) for (s, sc, _), c in clips.items() if s == session and sc == scene]
        clips[key] = f"c{(max(used) + 1 if used else 1):02d}"
    return clips


def find_videos(raw: Path) -> list[Video]:
    """raw/<세션>/<장면>/ 아래 장면별 영상과 raw/<세션>/ 바로 아래 연속 영상. 규칙과 다르면 오류."""
    videos, errors = [], []
    for session_dir in sorted(p for p in raw.iterdir() if p.is_dir()):
        if not SESSION_RE.match(session_dir.name):
            errors.append(f"세션 폴더 이름은 s1, s2 … 형식이어야 합니다: {session_dir.name}")
            continue
        continuous_names: set[str] = set()
        for video in sorted(p for p in session_dir.iterdir() if p.is_file() and p.suffix.lower() in VIDEO_EXTS):
            seg_path = segments_path_for(video)
            if not seg_path.exists():
                errors.append(f"연속 영상에 구간 파일이 없습니다: {session_dir.name}/{video.name} → {seg_path.name} 필요")
                continue
            try:
                segments = parse_segments(seg_path)
            except ValueError as e:
                errors.append(f"{session_dir.name}/{e}")
                continue
            digest = hashlib.sha1(seg_path.read_bytes()).hexdigest()[:12]
            videos.append(Video(session_dir.name, video, None, tuple(segments), digest))
            continuous_names.add(video.name)
        for scene_dir in sorted(p for p in session_dir.iterdir() if p.is_dir()):
            if scene_dir.name not in SCENES:
                errors.append(f"모르는 장면 폴더: {session_dir.name}/{scene_dir.name} (허용: {', '.join(SCENES)})")
                continue
            for video in sorted(scene_dir.iterdir()):
                if video.suffix.lower() in VIDEO_EXTS:
                    if video.name in continuous_names:
                        # manifest 는 세션·원본 파일 이름으로 영상을 구분한다.
                        errors.append(f"같은 세션에 이름이 같은 영상이 있습니다: {session_dir.name}/{video.name}, "
                                      f"{session_dir.name}/{scene_dir.name}/{video.name}")
                    videos.append(Video(session_dir.name, video, scene_dir.name))
    if errors:
        raise SystemExit("\n".join(errors))
    return videos


def resize_max_side(frame, max_side: int):
    h, w = frame.shape[:2]
    if max_side <= 0 or max(h, w) <= max_side:
        return frame
    scale = max_side / max(h, w)
    return cv2.resize(frame, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)


def extract_video(video: Path, out: Path, name_for: Callable[[int], FrameName | None], every_sec: float,
                  max_side: int, overwrite: bool) -> tuple[list[dict], list[float]]:
    """영상 시각 기준으로 every_sec 마다 1장씩 저장한다 (폰 영상의 가변 프레임레이트 대응).

    name_for(0.1초 단위 시각) 가 None 이면 그 시각은 저장하지 않는다. 반환: (manifest 행, 제외한 시각).
    """
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError(f"영상을 열 수 없습니다 (코덱 확인 — H.264 권장): {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    rows, excluded, index, next_t, sampled = [], [], 0, 0.0, 0
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
            sampled += 1
            name = name_for(ds)
            if name is None:
                excluded.append(ds / 10)
                continue
            frame = resize_max_side(frame, max_side)
            h, w = frame.shape[:2]
            out_dir = out / name.session / name.scene
            out_dir.mkdir(parents=True, exist_ok=True)
            target = out_dir / f"{name.stem}.jpg"
            if overwrite or not target.exists():
                # JPG 로 다시 저장하므로 원본의 위치·기기 메타데이터는 남지 않는다.
                cv2.imwrite(str(target), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            rows.append({"frame": target.name, "session": name.session, "scene": name.scene, "clip": name.clip,
                         "source": video.name, "sec": ds / 10, "width": w, "height": h})
    finally:
        cap.release()
    if not sampled:
        raise RuntimeError(f"프레임을 하나도 읽지 못했습니다 (코덱 확인 — HEVC 는 환경에 따라 읽지 못할 수 있음): {video}")
    return rows, excluded


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
        print(f"녹화 폴더가 없습니다: {raw}\n<세션>/<장면>/ 폴더 또는 <세션>/ 폴더(연속 영상 + 구간 파일)에 영상을 넣어 주세요.",
              file=sys.stderr)
        return 1
    if args.fps <= 0:
        print("--fps 는 0보다 커야 합니다.", file=sys.stderr)
        return 1

    videos = find_videos(raw)
    manifest_path = out / "manifest.csv"
    old_rows = load_manifest(manifest_path)
    keys = []
    for v in videos:
        scenes = [v.scene] if v.scene else list(dict.fromkeys(s.scene for s in v.segments if s.scene != EXCLUDE))
        keys += [(v.session, scene, v.path.name) for scene in scenes]
    clips = assign_clips(keys, old_rows)

    def old_rows_of(v: Video) -> list[dict]:
        return [r for r in old_rows if r["session"] == v.session and r["source"] == v.path.name
                and (v.continuous or r["scene"] == v.scene)]

    # 구간 파일을 고친 뒤 --overwrite 없이 실행하면 예전 구간으로 나눈 프레임이 그대로 남으므로 멈춘다.
    if not args.overwrite:
        changed = [f"{v.session}/{v.path.name}" for v in videos
                   if v.continuous and old_rows_of(v) and {r.get("segments") for r in old_rows_of(v)} != {v.segments_hash}]
        if changed:
            print("구간 파일이 이전 추출 이후 바뀌었습니다: " + ", ".join(changed)
                  + "\n--overwrite 로 다시 뽑아 주세요 (예전 구간으로 저장한 프레임은 지워집니다).", file=sys.stderr)
            return 1

    todo = [v for v in videos if args.overwrite or not old_rows_of(v)]
    new_rows: list[dict] = []
    for v in todo:
        def name_for(ds: int, v=v) -> FrameName | None:
            scene = v.scene or scene_at(v.segments, ds / 10)
            return FrameName(v.session, scene, clips[(v.session, scene, v.path.name)], ds) if scene else None

        rows, excluded = extract_video(v.path, out, name_for, 1.0 / args.fps, args.max_side, args.overwrite)
        for r in rows:
            r["segments"] = v.segments_hash
        if v.continuous:
            # 다시 뽑을 때, 예전 구간으로 저장했고 이번에는 만들지 않은 프레임을 지운다.
            fresh = {(r["scene"], r["frame"]) for r in rows}
            for r in old_rows_of(v):
                if (r["scene"], r["frame"]) not in fresh:
                    (out / r["session"] / r["scene"] / r["frame"]).unlink(missing_ok=True)

        if rows:
            w, h = rows[0]["width"], rows[0]["height"]
            note = "  ⚠ 세로 영상 — 설치 카메라와 같게 가로로 녹화하세요" if h > w else ""
            size = f"{w}x{h}"
        else:
            size, note = "-", "  ⚠ 저장한 프레임 없음"
        if v.continuous:
            print(f"{v.session}/{v.path.name} (연속 영상): {len(rows)}장 ({size}){note}")
            for scene in SCENES:
                n = sum(r["scene"] == scene for r in rows)
                if n:
                    print(f"    {scene:10s} {n}장 ({clips[(v.session, scene, v.path.name)]})")
            print(f"    {'제외':10s} {len(excluded)}장" + (f" ({', '.join(f'{s:g}s' for s in excluded)})" if excluded else ""))
            last = max(excluded + [r["sec"] for r in rows], default=0.0)
            beyond = [s for s in v.segments if s.end > last + 1.0 / args.fps + 1e-6]
            if beyond:
                print(f"    ⚠ 마지막 프레임({last:g}s) 이후까지 이어지는 구간: "
                      + ", ".join(f"{s.start:g}–{s.end:g} {s.scene}" for s in beyond))
        else:
            print(f"{v.session}/{v.scene}/{v.path.name} → {clips[(v.session, v.scene, v.path.name)]}: "
                  f"{len(rows)}장 ({size}){note}")
        new_rows.extend(rows)

    # 이번에 처리한 영상의 행은 새로 쓰고, 나머지(이전에 처리한 영상) 행은 유지한다.
    done = {(v.session, v.path.name, v.scene) for v in todo}
    kept = [r for r in old_rows
            if (r["session"], r["source"], r["scene"]) not in done and (r["session"], r["source"], None) not in done]
    out.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=MANIFEST_FIELDS, restval="")
        writer.writeheader()
        writer.writerows(kept + new_rows)
    skipped = len(videos) - len(todo)
    print(f"새 영상 {len(todo)}개, 프레임 {len(new_rows)}장 → {out}"
          + (f" (이미 처리한 영상 {skipped}개는 건너뜀 — 다시 뽑으려면 --overwrite)" if skipped else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
