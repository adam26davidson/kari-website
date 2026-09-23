import { useCallback } from "react";
import { LoadError } from "../components/load-error/load-error";
import { useS3Load } from "@kari/shared/hooks/use-s3-load";
import {
  DeployStatusService,
  PendingCommit,
  ProdDeployLookup,
} from "@kari/shared/services/deploy-status";
import { Card } from "../components/ui/card";
import { PageTitle } from "../components/page-title/page-title";

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

/**
 * One change waiting to go live, drawn like a row of a migrated list
 * (components/item-list): what changed on the left in Ink, the date and
 * short version faded beside it, a hairline between rows.
 *
 * Stacked on a phone and one line from `sm` up, so at 390px the date and
 * version never fight the subject for the same line.
 */
function PendingCommitItem({ commit }: { commit: PendingCommit }) {
  return (
    // `whats-on-test-commit` and the hook classes below are not styling —
    // no rule targets them anywhere. They are how the e2e journeys find a
    // row (e2e/admin-whats-on-test.spec.ts), the same arrangement
    // components/item-list makes for `admin-data-list-item`.
    <li className="whats-on-test-commit flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-x-3">
      <span className="text-foreground font-sans text-sm font-medium">
        {commit.subject}
      </span>
      {commit.prNumber !== null && (
        // Maroon, because it links out of the admin to GitHub.
        <a
          className="whats-on-test-pr-link text-accent font-sans text-sm hover:underline"
          href={`${PR_BASE_URL}/${commit.prNumber}`}
          target="_blank"
          rel="noreferrer"
        >
          #{commit.prNumber}
        </a>
      )}
      <span className="text-muted-foreground flex gap-x-3 font-sans text-xs whitespace-nowrap sm:ml-auto">
        <span>{formatDate(commit.date)}</span>
        <code className="font-mono">{commit.shortSha}</code>
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
 *
 * Tailwind/shadcn like every other admin section since #841: the page
 * title over its brush stroke, one quiet line saying what the page is for,
 * and — on the test site — a single white card holding the list. No design
 * board was ever drawn for this page (docs/design/admin-redesign covers the
 * seven production sections); the layout is derived from `Cleanup.png`, the
 * other one-card page, with the list rows drawn like `HaikuList.png`'s.
 * Unlike Cleanup there is no primary button: the page is read-only and its
 * one "action" is looking at the test site.
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
    // `admin-whats-on-test-page` is the section hook the e2e spec scopes
    // every locator to; nothing styles it.
    <div className="admin-whats-on-test-page mx-auto flex w-full max-w-[760px] flex-col gap-7">
      <PageTitle>What&apos;s on test</PageTitle>
      {headSha && (
        <p className="text-muted-foreground font-sans text-sm leading-relaxed">
          Changes that are on the test site but not on the live site yet. Have
          a look at them on the test site before they go live.
        </p>
      )}
      {!headSha && (
        // No VITE_COMMIT_SHA is baked in, which is the normal case outside
        // a deployed environment (local dev, the test-mode bundle) — there
        // is no version to compare against, so say that rather than name
        // the build variable.
        //
        // One paragraph, not two. The standing explanation used to render
        // unconditionally above this note, so the page promised a list of
        // changes in one breath and withdrew it in the next — and this is
        // the state every non-deployed build is in, so it is what a reader
        // usually meets. Context first, then the situation (#457, design
        // brief §3).
        <p className="text-muted-foreground font-sans text-sm leading-relaxed">
          On the test site, this page lists the changes that are waiting to go
          live, so they can be checked before they reach the live site. This
          isn&apos;t the test site, so there&apos;s nothing to list here.
        </p>
      )}
      {headSha && isLoading && (
        // A quiet line, not the shared `.loading` card: that one is the
        // public site's white panel with a black drop shadow, and it drops
        // 80px down the paper.
        <p className="text-muted-foreground font-sans text-sm">Loading...</p>
      )}
      {headSha && !isLoading && loadFailed && (
        <LoadError
          message="Failed to load what's waiting to go live."
          onRetry={load}
        />
      )}
      {headSha && !isLoading && !loadFailed && (
        <Card className="flex flex-col gap-4 p-5 sm:p-6">
          {data.prod.kind === "none" && (
            <p className="whats-on-test-note text-foreground font-sans text-sm leading-relaxed">
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
            <p className="whats-on-test-note text-foreground font-sans text-sm leading-relaxed">
              Couldn&apos;t work out which version the live site is running.
              This sorts itself out the next time changes go live.
            </p>
          )}
          {data.prod.kind === "found" && data.commits.length === 0 && (
            <p className="whats-on-test-note text-foreground font-sans text-sm leading-relaxed">
              The test site and the live site are the same right now —
              nothing is waiting to go live.
            </p>
          )}
          {truncated && (
            // The admin's one danger colour, filled — the same treatment
            // image cleanup's error block, the error toast and the
            // confirmed-destructive button wear.
            <p
              role="alert"
              className="bg-destructive text-destructive-foreground rounded-lg px-4 py-3 font-sans text-sm [overflow-wrap:anywhere]"
            >
              {data.totalCommits} changes are waiting to go live, but only the
              oldest {data.commits.length} could be listed — the most recent
              ones are missing from the list below.
            </p>
          )}
          {data.commits.length > 0 && (
            <ul className="whats-on-test-list divide-border m-0 flex list-none flex-col divide-y p-0">
              {data.commits.map((commit) => (
                <PendingCommitItem key={commit.sha} commit={commit} />
              ))}
            </ul>
          )}
          <p className="whats-on-test-shas text-muted-foreground font-sans text-xs">
            <span>
              The test site is at version{" "}
              <code className="font-mono">{headSha.slice(0, 7)}</code>
            </span>
            {data.prod.kind === "found" && (
              <span>
                , the live site at version{" "}
                <code className="font-mono">{data.prod.sha.slice(0, 7)}</code>
              </span>
            )}
          </p>
        </Card>
      )}
    </div>
  );
}
