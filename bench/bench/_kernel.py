"""Sandbox kernel: runs inside a child process with cwd = task workspace.

Protocol (line-delimited JSON over stdin/stdout):
  in : {"code": str, "cell": int}
  out: {"stdout": str, "stderr": str, "error": str | null, "images": [str]}

User output is captured in-process, so the real stdout only carries protocol frames.
"""

import contextlib
import io
import json
import os
import sys
import traceback

os.environ.setdefault("MPLBACKEND", "Agg")
_proto_out = sys.stdout
_globals: dict = {"__name__": "__main__"}


def _save_figures(cell: int) -> list[str]:
    if "matplotlib.pyplot" not in sys.modules:
        return []
    import matplotlib.pyplot as plt

    paths = []
    os.makedirs("plots", exist_ok=True)
    for k, num in enumerate(plt.get_fignums()):
        fig = plt.figure(num)
        path = os.path.join("plots", f"cell{cell:02d}_{k}.png")
        fig.savefig(path, dpi=72, bbox_inches="tight")
        paths.append(path.replace(os.sep, "/"))
    plt.close("all")
    return paths


def main() -> None:
    for line in sys.stdin:
        req = json.loads(line)
        out, err = io.StringIO(), io.StringIO()
        error = None
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                exec(compile(req["code"], f"<cell {req['cell']}>", "exec"), _globals)
            except SystemExit:
                error = "SystemExit is not allowed in the sandbox"
            except BaseException:  # noqa: BLE001 - report everything to the agent
                etype, evalue, tb = sys.exc_info()
                frames = [f for f in traceback.extract_tb(tb) if f.filename.startswith("<cell")]
                error = "".join(traceback.format_list(frames) + traceback.format_exception_only(etype, evalue))
            try:
                images = _save_figures(req["cell"])
            except Exception as e:  # noqa: BLE001
                images = []
                err.write(f"[plot capture failed: {e}]\n")
        _proto_out.write(json.dumps({"stdout": out.getvalue(), "stderr": err.getvalue(), "error": error, "images": images}) + "\n")
        _proto_out.flush()


if __name__ == "__main__":
    main()
