import { BlogPost } from "../../../../../models";
import {
  toDateInputValue,
  toPostDate,
} from "../../../../../utils/date-helpers";
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
    // toPostDate pins the picked day to UTC midnight, the one shape
    // stored post dates take (#379), and returns null for a value that
    // names no day — clearing the input yields "". Ignore that and keep
    // the post's last valid date rather than corrupting post.date (#154).
    const date = toPostDate(e.target.value);
    if (date === null) return;
    setPost({ ...post, date });
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
