import { useState } from "react";
import "./admin-image-gc-page.css";
import "../admin.css";
import { useAdminToken } from "../../../hooks/use-admin-token";
import { GcImage, GcReport, ImageService } from "../../../services/images";
import { AdminButton } from "../components/admin-button/admin-button";
import { useAdminUi } from "../admin-ui-context";

/**
 * One line per image, with the storage files that image is made of tucked
 * underneath it — so the count in the heading is a count of pictures and
 * matches every other number on the page (#454).
 */
function ImageList({
  title,
  images,
}: {
  title: string;
  images: Array<GcImage>;
}) {
  return (
    <details className="gc-image-list" open={images.length > 0}>
      <summary>
        {title} ({images.length})
      </summary>
      {images.length > 0 && (
        <ul className="gc-images">
          {images.map((image) => (
            <li key={image.id}>
              {image.id}
              <ul className="gc-keys">
                {image.keys.map((key) => (
                  <li key={key}>{key}</li>
                ))}
              </ul>
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
      <h2>Image cleanup</h2>
      <p className="gc-explanation">
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
            <ImageList title="Deleted" images={report.deleted} />
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
