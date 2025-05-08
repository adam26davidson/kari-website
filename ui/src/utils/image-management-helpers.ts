const API_URL = import.meta.env.VITE_API_URL;
const S3_URL = import.meta.env.VITE_S3_URL;

export const changeImageUrlToS3 = (url: string) => {
  const fileName = url.split("/").pop();
  return `${S3_URL}/images/${fileName}`;
};

export const changeImageUrlToApi = (url: string) => {
  const fileName = url.split("/").pop();
  return `${API_URL}/images/${fileName}`;
};

export const getImageFileName = (url: string) => {
  return url.split("/").pop();
};

export const getImageIdFromUrl = (url: string) => {
  const fileName = url.split("/").pop();
  return fileName?.split(".")[0];
};
