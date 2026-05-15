const stage = document.getElementById("stage");
const stageWrap = document.getElementById("stageWrap");
const main = document.getElementById("main");
const imageInput = document.getElementById("imageInput");
const mainImage = document.getElementById("mainImage");
const emptyMessage = document.getElementById("emptyMessage");
const resetBtn = document.getElementById("resetBtn");
const padImageBtn = document.getElementById("padImageBtn");
const downloadBtn = document.getElementById("downloadBtn");
const exportFormat = document.getElementById("exportFormat");
const exportFormatNote = document.getElementById("exportFormatNote");
const tagControls = document.getElementById("tagControls");
const uploadCard = document.getElementById("uploadCard");
const uploadFileName = document.getElementById("uploadFileName");

const tags = Array.from(document.querySelectorAll(".tag"));

const lineMap = {
  top: document.getElementById("lineTop"),
  right: document.getElementById("lineRight"),
  bottom: document.getElementById("lineBottom"),
  left: document.getElementById("lineLeft"),
};

const TAG_EDGE_SIZE = 8;
const STAGE_EDGE_SIZE = 12;
const MIN_TAG_SIZE = 20;
const INITIAL_TAG_SIZE = 80;
const MAX_TAG_SIZE = 1000;
const MIN_STAGE_WIDTH = 220;
const MAX_STAGE_WIDTH = 5000;
const ROI_MARGIN_RATIO = 0.05;
const EDGE_PADDING_PX = 100;

let activeAction = null;
let selectedTag = null;
let currentPreviewUrl = null;

let currentFileName = "apriltag-overlay";
let currentInputType = "image/png";
let currentInputExt = "png";
let currentInputSizeBytes = 0;

let originalSourceForExport = null;
let originalPixelWidth = 0;
let originalPixelHeight = 0;

function setUploadCardEmptyState() {
  uploadCard.classList.add("empty");
  uploadCard.classList.remove("has-file");
  uploadCard.classList.remove("dragover");
  uploadFileName.textContent = "No file selected yet";
}

function setUploadCardFileState(file) {
  uploadCard.classList.remove("empty");
  uploadCard.classList.remove("dragover");
  uploadCard.classList.add("has-file");
  uploadFileName.textContent = file ? file.name : "File selected";
}

uploadCard.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  imageInput.click();
});

uploadCard.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    imageInput.click();
  }
});

["dragenter", "dragover"].forEach((type) => {
  uploadCard.addEventListener(type, (event) => {
    event.preventDefault();
    uploadCard.classList.add("dragover");
  });
});

["dragleave", "dragend", "drop"].forEach((type) => {
  uploadCard.addEventListener(type, (event) => {
    event.preventDefault();
    uploadCard.classList.remove("dragover");
  });
});

