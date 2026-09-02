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
 *
 * The three header colours override the site header's bar tint, site title
 * and nav links (the hover underline follows the nav colour). Each is
 * either "" — or absent, which means the same thing — for "use the
 * built-in default", or a hex colour: `#rrggbbaa` for the bar, so one
 * field carries the translucency the bar needs, and `#rrggbb` for the two
 * text colours. They are optional because a settings object written before
 * this feature genuinely lacks them; the API fills them in with "" once
 * redeployed, so every reader has to treat absent and "" identically.
 * Anything that is not a hex colour of the right length is ignored by
 * useSiteBackground, which leaves the built-in appearance in place.
 */
export interface SiteSettings {
  backgroundPhoto: string;
  headerBackgroundColor?: string;
  headerTitleColor?: string;
  headerNavColor?: string;
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
