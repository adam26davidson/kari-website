//! A throwaway directory tree standing in for the deploy bundle's snapshot.
//!
//! Shared by `repo_tools_tests.rs` (what the three tools return and refuse)
//! and `repo_dir_tests.rs` (how `REPO_DIR` is read), which are separate
//! binaries on purpose — see the header of `repo_dir_tests.rs`.
//!
//! Built by hand rather than with a temp-directory crate: this is the only
//! place in the API that needs one, and a new dependency to save fifteen
//! lines is a poor trade (`docs/dependency-management.md`). Names are unique
//! per process and per fixture so the parallel test threads cannot collide,
//! and `Drop` clears up even when an assertion panics.
//!
//! Compiled into every test binary that declares `mod common;` but used by
//! only those two — hence the file-level dead_code allow, as in `store.rs`.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use kari_website_api::services::repo_tools::RepoAccess;

pub struct Fixture {
    root: PathBuf,
}

static FIXTURE_COUNT: AtomicUsize = AtomicUsize::new(0);

impl Fixture {
    pub fn new() -> Self {
        let n = FIXTURE_COUNT.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!("kari-repo-tools-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create fixture root");
        Self { root }
    }

    /// A tree shaped like this repository's, small enough to assert on.
    pub fn repo() -> Self {
        let fixture = Self::new();
        fixture.write(
            "README.md",
            "# Kari's site\n\nA poetry and photography site.\n",
        );
        fixture.write(
            "ui/apps/admin/src/admin-haiku-page/admin-haiku-page.tsx",
            "export function AdminHaikuPage() {\n  // The editor is URL-driven.\n  return null;\n}\n",
        );
        fixture.write(
            "ui/apps/admin/src/components/editor-page/editor-page.tsx",
            "export function EditorPage() {\n  return <Card>Save</Card>;\n}\n",
        );
        fixture.write(
            "api/src/services/assistant.rs",
            "//! The admin helper.\npub const RESTING_MESSAGE: &str = \"resting\";\n",
        );
        // Ignored everywhere: build output and dependencies say nothing
        // about how the site behaves, and a live-clone `REPO_DIR` has a
        // `.git` full of the same thing in packed form.
        fixture.write("node_modules/left-pad/index.js", "// haiku editor\n");
        fixture.write("ui/dist/assets/bundle.js", "// haiku editor\n");
        fixture.write(".git/config", "[remote \"origin\"]\n\turl = haiku editor\n");
        fixture
    }

    pub fn write(&self, relative: &str, contents: &str) -> PathBuf {
        let path = self.root.join(relative);
        std::fs::create_dir_all(path.parent().expect("a parent")).expect("create fixture dirs");
        std::fs::write(&path, contents).expect("write fixture file");
        path
    }

    pub fn access(&self) -> RepoAccess {
        RepoAccess::open(&self.root).expect("open the fixture as a snapshot")
    }

    pub fn path(&self) -> &Path {
        &self.root
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
