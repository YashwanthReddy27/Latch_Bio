"""Declarative, deterministic grader engine.

A task's grader is a JSON spec made of a small set of check kinds. No LLM calls, no
randomness, no wall-clock dependence: the same answer always gets the same verdict.

This module is mirrored line-for-line in web/lib/graders/engine.ts. The parity fixtures in
tests/fixtures/grader_cases.json are evaluated by both implementations (pytest and
`npm run test:parity`) and must produce identical `passed`, `score` and per-check verdicts.

Check kinds
  exact          path, value                     int / str (str compare: trimmed, case-insensitive)
  numeric        path, value, abs_tol
  numeric_map    path, values{k: v}, abs_tol     every key present and within tolerance
  range          path, min, max                  inclusive, numeric
  set_equal      path, values[]                  case-insensitive
  set_overlap    path, truth[], min_recall, min_precision, max_items
  f1             path, truth[], min_f1
  max_overlap    path, forbidden[], max_count    e.g. at most 2 core-essential genes in a hit list
  classification path, truth{item: class}, min_accuracy   answer is {class: [items]}
"""

from __future__ import annotations

import math
from typing import Any

EPS = 1e-9


# ---------------------------------------------------------------------------- schema

def _type_ok(value: Any, typ: str) -> bool:
    if typ == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if typ == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    if typ == "string":
        return isinstance(value, str)
    if typ == "array":
        return isinstance(value, list)
    if typ == "object":
        return isinstance(value, dict)
    return False


def validate_schema(answer: Any, schema: dict) -> str | None:
    """Minimal JSON-schema subset: object root, required keys, typed properties,
    array `items.type`, object `additionalProperties.type`. Returns an error or None."""
    if not isinstance(answer, dict):
        return "answer must be a JSON object"
    for key in schema.get("required", []):
        if key not in answer:
            return f"missing required key '{key}'"
    for key, prop in schema.get("properties", {}).items():
        if key not in answer:
            continue
        v = answer[key]
        if not _type_ok(v, prop["type"]):
            return f"'{key}' must be of type {prop['type']}"
        if prop["type"] == "array" and "items" in prop:
            for item in v:
                if not _type_ok(item, prop["items"]["type"]):
                    return f"items of '{key}' must be of type {prop['items']['type']}"
        if prop["type"] == "object" and "additionalProperties" in prop:
            sub = prop["additionalProperties"]
            for k2, item in v.items():
                if not _type_ok(item, sub["type"]):
                    return f"'{key}.{k2}' must be of type {sub['type']}"
                if sub["type"] == "array" and "items" in sub:
                    for x in item:
                        if not _type_ok(x, sub["items"]["type"]):
                            return f"items of '{key}.{k2}' must be of type {sub['items']['type']}"
    return None


# ---------------------------------------------------------------------------- helpers

_MISSING = object()


def _get(answer: dict, path: str) -> Any:
    cur: Any = answer
    if path == "":
        return cur
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return _MISSING
        cur = cur[part]
    return cur


def _norm(s: Any) -> str:
    return str(s).strip().upper()


def _fmt(x: float) -> str:
    """Stable number formatting shared with the TS port (4 decimals, trailing zeros trimmed)."""
    s = f"{x:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _result(check: dict, passed: bool, expected: str, actual: str, detail: str) -> dict:
    return {
        "id": check["id"],
        "kind": check["kind"],
        "label": check.get("label", check["id"]),
        "passed": bool(passed),
        "expected": expected,
        "actual": actual,
        "detail": detail,
    }


# ---------------------------------------------------------------------------- checks

