import { redirect } from "next/navigation";

/**
 * /rehearsal/global — the wall with Leva, for tuning. Same page as /exhibition/global (/v2/global/space), so what is
 * saved here is what the exhibition loads.
 */
export default function Page() {
  redirect("/v2/global/space");
}
