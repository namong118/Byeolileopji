"""학습(공개 데이터) / 검증(녹화 세션) / 시험(다른 녹화 세션) 데이터셋과 data.yaml 을 만든다.

입력:  <data>/public/<이름>/              import_public.py 출력 (학습)
       <data>/frames/<세션>/<장면>/*.jpg  extract_frames.py 출력 (검증·시험)
       <data>/labels/<세션>/<장면>/*.txt  ls_to_yolo.py 출력 (검수 완료 라벨)
출력:  <data>/datasets/<이름>/images/{train,val,test}/, labels/{train,val,test}/
       <data>/datasets/<이름>/scenes/{val,test}_<장면>.txt   장면별 이미지 목록 (eval_scenes.py)
       <data>/datasets/<이름>/data.yaml
       <data>/datasets/<이름>/split_report.json

검사 (하나라도 걸리면 데이터셋을 만들지 않는다):
  - 검증과 시험에 같은 녹화 세션이 들어가지 않는다
  - 학습 세트에 녹화 세션 이름(s1_ …) 파일이 없다
  - 세 세트 사이에 내용이 같은 이미지(해시)가 없다
  - 모든 라벨이 클래스 0, 값 5개, 좌표 0~1 이다
검수하지 않은 프레임(라벨 파일 없음)은 빠지고, 개수를 보고한다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from collections import defaultdict
from pathlib import Path

from common import (BACKGROUND_SCENES, SCENES, SESSION_PREFIX_RE, LabelError, data_dir, label_path_for, list_images,
                    parse_frame_name, read_yolo_label)

MARKER = ".byeol_dataset"
SPLITS = ("train", "val", "test")


class DatasetError(Exception):
    pass


def file_hash(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def collect_public(public_dir: Path, names: list[str] | None) -> list[dict]:
    items = []
    if not public_dir.exists():
        return items
    for ds in sorted(p for p in public_dir.iterdir() if p.is_dir()):
        if names and ds.name not in names:
            continue
        for image in list_images(ds / "images"):
            items.append({"image": image, "label": label_path_for(image), "scene": None, "session": None})
    if names:
        missing = set(names) - {p.name for p in public_dir.iterdir() if p.is_dir()}
        if missing:
            raise DatasetError(f"공개 데이터셋이 없습니다: {', '.join(sorted(missing))}")
    return items


def collect_session(frames_dir: Path, labels_dir: Path, session: str) -> tuple[list[dict], list[str]]:
    """세션의 검수 완료 프레임과 미검수 프레임 이름."""
    items, unreviewed = [], []
    for image in list_images(frames_dir / session):
        name = parse_frame_name(image.stem)
        if name is None:
            raise DatasetError(f"파일 이름 규칙이 아닌 프레임: {image.name}")
        label = labels_dir / name.session / name.scene / f"{image.stem}.txt"
        if not label.exists():
            unreviewed.append(image.name)
            continue
        items.append({"image": image, "label": label, "scene": name.scene, "session": name.session})
    return items, unreviewed


def check_splits(splits: dict[str, list[dict]]) -> dict:
    """누수·라벨 검사. 문제가 있으면 DatasetError. 반환: 경고 목록."""
    errors, warnings = [], []

    eval_sessions = {s: {it["session"] for it in splits[s]} for s in ("val", "test")}
    shared = eval_sessions["val"] & eval_sessions["test"]
    if shared:
        errors.append(f"검증과 시험에 같은 세션이 있습니다: {', '.join(sorted(shared))}")
    for split in ("val", "test"):
        for it in splits[split]:
            name = parse_frame_name(it["image"].stem)
            if name is None or name.session != it["session"]:
                errors.append(f"{split}: 파일 이름과 세션이 맞지 않습니다: {it['image'].name}")
    for it in splits["train"]:
        if SESSION_PREFIX_RE.match(it["image"].stem):
            errors.append(f"학습 세트에 녹화 세션 이름의 파일이 있습니다: {it['image'].name}")

    first_seen: dict[str, tuple[str, str]] = {}
    for split in SPLITS:
        for it in splits[split]:
            digest = file_hash(it["image"])
            if digest in first_seen and first_seen[digest][0] != split:
                errors.append(f"같은 이미지가 두 세트에 있습니다: {first_seen[digest][0]}/{first_seen[digest][1]} = {split}/{it['image'].name}")
            first_seen.setdefault(digest, (split, it["image"].name))
            try:
                it["boxes"] = len(read_yolo_label(it["label"]))
            except LabelError as e:
                errors.append(str(e))
                it["boxes"] = 0
            if it["scene"] in BACKGROUND_SCENES and it["boxes"]:
                warnings.append(f"배경 장면에 사람 박스가 있습니다 (TV·거울 속 사람이면 지워야 함): {it['image'].name}")
    if errors:
        raise DatasetError("\n".join(errors[:50]) + (f"\n… 외 {len(errors) - 50}건" if len(errors) > 50 else ""))
    return {"warnings": warnings}


def place(src: Path, dst: Path) -> None:
    """같은 드라이브면 하드링크(용량 절약), 아니면 복사."""
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def write_dataset(out: Path, splits: dict[str, list[dict]]) -> dict:
    if out.exists():
        if not (out / MARKER).exists():
            raise DatasetError(f"출력 폴더가 이미 있고 이 스크립트가 만든 폴더가 아닙니다: {out}")
        shutil.rmtree(out)
    for split in SPLITS:
        (out / "images" / split).mkdir(parents=True)
        (out / "labels" / split).mkdir(parents=True)
    (out / "scenes").mkdir()
    (out / MARKER).write_text("build_dataset.py 가 만든 폴더 (다시 실행하면 지우고 새로 만든다)\n", encoding="utf-8")

    summary: dict = {}
    for split in SPLITS:
        by_scene: dict[str, list[Path]] = defaultdict(list)
        per_scene = defaultdict(lambda: {"images": 0, "instances": 0, "background_images": 0})
        for it in splits[split]:
            image_dst = out / "images" / split / f"{it['image'].stem}{it['image'].suffix.lower()}"
            if image_dst.exists():
                raise DatasetError(f"{split} 세트에 같은 파일 이름이 두 번 있습니다: {image_dst.name}")
            place(it["image"], image_dst)
            # 배경도 빈 라벨 파일을 명시적으로 둔다 (라벨 누락과 구분).
            label_dst = out / "labels" / split / f"{it['image'].stem}.txt"
            if it["label"].exists():
                shutil.copyfile(it["label"], label_dst)
            else:
                label_dst.write_text("", encoding="utf-8")
            key = it["scene"] or "public"
            by_scene[key].append(image_dst.resolve())
            per_scene[key]["images"] += 1
            per_scene[key]["instances"] += it["boxes"]
            per_scene[key]["background_images"] += it["boxes"] == 0
        for scene, paths in by_scene.items():
            if split != "train":
                (out / "scenes" / f"{split}_{scene}.txt").write_text("\n".join(p.as_posix() for p in paths) + "\n", encoding="utf-8")
        summary[split] = {
            "images": len(splits[split]),
            "instances": sum(it["boxes"] for it in splits[split]),
            "sessions": sorted({it["session"] for it in splits[split] if it["session"]}),
            "scenes": {s: dict(per_scene[s]) for s in (list(SCENES) + ["public"]) if s in per_scene},
        }

    yaml_text = (
        "# build_dataset.py 가 만든 파일 — 직접 고치지 말고 다시 생성한다\n"
        f"path: {out.resolve().as_posix()}\n"
        "train: images/train\n"
        "val: images/val\n"
        "test: images/test\n"
        "names:\n"
        "  0: person\n"
    )
    (out / "data.yaml").write_text(yaml_text, encoding="utf-8")
    return summary


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--val-session", default="s1", help="검증 세션 (기본 s1)")
    ap.add_argument("--test-session", default="s2", help="시험 세션 (기본 s2)")
    ap.add_argument("--public", nargs="*", help="학습에 쓸 공개 데이터셋 이름 (기본: <data>/public 아래 전부)")
    ap.add_argument("--name", default="byeol-home", help="데이터셋 이름 (기본 byeol-home)")
    args = ap.parse_args(argv)

    root = data_dir()
    if args.val_session == args.test_session:
        print("검증과 시험 세션은 달라야 합니다.", file=sys.stderr)
        return 1
    try:
        splits = {"train": collect_public(root / "public", args.public)}
        unreviewed = {}
        for split, session in (("val", args.val_session), ("test", args.test_session)):
            splits[split], unreviewed[split] = collect_session(root / "frames", root / "labels", session)
        report = check_splits(splits)
        out = root / "datasets" / args.name
        summary = write_dataset(out, splits)
    except DatasetError as e:
        print(f"데이터셋을 만들지 않았습니다:\n{e}", file=sys.stderr)
        return 1

    all_sessions = sorted(p.name for p in (root / "frames").iterdir() if p.is_dir()) if (root / "frames").exists() else []
    unused = [s for s in all_sessions if s not in (args.val_session, args.test_session)]
    split_report = {
        "val_session": args.val_session,
        "test_session": args.test_session,
        "unused_sessions": unused,
        "unreviewed_frames": {k: len(v) for k, v in unreviewed.items()},
        "checks": {"session_disjoint": True, "no_session_files_in_train": True, "no_duplicate_images": True, "labels_valid": True},
        "warnings": report["warnings"],
        "splits": summary,
    }
    (out / "split_report.json").write_text(json.dumps(split_report, ensure_ascii=False, indent=2), encoding="utf-8")

    for split in SPLITS:
        s = summary[split]
        print(f"{split:5s}: 이미지 {s['images']}장, 사람 박스 {s['instances']}개, 세션 {s['sessions'] or '-'}")
        for scene, c in s["scenes"].items():
            print(f"       {SCENES.get(scene, '공개 데이터'):20s} {c['images']}장 / 박스 {c['instances']}개 / 박스 없는 이미지 {c['background_images']}장")
    for split, frames in unreviewed.items():
        if frames:
            print(f"⚠ {split}: 미검수 프레임 {len(frames)}장은 빠졌습니다.")
    if unused:
        print(f"참고: 쓰지 않은 세션 {', '.join(unused)}")
    for w in report["warnings"][:20]:
        print(f"⚠ {w}")
    if not summary["train"]["images"]:
        print("⚠ 학습 세트가 비어 있습니다 (공개 데이터 미입력). 기준선 평가(eval_scenes.py)는 할 수 있고, 학습은 할 수 없습니다.")
    print(f"→ {out / 'data.yaml'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
