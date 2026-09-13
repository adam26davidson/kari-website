import { cn } from "../ui/cn";

/**
 * The small line that names a field on a migrated admin editor: "Title",
 * "Publisher", "Blurb (optional)", "Caption (optional)".
 *
 * Ink at the interface size, one weight up from the value it names — which
 * is what the boards draw. Sampled from `WorksEditor.png`, the "Title",
 * "Date" and "Published" labels are `#2A2723` (Ink), the same colour as the
 * text in the box below them, while `#9A8F7C` — the boards' render of the
 * muted tone — is spent on the sidebar's "YOUR WORKSHOP" and "Sign out" and
 * on the publish hint, i.e. on asides, never on a field's name.
 *
 * Every editor had reached for `text-muted-foreground` instead, which put
 * the labels at Stone: 5.6:1 on the white card, so legible, but a full step
 * back from the boards' 14.9:1 and visibly the weaker half of a
 * label/value pair it is meant to lead. CI's visual review on #237 read
 * that as the editors looking unfinished ("the muted tan field labels …
 * are faint against the near-white card"), and it was right: the token was
 * wrong, not the ratio.
 *
 * Spelled once here because nine call sites across five editors had the
 * same class list copied out by hand, and a rule that lives in nine places
 * is a rule that drifts.
 *
 * `htmlFor` is what decides the element. Given one, this is a real
 * `<label>` and clicking the words focuses (or toggles) the control. Left
 * out, it is a `<span>`: the photography editor's "Images" and "Photo"
 * name a GROUP and a composite picker, neither of which is a single
 * control a `for` could point at, and a `<label>` with no `for` would
 * claim to name whatever input it happened to wrap.
 */
export function FieldLabel({
  children,
  className,
  htmlFor,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
  id?: string;
}) {
  const classes = cn(
    "text-foreground font-sans text-sm font-medium",
    className,
  );

  if (htmlFor === undefined) {
    return (
      <span className={classes} id={id}>
        {children}
      </span>
    );
  }

  return (
    <label className={classes} htmlFor={htmlFor} id={id}>
      {children}
    </label>
  );
}