uploadCard.addEventListener("drop", async (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;

  if (event.dataTransfer.files.length) {
    imageInput.files = event.dataTransfer.files;
  }

  setUploadCardFileState(file);
  await handleImageUpload(file);
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatBytes(bytes) {
  if (!bytes) return "unknown";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getFileExtension(fileName) {
  const match = fileName.toLowerCase().match(/[.]([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function getSourceWidth() {
  return originalPixelWidth || mainImage.naturalWidth || 0;
}

function getSourceHeight() {
  return originalPixelHeight || mainImage.naturalHeight || 0;
}

function getTag(id) {
  return tags.find((tag) => tag.dataset.id === id);
}

function getTagSize(tag) {
  return Number(tag.dataset.size) || INITIAL_TAG_SIZE;
}

function getPos(tag) {
  return {
    x: parseFloat(tag.style.left) || 0,
    y: parseFloat(tag.style.top) || 0,
  };
}

function getStageWrapPos() {
  const left = parseFloat(stageWrap.style.left);
  const top = parseFloat(stageWrap.style.top);
  return {
    x: Number.isFinite(left)
      ? left
      : (main.clientWidth - stage.clientWidth) / 2,
    y: Number.isFinite(top)
      ? top
      : (main.clientHeight - stage.clientHeight) / 2,
  };
}

function setStageWrapPos(x, y) {
  stageWrap.style.transform = "none";
  stageWrap.style.left = `${x}px`;
  stageWrap.style.top = `${y}px`;
}

function centerStageWrap() {
  const x =
    main.scrollLeft + Math.max(0, (main.clientWidth - stage.offsetWidth) / 2);
  const y =
    main.scrollTop + Math.max(0, (main.clientHeight - stage.offsetHeight) / 2);

  setStageWrapPos(x, y);
}

function getRenderedImageRect() {
  const imgW = getSourceWidth();
  const imgH = getSourceHeight();
  if (!imgW || !imgH) return null;

  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;

  const scale = Math.min(stageW / imgW, stageH / imgH);
  const renderW = imgW * scale;
  const renderH = imgH * scale;
  const offsetX = (stageW - renderW) / 2;
  const offsetY = (stageH - renderH) / 2;

  return {
    x: offsetX,
    y: offsetY,
    width: renderW,
    height: renderH,
    scale,
  };
}

function getTagBoundsLimit() {
  const imageRect = getRenderedImageRect();
  if (imageRect) return imageRect;

  return {
    x: 0,
    y: 0,
    width: stage.clientWidth,
    height: stage.clientHeight,
  };
}

function setPos(tag, x, y) {
  const size = getTagSize(tag);
  const limit = getTagBoundsLimit();
  const minX = limit.x;
  const minY = limit.y;
  const maxX = limit.x + limit.width - size;
  const maxY = limit.y + limit.height - size;

  tag.style.left = `${clamp(x, minX, Math.max(minX, maxX))}px`;
  tag.style.top = `${clamp(y, minY, Math.max(minY, maxY))}px`;
}

function setTagSize(tag, nextSize, anchor = "top-left") {
  const oldSize = getTagSize(tag);
  const oldPos = getPos(tag);
  const limit = getTagBoundsLimit();

  const maxByRight = limit.x + limit.width - oldPos.x;
  const maxByBottom = limit.y + limit.height - oldPos.y;
  const maxByLeft = oldPos.x + oldSize - limit.x;
  const maxByTop = oldPos.y + oldSize - limit.y;

  let maxSize = Math.min(MAX_TAG_SIZE, limit.width, limit.height);
  if (anchor.includes("left"))
    maxSize = Math.min(maxSize, maxByRight, maxByBottom);
  if (anchor.includes("right"))
    maxSize = Math.min(maxSize, maxByLeft, maxByBottom);
  if (anchor.includes("top"))
    maxSize = Math.min(maxSize, maxByRight, maxByBottom);
  if (anchor.includes("bottom"))
    maxSize = Math.min(maxSize, maxByRight, maxByTop);

  const size = clamp(
    Number(nextSize) || oldSize,
    MIN_TAG_SIZE,
    Math.max(MIN_TAG_SIZE, maxSize),
  );

  let nextX = oldPos.x;
  let nextY = oldPos.y;

  if (anchor.includes("right")) nextX = oldPos.x + oldSize - size;
  if (anchor.includes("bottom")) nextY = oldPos.y + oldSize - size;

  tag.dataset.size = String(size);
  tag.style.width = `${size}px`;
  tag.style.height = `${size}px`;
  setPos(tag, nextX, nextY);
}

function corner(tag, name) {
  const { x, y } = getPos(tag);
  const s = getTagSize(tag);

  const points = {
    topLeft: { x, y },
    topRight: { x: x + s, y },
    bottomRight: { x: x + s, y: y + s },
    bottomLeft: { x, y: y + s },
  };

  return points[name];
}

function shortenLine(start, end, trimRatio = 0.05) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    x1: start.x + dx * trimRatio,
    y1: start.y + dy * trimRatio,
    x2: end.x - dx * trimRatio,
    y2: end.y - dy * trimRatio,
  };
}

function drawLine(line, start, end) {
  const shortened = shortenLine(start, end, 0.05);
  line.setAttribute("x1", shortened.x1);
  line.setAttribute("y1", shortened.y1);
  line.setAttribute("x2", shortened.x2);
  line.setAttribute("y2", shortened.y2);
}

function updateLines() {
  const tl = getTag("tl");
  const tr = getTag("tr");
  const bl = getTag("bl");
  const br = getTag("br");

  drawLine(lineMap.top, corner(tl, "topRight"), corner(tr, "topLeft"));
  drawLine(lineMap.right, corner(tr, "bottomRight"), corner(br, "topRight"));
  drawLine(lineMap.bottom, corner(br, "bottomLeft"), corner(bl, "bottomRight"));
  drawLine(lineMap.left, corner(bl, "topLeft"), corner(tl, "bottomLeft"));

  updateControlValues();
}

function setSelected(tag) {
  selectedTag = tag;
  tags.forEach((t) => t.classList.toggle("selected", t === tag));
}

function makeControls() {
  tagControls.innerHTML = tags
    .map(
      (tag) => `
        <div class="tag-control">
          <h2>${tag.dataset.label} — ${tag.dataset.name}</h2>
          <div class="grid-3">
            <label>
              X px
              <input type="number" data-tag="${tag.dataset.id}" data-input="x" min="0" step="1" />
            </label>
            <label>
              Y px
              <input type="number" data-tag="${tag.dataset.id}" data-input="y" min="0" step="1" />
            </label>
            <label>
              Size px
              <input type="number" data-tag="${tag.dataset.id}" data-input="size" min="20" step="1" />
            </label>
          </div>
        </div>
      `,
    )
    .join("");

  tagControls.addEventListener("input", (event) => {
    const input = event.target;
    if (!input.matches('input[type="number"]')) return;

    const tag = getTag(input.dataset.tag);
    const current = getPos(tag);

    if (input.dataset.input === "size") {
      setTagSize(tag, Number(input.value), "top-left");
    } else {
      const nextX =
        input.dataset.input === "x" ? Number(input.value) : current.x;
      const nextY =
        input.dataset.input === "y" ? Number(input.value) : current.y;
      setPos(tag, nextX, nextY);
    }

    setSelected(tag);
    updateLines();
  });
}

function updateControlValues() {
  tags.forEach((tag) => {
    const { x, y } = getPos(tag);
    const size = getTagSize(tag);

    const xInput = tagControls.querySelector(
      `input[data-tag="${tag.dataset.id}"][data-input="x"]`,
    );
    const yInput = tagControls.querySelector(
      `input[data-tag="${tag.dataset.id}"][data-input="y"]`,
    );
    const sizeInput = tagControls.querySelector(
      `input[data-tag="${tag.dataset.id}"][data-input="size"]`,
    );

    if (xInput && document.activeElement !== xInput)
      xInput.value = Math.round(x);
    if (yInput && document.activeElement !== yInput)
      yInput.value = Math.round(y);
    if (sizeInput && document.activeElement !== sizeInput)
      sizeInput.value = Math.round(size);
  });
}

function fitStageToRightPanel() {
  const naturalW = getSourceWidth();
  const naturalH = getSourceHeight();
  if (!naturalW || !naturalH) return;

  const padding = 24;

  const availableWidth = Math.max(220, main.clientWidth - padding);
  const availableHeight = Math.max(160, main.clientHeight - padding);

  const scale = Math.min(availableWidth / naturalW, availableHeight / naturalH);

  const stageW = Math.max(MIN_STAGE_WIDTH, Math.floor(naturalW * scale));
  const stageH = Math.max(160, Math.floor(naturalH * scale));

  stage.style.width = `${stageW}px`;
  stage.style.height = `${stageH}px`;

  centerStageWrap();
  updateLines();
}

function getStageAspectRatio() {
  const w = getSourceWidth();
  const h = getSourceHeight();
  if (w && h) return w / h;
  return stage.clientWidth / stage.clientHeight;
}

function getRelativeTagLayouts() {
  const rect = getRenderedImageRect() || {
    x: 0,
    y: 0,
    width: stage.clientWidth,
    height: stage.clientHeight,
  };

  return tags.map((tag) => {
    const pos = getPos(tag);
    return {
      tag,
      relX: (pos.x - rect.x) / rect.width,
      relY: (pos.y - rect.y) / rect.height,
      relSize: getTagSize(tag) / rect.width,
    };
  });
}

function applyRelativeTagLayouts(layouts) {
  const rect = getRenderedImageRect() || {
    x: 0,
    y: 0,
    width: stage.clientWidth,
    height: stage.clientHeight,
  };

  layouts.forEach((item) => {
    const size = item.relSize * rect.width;
    item.tag.dataset.size = String(size);
    item.tag.style.width = `${size}px`;
    item.tag.style.height = `${size}px`;
    setPos(
      item.tag,
      rect.x + item.relX * rect.width,
      rect.y + item.relY * rect.height,
    );
  });
}

function setStagePreviewSizeFromAction(action, nextWidth) {
  const aspect = action.stageAspect;
  const width = clamp(nextWidth, MIN_STAGE_WIDTH, MAX_STAGE_WIDTH);
  const height = width / aspect;

  let nextLeft = action.startStageLeft;
  let nextTop = action.startStageTop;

  if (action.resizeDirection.includes("left")) {
    nextLeft = action.startStageLeft + action.startStageWidth - width;
  }
  if (action.resizeDirection.includes("top")) {
    nextTop = action.startStageTop + action.startStageHeight - height;
  }

  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  setStageWrapPos(nextLeft, nextTop);
  applyRelativeTagLayouts(action.tagLayouts);
}

function getResizedStageWidth(action, dx, dy) {
  const direction = action.resizeDirection;
  const aspect = action.stageAspect;
  const candidates = [];

  if (direction.includes("right")) candidates.push(action.startStageWidth + dx);
  if (direction.includes("left")) candidates.push(action.startStageWidth - dx);
  if (direction.includes("bottom"))
    candidates.push((action.startStageHeight + dy) * aspect);
  if (direction.includes("top"))
    candidates.push((action.startStageHeight - dy) * aspect);

  if (!candidates.length) return action.startStageWidth;

  return candidates.reduce((best, current) => {
    return Math.abs(current - action.startStageWidth) >
      Math.abs(best - action.startStageWidth)
      ? current
      : best;
  }, candidates[0]);
}

function stagePointToImagePoint(point, imageRect) {
  const exportScale = getSourceWidth() / imageRect.width;
  return {
    x: (point.x - imageRect.x) * exportScale,
    y: (point.y - imageRect.y) * exportScale,
  };
}

function getExportCorner(tag, cornerName, imageRect) {
  return stagePointToImagePoint(corner(tag, cornerName), imageRect);
}

function getFillColor(pathElement) {
  const style = pathElement.getAttribute("style") || "";
  const fillMatch = style.match(/fill[ ]*:[ ]*([^;]+)/i);
  if (fillMatch) return fillMatch[1].trim();
  return pathElement.getAttribute("fill") || "#000000";
}

function drawSvgTagAsVector(ctx, tag, x, y, size) {
  const svg = tag.querySelector("svg");
  const paths = Array.from(svg.querySelectorAll("path"));

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();

  // Our SVG viewBox is 10 10 80 80
  ctx.translate(x, y);
  ctx.scale(size / 80, size / 80);
  ctx.translate(-10, -10);

  paths.forEach((pathElement) => {
    const d = pathElement.getAttribute("d");
    if (!d) return;
    ctx.fillStyle = getFillColor(pathElement);
    ctx.fill(new Path2D(d));
  });

  ctx.restore();
}

function drawCanvasLine(ctx, start, end) {
  const shortened = shortenLine(start, end, 0.05);
  ctx.beginPath();
  ctx.moveTo(shortened.x1, shortened.y1);
  ctx.lineTo(shortened.x2, shortened.y2);
  ctx.stroke();
}

function getPreferredInputExport() {
  const ext = currentInputExt.toLowerCase();
  const type = currentInputType.toLowerCase();

  if (type === "image/png" || ext === "png") {
    return {
      type: "image/png",
      ext: "png",
      quality: undefined,
      label: "PNG",
    };
  }

  if (
    type === "image/jpeg" ||
    ["jpg", "jpeg", "jfif", "pjpeg", "pjp"].includes(ext)
  ) {
    return {
      type: "image/jpeg",
      ext: ext === "jfif" ? "jfif" : "jpg",
      quality: 0.92,
      label: ext === "jfif" ? "JFIF/JPEG" : "JPEG",
    };
  }

  if (type === "image/tiff" || ["tif", "tiff"].includes(ext)) {
    return {
      type: "image/tiff",
      ext: ext === "tiff" ? "tiff" : "tif",
      quality: undefined,
      label: "TIFF",
    };
  }

  // fallback for unsupported "same as input"
  return {
    type: "image/png",
    ext: "png",
    quality: undefined,
    label: "PNG fallback",
  };
}

function getExportSettings() {
  const selected = exportFormat.value;

  if (selected === "same") return getPreferredInputExport();
  if (selected === "jpeg")
    return {
      type: "image/jpeg",
      ext: "jpg",
      quality: 0.92,
      label: "JPEG",
    };
  if (selected === "tiff")
    return {
      type: "image/tiff",
      ext: "tif",
      quality: undefined,
      label: "TIFF",
    };
  return {
    type: "image/png",
    ext: "png",
    quality: undefined,
    label: "PNG",
  };
}

function updateExportFormatNote() {
  const settings = getExportSettings();
  const inputInfo = currentInputSizeBytes
    ? `Input: .${currentInputExt || "unknown"}, ${formatBytes(currentInputSizeBytes)}.`
    : "No image uploaded yet.";

  const selected = exportFormat.value;
  let note = "";
  let estimate = "";

  if (selected === "png") {
    note = "PNG is lossless and keeps tags/lines very sharp.";
    estimate = "Expected size: usually large.";
  } else if (selected === "jpeg") {
    note = "JPEG is smaller for photos, but lossy.";
    estimate = "Expected size: usually smaller than PNG.";
  } else if (selected === "tiff") {
    note =
      "TIFF is useful in scientific workflows and is exported using a frontend JS library.";
    estimate = "Expected size: often large to very large.";
  } else {
    note = `Same as input will export as ${settings.label}. Unsupported formats fall back to PNG.`;
    estimate = "Expected size: depends on the matched output format.";
  }

  exportFormatNote.textContent = `${inputInfo}\nOutput: ${settings.label}. ${note} ${estimate}`;
}

function buildExportCanvas() {
  const imageRect = getRenderedImageRect();
  if (!imageRect) return null;

  const sourceW = getSourceWidth();
  const sourceH = getSourceHeight();

  const canvas = document.createElement("canvas");
  canvas.width = sourceW;
  canvas.height = sourceH;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(originalSourceForExport, 0, 0, canvas.width, canvas.height);

  const exportScale = sourceW / imageRect.width;

  const tl = getTag("tl");
  const tr = getTag("tr");
  const bl = getTag("bl");
  const br = getTag("br");

  ctx.save();
  ctx.strokeStyle = "rgb(52, 52, 52)";
  ctx.lineWidth = Math.max(1.5, 1.5 * exportScale);
  ctx.setLineDash([10 * exportScale, 6 * exportScale]);
  ctx.lineCap = "butt";

  drawCanvasLine(
    ctx,
    getExportCorner(tl, "topRight", imageRect),
    getExportCorner(tr, "topLeft", imageRect),
  );
  drawCanvasLine(
    ctx,
    getExportCorner(tr, "bottomRight", imageRect),
    getExportCorner(br, "topRight", imageRect),
  );
  drawCanvasLine(
    ctx,
    getExportCorner(br, "bottomLeft", imageRect),
    getExportCorner(bl, "bottomRight", imageRect),
  );
  drawCanvasLine(
    ctx,
    getExportCorner(bl, "topLeft", imageRect),
    getExportCorner(tl, "bottomLeft", imageRect),
  );
  ctx.restore();

  for (const tag of tags) {
    const pos = getPos(tag);
    const size = getTagSize(tag);

    const drawX = (pos.x - imageRect.x) * exportScale;
    const drawY = (pos.y - imageRect.y) * exportScale;
    const drawSize = size * exportScale;

    drawSvgTagAsVector(ctx, tag, drawX, drawY, drawSize);
  }

  return canvas;
}

function downloadBlob(blob, extension) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentFileName}-with-apriltags.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportCanvasAsTIFF(canvas, extension = "tif") {
  if (typeof UTIF === "undefined") {
    throw new Error("UTIF.js is not available.");
  }

  const ctx = canvas.getContext("2d");
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const tiffData = UTIF.encodeImage(rgba, canvas.width, canvas.height);

  const blob = new Blob([tiffData], { type: "image/tiff" });
  downloadBlob(blob, extension);
}

async function downloadModifiedImage() {
  if (!originalSourceForExport || !getSourceWidth() || !getSourceHeight()) {
    alert("Please upload an image first.");
    return;
  }

  const outputCanvas = buildExportCanvas();
  if (!outputCanvas) {
    alert("Failed to build export canvas.");
    return;
  }

  const settings = getExportSettings();

  if (settings.type === "image/tiff") {
    try {
      await exportCanvasAsTIFF(outputCanvas, settings.ext);
    } catch (error) {
      console.error(error);
      alert("TIFF export failed. Please try PNG instead.");
    }
    return;
  }

  outputCanvas.toBlob(
    (blob) => {
      if (!blob) {
        alert("Failed to export image. Try PNG instead.");
        return;
      }
      downloadBlob(blob, settings.ext);
    },
    settings.type,
    settings.quality,
  );
}

function pointIsInsideRenderedImage(clientX, clientY) {
  const imageRect = getRenderedImageRect();
  if (!imageRect) return false;

  const stageBox = stage.getBoundingClientRect();
  const x = clientX - stageBox.left;
  const y = clientY - stageBox.top;

  return (
    x >= imageRect.x &&
    x <= imageRect.x + imageRect.width &&
    y >= imageRect.y &&
    y <= imageRect.y + imageRect.height
  );
}

function getResizeDirectionFromBox(box, event, edgeSize) {
  const x = event.clientX - box.left;
  const y = event.clientY - box.top;
  const w = box.width;
  const h = box.height;

  const nearLeft = x <= edgeSize;
  const nearRight = x >= w - edgeSize;
  const nearTop = y <= edgeSize;
  const nearBottom = y >= h - edgeSize;

  let horizontal = "";
  let vertical = "";

  if (nearLeft) horizontal = "left";
  else if (nearRight) horizontal = "right";

  if (nearTop) vertical = "top";
  else if (nearBottom) vertical = "bottom";

  if (!horizontal && !vertical) return "move";
  return `${vertical}${horizontal}` || horizontal || vertical;
}

function getTagResizeDirection(tag, event) {
  return getResizeDirectionFromBox(
    tag.getBoundingClientRect(),
    event,
    TAG_EDGE_SIZE,
  );
}

function getStageResizeDirection(event) {
  return getResizeDirectionFromBox(
    stage.getBoundingClientRect(),
    event,
    STAGE_EDGE_SIZE,
  );
}

function getCursorForDirection(direction) {
  const cursorMap = {
    top: "n-resize",
    bottom: "s-resize",
    left: "w-resize",
    right: "e-resize",
    topleft: "nwse-resize",
    bottomright: "nwse-resize",
    topright: "nesw-resize",
    bottomleft: "nesw-resize",
    move: "move",
  };
  return cursorMap[direction] || "move";
}

function getResizeAnchor(direction) {
  const anchorMap = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
    topleft: "bottomright",
    topright: "bottomleft",
    bottomleft: "topright",
    bottomright: "topleft",
  };
  return anchorMap[direction] || "top-left";
}

function getSizeFromTagResize(direction, startSize, dx, dy) {
  let delta = 0;

  if (direction === "right") delta = dx;
  else if (direction === "left") delta = -dx;
  else if (direction === "bottom") delta = dy;
  else if (direction === "top") delta = -dy;
  else if (direction === "bottomright") delta = Math.max(dx, dy);
  else if (direction === "bottomleft") delta = Math.max(-dx, dy);
  else if (direction === "topright") delta = Math.max(dx, -dy);
  else if (direction === "topleft") delta = Math.max(-dx, -dy);

  return startSize + delta;
}

function getDefaultRoiRect() {
  const rect = getTagBoundsLimit();

  const marginX = rect.width * ROI_MARGIN_RATIO;
  const marginY = rect.height * ROI_MARGIN_RATIO;

  return {
    x: rect.x + marginX,
    y: rect.y + marginY,
    width: rect.width * (1 - ROI_MARGIN_RATIO * 2),
    height: rect.height * (1 - ROI_MARGIN_RATIO * 2),
  };
}

function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

function getAverageBorderColor(imageData, width, height) {
  const data = imageData.data;

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  const borderThickness = Math.max(
    2,
    Math.round(Math.min(width, height) * 0.03),
  );

  function addPixel(x, y) {
    const i = (y * width + x) * 4;
    const alpha = data[i + 3];

    if (alpha < 20) return;

    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count += 1;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder =
        x < borderThickness ||
        x >= width - borderThickness ||
        y < borderThickness ||
        y >= height - borderThickness;

      if (isBorder) addPixel(x, y);
    }
  }

  if (!count) {
    return { r: 255, g: 255, b: 255 };
  }

  return {
    r: r / count,
    g: g / count,
    b: b / count,
  };
}

function getAdaptiveRoiRect() {
  const defaultRoi = getDefaultRoiRect();

  if (!originalSourceForExport || !getSourceWidth() || !getSourceHeight()) {
    return defaultRoi;
  }

  const sourceW = getSourceWidth();
  const sourceH = getSourceHeight();

  const maxAnalysisSize = 220;
  const scale = Math.min(
    maxAnalysisSize / sourceW,
    maxAnalysisSize / sourceH,
    1,
  );

  const analysisW = Math.max(1, Math.round(sourceW * scale));
  const analysisH = Math.max(1, Math.round(sourceH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = analysisW;
  canvas.height = analysisH;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(originalSourceForExport, 0, 0, analysisW, analysisH);

  const imageData = ctx.getImageData(0, 0, analysisW, analysisH);
  const data = imageData.data;
  const bg = getAverageBorderColor(imageData, analysisW, analysisH);

  let minX = analysisW;
  let minY = analysisH;
  let maxX = -1;
  let maxY = -1;
  let foregroundCount = 0;

  const thresholdSq = 70 * 70;

  // Ignore the outer 2% border during detection.
  // This prevents noisy image borders from expanding the ROI to the whole image.
  const ignoreX = Math.round(analysisW * 0.02);
  const ignoreY = Math.round(analysisH * 0.02);

  for (let y = ignoreY; y < analysisH - ignoreY; y++) {
    for (let x = ignoreX; x < analysisW - ignoreX; x++) {
      const i = (y * analysisW + x) * 4;
      const alpha = data[i + 3];

      if (alpha < 20) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const distSq = colorDistanceSq(r, g, b, bg.r, bg.g, bg.b);

      if (distSq > thresholdSq) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        foregroundCount += 1;
      }
    }
  }

  const totalPixels = analysisW * analysisH;
  const foregroundRatio = foregroundCount / totalPixels;

  if (foregroundRatio < 0.01 || minX >= maxX || minY >= maxY) {
    return defaultRoi;
  }

  const boxW = maxX - minX;
  const boxH = maxY - minY;
  const boxAreaRatio = (boxW * boxH) / totalPixels;

  const touchesLeft = minX <= analysisW * 0.04;
  const touchesRight = maxX >= analysisW * 0.96;
  const touchesTop = minY <= analysisH * 0.04;
  const touchesBottom = maxY >= analysisH * 0.96;

  const touchedBorderCount = [
    touchesLeft,
    touchesRight,
    touchesTop,
    touchesBottom,
  ].filter(Boolean).length;

  // Very important:
  // if the detected ROI is almost the whole image, reject it.
  if (
    boxAreaRatio > 0.72 ||
    boxW > analysisW * 0.88 ||
    boxH > analysisH * 0.88 ||
    touchedBorderCount >= 2
  ) {
    return defaultRoi;
  }

  const paddingX = analysisW * 0.04;
  const paddingY = analysisH * 0.04;

  minX = clamp(minX - paddingX, 0, analysisW);
  minY = clamp(minY - paddingY, 0, analysisH);
  maxX = clamp(maxX + paddingX, 0, analysisW);
  maxY = clamp(maxY + paddingY, 0, analysisH);

  const imageRect = getTagBoundsLimit();

  let roi = {
    x: imageRect.x + (minX / analysisW) * imageRect.width,
    y: imageRect.y + (minY / analysisH) * imageRect.height,
    width: ((maxX - minX) / analysisW) * imageRect.width,
    height: ((maxY - minY) / analysisH) * imageRect.height,
  };

  // Clamp adaptive ROI so it never becomes bigger than the safe 90% default ROI.
  const roiRight = Math.min(roi.x + roi.width, defaultRoi.x + defaultRoi.width);
  const roiBottom = Math.min(
    roi.y + roi.height,
    defaultRoi.y + defaultRoi.height,
  );

  roi.x = Math.max(roi.x, defaultRoi.x);
  roi.y = Math.max(roi.y, defaultRoi.y);
  roi.width = roiRight - roi.x;
  roi.height = roiBottom - roi.y;

  const largestTagSize = Math.max(...tags.map((tag) => getTagSize(tag)));

  if (roi.width < largestTagSize * 2 || roi.height < largestTagSize * 2) {
    return defaultRoi;
  }

  return roi;
}

function resetTagsToCorners() {
  const roi = getAdaptiveRoiRect();

  const tl = getTag("tl");
  const tr = getTag("tr");
  const bl = getTag("bl");
  const br = getTag("br");

  setPos(tl, roi.x, roi.y);
  setPos(tr, roi.x + roi.width - getTagSize(tr), roi.y);
  setPos(bl, roi.x, roi.y + roi.height - getTagSize(bl));
  setPos(
    br,
    roi.x + roi.width - getTagSize(br),
    roi.y + roi.height - getTagSize(br),
  );

  updateLines();
}

function addPaddingToImage(padding = EDGE_PADDING_PX) {
  if (!originalSourceForExport || !getSourceWidth() || !getSourceHeight()) {
    alert("Please upload an image first.");
    return;
  }

  const sourceW = getSourceWidth();
  const sourceH = getSourceHeight();
  const newW = sourceW + padding * 2;
  const newH = sourceH + padding * 2;

  const renderedRect = getRenderedImageRect();
  const tagImageLayouts = renderedRect
    ? tags.map((tag) => {
        const pos = getPos(tag);
        return {
          tag,
          imgX: ((pos.x - renderedRect.x) / renderedRect.width) * sourceW,
          imgY: ((pos.y - renderedRect.y) / renderedRect.height) * sourceH,
          imgSize: (getTagSize(tag) / renderedRect.width) * sourceW,
        };
      })
    : [];

  const canvas = document.createElement("canvas");
  canvas.width = newW;
  canvas.height = newH;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, newW, newH);
  ctx.drawImage(originalSourceForExport, padding, padding, sourceW, sourceH);

  originalSourceForExport = canvas;
  originalPixelWidth = newW;
  originalPixelHeight = newH;

  canvas.toBlob((blob) => {
    if (!blob) {
      alert("Failed to add padding to the image.");
      return;
    }

    if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = URL.createObjectURL(blob);

    mainImage.onload = () => {
      fitStageToRightPanel();

      const nextRect = getRenderedImageRect();
      if (nextRect && tagImageLayouts.length) {
        const scale = nextRect.width / newW;
        tagImageLayouts.forEach((item) => {
          const nextSize = item.imgSize * scale;
          item.tag.dataset.size = String(nextSize);
          item.tag.style.width = `${nextSize}px`;
          item.tag.style.height = `${nextSize}px`;
          setPos(
            item.tag,
            nextRect.x + (item.imgX + padding) * scale,
            nextRect.y + (item.imgY + padding) * scale,
          );
        });
      }

      updateLines();
    };
    mainImage.src = currentPreviewUrl;
  }, "image/png");
}

async function loadTiffFile(file) {
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  if (!ifds || !ifds.length) {
    throw new Error("No TIFF image found.");
  }

  UTIF.decodeImage(buffer, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);

  const width = ifds[0].width;
  const height = ifds[0].height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);

  originalSourceForExport = canvas;
  originalPixelWidth = width;
  originalPixelHeight = height;

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to create preview blob from TIFF."));
        return;
      }

      if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = URL.createObjectURL(blob);
      mainImage.onload = resolve;
      mainImage.onerror = reject;
      mainImage.src = currentPreviewUrl;
    }, "image/png");
  });
}

