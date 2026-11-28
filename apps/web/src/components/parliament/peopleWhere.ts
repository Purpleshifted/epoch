/**
 * peopleWhere — WHERE SOMEONE OF THE STREET IS DRAWN NOW, and whether the street is the white paper. PointPeople
 * registers it (its own people and the frames' pins); marks that go off at a person read it — my answer's burst at the
 * one I answered (RoleField; the artist, 2026-11-28: "응답했을 때 비주얼 효과 팡 터지던 거 … 내 화답을 받은 상대 근처에서
 * 터지도록"). Null when nobody registered or that person is not in the street now.
 */

type Where = (id: string) => { x: number; z: number } | null;

let where: Where | null = null;
let paper = false;

/** PointPeople: how to find a person, and whether its ground is the white paper (null on unmount). */
export function setPeopleWhere(fn: Where | null, isPaper = false): void {
  where = fn;
  paper = fn ? isPaper : false;
}

/** Where `id` is drawn now (scene units), or null. */
export function personWhere(id: string | null | undefined): { x: number; z: number } | null {
  if (!id || !where) return null;
  return where(id);
}

/** The street is drawn on the white paper (ink, not light). */
export function peoplePaper(): boolean {
  return paper;
}
