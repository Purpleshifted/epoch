// The melodies written down: the real glyphs (lib/parliament/glyph.ts) of the column's bots and of further beings.
import { register } from "node:module";
import { writeFileSync } from "node:fs";
register("./ts-hooks.mjs", import.meta.url);
const { glyphOf, individualNo } = await import("../../apps/web/src/lib/parliament/glyph.ts");
const out = [];
for (let i = 0; i < 400; i++) {
  const id = i < 19 ? `bot${i}` : `v${i}`;
  out.push({ id, no: individualNo(id), dots: glyphOf(id).map((d) => [d.col, d.row, d.len]) });
}
writeFileSync(new URL("../data/glyphs.json", import.meta.url), JSON.stringify(out));
console.log(out.length, out.slice(0, 2));

// The sound figures: one being's name, the being it meets, the new word from that contact (the app's own blend).
const { newWordOf } = await import("../../apps/web/src/lib/parliament/glyph.ts");
const dots = (ds) => ds.map((d) => [d.col, d.row, d.len]);
const figure = { a: { no: individualNo("bot7"), dots: dots(glyphOf("bot7")) }, b: { no: individualNo("bot3"), dots: dots(glyphOf("bot3")) }, word: dots(newWordOf("bot7", "bot3", 11)) };
writeFileSync(new URL("../data/figure.json", import.meta.url), JSON.stringify(figure));
console.log(figure.a.no, figure.b.no, figure.word.length);
