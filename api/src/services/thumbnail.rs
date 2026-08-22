//! Server-side generation of the small rendition stored as
//! `images/<id>/thumb.jpg` (#273).
//!
//! Admin pages render dozens of previews at once; before this, each preview
//! downloaded and decoded a multi-megabyte camera original, which stalled
//! the main thread. Generation happens in the API at upload time so every
//! upload path is covered by one implementation, and the migration backfill
//! reuses this exact function.
//!
//! Decoding a camera original allocates tens of megabytes and takes real
//! CPU time, so this is deliberately synchronous and blocking: callers on an
//! async runtime must wrap it in `spawn_blocking`.

use std::error::Error;
use std::fmt;
use std::io::Cursor;

use image::{codecs::jpeg::JpegEncoder, ImageDecoder, ImageReader};

/// Longest edge of a generated thumbnail, in pixels. 480 covers the 96 px
/// background-picker grid at 2-3x device pixel ratios and the 200 px
/// photo-picker preview, while being ~1% of a camera original's pixels.
pub const THUMB_MAX_EDGE: u32 = 480;

/// JPEG quality of generated thumbnails: visually clean at these sizes,
/// and small enough that a whole grid costs less than one original.
const THUMB_QUALITY: u8 = 80;

/// A thumbnail that could not be produced. Never fatal to the caller — the
/// serving path falls back to the original when no thumbnail exists.
#[derive(Debug)]
pub struct ThumbnailError(pub String);

impl fmt::Display for ThumbnailError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "thumbnail generation failed: {}", self.0)
    }
}

impl Error for ThumbnailError {}

/// Decode `bytes`, scale the image down so neither edge exceeds
/// [`THUMB_MAX_EDGE`], and encode the result as JPEG.
///
/// The EXIF orientation of the source is applied first, so a camera photo
/// that displays upright thanks to its orientation tag produces an upright
/// thumbnail rather than a sideways one. Images already within the limit are
/// re-encoded at their own size — never enlarged, which would only waste
/// bytes.
pub fn make_thumbnail(bytes: &[u8]) -> Result<Vec<u8>, ThumbnailError> {
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| ThumbnailError(format!("unreadable image data: {e}")))?
        .into_decoder()
        .map_err(|e| ThumbnailError(format!("undecodable image: {e}")))?;
    // Read the orientation before the pixels: `from_decoder` consumes it.
    let orientation = decoder
        .orientation()
        .map_err(|e| ThumbnailError(format!("unreadable orientation: {e}")))?;
    let mut image = image::DynamicImage::from_decoder(decoder)
        .map_err(|e| ThumbnailError(format!("undecodable image: {e}")))?;
    image.apply_orientation(orientation);

    // `DynamicImage::thumbnail` scales UP as readily as down, so clamp the
    // target to the source's own size first.
    let scaled = image.thumbnail(
        image.width().min(THUMB_MAX_EDGE),
        image.height().min(THUMB_MAX_EDGE),
    );

    let rgb = scaled.to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, THUMB_QUALITY)
        .encode_image(&rgb)
        .map_err(|e| ThumbnailError(format!("could not encode JPEG: {e}")))?;
    Ok(out)
}
