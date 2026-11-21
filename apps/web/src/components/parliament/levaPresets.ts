/**
 * NAMED PRESETS, FOLDER BY FOLDER (the artist, 2026-11-21: "레바 폴더들 총점검해서 각 폴더별로 세이브 하나씩 내가 이름
 * 정해서 프리셋 저장하고 불러올 수 있도록 만들어줘"). Every folder that has a save row has a third button there,
 * `프리셋…`: a small panel beside Leva with the folder's presets — a name and `저장`, and for each one saved
 * `불러오기`, `덮어쓰기`, `지우기`.
 *
 * WHAT A PRESET IS AND IS NOT. It is the folder's values under a name (levaSave readGroup: the folders inside it and
 * the knobs the panel does not list, all of it). LOADING ONE ONLY TURNS THE KNOBS, as if by hand: what the wall opens
 * with is still the folder's one saved set, and stays what it was until the folder's `save` is pressed. So a preset
 * can be tried and thrown away, and the wall's own values are never changed by looking.
 *
 * WHERE THEY ARE KEPT. On the presets server (/api/presets — the production's database), under a page of their own
 * (`/presets<page>`), so a wall never pulls them as a folder's values and every browser sees the same list — the
 * exhibition's machine too. A preview has no database: it lists the production's presets and can load them, and says
 * so when asked to save or delete. The lab shares the wall's page, and so its presets.
 */

import { legacyGroups, levaPage, presetsDefault, readGroup, showNote, writeGroup } from "./levaSave";

const PREFIX = "parliament.leva";
const NAME_MAX = 60;