async function loadNormalBrowserImage(file) {
  if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
  currentPreviewUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    mainImage.onload = () => {
      originalSourceForExport = mainImage;
      originalPixelWidth = mainImage.naturalWidth;
      originalPixelHeight = mainImage.naturalHeight;
      resolve();
    };
    mainImage.onerror = reject;
    mainImage.src = currentPreviewUrl;
  });
}

async function handleImageUpload(file) {
  downloadBtn.classList.remove("ready-download");

  currentFileName = file.name.replace(/[.][^.]+$/, "");
  currentInputType = file.type || "image/png";
  currentInputExt =
    getFileExtension(file.name) ||
    currentInputType.replace("image/", "") ||
    "png";
  currentInputSizeBytes = file.size || 0;

  updateExportFormatNote();

  const isTiffInput =
    currentInputType.toLowerCase() === "image/tiff" ||
    ["tif", "tiff"].includes(currentInputExt.toLowerCase());

  try {
    if (isTiffInput) {
      await loadTiffFile(file);
    } else {
      await loadNormalBrowserImage(file);
    }

    emptyMessage.style.display = "none";
    stage.classList.add("has-image");

    fitStageToRightPanel();
    resetTagsToCorners();
    updateExportFormatNote();

    downloadBtn.classList.add("ready-download");
  } catch (error) {
    console.error(error);
    alert("Failed to load the image.");
  }
}

