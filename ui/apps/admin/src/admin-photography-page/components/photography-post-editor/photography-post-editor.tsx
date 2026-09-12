import { useId } from "react";
import {
  faArrowDown,
  faArrowUp,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { PhotographyPost } from "@kari/shared/models";
import { EditorPage } from "../../../components/editor-page/editor-page";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { PhotoPicker } from "../../../components/photo-picker/photo-picker";
import {
  moveItemByIdByOne,
  removeItemById,
} from "@kari/shared/utils/data-list-helpers";
import { EditorImage, newEditorImage } from "./editor-image";

export function PhotographyPostEditor({
  post,
  setPost,
  saveDisabled,
  onSave,
  onClose,
  images,
  setImages,
}: {
  post: PhotographyPost;
  setPost: (post: PhotographyPost) => void;
  saveDisabled: boolean;
  onSave: () => void;
  onClose: () => void;
  images: Array<EditorImage>;
  setImages: (images: Array<EditorImage>) => void;
}) {
  const titleId = useId();
  const subtitleId = useId();
  const blurbId = useId();
  const captionIdPrefix = useId();
  const updateField =
    (field: "title" | "subtitle" | "blurb") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setPost({ ...post, [field]: e.target.value });
    };

  const onNewImage = () => {
    setImages([...images, newEditorImage()]);
  };

  const onDelete = (id: string) => {
    setImages(removeItemById(images, id));
  };

  const onMove = (id: string, direction: "up" | "down") => {
    setImages(moveItemByIdByOne(images, id, direction));
  };

  const handleImageBlurbChange =
    (id: string) => (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setImages(
        images.map((entry) =>
          entry.id === id ? { ...entry, blurb: e.target.value } : entry,
        ),
      );
    };

  const setImageFile = (id: string) => (file: File | null) => {
    setImages(
      images.map((entry) => {
        if (entry.id !== id) return entry;
        // A newly picked file replaces whatever was stored; clearing the
        // stored name marks the entry as pending upload.
        return file !== null
          ? { ...entry, file, image: "" }
          : { ...entry, file: null };
      }),
    );
  };

  return (
    <EditorPage
      title="Edit photography post"
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
          onChange={updateField("title")}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label
          className="text-muted-foreground font-sans text-sm"
          htmlFor={subtitleId}
        >
          Subtitle
        </label>
        <Input
          id={subtitleId}
          type="text"
          value={post.subtitle}
          onChange={updateField("subtitle")}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label
          className="text-muted-foreground font-sans text-sm"
          htmlFor={blurbId}
        >
          Blurb (optional)
        </label>
        <Textarea
          id={blurbId}
          value={post.blurb}
          onChange={updateField("blurb")}
        />
      </div>
      {/* The images, written out here rather than through `ItemList`: that
          component is an admin list PAGE (title, search, `?q=` in the URL)
          and its docstring says so — the fork's `compact` / `addVariant` /
          `deleteLabel` / `hideEdit` props existed only to bend it into this
          nested list, and a prop nothing else can reach is a branch nothing
          tests.

          `photography-post-editor-images` is not styling: it is how the e2e
          journeys scope to this section — the file input they attach a
          fixture to, the preview they assert on, and the row controls they
          count (e2e/admin-journeys.spec.ts). */}
      <div className="photography-post-editor-images flex flex-col gap-4">
        <div className="flex flex-row items-center justify-between gap-4">
          {/* A group label, not a control's: the rows below are what it
              names. */}
          <span className="text-muted-foreground font-sans text-sm">
            Images
          </span>
          {/* Secondary: Save, on the paper above, is this screen's one
              primary. Filled, these two competed as equals (#457). */}
          <Button variant="secondary" onClick={onNewImage}>
            Add an image
          </Button>
        </div>
        {/* A new post starts with no images, so this is the first thing the
            editor shows her — and it used to be a bare gap (#473, design
            brief §7). */}
        {images.length === 0 && (
          <p className="text-muted-foreground font-sans text-sm">
            No images yet. Add your first one.
          </p>
        )}
        {images.map((entry, idx) => (
          // One photograph per frame: a hairline and its own padding, with
          // no fill. Filled, this was a third grey surface stacked inside
          // the card (the legacy stylesheet's `rgba(0,0,0,0.1)` panel), a
          // well within a well — the grouping is spacing and a border's
          // job (visual review, #829).
          <div
            key={entry.id}
            className="border-border flex flex-col gap-4 rounded-xl border p-4"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
              <div className="flex shrink-0 flex-col gap-2">
                {/* Group label: the picker is a composite, not one control,
                    so there is nothing to point `for` at. */}
                <span className="text-muted-foreground font-sans text-sm">
                  Photo
                </span>
                <PhotoPicker
                  imageFile={entry.file}
                  fileName={entry.image}
                  setImageFile={setImageFile(entry.id)}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <label
                  className="text-muted-foreground font-sans text-sm"
                  htmlFor={`${captionIdPrefix}-${entry.id}`}
                >
                  Caption (optional)
                </label>
                <Textarea
                  id={`${captionIdPrefix}-${entry.id}`}
                  value={entry.blurb}
                  onChange={handleImageBlurbChange(entry.id)}
                />
              </div>
            </div>
            {/* The row's controls, on a line of their own under the fields.
                The move arrows stay icons — directional, low-consequence,
                and "Move up" is what the arrow already says — and are
                hidden where they would do nothing, as in every admin list
                since #457. */}
            <div className="flex flex-row flex-wrap items-center gap-2 sm:justify-end">
              {idx !== 0 && (
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Move up"
                  onClick={() => onMove(entry.id, "up")}
                >
                  <FontAwesomeIcon icon={faArrowUp} />
                </Button>
              )}
              {idx !== images.length - 1 && (
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Move down"
                  onClick={() => onMove(entry.id, "down")}
                >
                  <FontAwesomeIcon icon={faArrowDown} />
                </Button>
              )}
              {/* Named, and set further off than the arrows sit from each
                  other. As a bare red circle it floated beside the caption
                  box, saying nothing about whether it removed the caption,
                  the photo or the post (#457, design brief §2, §3). */}
              <Button
                variant="dangerSecondary"
                className="ml-4 max-sm:h-11 max-sm:px-3"
                onClick={() => onDelete(entry.id)}
              >
                <FontAwesomeIcon icon={faTrash} />
                Remove this image
              </Button>
            </div>
          </div>
        ))}
      </div>
    </EditorPage>
  );
}
