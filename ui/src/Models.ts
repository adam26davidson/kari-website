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
  featuredHaiku: Haiku;
  blurb: string;
}
