//! The helper's read-only eyes on this codebase.
//!
//! Three tools — list a folder, read a file, search for a string — over a
//! snapshot of the repository that ships INSIDE the deploy bundle. The
//! deploy workflow runs `git archive HEAD` on the very commit it is
//! deploying and extracts it next to the API binary, so the snapshot cannot
//! drift from what is running: there is no checkout on the host to keep in
//! sync, no cron, and no index to rebuild.
//!
//! Why the helper needs this at all: it answers how-to questions about a
//! site whose behaviour lives in the code, and it writes issues for whoever
//! picks them up. Both get markedly better when it can name the actual
//! component rather than guess from the prompt's page map.
//!
//! Everything here is READ-ONLY and bounded. Nothing writes, nothing
//! executes, every path is canonicalised and checked back against the root
//! before it is opened, and every answer is capped so one tool call cannot
//! pour a megabyte into the next request's token count.
//!
//! Like the rest of the helper this is optional: a host with no snapshot
//! simply has no repo tools declared, and a call that arrives anyway is
//! answered in words rather than failing the turn.

use std::path::{Component, Path, PathBuf};

use serde_json::{json, Value};

pub const LIST_TOOL: &str = "list_repo_files";
pub const READ_TOOL: &str = "read_repo_file";
pub const SEARCH_TOOL: &str = "search_repo";

/// Where the snapshot lives when the host does not say otherwise, relative
/// to the API binary — which is exactly where the appspec puts it
/// (`<API_DIR>/repo`). Resolved against the executable rather than the
/// working directory because the systemd unit's `WorkingDirectory` is set
/// on the instance and is not this repo's to assume.
pub const DEFAULT_DIR_NAME: &str = "repo";

/// Most one `read_repo_file` may return. Generous enough for any single
/// source file in this repo, small enough that a careless read cannot
/// dominate the conversation's token budget.
const MAX_READ_BYTES: usize = 50_000;

/// Most entries one `list_repo_files` may name.
const MAX_LIST_ENTRIES: usize = 300;

/// Most matches one `search_repo` may return.
const MAX_SEARCH_MATCHES: usize = 40;

/// Longest match line echoed back; a minified file would otherwise return
/// one line worth tens of thousands of characters.
const MAX_MATCH_LINE: usize = 200;

/// Files bigger than this are not searched. Nothing a person wrote is this
/// big; lock files and bundled assets are.
const MAX_SEARCH_FILE_BYTES: u64 = 512_000;

/// Ceiling on how many files one search may open, so a snapshot that grew
/// an unexpected directory cannot turn a tool call into a long blocking
/// walk of the disk.
const MAX_SEARCH_FILES: usize = 8_000;

/// Directories never listed, read into, or searched. Build output and
/// dependencies say nothing about how the site behaves, and in development
/// — where `REPO_DIR` points at a live clone rather than a snapshot —
/// `node_modules` alone would swamp every search.
const SKIPPED_DIRS: [&str; 6] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    "coverage",
    "dist-ssr",
];

/// Answered when a repo tool is called on a host with no snapshot. A plain
/// sentence rather than an error, because nothing is wrong: the helper just
/// has to answer from what it knows.
pub const REPO_UNAVAILABLE: &str =
    "The site's code isn't available to look at right now. Answer from what you already know, \
and say plainly if you are not sure.";

/// Said when a path points outside the snapshot. Doubles as guidance: the
/// model is told the shape of path that WILL work.
const OUTSIDE_ROOT: &str =
    "That path is outside the site's code. Use a path relative to the repository root, \
like \"ui/apps/admin/src\".";

/// Is this one of ours? Used by the turn loop to route a tool call, so an
/// unknown tool and a repo tool on a host with no snapshot get different
/// (and equally honest) answers.
pub fn is_repo_tool(name: &str) -> bool {
    matches!(name, LIST_TOOL | READ_TOOL | SEARCH_TOOL)
}

