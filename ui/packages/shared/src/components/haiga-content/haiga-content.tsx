import { Haiga } from "../../models";
import { HaigaOverride } from "../../utils/preview-channel";
import { useObjectUrl } from "../../hooks/use-object-url";
import { s3ImageUrl } from "../../utils/image-management-helpers";
import "./haiga-content.css";

export function HaigaContent({ haiga }: { haiga: Haiga | HaigaOverride }) {
  // In the admin's site preview (#859) the haiga may carry a picture she
  // has picked but not saved; it wins over the stored one.
  const draftUrl = useObjectUrl("imageFile" in haiga ? haiga.imageFile : null);
  const src = draftUrl ?? (haiga.image ? s3ImageUrl(haiga.image) : "");
  // The haiku lines are part of the artwork itself, so they are never
  // rendered as text — the lines field only feeds the image alt when an
  // older haiga happens to have it filled in.
  const altText = haiga.lines.join(", ") || "haiga";
  return (
    <div className="haiga-list-item-content">
      <div className="haiga-list-item-image-box">
        {/* A just-added haiga has no picture yet: no <img> rather than a
            broken one. */}
        {src && (
          <img src={src} alt={altText} className="haiga-list-item-image" />
        )}
      </div>
      <div>
        <div className="haiga-list-publisher">{haiga.publisher}</div>
      </div>
    </div>
  );
}
