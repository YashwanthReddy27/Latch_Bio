import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { ConfigRow, FailuresFile, IndexRow, Meta, TasksFile, Trajectory } from "./types";

const DATA_DIR = path.join(process.cwd(), "public", "data");

function read<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8")) as T;
}

export const getMeta = () => read<Meta>("meta.json");
export const getConfigs = () => read<ConfigRow[]>("configs.json");
export const getIndex = () => read<IndexRow[]>("index.json");
export const getFailures = () => read<FailuresFile>("failures.json");
export const getTasks = () => read<TasksFile>("tasks.json");
export const getReplays = () => read<Record<string, { id: string; kind: string }>>("live_replays.json");

export function getTrajectory(id: string): Trajectory | null {
  const file = path.join(DATA_DIR, "traj", `${id}.json`);
  if (!/^[\w.\-]+$/.test(id) || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Trajectory;
}

export function listTrajectoryIds(): string[] {
  return getIndex().map((r) => r.id);
}
