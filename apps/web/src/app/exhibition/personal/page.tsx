import { redirect } from "next/navigation";

/**
 * /exhibition/personal — the visitor's screen: the player view with no panel, in Korean. It lands on /v2/mobile, so the
 * Leva values saved while rehearsing there (levaSave.ts keys them by that path) are the ones the visitor gets.
 */
export default function Page() {
  redirect("/v2/mobile?ui=0&lang=ko");
}
