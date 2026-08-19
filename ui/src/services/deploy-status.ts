import { ensureOk } from "./http";

/**
 * Reads deployment state from the public, unauthenticated GitHub API to
 * answer "which merged changes are on test but not yet promoted to
 * production?" (the staging-only /admin/whats-on-test page). The repo is
 * public, so no token is needed, but every request counts against the
 * unauthenticated rate limit (60 req/hr/IP) — hence the deliberate scan
 * cap below.
 */

const GITHUB_REPO_URL =
  "https://api.github.com/repos/adam26davidson/kari-website";

/**
 * How many recent production deployments to scan for a success status.
 * Every merge to main creates one production deployment record, and
 * unapproved ones pile up as `waiting`/`error` — so the last success sits
 * one past the pending backlog. Each scanned deployment costs one
 * statuses request, so the cap bounds a page load at SCAN_LIMIT + 2
 * requests worst case against the 60/hr/IP unauthenticated limit. A
 * backlog deeper than the cap yields the honest `indeterminate` result
 * instead of more requests (or the old bug: falsely reporting that no
 * success exists).
 */
export const DEPLOYMENTS_SCAN_LIMIT = 20;

/** A merged change deployed to test but not yet promoted to production. */
export interface PendingCommit {
  sha: string;
  shortSha: string;
  /** Squash-commit subject line, without any trailing " (#N)" suffix. */
  subject: string;
  /** PR number from the squash subject's "(#N)" suffix, if present. */
  prNumber: number | null;
  /** ISO timestamp of the merge (committer date). */
  date: string;
}

/** Outcome of looking for the deployment production currently runs. */
export type ProdDeployLookup =
  /** The newest production deployment that reached `success`. */
  | { kind: "found"; sha: string }
  /** Scanned every production deployment; none ever succeeded. */
  | { kind: "none" }
  /**
   * No success among the newest DEPLOYMENTS_SCAN_LIMIT deployments, but
   * older unscanned ones exist — whether a success exists is unknown.
   */
  | { kind: "indeterminate" };

/** The pending-commit list plus the true size of the compared range. */
export interface PendingCommits {
  /** Newest first. */
  commits: Array<PendingCommit>;
  /**
   * Total commits in the range. GitHub caps the compare response's
   * commit list at 250, oldest first — so when totalCommits exceeds
   * commits.length, the NEWEST merges are the ones missing and callers
   * must surface the truncation rather than present the list as
   * complete.
   */
  totalCommits: number;
}

interface GithubDeployment {
  sha: string;
  statuses_url: string;
}

interface GithubDeploymentStatus {
  state: string;
}

interface GithubCompareCommit {
  sha: string;
  commit: {
    message: string;
    committer: { date: string } | null;
    author: { date: string } | null;
  };
}

interface GithubCompare {
  total_commits: number;
  commits: Array<GithubCompareCommit>;
}

function toPendingCommit(entry: GithubCompareCommit): PendingCommit {
  const subjectLine = entry.commit.message.split("\n", 1)[0];
  const prSuffix = subjectLine.match(/^(.*?)\s*\(#(\d+)\)\s*$/);
  return {
    sha: entry.sha,
    shortSha: entry.sha.slice(0, 7),
    subject: prSuffix ? prSuffix[1] : subjectLine,
    prNumber: prSuffix ? Number(prSuffix[2]) : null,
    // Committer date is the squash-merge time (the author date predates
    // the merge); fall back for the rare commit without a committer.
    date: entry.commit.committer?.date ?? entry.commit.author?.date ?? "",
  };
}

export class DeployStatusService {
  /**
   * The commit currently on production: the sha of the newest deployment
   * to the `production` GitHub Environment that reached a `success`
   * status, scanning at most the newest DEPLOYMENTS_SCAN_LIMIT
   * deployments (see the cap's doc comment for the request budget).
   */
  static async getLatestProdDeploy(): Promise<ProdDeployLookup> {
    const response = await fetch(
      `${GITHUB_REPO_URL}/deployments` +
        `?environment=production&per_page=${DEPLOYMENTS_SCAN_LIMIT}`,
    );
    ensureOk(response, "Failed to fetch production deployments");
    const deployments: Array<GithubDeployment> = await response.json();
    // Deployments come newest first; the first one with a success status
    // is what production currently runs.
    for (const deployment of deployments) {
      const statusesResponse = await fetch(deployment.statuses_url);
      ensureOk(statusesResponse, "Failed to fetch deployment statuses");
      const statuses: Array<GithubDeploymentStatus> =
        await statusesResponse.json();
      if (statuses.some((status) => status.state === "success")) {
        return { kind: "found", sha: deployment.sha };
      }
    }
    // A partial page means GitHub had nothing older to return, so the
    // scan covered every production deployment and none ever succeeded.
    // A full page means older, unscanned deployments exist — one of them
    // may well be the last success, so claiming "none" would be wrong.
    return deployments.length < DEPLOYMENTS_SCAN_LIMIT
      ? { kind: "none" }
      : { kind: "indeterminate" };
  }

  /**
   * The merged commits on test (`headSha`) but not yet on production
   * (`prodSha`), newest first, plus the range's true total (which
   * exceeds the list length when GitHub truncated the compare at 250
   * commits). Empty when the two are identical.
   */
  static async getPendingCommits(
    prodSha: string,
    headSha: string,
  ): Promise<PendingCommits> {
    const response = await fetch(
      `${GITHUB_REPO_URL}/compare/${prodSha}...${headSha}`,
    );
    ensureOk(response, "Failed to compare test with production");
    const comparison: GithubCompare = await response.json();
    // The compare API lists commits oldest first; the page shows the
    // most recent merge on top.
    return {
      commits: comparison.commits.map(toPendingCommit).reverse(),
      totalCommits: comparison.total_commits,
    };
  }
}
