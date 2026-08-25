import { BlogPost } from "../../../../../models";
import { toDateInputValue } from "../../../../../utils/date-helpers";
import { DataEditor } from "../../../components/data-editor/data-editor";
import { Tiptap } from "../../../components/tiptap/tiptap";
import "./blog-post-editor.css";

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
  /** Computed by the page (e.g. empty title); passed to DataEditor. */
  saveDisabled: boolean;
  onSave: () => void;
  onClose: () => void;
  onAddImage: (image: File, id: string) => void;
}) {
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = new Date(e.target.value);
    // Clearing the input yields "" and so an Invalid Date; ignore it and
    // keep the post's last valid date instead of crashing on
    // toISOString() or corrupting post.date (#154).
    if (isNaN(date.getTime())) return;
    setPost({ ...post, date: date.toISOString() });
  };

  return (
    <DataEditor onSave={onSave} onClose={onClose} disableSave={saveDisabled}>
      <input
        type="text"
        placeholder="Title"
        value={post.title}
        onChange={(e) => setPost({ ...post, title: e.target.value })}
      />
      <div className="blog-post-editor-input-line">
        <input
          type="date"
          value={toDateInputValue(post.date)}
          onChange={handleDateChange}
        />
        <div className="blog-post-editor-status">
          <input
            className="blog-post-editor-status-checkbox"
            type="checkbox"
            checked={post.isPublished}
            onChange={(e) =>
              setPost({ ...post, isPublished: e.target.checked })
            }
          />
          <label>Published</label>
        </div>
      </div>
      {
        <Tiptap
          content={content || ""}
          setContent={setContent}
          onAddImage={onAddImage}
        />
      }
    </DataEditor>
  );
}