/// The three tool declarations, for the `tools` array of every request in a
/// turn. Only included when a snapshot is actually present — a tool that
/// would always answer "unavailable" is worse than no tool at all.
pub fn tools() -> Vec<Value> {
    vec![
        json!({
            "name": SEARCH_TOOL,
            "description": "Search the site's source code for a literal piece \
        of text — a phrase she saw on screen, a component name, a setting. Case \
        insensitive. This is usually the fastest way in: search for the wording, then \
        read the file it points at.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The text to look for. Literal, not a \
        regular expression or a glob.",
                    },
                    "path_prefix": {
                        "type": "string",
                        "description": "Optional folder to search within, \
        relative to the repository root, e.g. \"ui/apps/admin/src\".",
                    },
                },
                "required": ["query"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": LIST_TOOL,
            "description": "List the files and folders at a path in the site's \
        source code. Use \"\" for the repository root.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Folder relative to the repository \
        root, e.g. \"ui/apps/admin/src\". Empty for the root itself.",
                    },
                },
                "required": ["path"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": READ_TOOL,
            "description": "Read a text file from the site's source code. Long \
        files come back trimmed; ask for a line range to see more.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File relative to the repository root, \
        e.g. \"ui/apps/admin/src/admin-haiku-page/admin-haiku-page.tsx\".",
                    },
                    "start_line": {
                        "type": "integer",
                        "description": "First line to return, counting from 1. \
        Defaults to the start of the file.",
                    },
                    "end_line": {
                        "type": "integer",
                        "description": "Last line to return. Defaults to the \
        end of the file.",
                    },
                },
                "required": ["path"],
                "additionalProperties": false,
            },
        }),
    ]
}

/// A snapshot of the codebase, and the only way to reach it.
///
/// Construction canonicalises the root once; every path the model supplies
/// is then canonicalised and checked back against it, so neither `..` nor a
/// symlink inside the snapshot can reach a byte outside. (`git archive`
/// does not follow symlinks, but the check is what makes that a property of
/// this code rather than of how the bundle happened to be built.)
#[derive(Clone, Debug)]
pub struct RepoAccess {
    root: PathBuf,
}

impl RepoAccess {
    /// Open a snapshot directory, or `None` when there is not one there.
    ///
    /// `None` is a normal state, not a failure: it is what every host looked
    /// like before this shipped, and what a local `cargo run` looks like
    /// unless `REPO_DIR` says otherwise.
    pub fn open(dir: impl AsRef<Path>) -> Option<Self> {
        let root = std::fs::canonicalize(dir.as_ref()).ok()?;
        root.is_dir().then_some(Self { root })
    }

