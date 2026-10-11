/**
 * Saving Leva settings per top-level group, by hand only: every top-level Leva group gets a row of two buttons,
 * "save" (its current values to localStorage) and "reload" (back to the values last saved, at once). Saved values
 * also replace the group's defaults on the next page load. Nothing is saved on its own. Stored per page (path, so
 * V1 and V2 are apart) and per group.
 */

import { buttonGroup, levaStore } from "leva";

const PREFIX = "parliament.leva";
/** Read once per page load and storage key (the schema is rebuilt every render; Leva only reads it at mount). */
const cache = new Map<string, Record<string, unknown> | null>();

function storageKey(root: string): string {
  const page = typeof window === "undefined" ? "" : window.location.pathname;
  return `${PREFIX}:${page}:${root}`;
}

function load(key: string): Record<string, unknown> | null {
  if (cache.has(key)) return cache.get(key)!;
  let v: Record<string, unknown> | null = null;
  try {
    const raw = window.localStorage.getItem(key);
    v = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    v = null;
  }
  cache.set(key, v);
  return v;
}

type Item = Record<string, unknown>;
const isObj = (x: unknown): x is Item => typeof x === "object" && x !== null && !Array.isArray(x);
const SPECIAL = new Set(["FOLDER", "BUTTON", "BUTTON_GROUP", "MONITOR"]);

/** A saved value fits the default it replaces (same kind; one of the options for a select). */
function fits(saved: unknown, item: unknown): boolean {
  const def = isObj(item) && "value" in item ? item.value : item;
  if (isObj(item) && "options" in item) {
    const o = item.options;
    const vals = Array.isArray(o) ? o : isObj(o) ? Object.values(o) : [];
    return vals.some((v) => v === saved);
  }
  if (Array.isArray(def)) return Array.isArray(saved) && saved.length === def.length && saved.every((x) => typeof x === typeof def[0]);
  return typeof saved === typeof def;
}

/** Walks a schema: the saved values put in, and every input's full Leva path (root.folder.key) collected. */
function inject(schema: Item, prefix: string, saved: Record<string, unknown> | null, paths: Map<string, string>): Item {
  const out: Item = {};
  for (const [key, item] of Object.entries(schema)) {
    if (isObj(item) && typeof item.type === "string" && SPECIAL.has(item.type)) {
      if (item.type === "FOLDER") out[key] = { ...item, schema: inject(item.schema as Item, `${prefix}.${key}`, saved, paths) };
      else out[key] = item;
      continue;
    }
    paths.set(key, `${prefix}.${key}`);
    const s = saved?.[key];
    if (s === undefined || !fits(s, item)) out[key] = item;
    else if (isObj(item) && ("value" in item || "options" in item)) out[key] = { ...item, value: s };
    else out[key] = s;
  }
  return out;
}

/**
 * The schema of a top-level Leva group `root` with its saved values (if any) and a save / reload row.
 * The type is the schema's own, so useControls infers its values as before.
 */
export function savable<S extends object>(root: string, schema: S): S {
  if (typeof window === "undefined") return schema;
  const key = storageKey(root);
  const paths = new Map<string, string>();
  const out = inject(schema as Item, root, load(key), paths);
  out["__save"] = buttonGroup({
    label: null,
    opts: {
      save: (get) => {
        const values: Record<string, unknown> = {};
        for (const [k, path] of paths) {
          try {
            const v = get(path);
            if (v !== undefined && typeof v !== "function") values[k] = v;
          } catch {
            /* an input that is not rendered */
          }
        }
        try {
          window.localStorage.setItem(key, JSON.stringify(values));
          cache.set(key, values);
        } catch {
          /* storage full or blocked */
        }
      },
      reload: () => {
        let saved: Record<string, unknown> | null = null;
        try {
          const raw = window.localStorage.getItem(key);
          saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
        } catch {
          saved = null;
        }
        if (!saved) return;
        for (const [k, path] of paths) {
          if (!(k in saved)) continue;
          try {
            levaStore.setValueAtPath(path, saved[k], true);
          } catch {
            /* an input that is not rendered */
          }
        }
      },
    },
  });
  return out as S;
}
