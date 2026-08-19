import { ensureOk } from "./http";

/**
 * Reads deployment state from the public, unauthenticated GitHub API to
 * answer "which merged changes are on test but not yet promoted to
 * production?" (the staging-only /whats-on-test page). The repo is
 * public, so no token is needed; the unauthenticated rate limit
 * (60 req/hr/IP) comfortably covers the page's 2-3 requests per load.
 */

const GITHUB_REPO_URL =
  "https://api.github.com/repos/adam26davidson/kari-website";

/** How many recent production deployments to scan for a success status. */
const DEPLOYMENTS_PAGE_SIZE = 10;

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
   * status. Returns null when no scanned deployment ever succeeded.
   */
  static async getLatestProdSha(): Promise<string | null> {
    const response = await fetch(
      `${GITHUB_REPO_URL}/deployments` +
        `?environment=production&per_page=${DEPLOYMENTS_PAGE_SIZE}`,
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
        return deployment.sha;
      }
    }
    return null;
  }

  /**
   * The merged commits on test (`headSha`) but not yet on production
   * (`prodSha`), newest first. Empty when the two are identical.
   */
  static async getPendingCommits(
    prodSha: string,
    headSha: string,
  ): Promise<Array<PendingCommit>> {
    const response = await fetch(
      `${GITHUB_REPO_URL}/compare/${prodSha}...${headSha}`,
    );
    ensureOk(response, "Failed to compare test with production");
    const comparison: GithubCompare = await response.json();
    // The compare API lists commits oldest first; the page shows the
    // most recent merge on top.
    return comparison.commits.map(toPendingCommit).reverse();
  }
}
