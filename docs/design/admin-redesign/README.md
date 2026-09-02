# Admin redesign — authoritative design reference

The visual design for the admin's shadcn/Tailwind migration (#592 and the
per-page issues #233–#238, #472, #240). The PNGs in this directory are the
design: one board per screen per width, rendered from the maintainer's
design canvas (2026-09-02). Where a PR's result and these boards disagree,
follow the boards unless the design brief's behavioral principles
(`docs/ui-design-brief.md`) say otherwise; copy IN the boards is sample
content, not final copy — keep the real pages' wording where it already
follows the brief.

## Theme (see Theme.png)

Tailwind v4 + shadcn/ui tokens. Geist for the interface, Newsreader
(italic) for greetings, page titles and item titles. Fonts via Google
Fonts with `system-ui` / `Georgia` fallbacks.

| Name   | Hex       | shadcn variable(s)          |
| ------ | --------- | --------------------------- |
| Paper  | `#FAF7F2` | `--background`              |
| Cream  | `#F4EFE6` | `--muted`, `--sidebar`      |
| Sand   | `#E9E0CF` | `--border`                  |
| Ink    | `#2A2723` | `--foreground`              |
| Stone  | `#6F6759` | `--muted-foreground`        |
| Fir    | `#2E5A44` | `--primary`                 |
| Maroon | `#7A3B3F` | `--accent`, `--destructive` |

Supporting values used throughout the boards: field border `#DCD2BE` on
`#FFFEFB`; card border `#EAE2D2` on white, radius 16px, warm shadow
(`rgba(74,62,40,…)`); buttons radius 10px; active-nav pill
`rgba(46,90,68,0.11)` with Fir text; "Published" badge `#E3EAE2`/Fir;
"Draft" badge Cream outline/Stone. Green leads; maroon supports (links
out, the brush swash, destructive actions).

## Shell, by width

- **Desktop (1440)**: 280px cream sidebar — Newsreader wordmark,
  "YOUR WORKSHOP" label, the seven sections with stroke icons, then
  (bottom) a maroon "See your site" link and the avatar + sign out.
- **Tablet (768)**: the sidebar collapses to a 72px icon rail
  (`*Tablet.png`).
- **Mobile (390)**: a 56px top bar with wordmark + hamburger; the menu
  (`MobileMenu.png`) merges the workshop sections with the public site's
  pages — today's hamburger lists only the public pages.

Every screen keeps one filled-green primary action (Add / Save /
Preview cleanup); Delete is outlined maroon, filled maroon only for the
cleanup page's confirmed-destructive "Delete N unused images". Saves are
acknowledged with the toast card shown bottom-right on several boards.
Page titles are Newsreader italic with the low-opacity maroon brush
swash behind them.

## Boards

| Section       | Boards |
| ------------- | ------ |
| Home          | `Main` (desktop), `HomeTablet`, `Mobile` |
| Haiku         | `HaikuList`, `HaikuTablet`, `HaikuListMobile`, `HaikuEditor`, `HaikuEditorMobile` |
| Haiga         | `HaigaList`, `HaigaTablet`, `HaigaListMobile`, `HaigaEditor`, `HaigaEditorMobile` |
| Photography   | `PhotoList`, `PhotoTablet`, `PhotoListMobile`, `PhotoEditor`, `PhotoEditorMobile` |
| Other works   | `WorksList`, `WorksTablet`, `WorksListMobile`, `WorksEditor`, `WorksEditorMobile` |
| Background    | `Background`, `BackgroundTablet`, `BackgroundMobile` |
| Image cleanup | `Cleanup`, `CleanupTablet`, `CleanupMobile` |
| Nav           | `MobileMenu` (open state) |
| Tokens        | `Theme` |

Notable deliberate decisions, beyond restyling:

- The horizontal admin menu becomes the sidebar/rail/hamburger shell
  above, and the admin drops the public site's background photo and
  header-colour settings entirely — it has its own fixed look (settles
  the direction of #642).
- List rows keep Edit / move arrows / outlined Delete with labels, per
  #457; search + one primary "Add …" button live in the list card's
  header row.
- The other-works "Published" checkbox becomes a green switch with the
  hint "— visitors can read this".
- Image tiles in the boards are drawn placeholders; real thumbnails
  render there.

## Provenance

Drafted on the maintainer's Claude design canvas ("Admin Home Redesign",
claude.ai/code/artifact/1377e78d-7ac8-4026-9021-70058e409b05 — only
reachable from the maintainer's account, hence these exports). Ask the
maintainer to re-export from the canvas rather than editing the PNGs.
