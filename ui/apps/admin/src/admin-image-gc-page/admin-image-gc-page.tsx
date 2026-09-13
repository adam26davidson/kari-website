import { useState } from "react";
import { Check, ChevronRight, Trash2 } from "lucide-react";
import { useAdminToken } from "../hooks/use-admin-token";
import { GcImage, GcReport, ImageService } from "@kari/shared/services/images";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { PageTitle } from "../components/page-title/page-title";
import { useAdminUi } from "../admin-ui-context";
import { apiImageUrl } from "@kari/shared/utils/image-management-helpers";

/**
 * One image's picture, fetched at thumbnail size like every other admin
 * grid. A picture that will not load leaves a quiet tile rather than the
 * browser's broken-image icon (#495).
 *
 * 64px square, the size the boards draw these tiles at
 * (docs/design/admin-redesign/Cleanup.png). The tint under it is the
 * admin's own muted cream, so a row of tiles doesn't flash white while the
 * thumbnails arrive.
 */
function ImageThumbnail({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="border-border text-muted-foreground flex size-16 items-center justify-center rounded-md border border-dashed p-1 text-center font-sans text-[11px] leading-tight">
        Couldn&apos;t show this picture
      </div>
    );
  }

  return (
    <img
      className="bg-muted size-16 rounded-md object-cover"
      src={apiImageUrl(id, "thumb")}
      // The stored name is a uuid and means nothing to her, so it stays out
      // of the page; as alt text it is still the only thing that tells two
      // otherwise identical tiles apart for a screen reader.
      alt={id}
      loading="lazy"
      decoding="async"
      width={64}
      height={64}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * One collapsible group of the report, drawn as the boards draw it: a
 * hairline panel whose header is the group's name, its count in the muted
 * tone beside it, and a chevron that turns a quarter-turn when the panel
 * is open.
 *
 * A native `<details>` rather than a Radix accordion: it is already a
 * keyboard-operable disclosure with the right semantics, it needs no new
 * dependency, and closed content stays out of the render — which is what
 * keeps 40-odd "still in use" thumbnails from being fetched before she has
 * asked to see them.
 *
 * `open` is the state the group STARTS in. The boards open the group the
 * page is about (the pictures a sweep would remove) and leave the two kept
 * groups folded away, so what she came to check is the only thing on
 * screen; toggling any of them afterwards is hers to do and React does not
 * take it back.
 *
 * `removed` marks the group whose objects a real run has just deleted:
 * their thumbnails are gone from storage, so the list says so instead of
 * asking for pictures that cannot come back.
 *
 * `run` identifies the report these images came from; see the thumbnail
 * key below.
 */
function ImageList({
  title,
  images,
  run,
  open = false,
  removed = false,
}: {
  title: string;
  images: Array<GcImage>;
  run: number;
  open?: boolean;
  removed?: boolean;
}) {
  return (
    <details
      open={open}
      className="border-border group rounded-lg border bg-transparent"
    >
      {/* `list-none` plus the webkit marker rule: the disclosure triangle
          is replaced by the boards' chevron on the right, and Safari draws
          its own marker through a pseudo-element that `list-style` alone
          does not reach. */}
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-foreground font-sans text-sm font-medium">
          {title}{" "}
          <span className="text-muted-foreground font-normal">
            ({images.length})
          </span>
        </span>
        {/* Decorative: `<summary>` already announces itself as expandable
            and says which way it is. */}
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="px-4 pb-4">
        {images.length === 0 ? (
          <p className="text-muted-foreground font-sans text-sm">
            Nothing here.
          </p>
        ) : removed ? (
          <p className="text-muted-foreground font-sans text-sm">
            These pictures are no longer in storage, so there is nothing left
            to show.
          </p>
        ) : (
          <ul className="flex list-none flex-wrap gap-2 p-0">
            {images.map((image) => (
              <li key={image.id} className="leading-[0]">
                {/*
                  Keyed by the run so a new report starts each tile over: the
                  placeholder invites her to preview again, and a failure
                  remembered from the previous report would make that
                  invitation a no-op.
                */}
                <ImageThumbnail key={run} id={image.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/** Picks the wording that agrees with a count, so "1" never reads wrong. */
const agree = (count: number, one: string, many: string) =>
  count === 1 ? one : many;

/** "1 unused image" / "3 unused images" — what the delete button offers. */
const countOfImages = (count: number) =>
  `${count} ${agree(count, "unused image", "unused images")}`;

/** "1 picture" / "3 pictures" — the word the summary speaks in. */
const countOfPictures = (count: number) =>
  `${count} ${agree(count, "picture", "pictures")}`;

/**
 * What a preview found, in the plain two-sentence shape the boards draw:
 * the number that matters in bold, the two kept groups in one aside, and a
 * bold reassurance that looking has changed nothing.
 *
 * The kept sentence is only written when there is something to keep — "0
 * are still in use and 0 were uploaded in the last hour — those are all
 * kept" is a machine reciting empty buckets at her.
 */
function PreviewSummary({ report }: { report: GcReport }) {
  const unused = report.orphaned.length;
  const inUse = report.referenced.length;
  const recent = report.skipped_recent.length;

  return (
    <p className="text-foreground font-sans text-sm leading-relaxed">
      {unused === 0 ? (
        <>
          Preview: every picture is still used by a page, so there is{" "}
          <strong className="font-medium">nothing to clean up</strong>.{" "}
        </>
      ) : (
        <>
          Preview:{" "}
          <strong className="font-medium">{countOfPictures(unused)}</strong>{" "}
          {agree(unused, "is", "are")} no longer used by any page and can be
          deleted.{" "}
        </>
      )}
      {inUse + recent > 0 && (
        <>
          {inUse} {agree(inUse, "is", "are")} still in use and {recent}{" "}
          {agree(recent, "was", "were")} uploaded in the last hour — those are
          all kept.{" "}
        </>
      )}
      <strong className="font-medium">
        Nothing has been deleted{unused === 0 ? "" : " yet"}.
      </strong>
    </p>
  );
}

export function AdminImageGcPage() {
  const getAccessTokenSilently = useAdminToken();
  const { showLoading, hideLoading, confirm, notify } = useAdminUi();
  const [report, setReport] = useState<GcReport | null>(null);
  // Counts the reports that have arrived, so each one is a distinct render
  // of the same image ids. Without it React keeps the previous report's
  // thumbnails (same `key`, same position) along with any load failure they
  // remembered, and re-previewing — the page's only refresh — would leave a
  // picture that loads fine now stuck behind its placeholder.
  const [run, setRun] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const runGc = async (dryRun: boolean) => {
    showLoading(
      dryRun ? "Previewing image cleanup..." : "Deleting unused images...",
    );
    setError(null);
    try {
      const result = await ImageService.gc(dryRun, getAccessTokenSilently);
      setReport(result);
      setRun((previous) => previous + 1);
      if (!dryRun) {
        notify(`Deleted ${countOfImages(result.deleted.length)}`);
      }
    } catch (e) {
      console.error(e);
      // Keep the failure visible on the page (the toast disappears); a
      // stale report from before the failure must not look current.
      setReport(null);
      setError(e instanceof Error ? e.message : "Image cleanup failed");
      notify("Image cleanup failed", "error");
    } finally {
      hideLoading();
    }
  };

  const onDeleteUnused = () => {
    if (!report) return;
    confirm(
      `This will permanently delete ${countOfImages(report.orphaned.length)}` +
        " from storage. This cannot be undone. Do you want to continue?",
      () => runGc(false),
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7">
      <PageTitle>Image cleanup</PageTitle>
      <p className="text-muted-foreground font-sans text-sm leading-relaxed">
        Finds pictures no page of the site uses any more, so storage stays
        tidy. Previewing never deletes anything, and pictures uploaded in the
        last hour are always kept.
      </p>
      <Button onClick={() => runGc(true)}>Preview cleanup</Button>
      {error && (
        // The admin's one danger colour, filled — the same treatment the
        // error toast and the confirmed-destructive button wear, so "this
        // did not work" is one colour wherever it appears. `anywhere`
        // because the server's message can carry an unbreakable id or URL.
        <div
          role="alert"
          className="bg-destructive text-destructive-foreground rounded-lg px-4 py-3 font-sans text-sm [overflow-wrap:anywhere]"
        >
          {error}
          <p className="mt-1.5">
            Nothing further was deleted. Try previewing again in a moment.
          </p>
        </div>
      )}
      {report && (
        <Card className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-row items-start gap-3">
            {/* Decorative: the sentence beside it says everything this
                tick says, and then some. */}
            <Check
              aria-hidden="true"
              className="text-primary mt-0.5 size-4 shrink-0"
            />
            {report.dry_run ? (
              <PreviewSummary report={report} />
            ) : (
              <p className="text-foreground font-sans text-sm leading-relaxed">
                Deleted{" "}
                <strong className="font-medium">
                  {countOfImages(report.deleted.length)}
                </strong>
                .
              </p>
            )}
          </div>
          {report.dry_run && report.orphaned.length > 0 && (
            // The one screen in the admin where destroying IS the point,
            // so the maroon is filled here rather than outlined — the
            // boards draw it that way and the design brief allows it (§2).
            <Button variant="danger" onClick={onDeleteUnused}>
              <Trash2 />
              Delete {countOfImages(report.orphaned.length)}
            </Button>
          )}
          <div className="flex flex-col gap-3">
            {report.dry_run ? (
              <ImageList
                title="No longer used — would be deleted"
                images={report.orphaned}
                run={run}
                open
              />
            ) : (
              <ImageList
                title="Deleted"
                images={report.deleted}
                run={run}
                open
                removed
              />
            )}
            <ImageList
              title="Still in use — kept"
              images={report.referenced}
              run={run}
            />
            <ImageList
              title="Uploaded in the last hour — kept"
              images={report.skipped_recent}
              run={run}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
