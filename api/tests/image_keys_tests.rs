//! Tests for `services::image_keys` (the single place S3 key shapes live)
//! and `services::thumbnail` (server-side rendition generation).
//!
//! Both are pure functions, so they need no store, no router and no auth —
//! but they are the contract every image key in the bucket is built from,
//! so they are pinned down explicitly rather than only through the handlers.

use image::{
    codecs::jpeg::JpegEncoder, ColorType, DynamicImage, ImageEncoder, RgbImage, RgbaImage,
};
use kari_website_api::services::image_keys::{
    id_from_key, legacy_key, original_key, prefix, sanitized_extension, variant_key, ImageVariant,
    BACKGROUND_FILE, THUMB_FILE,
};
use kari_website_api::services::thumbnail::{
    make_rendition, make_renditions, BACKGROUND_MAX_EDGE, THUMB_MAX_EDGE,
};

/// The thumbnail of `bytes` — the rendition most of these tests exercise.
fn make_thumbnail(bytes: &[u8]) -> Result<Vec<u8>, impl std::error::Error> {
    make_rendition(bytes, ImageVariant::Thumb)
}

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
fn variant_key_names_the_background_file() {
    // Fixed name, not the id's own extension: the encoder is JPEG-only, so
    // a background derived from a PNG is still a .jpg.
    assert_eq!(
        variant_key("abc.png", ImageVariant::Background),
        format!("images/abc.png/{BACKGROUND_FILE}")
    );
    assert_eq!(BACKGROUND_FILE, "background.jpg");
}

#[test]
fn every_variant_has_a_distinct_file_name() {
    // The public site builds these paths itself, so two variants sharing a
    // name would silently serve the wrong rendition.
    let mut names: Vec<&str> = ImageVariant::ALL.iter().map(|v| v.file_name()).collect();
    let count = names.len();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), count, "duplicate variant file names");
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
fn background_scales_a_huge_image_down_to_its_own_max_edge() {
    // Far larger than the thumbnail's 480, so a background must never be
    // capped at the thumbnail size (#453).
    let jpeg = make_rendition(&png_bytes(4000, 3000), ImageVariant::Background).expect("rendition");
    let decoded = image::load_from_memory(&jpeg).expect("background decodes");
    assert_eq!(
        (decoded.width(), decoded.height()),
        (BACKGROUND_MAX_EDGE, BACKGROUND_MAX_EDGE * 3 / 4)
    );
}

#[test]
fn background_never_enlarges_an_image_smaller_than_the_max_edge() {
    // The bytes uploaded before #453 were already downscaled in the browser;
    // re-deriving must not blow them up into a blurry larger file.
    let jpeg = make_rendition(&png_bytes(1600, 900), ImageVariant::Background).expect("rendition");
    let decoded = image::load_from_memory(&jpeg).expect("background decodes");
    assert_eq!((decoded.width(), decoded.height()), (1600, 900));
}

#[test]
fn make_renditions_produces_every_variant_in_order_from_one_decode() {
    let renditions = make_renditions(&png_bytes(3000, 3000)).expect("renditions");
    let variants: Vec<ImageVariant> = renditions.iter().map(|(v, _)| *v).collect();
    assert_eq!(variants, ImageVariant::ALL.to_vec());

    for (variant, bytes) in &renditions {
        let decoded = image::load_from_memory(bytes).expect("rendition decodes");
        let expected = match variant {
            ImageVariant::Thumb => THUMB_MAX_EDGE,
            ImageVariant::Background => BACKGROUND_MAX_EDGE,
        };
        assert_eq!(
            (decoded.width(), decoded.height()),
            (expected, expected),
            "for {variant:?}"
        );
    }
}

#[test]
fn make_renditions_of_undecodable_bytes_is_an_error() {
    // The whole set fails together: there is nothing to derive from.
    make_renditions(b"PNGDATA").expect_err("should not decode");
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

/// A real encoded PNG whose left half is fully transparent and whose right
/// half is opaque black — the transparent pixels deliberately carry black
/// RGB underneath, which is exactly what a naive `to_rgb8()` would keep.
fn transparent_png_bytes(width: u32, height: u32) -> Vec<u8> {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_fn(width, height, |x, _| {
        image::Rgba([0, 0, 0, if x < width / 2 { 0 } else { 255 }])
    }));
    let mut out = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("png encodes");
    out
}

#[test]
fn thumbnail_composites_transparency_onto_white_rather_than_black() {
    // JPEG has no alpha channel, so a transparent-background PNG (a drawn
    // haiga, a logo) has to be flattened onto SOMETHING. Dropping the
    // channel keeps whatever RGB sat under the transparent pixels, which
    // for most encoders is black — the admin grid would show the artwork on
    // a black slab. White matches the page it is previewed on.
    let jpeg = make_thumbnail(&transparent_png_bytes(200, 100)).expect("thumbnail");
    let decoded = image::load_from_memory(&jpeg)
        .expect("thumbnail decodes")
        .to_rgb8();

    // Sample well inside each half: JPEG is lossy and rings at the edge.
    let transparent = decoded.get_pixel(20, 50);
    let opaque = decoded.get_pixel(180, 50);
    assert!(
        transparent.0.iter().all(|&c| c > 240),
        "the transparent half should be white, got {transparent:?}"
    );
    assert!(
        opaque.0.iter().all(|&c| c < 20),
        "the opaque half should stay black, got {opaque:?}"
    );
}

