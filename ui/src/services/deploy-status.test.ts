import { describe, it, expect, vi } from "vitest";
import { DeployStatusService, DEPLOYMENTS_SCAN_LIMIT } from "./deploy-status";
import { HttpError } from "./http-error";
import { setupServiceTestHooks } from "./test-helpers";

const DEPLOYMENTS_URL =
  "https://api.github.com/repos/adam26davidson/kari-website/deployments" +
  `?environment=production&per_page=${DEPLOYMENTS_SCAN_LIMIT}`;
const COMPARE_URL =
  "https://api.github.com/repos/adam26davidson/kari-website/compare/" +
  "aaa1111...bbb2222";

setupServiceTestHooks();

/**
 * Stubs global fetch with a sequence of responses (one per call, in
 * order) and returns the mock for call assertions.
 */
function mockFetchSequence(
  responses: Array<Partial<Response> & { json?: () => Promise<unknown> }>,
) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function deployment(sha: string, id: number) {
  return {
    sha,
    statuses_url: `https://api.github.com/repos/adam26davidson/kari-website/deployments/${id}/statuses`,
  };
}

/** A statuses response for a deployment that never got approved. */
const waiting = { ok: true, json: async () => [{ state: "waiting" }] };

describe("DeployStatusService.getLatestProdDeploy", () => {
  it("returns the sha of the newest deployment with a success status", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: async () => [deployment("headsha", 2)] },
      { ok: true, json: async () => [{ state: "success" }] },
    ]);

    const result = await DeployStatusService.getLatestProdDeploy();

    expect(result).toEqual({ kind: "found", sha: "headsha" });
    expect(fetchMock).toHaveBeenNthCalledWith(1, DEPLOYMENTS_URL);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/adam26davidson/kari-website/deployments/2/statuses",
    );
  });

  it("skips deployments that never reached success", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: async () => [deployment("failedsha", 3), deployment("goodsha", 2)],
      },
      // newest deployment: rejected/failed, never succeeded
      { ok: true, json: async () => [{ state: "failure" }, { state: "in_progress" }] },
      // older deployment: succeeded
      { ok: true, json: async () => [{ state: "success" }] },
    ]);

    expect(await DeployStatusService.getLatestProdDeploy()).toEqual({
      kind: "found",
      sha: "goodsha",
    });
  });

  it("still finds a success older than 10 deployments (one merge per deferred promotion)", async () => {
    // 12 unapproved merges piled up before the last promoted one — the
    // exact situation the page exists for. A 10-deployment scan (the old
    // page size) would miss the success entirely.
    const deployments = Array.from({ length: 12 }, (_, i) =>
      deployment(`pending${i}`, 20 - i),
    ).concat([deployment("promotedsha", 7)]);
    mockFetchSequence([
      { ok: true, json: async () => deployments },
      ...deployments.slice(0, 12).map(() => waiting),
      { ok: true, json: async () => [{ state: "success" }] },
    ]);

    expect(await DeployStatusService.getLatestProdDeploy()).toEqual({
      kind: "found",
      sha: "promotedsha",
    });
  });

  it("returns 'none' when every existing deployment failed to succeed", async () => {
    // A partial page means GitHub had nothing older to return, so the
    // scan really covered every production deployment.
    mockFetchSequence([
      { ok: true, json: async () => [deployment("failedsha", 3)] },
      { ok: true, json: async () => [{ state: "error" }] },
    ]);

    expect(await DeployStatusService.getLatestProdDeploy()).toEqual({
      kind: "none",
    });
  });

  it("returns 'none' when there are no production deployments", async () => {
    mockFetchSequence([{ ok: true, json: async () => [] }]);

    expect(await DeployStatusService.getLatestProdDeploy()).toEqual({
      kind: "none",
    });
  });

  it("returns 'indeterminate' instead of 'none' when the scan cap is hit with older deployments unscanned", async () => {
    // A full page without a success: the success (if any) is further back
    // than the deliberate scan cap, and saying "none exists" would be a
    // lie. The cap keeps the worst case at DEPLOYMENTS_SCAN_LIMIT + 1
    // unauthenticated requests against GitHub's 60/hr/IP limit.
    const fullPage = Array.from({ length: DEPLOYMENTS_SCAN_LIMIT }, (_, i) =>
      deployment(`pending${i}`, 100 - i),
    );
    const fetchMock = mockFetchSequence([
      { ok: true, json: async () => fullPage },
      ...fullPage.map(() => waiting),
    ]);

    expect(await DeployStatusService.getLatestProdDeploy()).toEqual({
      kind: "indeterminate",
    });
    // The scan never goes past one page: total requests stay bounded.
    expect(fetchMock).toHaveBeenCalledTimes(DEPLOYMENTS_SCAN_LIMIT + 1);
  });

  it("throws an HttpError when the deployments fetch fails", async () => {
    mockFetchSequence([{ ok: false, status: 403 }]);

    await expect(DeployStatusService.getLatestProdDeploy()).rejects.toThrow(
      HttpError,
    );
  });

  it("throws an HttpError when a statuses fetch fails", async () => {
    mockFetchSequence([
      { ok: true, json: async () => [deployment("headsha", 2)] },
      { ok: false, status: 500 },
    ]);

    await expect(DeployStatusService.getLatestProdDeploy()).rejects.toThrow(
      HttpError,
    );
  });
});

