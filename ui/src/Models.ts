export interface Haiku {
  id: string;
  title: string;
  lines: Array<string>;
  publisher: string;
}

export interface Haiga {
  id: string;
  title: string;
  lines: Array<string>;
  image: string;
  publisher: string;
}

export interface HomePageData {
  featuredHaiku: Haiku;
  blurb: string;
}
