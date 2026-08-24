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

export function AdminImageGcPage() {
  const getAccessTokenSilently = useAdminToken();
  const { showLoading, hideLoading, confirm, notify } = useAdminUi();
  const [report, setReport] = useState<GcReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runGc = async (dryRun: boolean) => {
    showLoading(
      dryRun ? "Previewing image cleanup..." : "Deleting orphaned images...",
    );
    setError(null);
    try {
      const result = await ImageService.gc(dryRun, getAccessTokenSilently);
      setReport(result);
      if (!dryRun) {
        notify(
          `Deleted ${result.deleted.length} orphaned image${
            result.deleted.length === 1 ? "" : "s"
          }`,
        );
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

  const onDeleteOrphaned = () => {
    if (!report) return;
    confirm(
      `This will permanently delete ${report.orphaned.length} orphaned ` +
        `image${report.orphaned.length === 1 ? "" : "s"} from storage. ` +
        "Do you want to continue?",
      () => runGc(false),
    );
  };

  return (
    <div className="admin-image-gc-page">
      <h2>Image cleanup</h2>
      <p className="gc-explanation">
        Finds uploaded images that are no longer referenced by any page and
        removes them from storage. Previewing never deletes anything; images
        uploaded within the last hour are always kept.
      </p>
      <AdminButton onClick={() => runGc(true)}>
        Preview cleanup (dry run)
      </AdminButton>
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
              ? `Preview: ${report.orphaned.length} orphaned, ` +
                `${report.referenced.length} referenced, ` +
                `${report.skipped_recent.length} skipped as recent. ` +
                "Nothing has been deleted."
              : `Deleted ${report.deleted.length} orphaned image` +
                `${report.deleted.length === 1 ? "" : "s"}.`}
          </div>
          {report.dry_run && report.orphaned.length > 0 && (
            <AdminButton onClick={onDeleteOrphaned}>
              Delete {report.orphaned.length} orphaned image
              {report.orphaned.length === 1 ? "" : "s"}
            </AdminButton>
          )}
          {report.dry_run ? (
            <ImageList
              title="Orphaned (would be deleted)"
              images={report.orphaned}
            />
          ) : (
            <ImageList title="Deleted" images={report.deleted} />
          )}
          <ImageList title="Referenced (kept)" images={report.referenced} />
          <ImageList
            title="Skipped — uploaded within the last hour"
            images={report.skipped_recent}
          />
        </div>
      )}
    </div>
  );
}
