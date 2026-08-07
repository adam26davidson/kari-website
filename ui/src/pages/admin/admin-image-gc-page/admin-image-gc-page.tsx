import { useState } from "react";
import "./admin-image-gc-page.css";
import "../admin.css";
import { useAdminToken } from "../../../hooks/useAdminToken";
import { Confirmation, Loading, Notify } from "../admin";
import { GcReport, ImageService } from "../../../services/images";
import { AdminButton } from "../../../components/admin-button/admin-button";

interface AdminImageGcPageProps {
  setLoading: (loading: Loading) => void;
  setConfirmation: (confirmation: Confirmation) => void;
  notify: Notify;
}

function KeyList({ title, keys }: { title: string; keys: Array<string> }) {
  return (
    <details className="gc-key-list" open={keys.length > 0}>
      <summary>
        {title} ({keys.length})
      </summary>
      {keys.length > 0 && (
        <ul>
          {keys.map((key) => (
            <li key={key}>{key}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function AdminImageGcPage({
  setLoading,
  setConfirmation,
  notify,
}: AdminImageGcPageProps) {
  const getAccessTokenSilently = useAdminToken();
  const [report, setReport] = useState<GcReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runGc = async (dryRun: boolean) => {
    setLoading({
      isLoading: true,
      message: dryRun
        ? "Previewing image cleanup..."
        : "Deleting orphaned images...",
    });
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
      setLoading({ isLoading: false, message: "" });
    }
  };

  const onDeleteOrphaned = () => {
    if (!report) return;
    setConfirmation({
      show: true,
      message:
        `This will permanently delete ${report.orphaned.length} orphaned ` +
        `image${report.orphaned.length === 1 ? "" : "s"} from storage. ` +
        "Do you want to continue?",
      options: [
        { label: "Yes", callback: () => runGc(false) },
        { label: "No", callback: () => {} },
      ],
    });
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
            <KeyList title="Orphaned (would be deleted)" keys={report.orphaned} />
          ) : (
            <KeyList title="Deleted" keys={report.deleted} />
          )}
          <KeyList title="Referenced (kept)" keys={report.referenced} />
          <KeyList
            title="Skipped — uploaded within the last hour"
            keys={report.skipped_recent}
          />
        </div>
      )}
    </div>
  );
}
