import { useId } from "react";
import { BlogPost } from "@kari/shared/models";
import { toDateInputValue, toPostDate } from "@kari/shared/utils/date-helpers";
import { EditorPage } from "../../../components/editor-page/editor-page";
import { Input } from "../../../components/ui/input";
import { Switch } from "../../../components/ui/switch";
import { Tiptap } from "../../../components/tiptap/tiptap";

export function BlogPostEditor({
  post,
  content,
  setContent,
  setPost,
  saveDisabled,
  onSave,
  onClose,
  onAddImage,
}: {
  post: BlogPost;
  content: string | null;
  setContent: (content: string | null) => void;
  setPost: (post: BlogPost) => void;
  /** Computed by the page (e.g. empty title); passed to EditorPage. */
  saveDisabled: boolean;
  onSave: () => void;
  onClose: () => void;
  onAddImage: (image: File, id: string) => void;
}) {
  const titleId = useId();
  const dateId = useId();
  const publishedId = useId();
  const publishedLabelId = `${publishedId}-label`;
  const publishedHintId = `${publishedId}-hint`;
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // toPostDate pins the picked day to UTC midnight, the one shape
    // stored post dates take (#379), and returns null for a value that
    // names no day — clearing the input yields "". Ignore that and keep
    // the post's last valid date rather than corrupting post.date (#154).
    const date = toPostDate(e.target.value);
    if (date === null) return;
    setPost({ ...post, date });
  };

  return (
    <EditorPage
      title="Edit post"
      onSave={onSave}
      onClose={onClose}
      disableSave={saveDisabled}
    >
      <div className="flex flex-col gap-2">
        <label
          className="text-muted-foreground font-sans text-sm"
          htmlFor={titleId}
        >
          Title
        </label>
        <Input
          id={titleId}
          type="text"
          value={post.title}
          onChange={(e) => setPost({ ...post, title: e.target.value })}
        />
      </div>
      {/* Date and Published share a row on the boards (`WorksEditor.png`)
          and stack on a phone (`WorksEditorMobile.png`), which is what the
          wrap does — `items-end` so the switch sits level with the date box
          rather than with the label above it. */}
      <div className="flex flex-row flex-wrap items-end gap-x-6 gap-y-4">
        <div className="flex flex-col gap-2">
          <label
            className="text-muted-foreground font-sans text-sm"
            htmlFor={dateId}
          >
            Date
          </label>
          {/* Still the browser's own date control, rendered through the
              boards' field skin: it brings a picker, a keyboard entry mode
              and a locale format that no hand-rolled calendar here would
              match, and every date invariant this editor holds (#154, #379)
              is written against its change events. `w-fit` because a date
              is a fixed-width thing and has no business filling the card
              the way Title does. The boards' "14 August 2026" rendering is
              the one accepted divergence — that is the browser's format to
              choose, not this component's. */}
          <Input
            id={dateId}
            type="date"
            className="w-fit"
            value={toDateInputValue(post.date)}
            onChange={handleDateChange}
          />
        </div>
        {/* A switch rather than the checkbox this used to be: publishing is
            a state the site is in, and the boards draw it as one (README,
            "notable deliberate decisions"). The hint says what flipping it
            DOES before she flips it, rather than leaving "Published" to be
            found out (design brief §9). */}
        <div className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1 pb-2">
          {/* Named through `aria-labelledby` as well as by the `htmlFor`
              below, because a `<label for>` is only a reliable name source
              for the labelable CONTROLS — and Radix renders a switch as a
              `<button>` with no text of its own, which a browser would
              otherwise compute an empty name for. The `htmlFor` stays: it
              is what makes clicking the word flip the switch. */}
          <Switch
            id={publishedId}
            aria-labelledby={publishedLabelId}
            aria-describedby={publishedHintId}
            checked={post.isPublished}
            onCheckedChange={(checked) =>
              setPost({ ...post, isPublished: checked })
            }
          />
          <label
            id={publishedLabelId}
            className="text-foreground cursor-pointer font-sans text-sm font-medium"
            htmlFor={publishedId}
          >
            Published
          </label>
          <span
            id={publishedHintId}
            className="text-muted-foreground font-sans text-sm"
          >
            — visitors can read this
          </span>
        </div>
      </div>
      <Tiptap
        content={content || ""}
        setContent={setContent}
        onAddImage={onAddImage}
      />
    </EditorPage>
  );
}
