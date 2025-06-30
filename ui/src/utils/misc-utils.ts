import { PhotographyPost } from "../Models";

export function copyPhotographyPost(oldItem: PhotographyPost) {
  const newItem: PhotographyPost = new PhotographyPost();
  newItem.id = oldItem.id;
  newItem.title = oldItem.title;
  newItem.subtitle = oldItem.subtitle;
  newItem.blurb = oldItem.blurb;
  newItem.images = oldItem.images.map((image) => {
    return { ...image };
  });
  return newItem;
}
