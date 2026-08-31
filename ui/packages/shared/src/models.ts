export interface Haiku {
  id: string;
  lines: Array<string>;
  publisher: string;
}

export interface Haiga {
  id: string;
  lines: Array<string>;
  image: string;
  publisher: string;
}

export interface HomePageData {
  photo: string;
  blurb: string;
}

/**
 * Site-wide settings stored as site-settings.json. backgroundPhoto is the
 * uploaded image file name used as the public site's page background; ""
 * means "use the built-in default background".
 */
export interface SiteSettings {
  backgroundPhoto: string;
}

export interface BlogPost {
  id: string;
  title: string;
  date: string;
  isPublished: boolean;
}

export interface BlogPostContentUpdate {
  id: string;
  isPublished: boolean;
  content: string;
}

export interface PhotographyImage {
  image: string;
  blurb: string;
}

export interface PhotographyPost {
  id: string;
  title: string;
  subtitle: string;
  blurb: string;
  images: Array<PhotographyImage>;
}
