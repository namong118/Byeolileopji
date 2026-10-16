"""학습 스크립트 로직 테스트 — 합성 영상·이미지·라벨만 쓴다 (GPU·실제 데이터 불필요).

  .venv\\Scripts\\python -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build_dataset  # noqa: E402
import extract_frames  # noqa: E402
import import_public  # noqa: E402
import ls_to_yolo  # noqa: E402
import prelabel  # noqa: E402
import train  # noqa: E402
from common import FrameName, LabelError, label_path_for, parse_frame_name, read_yolo_label  # noqa: E402


def write_image(path: Path, seed: int, size=(64, 48)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    cv2.imwrite(str(path), rng.integers(0, 255, (size[1], size[0], 3), dtype=np.uint8))
    return path


def write_video(path: Path, seconds: float, fps: int = 10, size=(320, 180)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    for i in range(int(seconds * fps)):
        frame = np.full((size[1], size[0], 3), i % 255, dtype=np.uint8)
        writer.write(frame)
    writer.release()
    return path


class TempDataDir(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self._old = os.environ.get("BYEOL_DATA_DIR")
        os.environ["BYEOL_DATA_DIR"] = str(self.root)

    def tearDown(self):
        if self._old is None:
            os.environ.pop("BYEOL_DATA_DIR", None)
        else:
            os.environ["BYEOL_DATA_DIR"] = self._old
        self._tmp.cleanup()


class FrameNameTest(unittest.TestCase):
    def test_roundtrip(self):
        name = FrameName("s1", "bg-tv", "c03", 125)
        self.assertEqual(name.stem, "s1_bg-tv_c03_t00125")
        self.assertEqual(parse_frame_name(name.stem), name)

    def test_rejects_unknown_scene_and_bad_format(self):
        self.assertIsNone(parse_frame_name("s1_standsit_c01_t00010"))  # 예전 장면 코드
        self.assertIsNone(parse_frame_name("p_fall_s1_lying_c01_t00010"))
        self.assertIsNone(parse_frame_name("s1_lying_1_t00010"))

    def test_standing_and_sitting_are_separate(self):
        self.assertEqual(parse_frame_name("s2_standing_c01_t00000").scene, "standing")
        self.assertEqual(parse_frame_name("s2_sitting_c01_t00000").scene, "sitting")


class LabelReadTest(TempDataDir):
    def test_valid_and_invalid_labels(self):
        ok = self.root / "ok.txt"
        ok.write_text("0 0.5 0.5 0.2 0.4\n\n", encoding="utf-8")
        self.assertEqual(len(read_yolo_label(ok)), 1)
        self.assertEqual(read_yolo_label(self.root / "missing.txt"), [])
        for bad in ("1 0.5 0.5 0.2 0.2", "0 1.2 0.5 0.2 0.2", "0 0.5 0.5 0.2", "0 0.5 0.5 0 0.2"):
            p = self.root / "bad.txt"
            p.write_text(bad, encoding="utf-8")
            with self.assertRaises(LabelError, msg=bad):
                read_yolo_label(p)

    def test_label_path_uses_last_images_dir(self):
        p = Path("a/images/b/images/train/x.jpg")
        self.assertEqual(label_path_for(p), Path("a/images/b/labels/train/x.txt"))


class ExtractFramesTest(TempDataDir):
    def test_one_frame_per_second_and_stable_clip_numbers(self):
        raw = self.root / "raw"
        write_video(raw / "s1" / "lying" / "b.mp4", 3.0)
        self.assertEqual(extract_frames.main(["--max-side", "160"]), 0)
        frames = sorted(p.name for p in (self.root / "frames" / "s1" / "lying").glob("*.jpg"))
        self.assertEqual(frames, ["s1_lying_c01_t00000.jpg", "s1_lying_c01_t00010.jpg", "s1_lying_c01_t00020.jpg"])
        img = cv2.imread(str(self.root / "frames" / "s1" / "lying" / frames[0]))
        self.assertEqual(max(img.shape[:2]), 160)

        # 이름이 앞서는 새 영상을 추가해도 기존 클립 번호(c01)는 그대로다.
        write_video(raw / "s1" / "lying" / "a.mp4", 1.0)
        self.assertEqual(extract_frames.main([]), 0)
        rows = extract_frames.load_manifest(self.root / "frames" / "manifest.csv")
        clips = {r["source"]: r["clip"] for r in rows}
        self.assertEqual(clips, {"b.mp4": "c01", "a.mp4": "c02"})
        self.assertEqual(len(rows), 4)
        # 이미 처리한 영상은 건너뛰므로 manifest 의 해상도가 실제 파일(160px)과 같다.
        self.assertEqual({r["width"] for r in rows if r["source"] == "b.mp4"}, {"160"})

    def test_two_per_second_names_do_not_collide(self):
        write_video(self.root / "raw" / "s1" / "evening" / "v.mp4", 2.0)
        self.assertEqual(extract_frames.main(["--fps", "2"]), 0)
        self.assertEqual(len(list((self.root / "frames" / "s1" / "evening").glob("*.jpg"))), 4)

    def test_rejects_unknown_scene_folder(self):
        write_video(self.root / "raw" / "s1" / "standsit" / "v.mp4", 1.0)
        with self.assertRaises(SystemExit):
            extract_frames.main([])


class PrelabelTaskTest(unittest.TestCase):
    def test_task_uses_predictions_and_local_url(self):
        root = Path(tempfile.gettempdir()) / "byeol-root"
        image = root / "frames" / "s1" / "lying" / "s1_lying_c01_t00000.jpg"
        task = prelabel.make_task(image, root, 200, 100, [(20, 10, 60, 90, 0.8)])
        self.assertEqual(task["data"]["image"], "/data/local-files/?d=frames/s1/lying/s1_lying_c01_t00000.jpg")
        self.assertNotIn("annotations", task)
        v = task["predictions"][0]["result"][0]["value"]
        self.assertAlmostEqual(v["x"], 10.0)
        self.assertAlmostEqual(v["y"], 10.0)
        self.assertAlmostEqual(v["width"], 20.0)
        self.assertAlmostEqual(v["height"], 80.0)


def ls_task(frame: str, annotations=None, predictions=True) -> dict:
    box = {"type": "rectanglelabels", "value": {"x": 10, "y": 20, "width": 30, "height": 40, "rotation": 0,
                                                "rectanglelabels": ["person"]}}
    task = {"data": {"image": f"/data/local-files/?d=frames/{frame}", "frame": f"frames/{frame}"}}
    if predictions:
        task["predictions"] = [{"result": [box]}]
    task["annotations"] = annotations if annotations is not None else []
    return task


class LabelStudioConvertTest(TempDataDir):
    def test_only_human_annotations_are_used(self):
        box = {"type": "rectanglelabels", "value": {"x": 10, "y": 20, "width": 30, "height": 40, "rotation": 0,
                                                    "rectanglelabels": ["person"]}}
        tasks = [
            ls_task("s1_lying_c01_t00000.jpg", annotations=[{"id": 1, "result": [box], "updated_at": "2026-01-01"}]),
            ls_task("s1_lying_c01_t00010.jpg"),  # 초안만 있음 → 미검수
            ls_task("s1_bg-tv_c01_t00000.jpg", annotations=[{"id": 2, "result": []}]),  # 박스 0개 제출 → 배경
            ls_task("s1_occluded_c01_t00000.jpg", annotations=[{"id": 3, "result": [box], "was_cancelled": True}]),
        ]
        labels = self.root / "labels"
        written, boxes, unreviewed, errors = ls_to_yolo.convert(tasks, labels)
        self.assertEqual((written, boxes, errors), (2, 1, []))
        self.assertEqual(sorted(unreviewed), ["s1_lying_c01_t00010.jpg", "s1_occluded_c01_t00000.jpg"])
        line = (labels / "s1" / "lying" / "s1_lying_c01_t00000.txt").read_text(encoding="utf-8").split()
        self.assertEqual(line[0], "0")
        self.assertEqual([round(float(v), 4) for v in line[1:]], [0.25, 0.4, 0.3, 0.4])
        self.assertEqual((labels / "s1" / "bg-tv" / "s1_bg-tv_c01_t00000.txt").read_text(encoding="utf-8"), "")
        self.assertFalse((labels / "s1" / "lying" / "s1_lying_c01_t00010.txt").exists())

    def test_latest_annotation_wins_and_stale_label_removed(self):
        box = lambda x: {"type": "rectanglelabels", "value": {"x": x, "y": 0, "width": 10, "height": 10,  # noqa: E731
                                                              "rectanglelabels": ["person"]}}
        task = ls_task("s1_sitting_c01_t00000.jpg", annotations=[
            {"id": 1, "result": [box(0)], "updated_at": "2026-01-01T00:00:00"},
            {"id": 2, "result": [box(50)], "updated_at": "2026-02-01T00:00:00"},
        ])
        labels = self.root / "labels"
        ls_to_yolo.convert([task], labels)
        path = labels / "s1" / "sitting" / "s1_sitting_c01_t00000.txt"
        self.assertAlmostEqual(float(path.read_text(encoding="utf-8").split()[1]), 0.55)
        task["annotations"] = []
        ls_to_yolo.convert([task], labels)
        self.assertFalse(path.exists())

    def test_rejects_other_labels(self):
        bad = {"type": "rectanglelabels", "value": {"x": 0, "y": 0, "width": 5, "height": 5, "rectanglelabels": ["dog"]}}
        _, _, _, errors = ls_to_yolo.convert([ls_task("s1_lying_c01_t00000.jpg", annotations=[{"id": 1, "result": [bad]}])],
                                             self.root / "labels")
        self.assertEqual(len(errors), 1)


class ImportPublicTest(TempDataDir):
    def test_class_mapping_polygon_and_names(self):
        self.assertEqual(import_public.convert_line("2 0.5 0.5 0.2 0.2", {0, 1}), None)
        self.assertEqual(import_public.convert_line("1 0.5 0.5 0.2 0.4", {0, 1}), "0 0.500000 0.500000 0.200000 0.400000")
        self.assertEqual(import_public.convert_line("0 0.1 0.2 0.3 0.2 0.3 0.6 0.1 0.6", {0}),
                         "0 0.200000 0.400000 0.200000 0.400000")

        src = self.root / "src"
        write_image(src / "train" / "images" / "s1_x.jpg", 1)  # 원본 이름이 세션처럼 생겨도
        (src / "train" / "labels").mkdir(parents=True)
        (src / "train" / "labels" / "s1_x.txt").write_text("0 0.5 0.5 0.2 0.2\n3 0.5 0.5 0.1 0.1\n", encoding="utf-8")
        write_image(src / "valid" / "images" / "bg.jpg", 2)  # 라벨 파일 없음 → 배경
        self.assertEqual(import_public.main(["--src", str(src), "--name", "fall-a", "--person-classes", "0"]), 0)
        out = self.root / "public" / "fall-a"
        names = sorted(p.stem for p in (out / "images").iterdir())
        self.assertEqual(names, ["p_fall-a_train__s1_x", "p_fall-a_valid__bg"])
        report = json.loads((out / "import_report.json").read_text(encoding="utf-8"))
        self.assertEqual((report["person_boxes"], report["dropped_boxes"], report["background_images"]), (1, 1, 1))
        # 다시 실행하면 지우고 새로 만든다
        self.assertEqual(import_public.main(["--src", str(src), "--name", "fall-a", "--person-classes", "0"]), 0)


class BuildDatasetTest(TempDataDir):
    def make_session(self, session: str, seed: int, scenes=("standing", "lying", "bg-tv")):
        for i, scene in enumerate(scenes):
            stem = f"{session}_{scene}_c01_t00000"
            write_image(self.root / "frames" / session / scene / f"{stem}.jpg", seed + i)
            label = self.root / "labels" / session / scene / f"{stem}.txt"
            label.parent.mkdir(parents=True, exist_ok=True)
            label.write_text("" if scene.startswith("bg") else "0 0.5 0.5 0.2 0.4\n", encoding="utf-8")
        # 검수하지 않은 프레임 (라벨 없음)
        write_image(self.root / "frames" / session / "lying" / f"{session}_lying_c01_t00010.jpg", seed + 50)

    def make_public(self):
        pub = self.root / "public" / "fall-a"
        write_image(pub / "images" / "p_fall-a_1.jpg", 100)
        (pub / "labels").mkdir(parents=True, exist_ok=True)
        (pub / "labels" / "p_fall-a_1.txt").write_text("0 0.5 0.5 0.3 0.3\n", encoding="utf-8")

    def test_builds_dataset_with_scene_lists(self):
        self.make_session("s1", 0)
        self.make_session("s2", 10)
        self.make_public()
        self.assertEqual(build_dataset.main([]), 0)
        out = self.root / "datasets" / "byeol-home"
        report = json.loads((out / "split_report.json").read_text(encoding="utf-8"))
        self.assertEqual(report["splits"]["val"]["sessions"], ["s1"])
        self.assertEqual(report["splits"]["test"]["sessions"], ["s2"])
        self.assertEqual(report["unreviewed_frames"], {"val": 1, "test": 1})
        self.assertEqual(report["splits"]["train"]["images"], 1)
        self.assertEqual((report["splits"]["val"]["images"], report["splits"]["val"]["instances"]), (3, 2))
        lying = (out / "scenes" / "val_lying.txt").read_text(encoding="utf-8").split()
        self.assertEqual(len(lying), 1)
        self.assertTrue(Path(lying[0]).exists())
        self.assertEqual((out / "labels" / "val" / "s1_bg-tv_c01_t00000.txt").read_text(encoding="utf-8"), "")
        self.assertIn("names:\n  0: person", (out / "data.yaml").read_text(encoding="utf-8"))

    def test_same_session_for_val_and_test_is_rejected(self):
        self.make_session("s1", 0)
        self.assertEqual(build_dataset.main(["--val-session", "s1", "--test-session", "s1"]), 1)

    def test_check_splits_detects_shared_session(self):
        img = write_image(self.root / "a" / "s1_lying_c01_t00000.jpg", 1)
        img2 = write_image(self.root / "b" / "s1_lying_c01_t00010.jpg", 2)
        splits = {"train": [], "val": [{"image": img, "label": self.root / "none.txt", "scene": "lying", "session": "s1"}],
                  "test": [{"image": img2, "label": self.root / "none.txt", "scene": "lying", "session": "s1"}]}
        with self.assertRaisesRegex(build_dataset.DatasetError, "같은 세션"):
            build_dataset.check_splits(splits)

    def test_duplicate_image_across_splits_is_rejected(self):
        self.make_session("s1", 0)
        self.make_session("s2", 10)
        self.make_public()
        # 공개 데이터에 검증 프레임과 같은 이미지가 섞인 경우
        same = (self.root / "frames" / "s1" / "lying" / "s1_lying_c01_t00000.jpg").read_bytes()
        (self.root / "public" / "fall-a" / "images" / "p_fall-a_dup.jpg").write_bytes(same)
        self.assertEqual(build_dataset.main([]), 1)
        self.assertFalse((self.root / "datasets" / "byeol-home").exists())

    def test_session_named_file_in_train_is_rejected(self):
        self.make_session("s1", 0)
        self.make_session("s2", 10)
        pub = self.root / "public" / "leak"
        write_image(pub / "images" / "s3_lying_c01_t00000.jpg", 200)
        self.assertEqual(build_dataset.main([]), 1)

    def test_bad_label_is_rejected(self):
        self.make_session("s1", 0)
        self.make_session("s2", 10)
        (self.root / "labels" / "s2" / "lying" / "s2_lying_c01_t00000.txt").write_text("1 0.5 0.5 0.2 0.2\n", encoding="utf-8")
        self.assertEqual(build_dataset.main([]), 1)


class TrainSettingsTest(unittest.TestCase):
    def test_document_settings(self):
        self.assertEqual(train.train_kwargs("rehearsal", None, None, None), {"fraction": 0.1, "epochs": 3, "imgsz": 640})
        self.assertEqual(train.train_kwargs("full", None, None, None),
                         {"imgsz": 640, "epochs": 300, "patience": 15, "batch": -1, "cache": True, "freeze": 10})
        self.assertEqual(train.train_kwargs("full", None, None, "disk")["cache"], "disk")

    def test_lr0_requires_explicit_optimizer(self):
        with self.assertRaises(ValueError):
            train.train_kwargs("full", 0.001, None, None)
        with self.assertRaises(ValueError):
            train.train_kwargs("full", 0.001, "auto", None)
        self.assertEqual(train.train_kwargs("full", 0.001, "SGD", None)["lr0"], 0.001)


if __name__ == "__main__":
    unittest.main()
