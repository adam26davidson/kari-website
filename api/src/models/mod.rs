use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Haiku {
    pub id: String,
    pub title: String,
    pub lines: Vec<String>,
    pub publisher: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Haiga {
    pub id: String,
    pub title: String,
    pub lines: Vec<String>,
    pub publisher: String,
    pub image: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HomePageData {
    #[serde(rename = "featuredHaiku")]
    pub featured_haiku: Haiku,
    pub blurb: String,
}