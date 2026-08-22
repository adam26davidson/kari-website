//! Tests for `services::image_keys` (the single place S3 key shapes live)
//! and `services::thumbnail` (server-side rendition generation).
//!
//! Both are pure functions, so they need no store, no router and no auth —
//! but they are the contract every image key in the bucket is built from,
//! so they are pinned down explicitly rather than only through the handlers.

use image::{codecs::jpeg::JpegEncoder, ColorType, DynamicImage, ImageEncoder, RgbImage};
use kari_website_api::services::image_keys::{
    id_from_key, legacy_key, original_key, prefix, sanitized_extension, variant_key, ImageVariant,
    THUMB_FILE,
};
use kari_website_api::services::thumbnail::{make_thumbnail, THUMB_MAX_EDGE};

// ------------------------------------------------------------- image_keys

#[test]
fn prefix_is_the_images_directory_for_the_id() {
    assert_eq!(prefix("abc.jpg"), "images/abc.jpg/");
}

#[test]
fn original_key_appends_the_ids_own_extension() {
    assert_eq!(original_key("abc.jpg"), "images/abc.jpg/original.jpg");
}

#[test]
fn original_key_lowercases_the_extension_like_uploads_do() {
    assert_eq!(original_key("abc.JPG"), "images/abc.JPG/original.jpg");
}

#[test]
fn original_key_of_an_id_without_extension_has_no_extension() {
    assert_eq!(original_key("abc"), "images/abc/original");
}

#[test]
fn variant_key_names_the_thumbnail_file() {
    assert_eq!(
        variant_key("abc.jpg", ImageVariant::Thumb),
        format!("images/abc.jpg/{THUMB_FILE}")
    );
}

#[test]
fn legacy_key_is_the_pre_migration_single_object() {
    assert_eq!(legacy_key("abc.jpg"), "images/abc.jpg");
}

#[test]
fn id_from_key_takes_the_first_segment_under_images() {
    assert_eq!(id_from_key("images/abc.jpg/thumb.jpg"), Some("abc.jpg"));
    assert_eq!(id_from_key("images/abc.jpg/original.jpg"), Some("abc.jpg"));
    // A legacy single-object key is its own id.
    assert_eq!(id_from_key("images/abc.jpg"), Some("abc.jpg"));
}

#[test]
fn id_from_key_rejects_the_bare_folder_marker_and_foreign_keys() {
    assert_eq!(id_from_key("images/"), None);
    // The directory marker some S3 tools create for a prefix.
    assert_eq!(id_from_key("images/abc.jpg/"), Some("abc.jpg"));
    assert_eq!(id_from_key("blog/post.html"), None);
}

#[test]
fn sanitized_extension_keeps_short_alphanumeric_suffixes_lowercased() {
    assert_eq!(sanitized_extension("photo.PNG"), ".png");
    assert_eq!(sanitized_extension("archive.tar.gz"), ".gz");
}

#[test]
fn sanitized_extension_drops_anything_unusable() {
    for name in [
        "noextension",
        ".png",
        "photo.",
        "photo.<script>",
        "photo.averyveryverylongextension",
    ] {
        assert_eq!(sanitized_extension(name), "", "for {name:?}");
    }
}

// -------------------------------------------------------------- thumbnail

/// A real encoded PNG of the given size, so the decoder has something
/// genuine to work on.
fn png_bytes(width: u32, height: u32) -> Vec<u8> {
    let image = DynamicImage::ImageRgb8(RgbImage::from_fn(width, height, |x, _| {
        image::Rgb([(x % 256) as u8, 40, 90])
    }));
    let mut out = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("png encodes");
    out
}

#[test]
fn thumbnail_scales_a_large_image_down_to_the_max_edge_preserving_aspect() {
    let jpeg = make_thumbnail(&png_bytes(1200, 800)).expect("thumbnail");
    let decoded = image::load_from_memory(&jpeg).expect("thumbnail decodes");
    assert_eq!((decoded.width(), decoded.height()), (THUMB_MAX_EDGE, 320));
}

#[test]
fn thumbnail_is_encoded_as_jpeg() {
    let jpeg = make_thumbnail(&png_bytes(600, 600)).expect("thumbnail");
    assert_eq!(&jpeg[..2], &[0xFF, 0xD8], "JPEG SOI marker");
    assert_eq!(
        image::guess_format(&jpeg).expect("format"),
        image::ImageFormat::Jpeg
    );
}

#[test]
fn thumbnail_never_enlarges_an_image_smaller_than_the_max_edge() {
    let jpeg = make_thumbnail(&png_bytes(120, 90)).expect("thumbnail");
    let decoded = image::load_from_memory(&jpeg).expect("thumbnail decodes");
    assert_eq!((decoded.width(), decoded.height()), (120, 90));
}

#[test]
fn thumbnail_of_undecodable_bytes_is_an_error() {
    let err = make_thumbnail(b"PNGDATA").expect_err("should not decode");
    assert!(
        err.to_string().contains("thumbnail"),
        "error should name what failed: {err}"
    );
}

#[test]
fn thumbnail_applies_exif_orientation_so_camera_photos_are_upright() {
    // A 1200x800 landscape JPEG tagged "rotate 90" describes an upright
    // 800x1200 portrait; the thumbnail must be portrait, not landscape.
    let jpeg = jpeg_with_orientation(&png_bytes(1200, 800), 6);
    let thumb = make_thumbnail(&jpeg).expect("thumbnail");
    let decoded = image::load_from_memory(&thumb).expect("thumbnail decodes");
    assert!(
        decoded.height() > decoded.width(),
        "expected a portrait thumbnail, got {}x{}",
        decoded.width(),
        decoded.height()
    );
}

/// Re-encode `png` as a JPEG carrying an EXIF APP1 segment whose
/// Orientation tag is `orientation`.
fn jpeg_with_orientation(png: &[u8], orientation: u16) -> Vec<u8> {
    let image = image::load_from_memory(png).expect("png decodes").to_rgb8();
    let mut body = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut body, 90);
    encoder
        .set_exif_metadata(exif_orientation(orientation))
        .expect("exif accepted");
    encoder
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ColorType::Rgb8.into(),
        )
        .expect("jpeg encodes");
    body
}

/// A minimal little-endian TIFF header holding only the Orientation tag.
fn exif_orientation(orientation: u16) -> Vec<u8> {
    let mut exif = Vec::new();
    exif.extend_from_slice(b"II\x2a\x00"); // little-endian, magic 42
    exif.extend_from_slice(&8u32.to_le_bytes()); // offset of IFD0
    exif.extend_from_slice(&1u16.to_le_bytes()); // one entry
    exif.extend_from_slice(&0x0112u16.to_le_bytes()); // Orientation
    exif.extend_from_slice(&3u16.to_le_bytes()); // SHORT
    exif.extend_from_slice(&1u32.to_le_bytes()); // count
    exif.extend_from_slice(&orientation.to_le_bytes());
    exif.extend_from_slice(&[0, 0]); // pad the 4-byte value field
    exif.extend_from_slice(&0u32.to_le_bytes()); // no next IFD
    exif
}
