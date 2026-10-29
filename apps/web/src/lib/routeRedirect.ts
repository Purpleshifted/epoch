import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Redirects a short address (/exhibition/…, /rehearsal/…) to the page it stands for, keeping any extra query the
 * address was opened with (e.g. ?sound=0 when a Claude session checks the wall); the target's own parameters win.
 */
export async function redirectKeepingQuery(target: string, searchParams: SearchParams): Promise<never> {
  const [path, own = ""] = target.split("?");
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, one);
  }
  for (const [k, v] of new URLSearchParams(own)) q.set(k, v);
  const s = q.toString();
  redirect(s ? `${path}?${s}` : path);
}
