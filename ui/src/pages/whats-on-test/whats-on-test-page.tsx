import { useCallback } from "react";
import "./whats-on-test-page.css";
import { LoadError } from "../../components/load-error/load-error";
import { useS3Load } from "../../hooks/use-s3-load";
import {
  DeployStatusService,
  PendingCommit,
} from "../../services/deploy-status";

const PR_BASE_URL = "https://github.com/adam26davidson/kari-website/pull";

/** Everything the page needs from GitHub, loaded in one go. */
interface PromotionStatus {
  /** Sha currently on production; null when none ever succeeded. */
  prodSha: string | null;
  commits: Array<PendingCommit>;
}

const EMPTY_STATUS: PromotionStatus = { prodSha: null, commits: [] };

async function loadStatus(headSha: string): Promise<PromotionStatus> {
  const prodSha = await DeployStatusService.getLatestProdSha();
  if (prodSha === null || prodSha === headSha) {
    return { prodSha, commits: [] };
  }
  return {
    prodSha,
    commits: await DeployStatusService.getPendingCommits(prodSha, headSha),
  };
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
 * Staging-only page (route registered only when VITE_SHOW_TEST_STATUS is
 * "true", i.e. in the .env.staging / .env.test builds): lists the merged
 * changes deployed to test but not yet promoted to production, so pending
 * work can be checked on test before approving the prod deploy.
 */
export function WhatsOnTestPage() {
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

  return (
    <div className="whats-on-test-page">
      <div className="whats-on-test-card">
        <h1>What&apos;s on test</h1>
        {!headSha && (
          <p className="whats-on-test-note">
            Unknown build — comparison unavailable. This build has no
            VITE_COMMIT_SHA baked in (expected outside deployed
            environments).
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
            {data.prodSha === null && (
              <p className="whats-on-test-note">
                No successful production deployment found — everything on
                test is awaiting promotion.
              </p>
            )}
            {data.prodSha !== null && data.commits.length === 0 && (
              <p className="whats-on-test-note">
                test == prod — nothing awaiting promotion.
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
              {data.prodSha !== null && (
                <span>
                  , production is at <code>{data.prodSha.slice(0, 7)}</code>
                </span>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