interface Stored {
  v: 1;
  group: string;
  name: string;
  roots: Record<string, Record<string, unknown>>;
}
interface Row extends Stored {
  key: string;
  updatedAt: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const presetPage = () => `/presets${levaPage()}`;
const keyOf = (group: string, name: string) => `${PREFIX}:${presetPage()}:${group} :: ${name}`;

/** The folder's presets on the server (its own name and the names it had before), newest first; and whether this
 *  deployment can write there (`server`), or reads another's (`from`: a preview reading its production). */
async function list(group: string): Promise<{ rows: Row[]; server: boolean; from: string | null }> {
  const r = await fetch(`/api/presets?page=${encodeURIComponent(presetPage())}`, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  const d = (await r.json()) as { presets?: Record<string, { json: unknown; updatedAt: number }>; server?: boolean; from?: string };
  const names = new Set([group, ...legacyGroups(group)]);
  const rows: Row[] = [];
  for (const [key, p] of Object.entries(d.presets ?? {})) {
    const j = p?.json;
    if (!isObj(j) || typeof j.name !== "string" || typeof j.group !== "string" || !isObj(j.roots) || !names.has(j.group)) continue;
    rows.push({ v: 1, key, group: j.group, name: j.name, roots: j.roots as Stored["roots"], updatedAt: Number(p.updatedAt) || 0 });
  }
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return { rows, server: !!d.server, from: typeof d.from === "string" ? d.from : null };
}

const NOT_HERE = "프리뷰에서는 저장되지 않아요 — 프로덕션 주소에서 해 주세요 (여기서는 불러오기만)";

let panel: HTMLDivElement | null = null;
let openFor = "";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}
const BTN = "font:inherit;color:#d7dbe0;background:#2a2f36;border:1px solid #3d444d;border-radius:3px;padding:2px 7px;cursor:pointer;white-space:nowrap";
const when = (ms: number) => {
  const d = new Date(ms), p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function closePresetPanel(): void {
  panel?.remove();
  panel = null;
  openFor = "";
}

/** Opens (or, for the same folder again, closes) the panel of the folder `group`'s presets. */
export function openPresetPanel(group: string): void {
  if (typeof document === "undefined") return;
  if (panel && openFor === group) {
    closePresetPanel();
    return;
  }
  closePresetPanel();
  openFor = group;
  const root = (panel = el(
    "div",
    "position:fixed;right:480px;top:10px;width:340px;max-width:calc(100vw - 24px);max-height:76vh;overflow:auto;z-index:10000;background:#181c20;color:#c9ced4;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid #3a4048;border-radius:6px;padding:10px 10px 8px;box-shadow:0 6px 24px rgba(0,0,0,.5)",
  ));
  // (keys typed here are the panel's: the view's shortcuts and the orbit do not hear them)
  for (const ev of ["keydown", "keyup", "keypress", "pointerdown", "wheel"] as const) root.addEventListener(ev, (e) => e.stopPropagation());

  const head = el("div", "display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px");
  const title = el("div", "color:#fff;line-height:1.35", `프리셋 — ${group}`);
  const x = el("button", BTN, "닫기");
  x.onclick = closePresetPanel;
  head.append(title, x);
  const about = el("div", "color:#8b939c;line-height:1.4;margin-bottom:8px", "불러오면 이 폴더의 손잡이만 바뀜 (하위 폴더 · 숨은 손잡이 포함). 벽이 뜰 때 쓰는 값으로 삼으려면 그 뒤에 폴더의 save.");
  const status = el("div", "min-height:14px;line-height:1.4;margin:6px 0;color:#9fd3a8;white-space:pre-wrap");
  const listBox = el("div", "display:flex;flex-direction:column;gap:4px;margin-bottom:8px");
  const form = el("div", "display:flex;gap:6px;align-items:center;border-top:1px solid #2c3138;padding-top:8px");
  const input = el("input", "flex:1;min-width:0;font:inherit;color:#fff;background:#0f1215;border:1px solid #3d444d;border-radius:3px;padding:3px 6px");
  input.placeholder = "새 프리셋 이름";
  input.maxLength = NAME_MAX;
  const saveBtn = el("button", BTN, "저장");
  form.append(input, saveBtn);
  root.append(head, about, listBox, status, form);
  document.body.appendChild(root);

  let rows: Row[] = [];
  let canWrite = true;
  const say = (text: string, ok = true) => {
    status.textContent = text;
    status.style.color = ok ? "#9fd3a8" : "#e8a39a";
  };

  const draw = () => {
    listBox.replaceChildren();
    if (!rows.length) listBox.append(el("div", "color:#8b939c", "저장된 프리셋이 아직 없음"));
    for (const row of rows) {
      const line = el("div", "display:flex;align-items:center;gap:5px");
      const name = el("div", "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff", row.name);
      name.title = row.group === group ? row.name : `${row.name} (옛 폴더 이름: ${row.group})`;
      const at = el("div", "color:#7c848d;white-space:nowrap", when(row.updatedAt));
      const load = el("button", BTN, "불러오기");
      load.onclick = () => {
        const res = writeGroup(group, row.roots);
        const skipped = [...res.misfit, ...res.gone];
        const text = `'${row.name}' 불러옴 · 손잡이 ${res.applied}개` + (skipped.length ? `\n건너뜀 ${skipped.length}개 (지금 폴더에 없거나 값이 안 맞음): ${skipped.slice(0, 12).join(", ")}${skipped.length > 12 ? " …" : ""}` : "") + "\n아직 저장된 것은 아님 — 벽의 값으로 삼으려면 폴더의 save";
        say(text, !skipped.length);
        showNote(`프리셋 '${row.name}' 불러옴 (${res.applied}개${skipped.length ? ` · 건너뜀 ${skipped.length}` : ""}) · save 전에는 이 탭만`, true);
      };
      const over = el("button", BTN, "덮어쓰기");
      over.onclick = () => void put(row.name, true);
      const del = el("button", BTN, "지우기");
      del.onclick = () => void remove(row);
      line.append(name, at, load, over, del);
      listBox.append(line);
    }
  };

  const refresh = async () => {
    try {
      const l = await list(group);
      if (panel !== root) return;
      rows = l.rows;
      canWrite = l.server && !presetsDefault();
      about.textContent =
        (l.server ? "" : l.from ? `이 주소는 프리뷰: 프로덕션(${l.from})의 프리셋을 읽기만 함 — 저장 · 지우기는 프로덕션에서.\n` : "이 주소에는 프리셋 서버가 없음 — 저장되지 않음.\n") +
        "불러오면 이 폴더의 손잡이만 바뀜 (하위 폴더 · 숨은 손잡이 포함). 벽이 뜰 때 쓰는 값으로 삼으려면 그 뒤에 폴더의 save.";
      about.style.whiteSpace = "pre-wrap";
      draw();
    } catch {
      if (panel === root) say("프리셋 목록을 읽지 못함 (서버에 닿지 않음)", false);
    }
  };

  /** Saves the folder as it stands under `name`; an existing name is asked about first (`sure`: already asked). */
  const put = async (raw: string, existing = false) => {
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) return say("이름을 적어 주세요", false);
    if (!canWrite) return say(presetsDefault() ? "기본값 모드 (?presets=default): 저장하지 않음" : NOT_HERE, false);
    const key = keyOf(group, name);
    if (key.length > 300) return say("이름이 너무 김", false);
    const was = rows.find((r) => r.name === name);
    if (was || existing) {
      if (!window.confirm(`'${name}' 프리셋이 이미 있습니다. 지금 이 폴더의 값으로 덮어쓸까요?`)) return;
    }
    const json: Stored = { v: 1, group, name, roots: readGroup(group) };
    try {
      // (a preset saved under the folder's old name is replaced where it is: one name, one preset)
      const r = await fetch("/api/presets", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: was?.key ?? key, json }) });
      if (r.status === 503) return say(NOT_HERE, false);
      if (!r.ok) throw new Error(String(r.status));
      const n = Object.values(json.roots).reduce((a, v) => a + Object.keys(v).length, 0);
      say(`'${name}' 저장됨 · 손잡이 ${n}개 (다른 브라우저에서도 보임)`);
      input.value = "";
      await refresh();
    } catch {
      say("저장 실패 (서버에 닿지 않음)", false);
    }
  };

  const remove = async (row: Row) => {
    if (!canWrite) return say(presetsDefault() ? "기본값 모드 (?presets=default): 지우지 않음" : NOT_HERE, false);
    if (!window.confirm(`'${row.name}' 프리셋을 지울까요? 되돌릴 수 없습니다. (폴더에 저장된 값과 지금 손잡이는 그대로)`)) return;
    try {
      const r = await fetch(`/api/presets?key=${encodeURIComponent(row.key)}`, { method: "DELETE" });
      if (r.status === 503) return say(NOT_HERE, false);
      if (!r.ok) throw new Error(String(r.status));
      say(`'${row.name}' 지움`);
      await refresh();
    } catch {
      say("지우기 실패 (서버에 닿지 않음)", false);
    }
  };

  saveBtn.onclick = () => void put(input.value);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void put(input.value);
    if (e.key === "Escape") closePresetPanel();
  });
  listBox.append(el("div", "color:#8b939c", "목록 읽는 중…"));
  void refresh();
}
