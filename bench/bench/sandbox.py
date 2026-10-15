"""Sandboxed Python tool for agents.

A persistent kernel (bench/_kernel.py) runs in a child process whose cwd is a throwaway
workspace holding only the task's input files. Each cell has a wall-clock timeout; on
timeout the kernel is killed and restarted (state is lost, and the agent is told so).
Output is truncated before it reaches the model.

Isolation is process-level: separate interpreter, separate cwd, minimal environment,
no API keys passed through. It is NOT a security boundary against hostile code (no
seccomp / network namespace) — fine for benchmarking cooperative agents, documented in
the README limitations.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

KERNEL = Path(__file__).with_name("_kernel.py")
MAX_OUTPUT_CHARS = 6000


def truncate(text: str, limit: int = MAX_OUTPUT_CHARS) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    head = text[: limit * 2 // 3]
    tail = text[-limit // 3:]
    return f"{head}\n... [{len(text) - limit} chars truncated] ...\n{tail}", True


class Sandbox:
    def __init__(self, workspace: Path, timeout_s: float = 60.0):
        self.workspace = Path(workspace).resolve()
        self.timeout_s = timeout_s
        self.cell = 0
        self.proc: subprocess.Popen | None = None
        self._q: queue.Queue = queue.Queue()

    # -- lifecycle --------------------------------------------------------------------
    def start(self) -> None:
        env = {k: v for k, v in os.environ.items()
               if k.upper() in ("PATH", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "PROGRAMDATA", "APPDATA", "TEMP", "TMP",
                             "HOME", "USERPROFILE", "PYTHONPATH", "LOCALAPPDATA")}
        env["MPLBACKEND"] = "Agg"
        env["PYTHONIOENCODING"] = "utf-8"
        self.proc = subprocess.Popen(
            [sys.executable, "-u", str(KERNEL)], cwd=self.workspace, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", bufsize=1,
        )
        self._q = queue.Queue()
        threading.Thread(target=self._reader, args=(self.proc, self._q), daemon=True).start()

    @staticmethod
    def _reader(proc: subprocess.Popen, q: queue.Queue) -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            q.put(line)
        q.put(None)

    def close(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait()
        self.proc = None

    def __enter__(self) -> "Sandbox":
        self.start()
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- tools ------------------------------------------------------------------------
    def run_python(self, code: str) -> dict:
        if self.proc is None or self.proc.poll() is not None:
            self.start()
        self.cell += 1
        t0 = time.perf_counter()
        assert self.proc and self.proc.stdin
        try:
            self.proc.stdin.write(json.dumps({"code": code, "cell": self.cell}) + "\n")
            self.proc.stdin.flush()
            line = self._q.get(timeout=self.timeout_s)
        except queue.Empty:
            self.close()
            self.start()
            return {"stdout": "", "stderr": "", "images": [], "truncated": False,
                    "error": f"TimeoutError: cell exceeded {self.timeout_s:.0f}s; kernel restarted and all state was lost.",
                    "exec_s": round(time.perf_counter() - t0, 3)}
        except (BrokenPipeError, OSError):
            line = None
        if line is None:
            self.close()
            self.start()
            return {"stdout": "", "stderr": "", "images": [], "truncated": False,
                    "error": "KernelDied: the Python process exited; kernel restarted and all state was lost.",
                    "exec_s": round(time.perf_counter() - t0, 3)}
        res = json.loads(line)
        stdout, t1 = truncate(res["stdout"])
        stderr, t2 = truncate(res["stderr"], 2000)
        return {"stdout": stdout, "stderr": stderr, "error": res["error"], "images": res["images"],
                "truncated": t1 or t2, "exec_s": round(time.perf_counter() - t0, 3)}

    def list_files(self) -> dict:
        files = []
        for p in sorted(self.workspace.rglob("*")):
            if p.is_file():
                files.append({"path": p.relative_to(self.workspace).as_posix(), "bytes": p.stat().st_size})
        return {"files": files}

    def read_file(self, path: str, max_bytes: int = 4000) -> dict:
        max_bytes = max(1, min(int(max_bytes), 20000))
        target = (self.workspace / path).resolve()
        if self.workspace not in target.parents and target != self.workspace:
            return {"error": "path escapes the workspace"}
        if not target.is_file():
            return {"error": f"no such file: {path}"}
        data = target.read_bytes()
        return {"path": path, "content": data[:max_bytes].decode("utf-8", errors="replace"),
                "truncated": len(data) > max_bytes, "total_bytes": len(data)}