imageInput.addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    setUploadCardEmptyState();
    return;
  }

  setUploadCardFileState(file);
  await handleImageUpload(file);
});

resetBtn.addEventListener("click", resetTagsToCorners);
padImageBtn.addEventListener("click", () => addPaddingToImage());
downloadBtn.addEventListener("click", downloadModifiedImage);
exportFormat.addEventListener("change", updateExportFormatNote);

stage.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".tag")) return;
  event.preventDefault();
  stage.setPointerCapture(event.pointerId);

  const direction = getStageResizeDirection(event);
  const stagePos = getStageWrapPos();

  activeAction = {
    type: "stage",
    mode: direction === "move" ? "move" : "resize",
    pointerId: event.pointerId,
    resizeDirection: direction,
    startPointerX: event.clientX,
    startPointerY: event.clientY,
    startStageLeft: stagePos.x,
    startStageTop: stagePos.y,
    startStageWidth: stage.clientWidth,
    startStageHeight: stage.clientHeight,
    stageAspect: getStageAspectRatio(),
    tagLayouts: getRelativeTagLayouts(),
  };
});

stage.addEventListener("pointermove", (event) => {
  if (!activeAction) {
    const direction = getStageResizeDirection(event);
    stage.style.cursor = getCursorForDirection(direction);
    return;
  }

  if (
    activeAction.type !== "stage" ||
    activeAction.pointerId !== event.pointerId
  )
    return;

  const dx = event.clientX - activeAction.startPointerX;
  const dy = event.clientY - activeAction.startPointerY;

  if (activeAction.mode === "move") {
    setStageWrapPos(
      activeAction.startStageLeft + dx,
      activeAction.startStageTop + dy,
    );
  } else {
    const nextWidth = getResizedStageWidth(activeAction, dx, dy);
    setStagePreviewSizeFromAction(activeAction, nextWidth);
    updateLines();
  }
});

