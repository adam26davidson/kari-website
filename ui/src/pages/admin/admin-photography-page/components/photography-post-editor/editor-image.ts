import { v4 as uuidv4 } from "uuid";

// One image row of the photography post editor. The stable client-side `id`
// (generated at add/open time, never persisted) keys the rendered list so
// reorders move DOM/state with their item, and the pending `file` travels on
// the same object instead of living in a parallel index-aligned array.
export interface EditorImage {
  id: string;
  // Stored file name; "" until a pending file is uploaded on save.
  image: string;
  blurb: string;
  // Freshly picked file awaiting upload, or null for already-stored images.
  file: File | null;
}

export function newEditorImage(image = "", blurb = ""): EditorImage {
  return { id: uuidv4(), image, blurb, file: null };
}
