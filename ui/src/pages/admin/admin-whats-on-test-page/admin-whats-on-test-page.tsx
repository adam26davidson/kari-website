import { useCallback } from "react";
import "./admin-whats-on-test-page.css";
import { LoadError } from "../../../components/load-error/load-error";
import { useS3Load } from "../../../hooks/use-s3-load";
import {
  DeployStatusService,
  PendingCommit,
  ProdDeployLookup,
} from "../../../services/deploy-status";

const PR_BASE_URL = "https://github.com/adam26davidson/kari-website/pull";

/** Everything the page needs from GitHub, loaded in one go. */
interface PromotionStatus {
  prod: ProdDeployLookup;
  /** Pending merges, newest first (empty unless prod.kind is "found"). */
  commits: Array<PendingCommit>;
  /** True size of the pending range; > commits.length when truncated. */
  totalCommits: number;
}

const EMPTY_STATUS: PromotionStatus = {
  prod: { kind: "none" },
  commits: [],
  totalCommits: 0,
};

async function loadStatus(headSha: string): Promise<PromotionStatus> {
  const prod = await DeployStatusService.getLatestProdDeploy();
  if (prod.kind !== "found" || prod.sha === headSha) {
    return { prod, commits: [], totalCommits: 0 };
  }
  const pending = await DeployStatusService.getPendingCommits(
    prod.sha,
    headSha,
  );
  return { prod, ...pending };
}

function formatDate(isoDate: string): string {
  // Fixed locale and UTC keep the rendering (and tests) deterministic;
  // day-level precision doesn't warrant timezone conversion.
  return new Date(isoDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function PendingCommitItem({ commit }: { commit: PendingCommit }) {
  return (
    <li className="whats-on-test-commit">
      <span className="whats-on-test-subject">{commit.subject}</span>
      {commit.prNumber !== null && (
        <a
          className="whats-on-test-pr-link"
          href={`${PR_BASE_URL}/${commit.prNumber}`}
          target="_blank"
          rel="noreferrer"
        >
          #{commit.prNumber}
        </a>
      )}
      <span className="whats-on-test-meta">
        <span>{formatDate(commit.date)}</span>
        <code>{commit.shortSha}</code>
      </span>
    </li>
  );
}

/**
 * Staging-only admin section (menu entry and route registered only when
 * VITE_SHOW_TEST_STATUS is "true", i.e. in the .env.staging / .env.test
 * builds): lists the merged changes deployed to test but not yet promoted
 * to production, so pending work can be checked on test before approving
 * the prod deploy.
 */
export function AdminWhatsOnTestPage() {
  // Baked in by deploy.yml; absent in local dev and test-mode builds.
  const headSha = import.meta.env.VITE_COMMIT_SHA;
  const fetcher = useCallback(
    () => (headSha ? loadStatus(headSha) : Promise.resolve(EMPTY_STATUS)),
    [headSha],
  );
  const { data, isLoading, loadFailed, load } = useS3Load(
    fetcher,
    EMPTY_STATUS,
  );
  const truncated = data.totalCommits > data.commits.length;

  return (
    <div className="admin-whats-on-test-page">
      <h2 className="admin-section-heading">What&apos;s on test</h2>
      <p className="admin-section-explanation">
        Changes that are on the test site but not on the live site yet. Have a
        look at them on the test site before they go live.
      </p>
      {!headSha && (
        // No VITE_COMMIT_SHA is baked in, which is the normal case outside
        // a deployed environment (local dev, the test-mode bundle) — there
        // is no version to compare against, so say that rather than name
        // the build variable.
        <p className="whats-on-test-note">
          This isn&apos;t the test site, so there&apos;s nothing to compare. On
          the test site, this page lists what&apos;s waiting to go live.
        </p>
      )}
      {headSha && isLoading && <div className="loading">Loading...</div>}
      {headSha && !isLoading && loadFailed && (
        <LoadError
          message="Failed to load what's waiting to go live."
          onRetry={load}
        />
      )}
      {headSha && !isLoading && !loadFailed && (
        <>
          {data.prod.kind === "none" && (
            <p className="whats-on-test-note">
              The live site hasn&apos;t been published from here yet, so
              everything on the test site is waiting to go live.
            </p>
          )}
          {data.prod.kind === "indeterminate" && (
            // The live site doesn't report its own version yet (that
            // arrives with the next promotion) and the GitHub fallback
            // found no promoted deployment among the newest
            // DEPLOYMENTS_SCAN_LIMIT — the rest are unpromoted candidates,
            // not failures — without scanning older ones, each of which
            // costs a GitHub API request against a 60/hour limit.
            <p className="whats-on-test-note">
              Couldn&apos;t work out which version the live site is running.
              This sorts itself out the next time changes go live.
            </p>
          )}
          {data.prod.kind === "found" && data.commits.length === 0 && (
            <p className="whats-on-test-note">
              The test site and the live site are the same right now —
              nothing is waiting to go live.
            </p>
          )}
          {truncated && (
            <p className="whats-on-test-warning">
              {data.totalCommits} changes are waiting to go live, but only the
              oldest {data.commits.length} could be listed — the most recent
              ones are missing from the list below.
            </p>
          )}
          {data.commits.length > 0 && (
            <ul className="whats-on-test-list">
              {data.commits.map((commit) => (
                <PendingCommitItem key={commit.sha} commit={commit} />
              ))}
            </ul>
          )}
          <p className="whats-on-test-shas">
            <span>
              The test site is at version <code>{headSha.slice(0, 7)}</code>
            </span>
            {data.prod.kind === "found" && (
              <span>
                , the live site at version{" "}
                <code>{data.prod.sha.slice(0, 7)}</code>
              </span>
            )}
          </p>
        </>
      )}
    </div>
  );
}
