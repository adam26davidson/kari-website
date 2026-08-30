import { useState } from "react";
import "./admin-image-gc-page.css";
import "../admin.css";
import { useAdminToken } from "../../../hooks/use-admin-token";
import { GcImage, GcReport, ImageService } from "../../../services/images";
import { AdminButton } from "../components/admin-button/admin-button";
import { useAdminUi } from "../admin-ui-context";
import { apiImageUrl } from "../../../utils/image-management-helpers";

/**
 * One image's picture, fetched at thumbnail size like every other admin
 * grid. A picture that will not load leaves a quiet tile rather than the
 * browser's broken-image icon (#495).
 */
function ImageThumbnail({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="gc-image-missing">Couldn&apos;t show this picture</div>
    );
  }

  return (
    <img
      className="gc-image-thumb"
      src={apiImageUrl(id, "thumb")}
      // The stored name is a uuid and means nothing to her, so it stays out
      // of the page; as alt text it is still the only thing that tells two
      // otherwise identical tiles apart for a screen reader.
      alt={id}
      loading="lazy"
      decoding="async"
      width={96}
      height={96}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * One tile per image, showing the picture itself — the count in the heading
 * is a count of pictures (#454) and so is what she sees under it (#495).
 *
 * `removed` marks the group whose objects a real run has just deleted:
 * their thumbnails are gone from storage, so the list says so instead of
 * asking for pictures that cannot come back.
 */
function ImageList({
  title,
  images,
  removed = false,
}: {
  title: string;
  images: Array<GcImage>;
  removed?: boolean;
}) {
  return (
    <details className="gc-image-list" open={images.length > 0}>
      <summary>
        {title} ({images.length})
      </summary>
      {images.length === 0 ? (
        <p className="gc-images-note">Nothing here.</p>
      ) : removed ? (
        <p className="gc-images-note">
          These pictures are no longer in storage, so there is nothing left to
          show.
        </p>
      ) : (
        <ul className="gc-images">
          {images.map((image) => (
            <li key={image.id}>
              <ImageThumbnail id={image.id} />
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** Picks the wording that agrees with a count, so "1" never reads wrong. */
const agree = (count: number, one: string, many: string) =>
  count === 1 ? one : many;

/** "1 unused image" / "3 unused images" — the phrase every count uses. */
const countOfImages = (count: number) =>
  `${count} ${agree(count, "unused image", "unused images")}`;

export function AdminImageGcPage() {
  const getAccessTokenSilently = useAdminToken();
  const { showLoading, hideLoading, confirm, notify } = useAdminUi();
  const [report, setReport] = useState<GcReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runGc = async (dryRun: boolean) => {
    showLoading(
      dryRun ? "Previewing image cleanup..." : "Deleting unused images...",
    );
    setError(null);
    try {
      const result = await ImageService.gc(dryRun, getAccessTokenSilently);
      setReport(result);
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
    <div className="admin-image-gc-page">
      <h2 className="admin-section-heading">Image cleanup</h2>
      <p className="admin-section-explanation">
        Finds uploaded images that no page on the site uses any more and
        removes them from storage. Previewing never deletes anything; images
        uploaded within the last hour are always kept.
      </p>
      <AdminButton onClick={() => runGc(true)}>Preview cleanup</AdminButton>
      {error && (
        <div className="gc-error" role="alert">
          {error}
          <div className="gc-error-note">
            Nothing further was deleted. Fix the problem and preview again.
          </div>
        </div>
      )}
      {report && (
        <div className="gc-report">
          <div className="gc-summary">
            {report.dry_run
              ? `Preview: ${report.orphaned.length} ` +
                agree(report.orphaned.length, "image is", "images are") +
                " no longer used by any page and would be deleted, " +
                `${report.referenced.length} still in use, ` +
                `${report.skipped_recent.length} uploaded in the last hour ` +
                "and left alone. Nothing has been deleted."
              : `Deleted ${countOfImages(report.deleted.length)}.`}
          </div>
          {report.dry_run && report.orphaned.length > 0 && (
            <AdminButton variant="danger" onClick={onDeleteUnused}>
              Delete {countOfImages(report.orphaned.length)}
            </AdminButton>
          )}
          {report.dry_run ? (
            <ImageList
              title="No longer used (would be deleted)"
              images={report.orphaned}
            />
          ) : (
            <ImageList title="Deleted" images={report.deleted} removed />
          )}
          <ImageList title="Still in use (kept)" images={report.referenced} />
          <ImageList
            title="Uploaded in the last hour (kept)"
            images={report.skipped_recent}
          />
        </div>
      )}
    </div>
  );
}
