# Admin UI design brief

How the admin section (`/admin`) should look and feel, and how to judge
whether a change gets it right. Read this before any change that touches
what the admin UI shows: components, CSS, copy, empty/error/success
states, dialogs, navigation. CLAUDE.md's Visual Checks ask "does it look
right"; this brief asks "does it feel right".

## Who it is for

One person: the site's author, Kari. She is not a developer and never
will be, and she uses the admin for everything — publishing haiku and
haiga, uploading photographs, editing the home page and backgrounds. The
intent is that she eventually controls the public site *completely*
from here, so the admin is not a maintenance hatch; it is her workshop.

The feeling to aim for: **she is being taken care of.** The interface
anticipates what she needs, explains itself in her words, tells her
when things went well, and, when something goes wrong, tells her what
happened and what to do next. She should never feel scolded, lost, or
afraid of breaking something.

## Principles

1. **Calm and warm over slick.** Generous spacing, readable type,
   soft contrast, nothing that flashes or demands. Polish means
   quiet confidence, not visual flourish. No dense dashboards.
2. **One obvious next action per screen.** A list has one primary
   button (add). An editor has one primary button (save/publish).
   Secondary actions are visibly secondary; destructive actions are
   visibly destructive and never the closest thing to the primary.
3. **Speak plainly, in her words.** Labels and messages use the
   site's vocabulary ("haiku", "photograph", "home page"), not the
   code's ("item", "entity", "manifest", "S3"). No status codes, no
   stack traces, no "Error:" prefixes, no exclamation marks.
4. **Acknowledge success.** Saving, publishing, uploading and deleting
   each get a brief, visible confirmation ("Saved", "Published",
   "Photograph uploaded"). Silence after an action reads as failure.
5. **Errors say what happened and what to do next.** "Couldn't save the
   haiku — the site may be offline. Your changes are still here; try
   again in a moment." Keep her work; never discard an edit because a
   request failed. If there is nothing she can do, say so and who to
   tell.
6. **Confirmations name the thing.** "Delete the haiku 'Autumn rain'?"
   rather than "Are you sure?". The confirm dialog keeps its **Yes** /
   **No** button labels — the admin e2e journeys depend on them.
7. **Empty states invite.** A page with nothing in it explains what
   goes here and offers the one action that fills it ("No haiga yet.
   Add your first one."), never a bare empty table.
8. **No dead ends.** Every screen has a way back; every action has a
   visible result; nothing opens somewhere she cannot return from.
   Unsaved changes are protected by a clear prompt, not lost.
9. **Show her the site, not a proxy for it.** Where it is practical,
   the admin previews how a change will look on the public pages
   (#239); until then, descriptions of an effect ("this appears on the
   home page") beat abstract field names.
10. **Forgiving input.** Trim whitespace, accept the obvious formats,
    fill sensible defaults, and say what is expected *before* she
    submits rather than rejecting afterwards.

## Migration direction

The vehicle for making this real is the shadcn/ui + Tailwind + Geist
migration (#212, #232–#238, #240). New admin work should move toward it
and never add to the legacy CSS. Where a page is still on the legacy
styling, apply the principles *within* it — copy, spacing, empty, error
and success states cost nothing to get right — rather than half-migrate
it. Use stock shadcn components and their default neutral theme; the
warmth comes from spacing, copy and behavior, not custom colors.

## Out of scope

The public site's appearance. It is Kari's art and is unaffected by the
admin's look (the two are separate bundles by design).

## Reviewer checklist

For any PR that changes what the admin shows. Planners use it to shape
the design intent, workers to self-check, reviewers and the visual
review to judge. Every "no" is a finding.

- Is there one clear primary action on each changed screen?
- Does every action she can take produce a visible result (success
  message, updated list, navigation)?
- Does every failure path show a plain-language message that says what
  to do next, and keep her work?
- Do confirmations name the item, with Yes / No labels intact?
- Does every list or editor that can be empty have an inviting empty
  state?
- Is the copy in the site's vocabulary, free of codes, jargon and
  blame?
- Is anything new built on shadcn/Tailwind rather than fresh legacy
  CSS?
- At 390px, is it still calm and usable, not merely not-overflowing?
