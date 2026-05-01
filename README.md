# AprilTag Overlay Tool

A browser-based tool for overlaying AprilTag fiducial markers onto images. No backend, no installation — open the HTML file and start working.

## What it does

Upload any image and the tool places four AprilTags (IDs 0–3) at the corners of the image. Each tag can be freely repositioned and resized within the image bounds. Dashed lines connect adjacent tag corners to form a reference frame overlay, and the final composite can be exported at the original image resolution.

The four tags are:
| Position | Tag ID |
|---|---|
| Top Left | Tag 0 |
| Top Right | Tag 1 |
| Bottom Left | Tag 2 |
| Bottom Right | Tag 3 |

The connecting lines follow this rule (each line occupies 90% of the distance between its two anchor points, leaving a 5% gap at each end):

| Line | From | To |
|---|---|---|
| Top | TL top-right corner | TR top-left corner |
| Right | TR bottom-right corner | BR top-right corner |
| Bottom | BR bottom-left corner | BL bottom-right corner |
| Left | BL top-left corner | TL bottom-left corner |

## How to use

1. Open `april_tag_image_editor_single_file - format suppport.html` in any modern browser.
2. Click **Upload image** and pick any image file (PNG, JPEG, JFIF, WebP, etc.).
3. The four AprilTags appear at the image corners automatically.
4. Reposition or resize the tags as needed (see controls below).
5. Choose an export format from the **Export format** dropdown.
6. Click **Download modified image** to save the result.

### Moving and resizing tags

| Action | How |
|---|---|
| Move a tag | Drag from the center of the tag |
| Resize a tag | Drag any edge or corner of the tag |
| Fine-tune position/size | Edit the X, Y, Size fields in the sidebar |
| Nudge selected tag | Arrow keys (1 px); Shift + Arrow keys (10 px) |
| Reset all tags to corners | Click **Reset tags to image corners** |

Tags are constrained to stay within the rendered image area.

### Moving and resizing the preview stage

| Action | How |
|---|---|
| Move the stage | Drag the image canvas area |
| Resize the stage | Drag the stage edge or corner |

Resizing the preview stage only affects how the layout looks on screen — the exported image always uses the original image resolution.

### Export formats

| Format | Notes |
|---|---|
| PNG | Lossless, sharpest for tags and lines. Default. |
| JPEG | Smaller for photos; lossy. |
| WebP | Often smallest file; good modern browser support. |
| Same as input | Matches the input format where canvas export supports it; falls back to PNG for GIF, BMP, TIFF, HEIC, AVIF, SVG. |

## Example

Sample input and output images are in the `example/` folder.

## Technical notes

- **Single HTML file** — all logic is self-contained with no external dependencies.
- Tags are rendered as inline SVG paths and drawn onto the export canvas as vector graphics, keeping them sharp at any size.
- The export canvas is sized to the original image's natural resolution; the on-screen preview is a scaled representation only.
- Pointer Events API is used for drag handling, providing consistent behaviour across mouse, touch, and stylus input.