    /// Find the snapshot: `REPO_DIR` if the host sets it, otherwise `repo`
    /// beside the API binary, which is where the appspec installs it.
    ///
    /// The executable's own directory rather than the working directory,
    /// because the working directory is a property of the systemd unit on
    /// the instance and nothing here should depend on it. A host that wants
    /// something else — development pointing at a live clone — sets
    /// `REPO_DIR` and is believed.
    pub fn from_env() -> Option<Self> {
        if let Some(dir) = std::env::var("REPO_DIR")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        {
            let opened = Self::open(&dir);
            if opened.is_none() {
                tracing::warn!("REPO_DIR={dir:?} is not a directory; the helper cannot read code");
            }
            return opened;
        }
        let beside_binary = std::env::current_exe()
            .ok()?
            .parent()?
            .join(DEFAULT_DIR_NAME);
        Self::open(beside_binary)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Answer one tool call: `(is_error, content)`, in the shape the turn
    /// loop puts straight into a `tool_result` block.
    ///
    /// Never returns a `Result`: a bad path or a missing file is something
    /// the model should read and try again from, not something that should
    /// end her turn.
    pub fn run(&self, tool: &str, input: &Value) -> (bool, String) {
        let text = |name: &str| {
            input
                .get(name)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
        };
        // Numbers arrive as numbers, but a model that sends "12" means 12 and
        // answering "that is not a line number" would be pedantry.
        let line = |name: &str| {
            input.get(name).and_then(|value| {
                value
                    .as_u64()
                    .or_else(|| value.as_str()?.trim().parse::<u64>().ok())
                    .map(|n| n as usize)
            })
        };
        let answer = match tool {
            LIST_TOOL => self.list(text("path").unwrap_or("")),
            READ_TOOL => self.read(
                text("path").unwrap_or(""),
                line("start_line"),
                line("end_line"),
            ),
            SEARCH_TOOL => self.search(text("query").unwrap_or(""), text("path_prefix")),
            // Unreachable through `is_repo_tool`, and answered rather than
            // panicked on anyway.
            _ => Err(format!("There is no tool called {tool}.")),
        };
        match answer {
            Ok(content) => (false, content),
            Err(message) => (true, message),
        }
    }

    /// Turn a model-supplied path into a real one inside the snapshot.
    ///
    /// Two independent checks, because each covers what the other cannot:
    /// the component scan rejects `..` and absolute paths before the
    /// filesystem is touched at all, and the canonicalised prefix check
    /// catches anything a symlink could do afterwards.
    fn resolve(&self, raw: &str) -> Result<PathBuf, String> {
        let raw = raw.trim().trim_start_matches("./");
        if raw.is_empty() || raw == "." {
            return Ok(self.root.clone());
        }
        let relative = Path::new(raw);
        let plain = relative
            .components()
            .all(|part| matches!(part, Component::Normal(_) | Component::CurDir));
        if !plain {
            return Err(OUTSIDE_ROOT.to_string());
        }
        let resolved =
            std::fs::canonicalize(self.root.join(relative)).map_err(|_| self.missing(raw))?;
        if !resolved.starts_with(&self.root) {
            return Err(OUTSIDE_ROOT.to_string());
        }
        Ok(resolved)
    }

    /// What a path that is not there is answered with. Names the path so the
    /// model can see its own typo, and points at the tool that would have
    /// told it the truth.
    fn missing(&self, raw: &str) -> String {
        format!(
            "There is no \"{raw}\" in the site's code. Use {LIST_TOOL} to see what is \
there, or {SEARCH_TOOL} to find it."
        )
    }

    /// How a path reads in an answer: relative to the root, never the
    /// instance's real directory layout.
    fn shown(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string()
    }

    fn list(&self, raw: &str) -> Result<String, String> {
        let dir = self.resolve(raw)?;
        if !dir.is_dir() {
            return Err(format!(
                "\"{raw}\" is a file, not a folder — use {READ_TOOL} to read it."
            ));
        }
        let mut entries: Vec<String> = std::fs::read_dir(&dir)
            .map_err(|_| self.missing(raw))?
            .flatten()
            .filter(|entry| !skipped(&entry.file_name().to_string_lossy()))
            .map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                if entry.path().is_dir() {
                    format!("{name}/")
                } else {
                    name
                }
            })
            .collect();
        // Sorted so two calls on one conversation cannot disagree about the
        // order, which a model would read as the folder having changed.
        entries.sort();
        let total = entries.len();
        let mut note = String::new();
        if total > MAX_LIST_ENTRIES {
            entries.truncate(MAX_LIST_ENTRIES);
            note = format!(
                "\n({MAX_LIST_ENTRIES} of {total} shown — look inside a folder for the rest)"
            );
        }
        let shown = self.shown(&dir);
        let shown = if shown.is_empty() {
            "the repository root".to_string()
        } else {
            shown
        };
        if entries.is_empty() {
            return Ok(format!("{shown} is empty."));
        }
        Ok(format!("{shown}:\n{}{note}", entries.join("\n")))
    }

    fn read(
        &self,
        raw: &str,
        start_line: Option<usize>,
        end_line: Option<usize>,
    ) -> Result<String, String> {
        let file = self.resolve(raw)?;
        if file.is_dir() {
            return Err(format!(
                "\"{raw}\" is a folder, not a file — use {LIST_TOOL} to see what is in it."
            ));
        }
        let bytes = std::fs::read(&file).map_err(|_| self.missing(raw))?;
        // Binary files are rejected rather than lossily converted: a page of
        // replacement characters is not something the model can reason about
        // and it costs the same tokens as real code.
        let text = String::from_utf8(bytes)
            .map_err(|_| format!("\"{raw}\" is not a text file, so there is nothing to read."))?;

        let lines: Vec<&str> = text.lines().collect();
        let total = lines.len();
        if total == 0 {
            return Ok(format!("{} is empty.", self.shown(&file)));
        }
        // 1-based and inclusive, which is how the file reads in an editor and
        // how the model will quote it back.
        let first = start_line.unwrap_or(1).max(1);
        let last = end_line.unwrap_or(total).min(total);
        if first > total {
            return Err(format!(
                "\"{raw}\" has only {total} lines, so line {first} is past the end."
            ));
        }
        if last < first {
            return Err("The last line to read comes before the first one.".to_string());
        }

        let mut body = String::new();
        let mut shown_to = first;
        let mut trimmed = false;
        for (offset, line) in lines[first - 1..last].iter().enumerate() {
            if body.len() + line.len() + 1 > MAX_READ_BYTES {
                trimmed = true;
                break;
            }
            body.push_str(line);
            body.push('\n');
            shown_to = first + offset;
        }
        let note = if trimmed {
            format!(
                "\n(trimmed here — read from line {} for more)",
                shown_to.saturating_add(1)
            )
        } else {
            String::new()
        };
        Ok(format!(
            "{} (lines {first}-{shown_to} of {total}):\n{body}{note}",
            self.shown(&file)
        ))
    }

    fn search(&self, query: &str, path_prefix: Option<&str>) -> Result<String, String> {
        let query = query.trim();
        if query.len() < 2 {
            return Err(
                "Search for at least two characters — a phrase or a name, not a single letter."
                    .to_string(),
            );
        }
        let start = match path_prefix {
            Some(prefix) => self.resolve(prefix)?,
            None => self.root.clone(),
        };
        let needle = query.to_lowercase();

        let mut matches: Vec<String> = vec![];
        let mut files_read = 0usize;
        let mut capped = false;
        // An explicit stack rather than recursion: the depth is whatever the
        // snapshot happens to contain, and a stack makes that the heap's
        // problem instead of the thread's.
        let mut pending = vec![start.clone()];
        if start.is_file() {
            pending = vec![];
            files_read += 1;
            self.scan_file(&start, &needle, &mut matches);
        }
        while let Some(dir) = pending.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            // Collected and sorted so the answer is the same every time the
            // same question is asked.
            let mut children: Vec<PathBuf> = entries
                .flatten()
                .filter(|entry| !skipped(&entry.file_name().to_string_lossy()))
                .map(|entry| entry.path())
                .collect();
            children.sort();
            for child in children {
                if child.is_dir() {
                    pending.push(child);
                    continue;
                }
                if files_read >= MAX_SEARCH_FILES || matches.len() >= MAX_SEARCH_MATCHES {
                    capped = true;
                    break;
                }
                let too_big = std::fs::metadata(&child)
                    .map(|meta| meta.len() > MAX_SEARCH_FILE_BYTES)
                    .unwrap_or(true);
                if too_big {
                    continue;
                }
                files_read += 1;
                self.scan_file(&child, &needle, &mut matches);
            }
            if capped {
                break;
            }
        }

        if matches.is_empty() {
            return Ok(format!(
                "Nothing in the site's code contains \"{query}\". Try fewer words, or the \
exact wording she saw on screen."
            ));
        }
        // Either the walk stopped early, or it filled the answer exactly —
        // both mean "there may well be more", which is what the note says.
        let capped = capped || matches.len() >= MAX_SEARCH_MATCHES;
        matches.truncate(MAX_SEARCH_MATCHES);
        let note = if capped {
            "\n(there are more — narrow the search with path_prefix or a longer phrase)"
        } else {
            ""
        };
        Ok(format!(
            "Lines containing \"{query}\":\n{}{note}",
            matches.join("\n")
        ))
    }

    /// Every matching line in one file, appended as `path:line: text`.
    ///
    /// Silent about files it cannot read or that are not text: a snapshot
    /// holds a few images and a lock file or two, and "could not read" for
    /// each of them would be the whole answer.
    fn scan_file(&self, file: &Path, needle: &str, matches: &mut Vec<String>) {
        let Ok(bytes) = std::fs::read(file) else {
            return;
        };
        let Ok(text) = String::from_utf8(bytes) else {
            return;
        };
        let shown = self.shown(file);
        for (index, line) in text.lines().enumerate() {
            if matches.len() >= MAX_SEARCH_MATCHES {
                return;
            }
            if !line.to_lowercase().contains(needle) {
                continue;
            }
            let line = line.trim();
            // Cut on a character boundary, never a byte one — an em dash is
            // three bytes and this repo's comments are full of them.
            let shortened = if line.chars().count() > MAX_MATCH_LINE {
                format!("{}…", line.chars().take(MAX_MATCH_LINE).collect::<String>())
            } else {
                line.to_string()
            };
            matches.push(format!("{shown}:{}: {shortened}", index + 1));
        }
    }
}

/// Directories and files the tools pretend do not exist.
fn skipped(name: &str) -> bool {
    SKIPPED_DIRS.contains(&name)
}
