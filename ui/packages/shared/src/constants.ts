/**
 * The id of the phone menu's container, shared so that each app's header can
 * name it from the hamburger's `aria-controls` without the two sides drifting
 * apart (#502). Both apps render at most one mobile menu, and never at the
 * same time as each other — they are separate builds — so one id is enough.
 */
export const MOBILE_MENU_ID = "mobile-menu";

export const PAGES = [
  { name: "Home", path: "/" },
  { name: "Haiku", path: "/haiku" },
  { name: "Haiga", path: "/haiga" },
  { name: "Other works", path: "/other-works" },
  { name: "Photography", path: "/photography" },
];
