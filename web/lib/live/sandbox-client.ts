"use client";

import { truncate } from "./shared";

export interface CellResult {
  stdout: string;
  stderr: string;
  error: string | null;
  images: string[]; // data URLs
  truncated: boolean;
  exec_s: number;
}

type Pending = { resolve: (v: Record<string, unknown>) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Browser sandbox: a Pyodide Web Worker. Same semantics as bench/bench/sandbox.py — persistent state,
 * per-cell timeout, kernel restart (state lost, agent told) on timeout, truncated output.
 */
export class BrowserSandbox {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private cell = 0;
  private files: { path: string; url: string }[] = [];
  ready: Promise<{ python: string; numpy: string; pandas: string; scipy: string }> | null = null;

  constructor(
    private onProgress: (stage: string, pct: number) => void,
    private timeoutS = 60,
  ) {}

  init(files: { path: string; url: string }[]) {
    if (this.ready && JSON.stringify(files) === JSON.stringify(this.files)) return this.ready;
    this.terminate();
    this.files = files;
    this.cell = 0;
    const w = new Worker("/pyodide-worker.js", { type: "module" });
    this.worker = w;
    this.ready = new Promise((resolve, reject) => {
      w.onmessage = (ev: MessageEvent) => {
        const m = ev.data;
        if (m.type === "progress") this.onProgress(m.stage, m.pct);
        else if (m.type === "ready") resolve(m.versions);
        else if (m.type === "fatal") reject(new Error(m.message));
        else if (m.type === "result") {
          const p = this.pending.get(m.id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(m.id);
            p.resolve(m);
          }
        }
      };
      w.onerror = (e) => reject(new Error(e.message || "worker failed to start"));
    });
    w.postMessage({ type: "init", files });
    // a failed boot must not leave a rejected promise behind for later calls to await
    this.ready.catch(() => this.terminate());
    return this.ready;
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
  }

  private call(msg: Record<string, unknown>, timeoutS: number): Promise<Record<string, unknown>> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ __timeout: true });
      }, timeoutS * 1000);
      this.pending.set(id, { resolve, timer });
      this.worker!.postMessage({ ...msg, id });
    });
  }

  async run(code: string): Promise<CellResult> {
    await this.ready;
    this.cell += 1;
    const t0 = performance.now();
    const r = await this.call({ type: "run", code, cell: this.cell }, this.timeoutS);
    if (r.__timeout) {
      const files = this.files;
      this.ready = null;
      this.init(files); // restart: state is lost, exactly like the server sandbox
      await this.ready;
      return {
        stdout: "",
        stderr: "",
        images: [],
        truncated: false,
        error: `TimeoutError: cell exceeded ${this.timeoutS}s; kernel restarted and all state was lost.`,
        exec_s: (performance.now() - t0) / 1000,
      };
    }
    const [stdout, t1] = truncate(String(r.stdout ?? ""));
    const [stderr, t2] = truncate(String(r.stderr ?? ""), 2000);
    return {
      stdout,
      stderr,
      error: (r.error as string | null) ?? null,
      images: ((r.images as string[]) ?? []).map((b) => `data:image/png;base64,${b}`),
      truncated: t1 || t2,
      exec_s: Number(r.exec_s ?? (performance.now() - t0) / 1000),
    };
  }

  /** Fresh Python namespace and pristine input files for a new run (runtime stays loaded). */
  async reset() {
    await this.ready;
    this.cell = 0;
    await this.call({ type: "reset" }, 20);
  }

  async listFiles() {
    await this.ready;
    const r = await this.call({ type: "list" }, 10);
    return { files: (r.files as { path: string; bytes: number }[]) ?? [] };
  }

  async readFile(path: string, maxBytes = 4000) {
    await this.ready;
    const r = await this.call({ type: "read", path, max_bytes: maxBytes }, 10);
    const { id: _id, type: _t, ...rest } = r;
    void _id;
    void _t;
    return rest;
  }
}
