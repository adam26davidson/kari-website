import { useCallback } from "react";
import "./admin-whats-on-test-page.css";
import { LoadError } from "../../../components/load-error/load-error";
import { useS3Load } from "../../../hooks/use-s3-load";
import {
  DEPLOYMENTS_SCAN_LIMIT,
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
      <h2>What&apos;s on test</h2>
      <p className="whats-on-test-explanation">
        Merged changes deployed to test but not yet promoted to production —
        what to check on test before approving the prod deploy.
      </p>
      {!headSha && (
        <p className="whats-on-test-note">
          Unknown build — comparison unavailable. This build has no
          VITE_COMMIT_SHA baked in (expected outside deployed environments).
        </p>
      )}
      {headSha && isLoading && <div className="loading">Loading...</div>}
      {headSha && !isLoading && loadFailed && (
        <LoadError
          message="Failed to load deployment status."
          onRetry={load}
        />
      )}
      {headSha && !isLoading && !loadFailed && (
        <>
          {data.prod.kind === "none" && (
            <p className="whats-on-test-note">
              No successful production deployment found — everything on test
              is awaiting promotion.
            </p>
          )}
          {data.prod.kind === "indeterminate" && (
            <p className="whats-on-test-note">
              Couldn&apos;t determine what production is running: none of the
              newest {DEPLOYMENTS_SCAN_LIMIT} production deployments ever
              succeeded, and older ones weren&apos;t scanned (each scan is a
              GitHub API request against a 60/hour limit). The pending list
              can&apos;t be computed.
            </p>
          )}
          {data.prod.kind === "found" && data.commits.length === 0 && (
            <p className="whats-on-test-note">
              test == prod — nothing awaiting promotion.
            </p>
          )}
          {truncated && (
            <p className="whats-on-test-warning">
              {data.totalCommits} commits are pending, but GitHub&apos;s
              comparison returned only the oldest {data.commits.length} — the
              most recent merges are not listed below.
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
              Test is at <code>{headSha.slice(0, 7)}</code>
            </span>
            {data.prod.kind === "found" && (
              <span>
                , production is at <code>{data.prod.sha.slice(0, 7)}</code>
              </span>
            )}
          </p>
        </>
      )}
    </div>
  );
}