#[test]
fn thumbnail_of_a_partly_transparent_pixel_blends_towards_white() {
    // Straight (non-premultiplied) alpha: a 50%-opaque black pixel over
    // white is mid grey, not black and not white.
    let image =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(120, 120, image::Rgba([0, 0, 0, 128])));
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("png encodes");

    let jpeg = make_thumbnail(&png).expect("thumbnail");
    let decoded = image::load_from_memory(&jpeg)
        .expect("thumbnail decodes")
        .to_rgb8();
    let pixel = decoded.get_pixel(60, 60);
    assert!(
        pixel.0.iter().all(|&c| (100..=155).contains(&c)),
        "expected mid grey, got {pixel:?}"
    );
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

// ------------------------------------------------ decoded-size ceiling

/// A PNG that declares `width` x `height` of 8-bit RGB in its IHDR and then
/// carries no usable pixel data at all.
///
/// The decoded-size ceiling has to refuse an image from its HEADER, before a
/// single pixel is read — that is the whole point of it, and a fixture made
/// of real pixels could not tell the difference between refusing early and
/// surviving the allocation. It also keeps these tests free: encoding a real
/// 81 MP PNG costs ~15 s and 243 MB, which is a strange price to pay in a
/// test about not spending 243 MB.
fn png_header_only(width: u32, height: u32) -> Vec<u8> {
    /// PNG chunk: big-endian length, four-byte type, payload, CRC-32 over
    /// type and payload.
    fn chunk(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        fn crc32(bytes: &[u8]) -> u32 {
            let mut crc = 0xFFFF_FFFFu32;
            for &byte in bytes {
                crc ^= u32::from(byte);
                for _ in 0..8 {
                    crc = if crc & 1 == 0 {
                        crc >> 1
                    } else {
                        (crc >> 1) ^ 0xEDB8_8320
                    };
                }
            }
            !crc
        }

        let mut body = kind.to_vec();
        body.extend_from_slice(payload);
        let mut out = (payload.len() as u32).to_be_bytes().to_vec();
        out.extend_from_slice(&body);
        out.extend_from_slice(&crc32(&body).to_be_bytes());
        out
    }

    let mut ihdr = width.to_be_bytes().to_vec();
    ihdr.extend_from_slice(&height.to_be_bytes());
    // 8 bits per channel, colour type 2 (RGB), deflate, no filter, no
    // interlace — so bytes-per-pixel is 3, as a camera JPEG's would be.
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);

    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend_from_slice(&chunk(b"IHDR", &ihdr));
    // A zlib header and nothing else: enough for the decoder to be built
    // (which is where the size is checked), never enough to decode.
    png.extend_from_slice(&chunk(b"IDAT", &[0x78, 0x01]));
    png.extend_from_slice(&chunk(b"IEND", &[]));
    png
}

#[test]
fn make_renditions_refuses_a_source_whose_decoded_size_exceeds_the_byte_cap() {
    // 9000x9000 passes MAX_SOURCE_EDGE on BOTH dimensions and would still
    // decode to 81 MP x 3 B = 243 MB — more than this API is allowed to
    // hold on its micro host. That gap is exactly what MAX_DECODE_BYTES
    // closes: a per-dimension edge limit is not a memory limit, and a
    // 16-bit source would blow through it by twice as much again.
    let err = make_renditions(&png_header_only(9000, 9000)).expect_err("should refuse to decode");
    let message = err.to_string();
    assert!(
        message.contains("decode limit"),
        "the error should name the decode limit: {message}"
    );
}

#[test]
fn the_decode_cap_still_admits_the_largest_camera_in_circulation() {
    // 9504x6336 is a 61 MP full-frame sensor: 172 MiB decoded, inside
    // MAX_DECODE_BYTES with headroom. It must keep being accepted —
    // refusing it would leave the untouched original as the file every
    // visitor downloads as the site background.
    //
    // Only the size check runs here (the fixture has no pixels, so the
    // decode itself then fails); that a large real image scales correctly
    // once admitted is pinned by
    // `background_scales_a_huge_image_down_to_its_own_max_edge`.
    let err = make_renditions(&png_header_only(9504, 6336)).expect_err("no pixel data to decode");
    let message = err.to_string();
    assert!(
        !message.contains("decode limit"),
        "61 MP is inside the budget and must not be refused: {message}"
    );
}

#[test]
fn background_applies_exif_orientation_like_the_thumbnail_does() {
    // Orientation is applied AFTER scaling now — to a <=2560 px rendition
    // rather than to the full-size source, which is what stops a portrait
    // camera photo holding two full-size buffers at once. Rotating later
    // must not mean rotating less, so the second variant is pinned too.
    let jpeg = jpeg_with_orientation(&png_bytes(1200, 800), 6);
    let background = make_rendition(&jpeg, ImageVariant::Background).expect("rendition");
    let decoded = image::load_from_memory(&background).expect("background decodes");
    assert_eq!(
        (decoded.width(), decoded.height()),
        (800, 1200),
        "a 'rotate 90' 1200x800 source describes an upright 800x1200 image"
    );
}
