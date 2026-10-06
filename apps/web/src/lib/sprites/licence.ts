/** Shared types and the licence gate of the sprite lab (design A: only licences that allow derivatives). */

export interface SpriteCandidate {
  title: string;
  pageUrl: string;
  thumbUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
  timestamp: string;
  width: number;
  height: number;
}

/** CC0, public domain, CC BY (any version). CC BY-SA / NC / ND and unknown strings are out. */
export function licenceAllowed(short: string): boolean {
  const s = short.trim().toLowerCase();
  if (!s) return false;
  if (s.startsWith("cc") && /(^|[\s-])(sa|nc|nd)(?=$|[\s-])/.test(s)) return false;
  if (s.startsWith("cc0") || s.startsWith("cc zero")) return true;
  if (s.startsWith("public domain") || s === "pd" || s.startsWith("pd-") || s.startsWith("pdm")) return true;
  return /^cc[- ]by[- ]?\d/.test(s);
}
