/**
 * True for the admin section's own routes (`/admin` and anything under
 * it). Shared by the header (which switches to admin chrome) and the app
 * shell (which mounts the Auth0 session boundary), so the two can never
 * disagree about where the admin section starts.
 */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}
