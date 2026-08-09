const API_URL = import.meta.env.VITE_API_URL;
const S3_URL = import.meta.env.VITE_S3_URL;

export const s3ImageUrl = (fileName: string) => `${S3_URL}/images/${fileName}`;

export const apiImageUrl = (fileName: string) =>
  `${API_URL}/images/${fileName}`;

export const getImageFileName = (url: string) => {
  return url.split("/").pop();
};

export const changeImageUrlToS3 = (url: string) =>
  s3ImageUrl(getImageFileName(url) ?? "");

export const changeImageUrlToApi = (url: string) =>
  apiImageUrl(getImageFileName(url) ?? "");
