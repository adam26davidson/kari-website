//! Server-side generation of the derived renditions stored alongside an
//! upload's original — `images/<id>/thumb.jpg` (#273) and
//! `images/<id>/background.jpg` (#453).
//!
//! Admin pages render dozens of previews at once; before this, each preview
//! downloaded and decoded a multi-megabyte camera original, which stalled
//! the main thread. The site background had the mirror-image problem: the
//! admin app downscaled it in the BROWSER before uploading, so the stored
//! background was permanently low-resolution and the original was lost.
//! Generation happens in the API at upload time so every upload path is
//! covered by one implementation, the original stays the source of truth,
//! and the migration backfill reuses these exact functions.
//!
//! Decoding a camera original allocates tens of megabytes and takes real
//! CPU time, so this is deliberately synchronous and blocking: callers on an
//! async runtime must wrap it in `spawn_blocking`.

use std::error::Error;
use std::fmt;
use std::io::Cursor;

use image::{
    codecs::jpeg::JpegEncoder, DynamicImage, ImageDecoder, ImageReader, Limits, Rgb, RgbImage,
};

use crate::services::image_keys::ImageVariant;

/// Longest edge of a generated thumbnail, in pixels. 480 covers the 96 px
/// background-picker grid at 2-3x device pixel ratios and the 200 px
/// photo-picker preview, while being ~1% of a camera original's pixels.
pub const THUMB_MAX_EDGE: u32 = 480;

/// Longest edge of the generated site background, in pixels. 2560 is what
/// the deleted browser-side downscale used, so no display that looked right
/// before loses resolution now — while a 6000 px camera original still
/// stops being what every visitor downloads.
pub const BACKGROUND_MAX_EDGE: u32 = 2560;

/// Longest edge, in pixels, of a source this will attempt to decode.
///
/// Decoding is where an upload's memory cost explodes: the file arrives
/// compressed but is decoded whole, so a 96 MP original is ~288 MB of RGB
/// regardless of how few megabytes it took on the wire. Since #706 raised
/// the request-body cap to 25 MiB, a JPEG small enough to accept can still
/// be enormous once decoded, and this API shares one host with the site it
/// serves.
///
/// 12 000 covers every camera in circulation with room to spare — a 61 MP
/// full-frame sensor is 9504 px on its long edge — while capping a
/// realistic 3:2 decode at ~12000x8000 = 96 MP. Anything past it is a
/// synthetic or malicious image, and refusing to decode one costs only its
/// renditions: [`store_renditions`](crate::routes::images) logs the failure
/// and the serving path falls back to the stored original.
pub const MAX_SOURCE_EDGE: u32 = 12_000;

/// JPEG quality of generated thumbnails: visually clean at these sizes,
/// and small enough that a whole grid costs less than one original.
const THUMB_QUALITY: u8 = 80;

/// JPEG quality of the generated background — the same 0.82 the browser-side
/// encode used, a step above the thumbnail's because this one is painted
/// full-screen rather than at 96 px.
const BACKGROUND_QUALITY: u8 = 82;

/// A rendition that could not be produced. Never fatal to the caller — the
/// serving path falls back to the original when no rendition exists.
#[derive(Debug)]
pub struct ThumbnailError(pub String);

impl fmt::Display for ThumbnailError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "thumbnail generation failed: {}", self.0)
    }
}

impl Error for ThumbnailError {}

/// The longest edge and JPEG quality a variant is encoded at.
fn encoding_for(variant: ImageVariant) -> (u32, u8) {
    match variant {
        ImageVariant::Thumb => (THUMB_MAX_EDGE, THUMB_QUALITY),
        ImageVariant::Background => (BACKGROUND_MAX_EDGE, BACKGROUND_QUALITY),
    }
}

