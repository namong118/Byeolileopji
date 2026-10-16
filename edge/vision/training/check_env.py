"""학습 환경 확인 — torch CUDA, GPU, ultralytics, 데이터·결과 폴더, GPU 추론 1회.

  python check_env.py          실패하면 종료 코드 1
"""

from __future__ import annotations

import sys


def main() -> int:
    import torch

    from common import data_dir, runs_dir, setup_ultralytics, weights_path

    print(f"Python       {sys.version.split()[0]}")
    print(f"torch        {torch.__version__} (CUDA 빌드 {torch.version.cuda})")
    ok = torch.cuda.is_available()
    print(f"CUDA 사용    {ok}")
    if not ok:
        print("GPU 를 쓰지 못합니다. torch 를 CUDA 판으로 설치했는지 확인하세요 (README 1장).", file=sys.stderr)
        return 1
    props = torch.cuda.get_device_properties(0)
    print(f"GPU          {props.name}, VRAM {props.total_memory / 1024**3:.1f} GB")

    setup_ultralytics()
    import cv2
    import ultralytics

    print(f"ultralytics  {ultralytics.__version__}")
    print(f"opencv       {cv2.__version__}")
    print(f"데이터 폴더  {data_dir()}")
    print(f"결과 폴더    {runs_dir()}")

    from ultralytics.utils import SETTINGS
    from ultralytics.utils.events import events

    print(f"가중치 폴더  {SETTINGS['weights_dir']} (AMP 검사용 포함)")
    print(f"사용 이벤트  {'전송함' if events.enabled else '전송 안 함'} (sync={SETTINGS['sync']})")
    if events.enabled:
        print("ultralytics 사용 이벤트 전송이 켜져 있습니다 — setup_ultralytics() 설정을 확인하세요.", file=sys.stderr)
        return 1

    from ultralytics import YOLO
    from ultralytics.utils import ASSETS

    model = YOLO(str(weights_path()))
    r = model.predict(str(ASSETS / "bus.jpg"), classes=[0], device=0, verbose=False)[0]
    print(f"GPU 추론     {len(r.boxes)}명 검출, {r.speed['inference']:.1f} ms (예제 이미지 1장, 첫 실행이라 느릴 수 있음)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
