import { BlogPost } from "../../../../../Models";
import { DataEditor } from "../../../../../components/data-editor/data-editor";
import { Tiptap } from "../../../../../components/tiptap/tiptap";
import "./blog-post-editor.css";

export function BlogPostEditor({
  post,
  content,
  setContent,
  setPost,
  validate,
  onSave,
  onClose,
  onAddImage,
}: {
  post: BlogPost;
  content: string | null;
  setContent: (content: string | null) => void;
  setPost: (post: BlogPost) => void;
  validate: (post: BlogPost) => boolean;
  onSave: () => void;
  onClose: () => void;
  setLoading: (loading: { isLoading: boolean; message: string }) => void;
  onAddImage: (image: File, id: string) => void;
}) {
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = new Date(e.target.value);
    const formattedDate = date.toISOString();
    setPost({ ...post, date: formattedDate });
  };

  return (
    <DataEditor onSave={onSave} onClose={onClose} disableSave={!validate(post)}>
      <input
        type="text"
        placeholder="Title"
        value={post.title}
        onChange={(e) => setPost({ ...post, title: e.target.value })}
      />
      <div className="blog-post-editor-input-line">
        <input
          type="date"
          value={new Date(post.date).toISOString().split("T")[0]}
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
