import { describe, it, expect, vi } from "vitest";
import { DeployStatusService } from "./deploy-status";
import { HttpError } from "./http-error";
import { setupServiceTestHooks } from "./test-helpers";

const DEPLOYMENTS_URL =
  "https://api.github.com/repos/adam26davidson/kari-website/deployments" +
  "?environment=production&per_page=10";
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

describe("DeployStatusService.getLatestProdSha", () => {
  it("returns the sha of the newest deployment with a success status", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: async () => [deployment("headsha", 2)] },
      { ok: true, json: async () => [{ state: "success" }] },
    ]);

    const result = await DeployStatusService.getLatestProdSha();

    expect(result).toBe("headsha");
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

    expect(await DeployStatusService.getLatestProdSha()).toBe("goodsha");
  });

  it("returns null when no deployment has a success status", async () => {
    mockFetchSequence([
      { ok: true, json: async () => [deployment("failedsha", 3)] },
      { ok: true, json: async () => [{ state: "error" }] },
    ]);

    expect(await DeployStatusService.getLatestProdSha()).toBeNull();
  });

  it("returns null when there are no production deployments", async () => {
    mockFetchSequence([{ ok: true, json: async () => [] }]);

    expect(await DeployStatusService.getLatestProdSha()).toBeNull();
  });

  it("throws an HttpError when the deployments fetch fails", async () => {
    mockFetchSequence([{ ok: false, status: 403 }]);

    await expect(DeployStatusService.getLatestProdSha()).rejects.toThrow(
      HttpError,
    );
  });

  it("throws an HttpError when a statuses fetch fails", async () => {
    mockFetchSequence([
      { ok: true, json: async () => [deployment("headsha", 2)] },
      { ok: false, status: 500 },
    ]);

    await expect(DeployStatusService.getLatestProdSha()).rejects.toThrow(
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
    expect(result).toEqual([
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
    ]);
  });

  it("keeps the full subject and null prNumber when there is no (#N) suffix", async () => {
    mockFetchSequence([
      {
        ok: true,
        json: async () => ({
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

    expect(result).toEqual([
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

    expect(result[0].date).toBe("2026-08-01T00:00:00Z");
  });

  it("returns an empty list when test and prod are identical", async () => {
    mockFetchSequence([{ ok: true, json: async () => ({ commits: [] }) }]);

    expect(
      await DeployStatusService.getPendingCommits("aaa1111", "bbb2222"),
    ).toEqual([]);
  });

  it("throws an HttpError when the compare fetch fails", async () => {
    mockFetchSequence([{ ok: false, status: 404 }]);

    await expect(
      DeployStatusService.getPendingCommits("aaa1111", "bbb2222"),
    ).rejects.toThrow(HttpError);
  });
});
