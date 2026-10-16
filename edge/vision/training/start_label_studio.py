"""Label Studio 를 이 PC 안에서만 쓰도록 설정해 실행한다 (.venv-labelstudio 의 Python 으로 실행).

  .venv-labelstudio\\Scripts\\python start_label_studio.py

- 데이터베이스·내보내기 파일은 <data>/label-studio 에 둔다 (기본 위치인 사용자 폴더 대신).
- 이미지는 업로드하지 않고 <data> 폴더의 파일을 로컬 파일 주소로 보여 준다.
- 사용 통계 전송, 오류 보고(Sentry), 새 버전 확인을 끈다.
- 127.0.0.1 에서만 연다 (같은 네트워크의 다른 기기에서 접속하지 못함).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from common import data_dir

PRIVACY_ENV = {
    "LABEL_STUDIO_COLLECT_ANALYTICS": "false",   # 사용 통계 (tele.labelstud.io) 끔
    "LABEL_STUDIO_SENTRY_DSN": "",               # 서버 오류 보고 끔
    "LABEL_STUDIO_FRONTEND_SENTRY_DSN": "",      # 브라우저 오류 보고 끔
    "LABEL_STUDIO_LATEST_VERSION_CHECK": "false",  # 시작할 때 PyPI 버전 확인 끔
}


def label_studio_env(root: Path) -> dict[str, str]:
    return {
        **PRIVACY_ENV,
        "LABEL_STUDIO_BASE_DATA_DIR": str(root / "label-studio"),
        "LABEL_STUDIO_LOCAL_FILES_SERVING_ENABLED": "true",
        "LABEL_STUDIO_LOCAL_FILES_DOCUMENT_ROOT": str(root),
    }


def main() -> int:
    root = data_dir()
    root.mkdir(parents=True, exist_ok=True)
    exe = shutil.which("label-studio", path=str(Path(sys.executable).parent))
    if exe is None:
        print("label-studio 를 찾지 못했습니다. .venv-labelstudio 의 Python 으로 실행하세요 (README 1장).", file=sys.stderr)
        return 1
    env = {**os.environ, **label_studio_env(root)}
    print(f"데이터 폴더(로컬 파일 루트): {root}")
    print("브라우저에서 http://127.0.0.1:8080 을 여세요. 끝내려면 Ctrl+C.")
    return subprocess.call([exe, "start", "--internal-host", "127.0.0.1", "--port", "8080", "--no-browser",
                            *sys.argv[1:]], env=env)


if __name__ == "__main__":
    sys.exit(main())
