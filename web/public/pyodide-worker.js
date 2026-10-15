/* Helix Trace in-browser sandbox: Pyodide in a (module) Web Worker.
 * Mirrors bench/bench/_kernel.py: persistent namespace, captured stdout/stderr, traceback limited to
 * agent cells, matplotlib figures captured as PNG. Loaded from the official Pyodide CDN on first use.
 *
 * Messages in : {type:"init", files:[{path, url}]} | {type:"run", id, code, cell} | {type:"list", id} | {type:"read", id, path, max_bytes}
 * Messages out: {type:"progress", stage, pct} | {type:"ready", versions} | {type:"result", id, ...} | {type:"fatal", message}
 */
const PYODIDE_VERSION = "314.0.7";
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
let pyodide = null;
let runCell = null;
const fileCache = new Map();

const BOOT = `
import sys, io, os, json, base64, contextlib, traceback
os.environ["MPLBACKEND"] = "Agg"
os.makedirs("/work", exist_ok=True)
os.chdir("/work")
_ns = {"__name__": "__main__"}

def _save_figures():
    if "matplotlib.pyplot" not in sys.modules:
        return []
    import matplotlib.pyplot as plt
    out = []
    for num in plt.get_fignums():
        buf = io.BytesIO()
        plt.figure(num).savefig(buf, format="png", dpi=72, bbox_inches="tight")
        out.append(base64.b64encode(buf.getvalue()).decode())
    plt.close("all")
    return out

def _run_cell(code, cell):
    out, err = io.StringIO(), io.StringIO()
    error = None
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            exec(compile(code, f"<cell {cell}>", "exec"), _ns)
        except SystemExit:
            error = "SystemExit is not allowed in the sandbox"
        except BaseException:
            etype, evalue, tb = sys.exc_info()
            frames = [f for f in traceback.extract_tb(tb) if f.filename.startswith("<cell")]
            error = "".join(traceback.format_list(frames) + traceback.format_exception_only(etype, evalue))
        try:
            images = _save_figures()
        except Exception as e:
            images = []
            err.write(f"[plot capture failed: {e}]\\n")
    return json.dumps({"stdout": out.getvalue(), "stderr": err.getvalue(), "error": error, "images": images})

def _reset():
    _ns.clear()
    _ns["__name__"] = "__main__"
    if "matplotlib.pyplot" in sys.modules:
        sys.modules["matplotlib.pyplot"].close("all")
    os.chdir("/work")

_run_cell
`;

function post(msg) {
  self.postMessage(msg);
}

async function init(files) {
  post({ type: "progress", stage: "Downloading Python runtime (Pyodide)", pct: 5 });
  // Pyodide >= 314 only runs in module workers (classic workers are rejected)
  const { loadPyodide } = await import(`${INDEX_URL}pyodide.mjs`);
  pyodide = await loadPyodide({ indexURL: INDEX_URL });
  post({ type: "progress", stage: "Loading numpy, pandas, scipy, matplotlib", pct: 35 });
  let loaded = 0;
  const pkgs = ["numpy", "pandas", "scipy", "matplotlib"];
  for (const p of pkgs) {
    await pyodide.loadPackage(p, { messageCallback: () => {} });
    loaded += 1;
    post({ type: "progress", stage: `Loaded ${p}`, pct: 35 + Math.round((loaded / pkgs.length) * 45) });
  }
  runCell = pyodide.runPython(BOOT);
  post({ type: "progress", stage: "Copying task files into the sandbox", pct: 85 });
  for (const f of files) {
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`could not fetch ${f.url}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    fileCache.set(f.path, buf);
    pyodide.FS.writeFile(`/work/${f.path}`, buf);
  }
  // warm imports so the first agent cell is not charged for them
  pyodide.runPython("import numpy, pandas, scipy.stats");
  const versions = JSON.parse(
    pyodide.runPython(
      "import json, sys, numpy, pandas, scipy; json.dumps({'python': sys.version.split()[0], 'numpy': numpy.__version__, 'pandas': pandas.__version__, 'scipy': scipy.__version__})",
    ),
  );
  post({ type: "progress", stage: "Ready", pct: 100 });
  post({ type: "ready", versions });
}

function listFiles() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const name of pyodide.FS.readdir(dir)) {
      if (name === "." || name === "..") continue;
      const full = `${dir}/${name}`;
      const st = pyodide.FS.stat(full);
      if (pyodide.FS.isDir(st.mode)) walk(full, `${prefix}${name}/`);
      else out.push({ path: `${prefix}${name}`, bytes: st.size });
    }
  };
  walk("/work", "");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function readFile(path, maxBytes) {
  const max = Math.max(1, Math.min(Number(maxBytes) || 4000, 20000));
  const norm = String(path).replace(/^\.?\//, "");
  if (norm.split("/").includes("..") || norm.startsWith("/")) return { error: "path escapes the workspace" };
  try {
    const data = pyodide.FS.readFile(`/work/${norm}`);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(data.slice(0, max));
    return { path: norm, content: text, truncated: data.length > max, total_bytes: data.length };
  } catch {
    return { error: `no such file: ${path}` };
  }
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") {
      await init(msg.files);
    } else if (msg.type === "run") {
      const t0 = performance.now();
      const res = JSON.parse(runCell(msg.code, msg.cell));
      post({ type: "result", id: msg.id, ...res, exec_s: (performance.now() - t0) / 1000 });
    } else if (msg.type === "reset") {
      // fresh namespace + pristine inputs for a new run, without re-downloading the runtime
      pyodide.globals.get("_reset")();
      for (const p of listFiles().map((f) => f.path)) pyodide.FS.unlink(`/work/${p}`);
      for (const [p, buf] of fileCache) pyodide.FS.writeFile(`/work/${p}`, buf);
      post({ type: "result", id: msg.id, ok: true });
    } else if (msg.type === "list") {
      post({ type: "result", id: msg.id, files: listFiles() });
    } else if (msg.type === "read") {
      post({ type: "result", id: msg.id, ...readFile(msg.path, msg.max_bytes) });
    }
  } catch (e) {
    if (msg.type === "init") post({ type: "fatal", message: String(e && e.message ? e.message : e) });
    else post({ type: "result", id: msg.id, error: `SandboxError: ${e && e.message ? e.message : e}` });
  }
};
