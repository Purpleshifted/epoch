// Builds a test column's events outside the browser: node column.mjs <minutes> <bots> <groups> <spread> <timeSpread> > events.json
import { register } from "node:module";
register("./ts-hooks.mjs", import.meta.url);
globalThis.window ??= undefined;
const { buildTestColumn } = await import("../../apps/web/src/lib/parliament/testColumn.ts");
const [min, bots, groups, spread, ts] = process.argv.slice(2).map(Number);
const ev = buildTestColumn({ seconds: min * 60, bots, flock: { groups, spread, timeSpread: ts } });
process.stdout.write(JSON.stringify({ events: ev, end: ev.length ? ev[ev.length - 1].s : 0, owners: new Set(ev.map((e) => e.o)).size }));
