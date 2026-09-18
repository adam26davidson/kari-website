//! How the helper finds its snapshot in the environment.
//!
//! This lives in its own integration-test binary ON PURPOSE, for the same
//! reason `assistant_config_tests.rs` does: `REPO_DIR` is process-global,
//! and cargo runs the tests within one binary on parallel threads — so a
//! sibling test setting or clearing it would race whatever this one is
//! reading back. `repo_tools_tests.rs` deliberately sets no variable at
//! all, injecting the snapshot root instead, so the two must not share a
//! process. Everything here runs in ONE test function for the same reason:
//! two tests in this binary would race each other.

mod common;

use common::repo::Fixture;
use kari_website_api::services::repo_tools::RepoAccess;

#[test]
fn repo_dir_decides_whether_the_helper_can_see_any_code() {
    let fixture = Fixture::repo();
    let before = std::env::var("REPO_DIR").ok();

    // A directory that is there becomes the snapshot...
    std::env::set_var("REPO_DIR", fixture.path());
    let pointed = RepoAccess::from_env();

    // ...and one that is not there leaves the helper without code, which is
    // a normal state rather than a failure.
    std::env::set_var("REPO_DIR", "/nonexistent/kari-website-snapshot");
    let absent = RepoAccess::from_env();

    // Restored before any assertion, so a failure here cannot leak the
    // variable into whatever this binary runs next.
    match before {
        Some(value) => std::env::set_var("REPO_DIR", value),
        None => std::env::remove_var("REPO_DIR"),
    }

    let pointed = pointed.expect("REPO_DIR should have been opened");
    // Canonicalised, so the comparison is against the real path either way.
    assert_eq!(
        pointed.root(),
        std::fs::canonicalize(fixture.path()).unwrap()
    );
    assert!(absent.is_none());
}
