import { redirect } from "next/navigation";

/**
 * /rehearsal/personal — the player view with Leva, for tuning. Same page as /exhibition/personal (/v2/mobile), so what
 * is saved here is what the visitor gets.
 */
export default function Page() {
  redirect("/v2/mobile");
}