describe("DeployStatusService.getPendingCommits", () => {
  it("maps compare commits to pending commits, newest first", async () => {
    const fetchMock = mockFetchSequence([
      {
        ok: true,
        json: async () => ({
          total_commits: 2,
          commits: [
            {
              sha: "c1c1c1c1c1c1c1c1",
              commit: {
                message:
                  "Fix header overflow (#226)\n\nLonger body text here.",
                committer: { date: "2026-08-10T10:00:00Z" },
                author: { date: "2026-08-09T09:00:00Z" },
              },
            },
            {
              sha: "d2d2d2d2d2d2d2d2",
              commit: {
                message: "Change background photo (#245)",
                committer: { date: "2026-08-12T12:00:00Z" },
                author: { date: "2026-08-11T11:00:00Z" },
              },
            },
          ],
        }),
      },
    ]);

    const result = await DeployStatusService.getPendingCommits(
      "aaa1111",
      "bbb2222",
    );

    expect(fetchMock).toHaveBeenCalledWith(COMPARE_URL);
    expect(result).toEqual({
      totalCommits: 2,
      commits: [
        {
          sha: "d2d2d2d2d2d2d2d2",
          shortSha: "d2d2d2d",
          subject: "Change background photo",
          prNumber: 245,
          date: "2026-08-12T12:00:00Z",
        },
        {
          sha: "c1c1c1c1c1c1c1c1",
          shortSha: "c1c1c1c",
          subject: "Fix header overflow",
          prNumber: 226,
          date: "2026-08-10T10:00:00Z",
        },
      ],
    });
  });

  it("reports the real total when GitHub truncates the commit list at 250", async () => {
    // Compare responses cap `commits` at 250, oldest first — so the
    // NEWEST merges are the ones missing. totalCommits > commits.length
    // is how callers detect (and must surface) the truncation.
    const truncated = Array.from({ length: 250 }, (_, i) => ({
      sha: `sha${i}`.padEnd(16, "0"),
      commit: {
        message: `Old merge ${i} (#${i})`,
        committer: { date: "2026-01-01T00:00:00Z" },
        author: { date: "2026-01-01T00:00:00Z" },
      },
    }));
    mockFetchSequence([
      {
        ok: true,
        json: async () => ({ total_commits: 715, commits: truncated }),
      },
    ]);

    const result = await DeployStatusService.getPendingCommits(
      "aaa1111",
      "bbb2222",
    );

    expect(result.totalCommits).toBe(715);
    expect(result.commits).toHaveLength(250);
    // Still newest-of-the-returned first.
    expect(result.commits[0].subject).toBe("Old merge 249");
  });

  it("keeps the full subject and null prNumber when there is no (#N) suffix", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: async () => ({
          total_commits: 1,
          commits: [
            {
              sha: "e3e3e3e3e3e3e3e3",
              commit: {
                message: "Direct push without a PR",
                committer: { date: "2026-08-13T08:00:00Z" },
                author: { date: "2026-08-13T08:00:00Z" },
              },
            },
          ],
        }),
      },
    ]);

    const result = await DeployStatusService.getPendingCommits(
      "aaa1111",
      "bbb2222",
    );

    expect(result.commits).toEqual([
      {
        sha: "e3e3e3e3e3e3e3e3",
        shortSha: "e3e3e3e",
        subject: "Direct push without a PR",
        prNumber: null,
        date: "2026-08-13T08:00:00Z",
      },
    ]);
  });

  it("falls back to the author date when the committer is missing", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: async () => ({
          total_commits: 1,
          commits: [
            {
              sha: "f4f4f4f4f4f4f4f4",
              commit: {
                message: "Imported commit (#9)",
                committer: null,
                author: { date: "2026-08-01T00:00:00Z" },
              },
            },
          ],
        }),
      },
    ]);

    const result = await DeployStatusService.getPendingCommits(
      "aaa1111",
      "bbb2222",
    );

    expect(result.commits[0].date).toBe("2026-08-01T00:00:00Z");
  });

  it("returns an empty list when test and prod are identical", async () => {
    mockFetchSequence([
      { ok: true, json: async () => ({ total_commits: 0, commits: [] }) },
    ]);

    expect(
      await DeployStatusService.getPendingCommits("aaa1111", "bbb2222"),
    ).toEqual({ totalCommits: 0, commits: [] });
  });

  it("throws an HttpError when the compare fetch fails", async () => {
    mockFetchSequence([{ ok: false, status: 404 }]);

    await expect(
      DeployStatusService.getPendingCommits("aaa1111", "bbb2222"),
    ).rejects.toThrow(HttpError);
  });
});