/// Decode `bytes` into the image every rendition is scaled from.
///
/// The EXIF orientation of the source is applied first, so a camera photo
/// that displays upright thanks to its orientation tag produces upright
/// renditions rather than sideways ones. Any alpha channel is then
/// composited onto white (JPEG has none) — before any scaling, because
/// `image`'s resize filters work on straight (non-premultiplied) alpha, so
/// scaling first would smear the RGB hiding under transparent pixels into
/// the visible edges.
///
/// The reader is given a [`MAX_SOURCE_EDGE`] dimension limit before any
/// pixels are read. It must be set on the READER rather than the decoder:
/// PNG takes its limits at decoder construction, every other format through
/// `set_limits`, and `into_decoder` is the one call that feeds both. The
/// rest of [`Limits::default`] is kept as-is, which retains the crate's
/// 512 MiB `max_alloc`; the dimension limit is the part that actually
/// refuses an over-large source here, since it is checked strictly against
/// the header dimensions before allocation.
fn decode_source(bytes: &[u8]) -> Result<DynamicImage, ThumbnailError> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| ThumbnailError(format!("unreadable image data: {e}")))?;
    // `Limits` is #[non_exhaustive], so start from the crate's defaults
    // (notably its 512 MiB `max_alloc`) and narrow the dimensions.
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_EDGE);
    limits.max_image_height = Some(MAX_SOURCE_EDGE);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| ThumbnailError(format!("undecodable image: {e}")))?;
    // Read the orientation before the pixels: `from_decoder` consumes it.
    let orientation = decoder
        .orientation()
        .map_err(|e| ThumbnailError(format!("unreadable orientation: {e}")))?;
    let mut image = image::DynamicImage::from_decoder(decoder)
        .map_err(|e| ThumbnailError(format!("undecodable image: {e}")))?;
    image.apply_orientation(orientation);
    Ok(flatten_onto_white(image))
}

/// Scale `image` down so neither edge exceeds `max_edge` and encode the
/// result as JPEG. Images already within the limit are re-encoded at their
/// own size — never enlarged, which would only waste bytes.
fn encode_scaled(
    image: &DynamicImage,
    max_edge: u32,
    quality: u8,
) -> Result<Vec<u8>, ThumbnailError> {
    // `DynamicImage::thumbnail` scales UP as readily as down, so clamp the
    // target to the source's own size first.
    let scaled = image.thumbnail(image.width().min(max_edge), image.height().min(max_edge));

    let rgb = scaled.to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(&rgb)
        .map_err(|e| ThumbnailError(format!("could not encode JPEG: {e}")))?;
    Ok(out)
}

/// Generate one rendition of `bytes`. Used by the migration backfill, which
/// writes only the variants a given image is missing.
pub fn make_rendition(bytes: &[u8], variant: ImageVariant) -> Result<Vec<u8>, ThumbnailError> {
    let (max_edge, quality) = encoding_for(variant);
    encode_scaled(&decode_source(bytes)?, max_edge, quality)
}

/// Generate EVERY rendition of a freshly uploaded image, in
/// [`ImageVariant::ALL`] order.
///
/// One decode for all of them: decoding a camera original is the expensive
/// half of this work, so an upload must never pay for it twice.
pub fn make_renditions(bytes: &[u8]) -> Result<Vec<(ImageVariant, Vec<u8>)>, ThumbnailError> {
    let source = decode_source(bytes)?;
    ImageVariant::ALL
        .into_iter()
        .map(|variant| {
            let (max_edge, quality) = encoding_for(variant);
            Ok((variant, encode_scaled(&source, max_edge, quality)?))
        })
        .collect()
}

/// Composite `image` over an opaque white canvas, returning an image with no
/// alpha channel.
///
/// JPEG cannot store transparency, so a transparent-background upload (a
/// drawn haiga, a logo) has to be flattened onto something. Simply dropping
/// the channel keeps whatever RGB the encoder stored under the transparent
/// pixels — usually black — so the admin grid would show the artwork on a
/// black slab while the public site renders the original correctly. White
/// matches the page the previews sit on.
///
/// Images without alpha are returned untouched, which is every camera
/// photograph, so the common path pays nothing.
fn flatten_onto_white(image: DynamicImage) -> DynamicImage {
    if !image.color().has_alpha() {
        return image;
    }
    let rgba = image.to_rgba8();
    let flattened = RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        // `image` stores straight alpha, so the source colour is used as-is:
        // out = src * a + white * (1 - a), in 0..=255 fixed point.
        let over = |c: u8| {
            let a = u32::from(a);
            (((u32::from(c) * a) + (255 * (255 - a)) + 127) / 255) as u8
        };
        Rgb([over(r), over(g), over(b)])
    });
    DynamicImage::ImageRgb8(flattened)
}
