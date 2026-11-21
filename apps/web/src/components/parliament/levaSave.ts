/**
 * Saving Leva settings per top-level group, by hand only: every top-level Leva group gets a row of two buttons,
 * "save" (its current values to localStorage) and "reload" (back to the values last saved, at once). Saved values
 * also replace the group's defaults on the next page load. Nothing is saved on its own. Stored per page (path, so
 * V1 and V2 are apart) and per group.
 */

import { buttonGroup, levaStore } from "leva";
import exhibitionPreset from "@/presets/exhibition.json";
import { holdThenLate } from "@/lib/presets/holdThenLate";

const PREFIX = "parliament.leva";

/**
 * MEASUREMENT SWITCH (2026-11-01, the reset): `?presets=default` makes this tab use the code's defaults alone — the
 * server's and this browser's saved values are ignored and nothing is saved or pulled. The readout names the source
 * of the values in use (presetSource).
 */
export function presetsDefault(): boolean {
  try {
    return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("presets") === "default";
  } catch {
    return false;
  }
}

let serverPresetAt = 0;
let serverPresetSeen = false;

/** Where this tab's Leva values come from: "default" (the switch), "server HH:MM" (the newest server save), or "local". */
export function presetSource(): string {
  if (presetsDefault()) return "default";
  if (serverPresetSeen && serverPresetAt > 0) {
    const d = new Date(serverPresetAt);
    return `server ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return "local";
}

/**
 * THE BUNDLED EXHIBITION PRESET (the artist, 2026-10-30): the Leva values tuned on the Vercel preview, carried in the
 * code so the exhibition machine starts from them without a server — a page's group whose storage key
 * (`parliament.leva:<path>:<group>`) has nothing saved in localStorage takes the preset's object under the same key.
 * Anything saved on the machine wins (the rehearsal wall can still overwrite). Filled from a JSON the artist exports
 * on /rehearsal/management (exportSettings) and pastes to the sessions; empty = plain defaults.
 */
const PRESET: Record<string, Record<string, unknown>> = exhibitionPreset as Record<string, Record<string, unknown>>;
/** Read once per page load and storage key (the schema is rebuilt every render; Leva only reads it at mount). */
const cache = new Map<string, Record<string, unknown> | null>();

/**
 * DEV ONLY — ANOTHER TAB'S VALUES, TAKEN OVER (2026-11-17: a session's dev server is another origin, so the artist's
 * values saved on :3020 are not there, and a look was judged on the defaults). `?leva=<tag>` reads the values that tab
 * posted (app/api/dev-leva, `.leva-live/<tag>.json` of this server) and saves them here as the page's groups, once per
 * tab, before Leva reads anything. Never in a production build (the route answers 404 there and this does not run).
 */
function takeOverLiveValues(): void {
  if (typeof window === "undefined" || process.env.NODE_ENV !== "development") return;
  try {
    const tag = new URLSearchParams(window.location.search).get("leva");
    if (!tag || !/^[a-zA-Z0-9_-]{1,24}$/.test(tag)) return;
    const done = `${PREFIX}:took:${tag}:${window.location.pathname}`;
    if (window.sessionStorage.getItem(done)) return;
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `/api/dev-leva?tag=${tag}`, false); // (sync: before the first group is read)
    xhr.send();
    if (xhr.status !== 200) return;
    const values = (JSON.parse(xhr.responseText) as { values?: Record<string, unknown> }).values ?? {};
    const groups: Record<string, Record<string, unknown>> = {};
    for (const [path, v] of Object.entries(values)) {
      const parts = path.split(".");
      (groups[parts[0]] ??= {})[parts[parts.length - 1]] = v;
    }
    for (const [group, v] of Object.entries(groups)) {
      const key = `${PREFIX}:${window.location.pathname}:${group}`;
      window.localStorage.setItem(key, JSON.stringify(v));
      window.localStorage.setItem(`${key}:savedAt`, String(Date.now()));
    }
    window.sessionStorage.setItem(done, "1");
  } catch {
    /* no such tab, or storage unavailable: the values as they are */
  }
}
takeOverLiveValues();

/** A page whose saved values another page shares (the lab tunes the shared global view's): set before Leva mounts. */
let pageOverride: string | null = null;
export function setLevaPage(path: string | null): void {
  pageOverride = path;
}

/** The page whose saved values this tab reads and writes (its own path, or the page it shares them with). */
export function levaPage(): string {
  return pageOverride ?? (typeof window === "undefined" ? "" : window.location.pathname);
}

function storageKey(root: string): string {
  return `${PREFIX}:${levaPage()}:${root}`;
}

/** Saved values of `root`, or (none saved under it yet) those of groups it was renamed from, merged. */
function loadWithLegacy(root: string, legacy: readonly string[]): Record<string, unknown> | null {
  const own = load(storageKey(root));
  if (own || !legacy.length) return own;
  let merged: Record<string, unknown> | null = null;
  for (const old of legacy) {
    const v = load(storageKey(old));
    if (v) merged = { ...v, ...(merged ?? {}) };
  }
  return merged;
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
  // nothing saved here: the bundled exhibition preset, if it has this page's group
  if (!v && isObj(PRESET[key])) v = { ...PRESET[key] };
  cache.set(key, v);
  return v;
}

/**
 * Every saved Leva group on this machine (all pages), the bundled preset underneath, as one JSON object keyed by
 * storage key — what the artist copies from the machine where the values were tuned.
 */
export function exportSettings(): string {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(PRESET)) if (isObj(v)) out[k] = v;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(`${PREFIX}:`) || k.includes(":migrated:")) continue;
      const raw = window.localStorage.getItem(k);
      if (!raw) continue;
      try {
        const v = JSON.parse(raw) as unknown;
        if (isObj(v)) out[k] = v;
      } catch {
        /* not a group */
      }
    }
  } catch {
    /* storage unavailable */
  }
  return JSON.stringify(out, null, 2);
}

/**
 * The reverse: a JSON from exportSettings pasted on another machine — every `parliament.leva:…` group in it is saved
 * here (replacing what was saved under that key). Returns how many groups were written; throws on bad JSON. Pages
 * read saved values at load, so reload them afterwards.
 */
export function importSettings(json: string): number {
  const data = JSON.parse(json) as unknown;
  if (!isObj(data)) throw new Error("not an object");
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (!k.startsWith(`${PREFIX}:`) || !isObj(v)) continue;
    window.localStorage.setItem(k, JSON.stringify(v));
    // an import is a SAVE: dated now and sent to this site's server — otherwise the next page load pulled the server's
    // older save over it (the server's date was newer than an undated browser copy) and the import was lost
    window.localStorage.setItem(`${k}:savedAt`, String(Date.now()));
    cache.delete(k);
    void pushPreset(k, v);
    n++;
  }
  return n;
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
function inject(schema: Item, prefix: string, saved: Record<string, unknown> | null, paths: Map<string, string>, items?: Map<string, unknown>): Item {
  const out: Item = {};
  for (const [key, item] of Object.entries(schema)) {
    if (isObj(item) && typeof item.type === "string" && SPECIAL.has(item.type)) {
      if (item.type === "FOLDER") out[key] = { ...item, schema: inject(item.schema as Item, `${prefix}.${key}`, saved, paths, items) };
      else out[key] = item;
      continue;
    }
    paths.set(key, `${prefix}.${key}`);
    items?.set(key, item);
    const s = saved?.[key];
    if (s === undefined || !fits(s, item)) out[key] = item;
    else if (isObj(item) && ("value" in item || "options" in item)) out[key] = { ...item, value: s };
    else out[key] = s;
  }
  return out;
}

/** A one-time change to a group's SAVED values (on this page): `set` replaces those keys, once per `tag`. */
export interface SavedMigration {
  tag: string;
  set: Record<string, unknown>;
}

/** The end of the day a migration was written, from the date its tag ends with ("…-2026-11-15"); null = no date. */
function migrationDay(tag: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})$/.exec(tag);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1).getTime() : null;
}

/**
 * Applies a migration to the values saved under `key` (if any), once: a marker remembers it was done.
 *
 * A MIGRATION IS FOR WHAT WAS SAVED BEFORE IT (the save audit, 2026-11-20). The marker is this browser's, so a browser
 * that had never opened the page — every new preview address, the exhibition's machine — ran every migration ever
 * written over the values it had just taken from the server: the fusion's 11/15 set replaced 23 knobs the artist had
 * saved on 11/20 (rib cell 2.4 → 5, pipe 0.85 → 0.45, scatter 1.6 → 0 …), and a look was judged there on values nobody
 * had saved. A save dated after the migration's day already carries it, or has been tuned past it: it is left alone.
 */
function migrateSaved(key: string, m: SavedMigration): void {
  const marker = `${key}:migrated:${m.tag}`;
  try {
    if (window.localStorage.getItem(marker) !== null) return;
    window.localStorage.setItem(marker, String(Date.now()));
    const day = migrationDay(m.tag);
    if (day !== null && Number(window.localStorage.getItem(`${key}:savedAt`) ?? 0) > day) return;
    const raw = window.localStorage.getItem(key);
    if (!raw) return; // nothing saved: the defaults apply anyway
    const v = { ...(JSON.parse(raw) as Record<string, unknown>), ...m.set };
    window.localStorage.setItem(key, JSON.stringify(v));
    cache.delete(key);
  } catch {
    /* storage unavailable */
  }
}

/**
 * The schema of a top-level Leva group `root` (or a folder path "group.folder" with its own row) with its saved values
 * (if any) and a save / reload row. `legacy`: the names the group had before (their saved values are taken as long as
 * nothing is saved under the new name). The type is the schema's own, so useControls infers its values as before.
 */
/**
 * ONE SAVE FOR A WHOLE FOLDER (the artist, 2026-11-15: "'길' 레바 폴더 다 저장로직이랑 이어졌는지도 확인해"). A folder
 * inside a group may keep its own values under its own key (savable("group.folder", …): the paths' trodden ground
 * inside 길) — it has its own save row, and the group's row did not reach it: pressing 길's save left 밟힘 unsaved.
 * Every savable registers its save and reload by root; a save row runs those of its whole group (the artist, later
 * the same day: "길 폴더 레바 뒤에서 세 개 값은 계속 저장이 안 돼" — whichever of the two rows is pressed).
 */
const savers = new Map<string, (get: (path: string) => unknown) => void>();
const reloaders = new Map<string, () => void>();
/** …and how a set of values brought in from elsewhere is put on a root's knobs (applyValues): how many it took. */
const appliers = new Map<string, (values: Record<string, unknown>) => number>();
/** Every registered root of the group `root` belongs to (the group itself and the folders inside it that keep their
 *  own values): any save row of a group saves the whole group — 길's own row and the one inside 길 › 밟힘 alike. */
const groupOf = (root: string) => {
  const top = root.split(".")[0];
  return [...savers.keys()].filter((r) => r === top || r.startsWith(`${top}.`));
};

// ── A FOLDER'S VALUES AS A NAMED PRESET (levaPresets.ts; the artist, 2026-11-21: "각 폴더별로 세이브 하나씩 내가 이름
// 정해서 프리셋 저장하고 불러올 수 있도록"). A preset is everything a folder holds — the folders inside it, and the
// knobs the panel does not list (LEVA_FOCUS, `render:`) — read from the knobs as they stand and put back on them as if
// turned by hand: nothing is saved by loading one (the folder's `save` makes it what the wall opens with). ──
/** A root's knobs as they stand, by key; and a set of values put on them — which keys it took, which did not fit. */
const presetReaders = new Map<string, () => Record<string, unknown>>();
const presetWriters = new Map<string, (values: Record<string, unknown>) => { took: string[]; misfit: string[] }>();
/** The names a root had before (savable's `legacy`): a preset saved under one of them is still its folder's. */
const legacyNames = new Map<string, readonly string[]>();
/** Knobs that are not a folder's look but switches of the panel itself: never in a preset (the fusion's own chooser
 *  of a set would put that set over the preset just loaded; the "list everything" checkbox is the panel's). */
const NOT_IN_PRESETS = new Set(["fusePreset", "allKnobs"]);

/** The folder `top` as a preset holds it: every root of the group (the folder and the folders in it that keep their
 *  own values) → its knobs' values by key. */
export function readGroup(top: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of groupOf(top)) {
    const v = presetReaders.get(r)?.();
    if (v) out[r] = v;
  }
  return out;
}

/**
 * A preset's values put on the folder's knobs. A PRESET OUTLIVES THE FOLDER IT WAS SAVED FROM: a root is found by its
 * name or a name it had before, and a knob by its key wherever in the group it sits now (a knob moved to another
 * folder of the group is still found). What cannot be put is skipped and named: a key no knob has any more (`gone`),
 * a value its knob no longer takes — another kind, an option that is not offered (`misfit`, by the knob's label).
 */
export function writeGroup(top: string, roots: Record<string, Record<string, unknown>>): { applied: number; gone: string[]; misfit: string[] } {
  const flat: Record<string, unknown> = {};
  for (const v of Object.values(roots)) if (isObj(v)) Object.assign(flat, v);
  const took = new Set<string>();
  const misfit: string[] = [];
  let applied = 0;
  for (const r of groupOf(top)) {
    const write = presetWriters.get(r);
    if (!write) continue;
    const was = [r, ...(legacyNames.get(r) ?? [])].find((n) => isObj(roots[n]));
    const res = write({ ...flat, ...(was ? roots[was] : {}) });
    for (const k of res.took) took.add(k);
    misfit.push(...res.misfit);
    applied += res.took.length - res.misfit.length;
  }
  const gone = Object.keys(flat).filter((k) => !took.has(k) && !NOT_IN_PRESETS.has(k));
  return { applied, gone, misfit };
}

/** The names the folder `top` had before: its presets saved under them are listed with its own. */
export function legacyGroups(top: string): readonly string[] {
  return legacyNames.get(top) ?? [];
}

export function savable<S extends object>(root: string, schema: S, legacy: readonly string[] = [], migrations: readonly SavedMigration[] = []): S {
  if (typeof window === "undefined") return schema;
  const key = storageKey(root);
  const defaultsOnly = presetsDefault();
  if (!defaultsOnly) for (const m of migrations) migrateSaved(key, m);
  const paths = new Map<string, string>();
  const items = new Map<string, unknown>();
  const out = inject(schema as Item, root, defaultsOnly ? null : loadWithLegacy(root, legacy), paths, items);
  legacyNames.set(root, legacy);
  presetReaders.set(root, () => {
    // (read from the store's data, not `get`: that warns for a path that is not there)
    const data = levaStore.getData() as Record<string, { value?: unknown } | undefined>;
    const values: Record<string, unknown> = {};
    for (const [k, path] of paths) {
      const v = data[path]?.value;
      if (v !== undefined && typeof v !== "function" && !NOT_IN_PRESETS.has(k)) values[k] = v;
    }
    return values;
  });
  presetWriters.set(root, (values) => {
    const took: string[] = [], misfit: string[] = [];
    const data = levaStore.getData() as Record<string, unknown>;
    for (const [k, path] of paths) {
      if (!(k in values) || NOT_IN_PRESETS.has(k)) continue;
      took.push(k);
      const item = items.get(k);
      const label = isObj(item) && typeof item.label === "string" ? item.label.split(" (")[0] : k;
      if (!fits(values[k], item) || !data[path]) {
        misfit.push(label);
        continue;
      }
      try {
        levaStore.setValueAtPath(path, values[k], true);
      } catch {
        misfit.push(label);
      }
    }
    return { took, misfit };
  });
  savers.set(root, (get) => {
        if (defaultsOnly) {
          showNote("기본값 모드 (?presets=default): 저장하지 않음", false);
          return;
        }
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
          window.localStorage.setItem(`${key}:savedAt`, String(Date.now()));
          cache.set(key, values);
        } catch {
          /* storage full or blocked */
        }
        void pushPreset(key, values);
  });
  reloaders.set(root, () => {
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
  });
  appliers.set(root, (values) => {
        let n = 0;
        for (const [k, path] of paths) {
          if (!(k in values)) continue;
          try {
            levaStore.setValueAtPath(path, values[k], true);
            n++;
          } catch {
            /* an input that is not rendered */
          }
        }
        return n;
  });
  out["__save"] = buttonGroup({
    label: null,
    opts: {
      save: (get) => {
        for (const r of groupOf(root)) savers.get(r)?.(get);
      },
      reload: () => {
        for (const r of groupOf(root)) reloaders.get(r)?.();
      },
      // (the folder's named presets: a small panel beside this one — levaPresets.ts)
      "프리셋…": () => {
        void import("./levaPresets").then((m) => m.openPresetPanel(root.split(".")[0]));
      },
    },
  });
  return out as S;
}

/**
 * A SET OF VALUES PUT ON A GROUP'S KNOBS (the artist, 2026-11-20: "프리셋 선택할 수 있게 레바 추가하고 거기 전시 버전
 * 넣어줘"): every knob of the group `top` (and of the folders in it that keep their own values) whose key is in
 * `values` takes that value, in this tab — as if moved by hand: nothing is saved until the group's save is pressed.
 * Knobs the set does not name stay as they are. Returns how many knobs it set.
 */
export function applyValues(top: string, values: Record<string, unknown>): number {
  let n = 0;
  for (const r of groupOf(top)) n += appliers.get(r)?.(values) ?? 0;
  return n;
}
/** …and back to what is saved for the group (its reload row). */
export function reloadSaved(top: string): void {
  for (const r of groupOf(top)) reloaders.get(r)?.();
}

// ── THE SERVER (the artist, 2026-10-30): "save in Leva should send the value to the DB, and the exhibition should use
// the latest save". Every save also goes to /api/presets (same deployment, Neon Postgres — lib/presets/db.ts), and
// a page asks the server once before its Leva mounts (ServerPresetsGate): a group the server saved later than this
// browser did replaces the browser's copy. Order: server's latest > this browser's save > bundled preset > defaults.
// No server (no DATABASE_URL, offline): nothing changes, the fetch fails at once. A slow server: the page waits
// PRESET_HOLD_MS and goes on; the request keeps running up to PRESET_LATE_MS, and what arrives is kept (onLate). ──

/** A page waits this long. A cold function took 2.15 s on production (11/01), past the old 1.2 s limit. */
const PRESET_HOLD_MS = 4000;
/** The request itself gives up here. */
const PRESET_LATE_MS = 30000;

/** A line the artist sees after a save: "서버 저장됨" / "서버 저장 실패" — a small overlay, gone after a moment. */
export function showNote(text: string, ok: boolean): void {
  try {
    const id = "leva-save-note";
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9999;font:10px ui-monospace,monospace;padding:4px 8px;border-radius:3px;pointer-events:none;transition:opacity .4s";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.background = ok ? "rgba(40,120,60,.85)" : "rgba(140,50,40,.85)";
    el.style.color = "#fff";
    el.style.opacity = "1";
    const mine = Symbol();
    (el as unknown as { tag: symbol }).tag = mine;
    setTimeout(() => {
      if ((el as unknown as { tag: symbol }).tag === mine) el!.style.opacity = "0";
    }, 2500);
  } catch {
    /* no document */
  }
}

/** One saved group to the server; the note says whether it got there. */
export async function pushPreset(key: string, values: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch("/api/presets", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, json: values }) });
    if (r.status === 503) {
      showNote("저장됨 (이 브라우저만 · 서버 없음)", true);
      return false;
    }
    if (!r.ok) throw new Error(String(r.status));
    const { preset } = (await r.json()) as { preset: { updatedAt: number } };
    try {
      window.localStorage.setItem(`${key}:savedAt`, String(preset.updatedAt));
    } catch {
      /* fine */
    }
    showNote("저장됨 · 서버에도 (전시가 이 값을 씀)", true);
    return true;
  } catch {
    showNote("저장됨 (이 브라우저만) · 서버 저장 실패", false);
    return false;
  }
}

/**
 * The server's groups for `page`, written into this browser where the server's save is newer than the browser's
 * (a browser copy without a date counts as older). Resolves with the keys that changed; [] when the server has
 * nothing newer, could not be reached, or took longer than PRESET_HOLD_MS. Call before Leva mounts. A slow answer is
 * still written when it arrives (the next load starts from it) and `onLate` gets its changed keys, because Leva has
 * mounted by then and this page shows the old values until it reloads.
 */
export function pullPresets(page: string, onLate?: (changed: string[]) => void): Promise<string[]> {
  if (typeof window === "undefined" || presetsDefault()) return Promise.resolve([]);
  return holdThenLate(fetchPresets(page), PRESET_HOLD_MS, [], onLate);
}

async function fetchPresets(page: string): Promise<string[]> {
  const changed: string[] = [];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PRESET_LATE_MS);
  try {
    const r = await fetch(`/api/presets?page=${encodeURIComponent(page)}`, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) return changed;
    const { presets } = (await r.json()) as { presets: Record<string, { json: Record<string, unknown>; updatedAt: number }> };
    for (const [key, p] of Object.entries(presets ?? {})) {
      if (!key.startsWith(`${PREFIX}:`) || !isObj(p?.json)) continue;
      serverPresetSeen = true;
      if (p.updatedAt > serverPresetAt) serverPresetAt = p.updatedAt;
      const localAt = Number(window.localStorage.getItem(`${key}:savedAt`) ?? 0);
      if (!(p.updatedAt > localAt)) continue;
      const before = window.localStorage.getItem(key);
      const after = JSON.stringify(p.json);
      window.localStorage.setItem(key, after);
      window.localStorage.setItem(`${key}:savedAt`, String(p.updatedAt));
      cache.delete(key);
      if (before !== after) changed.push(key);
    }
  } catch {
    /* offline, slow, or no server: this browser's values stand */
  } finally {
    clearTimeout(timer);
  }
  return changed;
}
