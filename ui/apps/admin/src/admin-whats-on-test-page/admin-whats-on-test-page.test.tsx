import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminWhatsOnTestPage } from "./admin-whats-on-test-page";
import { DeployStatusService } from "@kari/shared/services/deploy-status";
import type { PendingCommit } from "@kari/shared/services/deploy-status";

vi.mock("@kari/shared/services/deploy-status", () => ({
  DEPLOYMENTS_SCAN_LIMIT: 20,
  DeployStatusService: {
    getLatestProdDeploy: vi.fn(),
    getPendingCommits: vi.fn(),
  },
}));

const HEAD_SHA = "bbb2222bbb2222bbb2222bbb2222bbb2222bbb22";
const PROD_SHA = "aaa1111aaa1111aaa1111aaa1111aaa1111aaa11";

const pendingCommits: Array<PendingCommit> = [
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
    prNumber: null,
    date: "2026-08-10T10:00:00Z",
  },
];

describe("AdminWhatsOnTestPage", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_COMMIT_SHA", HEAD_SHA);
    vi.mocked(DeployStatusService.getLatestProdDeploy).mockResolvedValue({
      kind: "found",
      sha: PROD_SHA,
    });
    vi.mocked(DeployStatusService.getPendingCommits).mockResolvedValue({
      commits: pendingCommits,
      totalCommits: pendingCommits.length,
    });
    // The failure paths log via console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders as an admin section with its heading", async () => {
    render(<AdminWhatsOnTestPage />);

    expect(
      screen.getByRole("heading", { level: 2, name: "What's on test" }),
    ).toBeInTheDocument();
  });

  // The standing explanation used to render unconditionally above this
  // note, so off a deployed environment — which is every local build and
  // CI's e2e bundle, i.e. what a reader usually meets — the page promised a
  // list of changes in one paragraph and withdrew it in the next. One
  // paragraph now: context, then the situation (#457, design brief §3).
  // Exact strings, because this test is the spec for the copy.
  const STANDING =
    "Changes that are on the test site but not on the live site yet. Have a " +
    "look at them on the test site before they go live.";
  const OFF_TEST =
    "On the test site, this page lists the changes that are waiting to go " +
    "live, so they can be checked before they reach the live site. This " +
    "isn't the test site, so there's nothing to list here.";

  it("explains the page in one paragraph when the build sha is absent", async () => {
    vi.unstubAllEnvs();

    render(<AdminWhatsOnTestPage />);

    expect(await screen.findByText(OFF_TEST)).toBeInTheDocument();
    // Not alongside a paragraph promising the list it just said is empty.
    expect(screen.queryByText(STANDING)).toBeNull();
    expect(DeployStatusService.getLatestProdDeploy).not.toHaveBeenCalled();
    expect(DeployStatusService.getPendingCommits).not.toHaveBeenCalled();
  });

  it("explains the page as a live one when there is a build sha", async () => {
    render(<AdminWhatsOnTestPage />);

    expect(await screen.findByText(STANDING)).toBeInTheDocument();
    expect(screen.queryByText(OFF_TEST)).toBeNull();
  });

  it("renders the pending commits newest first with PR link, date, and short sha", async () => {
    render(<AdminWhatsOnTestPage />);

    expect(
      await screen.findByText("Change background photo"),
    ).toBeInTheDocument();
    expect(DeployStatusService.getPendingCommits).toHaveBeenCalledWith(
      PROD_SHA,
      HEAD_SHA,
    );

    const prLink = screen.getByRole("link", { name: "#245" });
    expect(prLink).toHaveAttribute(
      "href",
      "https://github.com/adam26davidson/kari-website/pull/245",
    );

    expect(screen.getByText("Fix header overflow")).toBeInTheDocument();
    expect(screen.getByText("d2d2d2d")).toBeInTheDocument();
    expect(screen.getByText("Aug 12, 2026")).toBeInTheDocument();
    // A commit without a PR suffix renders no link.
    expect(screen.queryByRole("link", { name: /#null/ })).toBeNull();
  });

  it("shows which versions the test and live sites are on", async () => {
    render(<AdminWhatsOnTestPage />);

    // The sentence wraps its shas in <code>, so match on the paragraph's
    // combined text rather than a single text node.
    const shaLine = await screen.findByText(
      (_, element) =>
        element?.classList.contains("whats-on-test-shas") ?? false,
    );
    expect(shaLine).toHaveTextContent(
      "The test site is at version bbb2222, the live site at version aaa1111",
    );
  });

  it("shows the empty state without comparing when test and prod are on the same sha", async () => {
    vi.mocked(DeployStatusService.getLatestProdDeploy).mockResolvedValue({
      kind: "found",
      sha: HEAD_SHA,
    });

    render(<AdminWhatsOnTestPage />);

    expect(
      await screen.findByText(
        /the test site and the live site are the same right now/i,
      ),
    ).toBeInTheDocument();
    expect(DeployStatusService.getPendingCommits).not.toHaveBeenCalled();
  });

  it("shows the empty state when the comparison finds no pending commits", async () => {
    vi.mocked(DeployStatusService.getPendingCommits).mockResolvedValue({
      commits: [],
      totalCommits: 0,
    });

    render(<AdminWhatsOnTestPage />);

    expect(
      await screen.findByText(
        /the test site and the live site are the same right now/i,
      ),
    ).toBeInTheDocument();
  });

  it("says so when no successful production deployment exists", async () => {
    vi.mocked(DeployStatusService.getLatestProdDeploy).mockResolvedValue({
      kind: "none",
    });

    render(<AdminWhatsOnTestPage />);

    expect(
      await screen.findByText(/hasn't been published from here yet/i),
    ).toBeInTheDocument();
    expect(DeployStatusService.getPendingCommits).not.toHaveBeenCalled();
  });

  it("distinguishes an indeterminate scan from no-success-exists", async () => {
    vi.mocked(DeployStatusService.getLatestProdDeploy).mockResolvedValue({
      kind: "indeterminate",
    });

    render(<AdminWhatsOnTestPage />);

    expect(
      await screen.findByText(
        /couldn't work out which version the live site is running/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/hasn't been published from here yet/i),
    ).toBeNull();
    expect(DeployStatusService.getPendingCommits).not.toHaveBeenCalled();
  });

  it("warns that the newest changes are missing when GitHub truncated the comparison", async () => {
    vi.mocked(DeployStatusService.getPendingCommits).mockResolvedValue({
      commits: pendingCommits,
      totalCommits: 715,
    });

    render(<AdminWhatsOnTestPage />);

    const warning = await screen.findByText(
      /715 changes are waiting to go live, but only the oldest 2 could be listed/i,
    );
    expect(warning).toHaveTextContent(/most recent ones are missing/i);
    // The (incomplete) list still renders below the warning.
    expect(screen.getByText("Change background photo")).toBeInTheDocument();
  });

  it("does not warn about truncation when the list is complete", async () => {
    render(<AdminWhatsOnTestPage />);

    await screen.findByText("Change background photo");
    expect(screen.queryByText(/could be listed/i)).toBeNull();
  });

  it("shows an error state with retry when the GitHub API fails", async () => {
    vi.mocked(DeployStatusService.getLatestProdDeploy).mockRejectedValueOnce(
      new Error("rate limited"),
    );

    render(<AdminWhatsOnTestPage />);

    expect(
      await screen.findByText("Failed to load what's waiting to go live."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByText("Retry"));
    expect(
      await screen.findByText("Change background photo"),
    ).toBeInTheDocument();
  });

  // jsdom applies no stylesheet, so the shape of the page is read from the
  // CSS. The panel's explanation line was capped at 60ch of 15px text while
  // the notes beneath it ran uncapped at 16px, so two paragraphs on one
  // card broke at visibly different widths — tidy panel, ragged block.
  describe("the panel's prose", () => {
    const css = (path: string) =>
      readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
    const pageCss = css(
      "apps/admin/src/admin-whats-on-test-page/admin-whats-on-test-page.css",
    );

    it.each([["font-size"], ["max-width"]])(
      "sets the notes' %s from the shared admin prose token",
      (property) => {
        const block = pageCss.match(/\.whats-on-test-note\s*\{([^}]*)\}/)?.[1];
        expect(block).toMatch(
          new RegExp(`${property}\\s*:\\s*var\\(--admin-prose-`),
        );
      },
    );

    it("gives the explanation line above them the very same tokens", () => {
      const adminCss = css("apps/admin/src/admin.css");
      const block = adminCss.match(
        /\.admin-section-explanation\s*\{([^}]*)\}/,
      )?.[1];
      expect(block).toMatch(/font-size\s*:\s*var\(--admin-prose-size\)/);
      expect(block).toMatch(/max-width\s*:\s*var\(--admin-prose-measure\)/);
    });
  });
});
