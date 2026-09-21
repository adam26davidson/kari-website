/**
 * Text from the helper, rendered as text.
 *
 * Both the replies in the transcript and the write-up on the draft card
 * arrive as plain strings, and nothing here interprets markup — what she
 * reads is the characters the model wrote, which on the card is the point:
 * it is the thing about to be published. Blank lines are kept, so a
 * step-by-step answer still reads as steps.
 */
export function AssistantPlainText({
  text,
  className,
}: {
  text: string;
  /** Applied to each line; the blank-line spacers keep their own height. */
  className?: string;
}) {
  return (
    <>
      {text.split("\n").map((line, index) => (
        <p key={index} className={line ? className : "h-3"}>
          {line}
        </p>
      ))}
    </>
  );
}