def _check(check: dict, answer: dict) -> dict:
    kind = check["kind"]
    v = _get(answer, check["path"])
    if v is _MISSING:
        return _result(check, False, "present", "missing", f"no value at '{check['path']}'")

    if kind == "exact":
        exp = check["value"]
        if isinstance(exp, str):
            ok = isinstance(v, str) and _norm(v) == _norm(exp)
        else:
            ok = _type_ok(v, "number") and v == exp
        return _result(check, ok, str(exp), str(v), "exact match" if ok else "value differs")

    if kind == "numeric":
        if not _type_ok(v, "number"):
            return _result(check, False, _fmt(check["value"]), str(v), "not a number")
        diff = abs(v - check["value"])
        ok = diff <= check["abs_tol"] + EPS
        return _result(check, ok, f"{_fmt(check['value'])} ± {_fmt(check['abs_tol'])}", _fmt(v),
                       f"|diff| = {_fmt(diff)}")

    if kind == "numeric_map":
        if not isinstance(v, dict):
            return _result(check, False, "object", str(type(v).__name__), "not an object")
        bad = []
        for k, exp in check["values"].items():
            got = v.get(k, _MISSING)
            if got is _MISSING or not _type_ok(got, "number"):
                bad.append(f"{k}: missing")
            elif abs(got - exp) > check["abs_tol"] + EPS:
                bad.append(f"{k}: {_fmt(got)} vs {_fmt(exp)}")
        ok = not bad
        n = len(check["values"])
        return _result(check, ok, f"{n} values within ± {_fmt(check['abs_tol'])}",
                       f"{n - len(bad)}/{n} within tolerance",
                       "all within tolerance" if ok else "; ".join(bad))

    if kind == "range":
        if not _type_ok(v, "number"):
            return _result(check, False, f"[{_fmt(check['min'])}, {_fmt(check['max'])}]", str(v), "not a number")
        ok = check["min"] - EPS <= v <= check["max"] + EPS
        return _result(check, ok, f"[{_fmt(check['min'])}, {_fmt(check['max'])}]", _fmt(v),
                       "within range" if ok else "outside range")

    if kind in ("set_equal", "set_overlap", "f1", "max_overlap"):
        if not isinstance(v, list):
            return _result(check, False, "list", str(type(v).__name__), "not a list")
        got = {_norm(x) for x in v}

        if kind == "set_equal":
            exp = {_norm(x) for x in check["values"]}
            ok = got == exp
            missing = sorted(exp - got)
            extra = sorted(got - exp)
            detail = "sets match" if ok else f"missing {missing} extra {extra}"
            return _result(check, ok, ", ".join(sorted(exp)) or "(empty)", ", ".join(sorted(got)) or "(empty)", detail)

        if kind == "max_overlap":
            forb = {_norm(x) for x in check["forbidden"]}
            hit = sorted(got & forb)
            ok = len(hit) <= check["max_count"]
            return _result(check, ok, f"≤ {check['max_count']}", str(len(hit)),
                           "ok" if not hit else f"includes {hit[:8]}")

        truth = {_norm(x) for x in check["truth"]}
        tp = len(got & truth)
        recall = tp / len(truth) if truth else 0.0
        precision = tp / len(got) if got else 0.0

        if kind == "set_overlap":
            too_many = len(v) > check["max_items"]
            ok = (not too_many) and recall >= check["min_recall"] - EPS and precision >= check["min_precision"] - EPS
            detail = f"TP={tp}, recall={_fmt(recall)}, precision={_fmt(precision)}"
            if too_many:
                detail += f"; {len(v)} items > max {check['max_items']}"
            return _result(check, ok,
                           f"recall ≥ {_fmt(check['min_recall'])}, precision ≥ {_fmt(check['min_precision'])}",
                           f"recall {_fmt(recall)}, precision {_fmt(precision)}", detail)

        f1 = 0.0 if tp == 0 else 2 * precision * recall / (precision + recall)
        ok = f1 >= check["min_f1"] - EPS
        return _result(check, ok, f"F1 ≥ {_fmt(check['min_f1'])}", f"F1 {_fmt(f1)}",
                       f"TP={tp}, recall={_fmt(recall)}, precision={_fmt(precision)}")

    if kind == "classification":
        if not isinstance(v, dict):
            return _result(check, False, "object", str(type(v).__name__), "not an object")
        assigned: dict[str, str] = {}
        for cls, items in v.items():
            if isinstance(items, list):
                for it in items:
                    assigned[_norm(it)] = str(cls).strip().lower()
        truth = check["truth"]
        correct = sum(1 for item, cls in truth.items() if assigned.get(_norm(item)) == cls)
        acc = correct / len(truth)
        ok = acc >= check["min_accuracy"] - EPS
        wrong = [item for item, cls in truth.items() if assigned.get(_norm(item)) != cls]
        return _result(check, ok, f"accuracy ≥ {_fmt(check['min_accuracy'])}",
                       f"{correct}/{len(truth)} ({_fmt(acc)})",
                       "all correct" if not wrong else f"misclassified {wrong[:10]}")

    raise ValueError(f"unknown check kind {kind}")


def grade(task: dict, answer: Any) -> dict:
    """Grade an answer against a task spec. Never raises on bad answers."""
    if answer is None:
        return {"passed": False, "score": 0.0, "error": "no answer submitted", "error_kind": "no_answer", "checks": []}
    err = validate_schema(answer, task["answer_schema"])
    if err:
        return {"passed": False, "score": 0.0, "error": f"schema: {err}", "error_kind": "schema", "checks": []}
    checks = [_check(c, answer) for c in task["grader"]["checks"]]
    n_pass = sum(c["passed"] for c in checks)
    return {
        "passed": n_pass == len(checks),
        "score": round(n_pass / len(checks), 4),
        "error": None,
        "error_kind": None,
        "checks": checks,
    }
