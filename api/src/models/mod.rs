use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Haiku {
    pub id: String,
    pub lines: Vec<String>,
    pub publisher: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Haiga {
    pub id: String,
    pub lines: Vec<String>,
    pub publisher: String,
    pub image: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HomePageData {
    pub photo: String,
    pub blurb: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BlogPost {
    pub id: String,
    pub title: String,
    pub date: String,
    #[serde(rename = "isPublished")]
    pub is_published: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BlogPostUpdate {
    pub id: String,
    pub content: String,
    #[serde(rename = "isPublished")]
    pub is_published: bool,
}

#[derive(Deserialize)]
pub struct IsPublishedQuery {
    #[serde(rename = "isPublished")]
    pub is_published: bool,
}