stage.addEventListener("pointerup", (event) => {
  if (
    activeAction &&
    activeAction.type === "stage" &&
    activeAction.pointerId === event.pointerId
  ) {
    activeAction = null;
    const direction = getStageResizeDirection(event);
    stage.style.cursor = getCursorForDirection(direction);
  }
});

stage.addEventListener("pointercancel", () => {
  activeAction = null;
});

tags.forEach((tag) => {
  setTagSize(tag, getTagSize(tag));

  tag.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    tag.setPointerCapture(event.pointerId);
    setSelected(tag);

    const resizeDirection = getTagResizeDirection(tag, event);
    const pos = getPos(tag);

    activeAction = {
      type: "tag",
      pointerId: event.pointerId,
      mode: resizeDirection === "move" ? "move" : "resize",
      resizeDirection,
      resizeAnchor: getResizeAnchor(resizeDirection),
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startTagX: pos.x,
      startTagY: pos.y,
      startSize: getTagSize(tag),
      tag,
    };
  });

  tag.addEventListener("pointermove", (event) => {
    if (
      !activeAction ||
      activeAction.type !== "tag" ||
      activeAction.pointerId !== event.pointerId ||
      activeAction.tag !== tag
    ) {
      if (!activeAction) {
        const direction = getTagResizeDirection(tag, event);
        tag.style.cursor = getCursorForDirection(direction);
      }
      return;
    }

    const dx = event.clientX - activeAction.startPointerX;
    const dy = event.clientY - activeAction.startPointerY;

    if (activeAction.mode === "resize") {
      const nextSize = getSizeFromTagResize(
        activeAction.resizeDirection,
        activeAction.startSize,
        dx,
        dy,
      );

      tag.dataset.size = String(activeAction.startSize);
      tag.style.width = `${activeAction.startSize}px`;
      tag.style.height = `${activeAction.startSize}px`;
      tag.style.left = `${activeAction.startTagX}px`;
      tag.style.top = `${activeAction.startTagY}px`;

      setTagSize(tag, nextSize, activeAction.resizeAnchor);
    } else {
      setPos(tag, activeAction.startTagX + dx, activeAction.startTagY + dy);
    }

    updateLines();
  });

  tag.addEventListener("pointerup", (event) => {
    if (
      activeAction &&
      activeAction.type === "tag" &&
      activeAction.pointerId === event.pointerId
    ) {
      activeAction = null;
      const direction = getTagResizeDirection(tag, event);
      tag.style.cursor = getCursorForDirection(direction);
    }
  });

  tag.addEventListener("pointercancel", () => {
    activeAction = null;
  });

  tag.addEventListener("pointerleave", () => {
    if (!activeAction) tag.style.cursor = "move";
  });
});

document.addEventListener("pointerdown", (event) => {
  const clickedTag = event.target.closest(".tag");
  const clickedSidebar = event.target.closest(".sidebar");

  if (clickedTag || clickedSidebar) return;

  if (!pointIsInsideRenderedImage(event.clientX, event.clientY)) {
    setSelected(null);
  }
});

window.addEventListener("keydown", (event) => {
  if (!selectedTag) return;

  const moveKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  if (!moveKeys.includes(event.key)) return;

  event.preventDefault();

  const step = event.shiftKey ? 10 : 1;
  const pos = getPos(selectedTag);
  const next = { ...pos };

  if (event.key === "ArrowUp") next.y -= step;
  if (event.key === "ArrowDown") next.y += step;
  if (event.key === "ArrowLeft") next.x -= step;
  if (event.key === "ArrowRight") next.x += step;

  setPos(selectedTag, next.x, next.y);
  updateLines();
});

window.addEventListener("resize", () => {
  if (!getSourceWidth() || !getSourceHeight()) return;

  const layouts = getRelativeTagLayouts();

  fitStageToRightPanel();
  applyRelativeTagLayouts(layouts);
  updateLines();
});

makeControls();
updateExportFormatNote();
setUploadCardEmptyState();
resetTagsToCorners();
