import type { LucideIcon } from "lucide-react";

/**
 * One section of the admin, as the shell needs to render it. The list
 * itself lives in admin.tsx, which is also where the routes are declared —
 * one place decides what the sections are, in what order, and what each is
 * called.
 */
export interface AdminPage {
  /** The URL segment under /admin, and the key the menu renders by. */
  id: string;
  label: string;
  /**
   * The stroke icon beside the label. Every section has one: the sidebar
   * collapses to an icon-only rail at tablet width, where the glyph is the
   * only thing on screen distinguishing one section from another.
   */
  icon: LucideIcon;
}
