"""CRISPRScreenBench-mini: verifiable pooled CRISPR screen analysis tasks for AI agents."""

from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent
BENCH_DIR = PKG_DIR.parent
REPO_DIR = BENCH_DIR.parent
DATA_DIR = BENCH_DIR / "data"
SCREEN_DIR = DATA_DIR / "screen"
TASKS_DIR = PKG_DIR / "tasks"
RUNS_DIR = BENCH_DIR / "runs"
WEB_DATA_DIR = REPO_DIR / "web" / "public" / "data"
WEB_TASKS_DIR = REPO_DIR / "web" / "public" / "tasks"
