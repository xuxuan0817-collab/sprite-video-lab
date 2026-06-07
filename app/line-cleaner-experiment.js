const state = {
  frames: [],
  currentIndex: 0,
  playing: false,
  rafId: 0,
  playbackStartedAt: 0,
  playbackStartIndex: 0,
  processing: false,
  previewZoom: 1,
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  syncOutputs();
  setPreviewZoom(1);
  drawEmptyCanvases();
});

function bindElements() {
  [
    "fileInput",
    "folderInput",
    "processButton",
    "dropzone",
    "frameCount",
    "sourceBytes",
    "processedBytes",
    "canvasSize",
    "savingRatio",
    "fpsInput",
    "methodInput",
    "playButton",
    "restartButton",
    "zoomOutButton",
    "zoomLabel",
    "zoomInButton",
    "scaleInput",
    "alphaCutoffInput",
    "alphaCutoffValue",
    "sharpenInput",
    "sharpenValue",
    "colorCountInput",
    "colorCountValue",
    "downloadCurrentButton",
    "downloadAllButton",
    "status",
    "frameLabel",
    "frameName",
    "sourceCanvas",
    "processedCanvas",
    "frameStrip",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.fileInput.addEventListener("change", () => loadFiles(Array.from(els.fileInput.files || [])));
  els.folderInput.addEventListener("change", () => loadFiles(Array.from(els.folderInput.files || [])));
  els.processButton.addEventListener("click", processAllFrames);
  els.playButton.addEventListener("click", togglePlayback);
  els.restartButton.addEventListener("click", restartPlayback);
  els.zoomOutButton.addEventListener("click", () => setPreviewZoom(state.previewZoom - 0.25));
  els.zoomInButton.addEventListener("click", () => setPreviewZoom(state.previewZoom + 0.25));
  els.downloadCurrentButton.addEventListener("click", downloadCurrentFrame);
  els.downloadAllButton.addEventListener("click", downloadAllFrames);

  [els.alphaCutoffInput, els.sharpenInput, els.colorCountInput].forEach((input) => {
    input.addEventListener("input", syncOutputs);
  });

  [els.methodInput, els.scaleInput].forEach((input) => {
    input.addEventListener("change", () => {
      clearProcessedFrames();
      renderCurrentFrame();
      setStatus("\u53c2\u6570\u5df2\u6539\u53d8\uff0c\u8bf7\u91cd\u65b0\u751f\u6210\u5bf9\u6bd4\u3002", "warn");
    });
  });

  els.fpsInput.addEventListener("change", () => {
    els.fpsInput.value = String(clamp(Math.round(Number(els.fpsInput.value) || 12), 1, 60));
    restartPlayback();
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove("dragging");
    });
  });

  els.dropzone.addEventListener("drop", (event) => {
    loadFiles(Array.from(event.dataTransfer?.files || []));
  });

  window.addEventListener("resize", () => renderCurrentFrame());
}

function syncOutputs() {
  els.alphaCutoffValue.textContent = els.alphaCutoffInput.value;
  els.sharpenValue.textContent = `${els.sharpenInput.value}%`;
  els.colorCountValue.textContent = els.colorCountInput.value;
}

async function loadFiles(files) {
  const imageFiles = sortFiles(files).filter(isSupportedImageFile);
  if (imageFiles.length === 0) {
    setStatus("\u8bf7\u5bfc\u5165 PNG / JPG / WebP / BMP \u5e8f\u5217\u5e27\u3002", "warn");
    return;
  }

  stopPlayback();
  clearFrames();
  state.currentIndex = 0;
  setBusy(true);
  setStatus(`\u6b63\u5728\u8f7d\u5165 ${imageFiles.length} \u5e27...`);

  try {
    const loaded = [];
    for (let index = 0; index < imageFiles.length; index += 1) {
      const file = imageFiles[index];
      const sourceUrl = URL.createObjectURL(file);
      const bitmap = await createImageBitmap(file);
      loaded.push({
        file,
        name: file.webkitRelativePath || file.name || `frame_${index + 1}.png`,
        sourceUrl,
        sourceBitmap: bitmap,
        sourceWidth: bitmap.width,
        sourceHeight: bitmap.height,
        sourceBytes: file.size || 0,
        processedUrl: "",
        processedBitmap: null,
        processedWidth: 0,
        processedHeight: 0,
        processedBytes: 0,
      });
      if (index % 8 === 0) {
        setStatus(`\u6b63\u5728\u8f7d\u5165 ${index + 1} / ${imageFiles.length} \u5e27...`);
        await nextFrame();
      }
    }
    state.frames = loaded;
    renderFrameStrip();
    updateStats();
    renderCurrentFrame();
    syncButtons();
    startPlayback();
    setStatus(`\u5df2\u8f7d\u5165 ${loaded.length} \u5e27\u3002\u9009\u8def\u7ebf\u548c\u76ee\u6807\u9ad8\u5ea6\u540e\u70b9\u201c\u751f\u6210\u5bf9\u6bd4\u201d\u3002`, "ok");
  } catch (error) {
    clearFrames();
    setStatus(error?.message || String(error), "warn");
  } finally {
    setBusy(false);
    syncButtons();
  }
}

async function processAllFrames() {
  if (!state.frames.length || state.processing) {
    return;
  }

  stopPlayback();
  setBusy(true);
  state.processing = true;
  clearProcessedFrames();
  setStatus("\u6b63\u5728\u4e0a\u4f20\u5e27\u5e76\u5904\u7406...");

  try {
    const form = new FormData();
    state.frames.forEach((frame) => {
      form.append("frames", frame.file, frame.name);
    });
    form.append("method", els.methodInput.value);
    form.append("scale", String(clamp(Number(els.scaleInput.value) || 0.5, 0.05, 2)));
    form.append("alpha_cutoff", els.alphaCutoffInput.value);
    form.append("sharpen_percent", els.sharpenInput.value);
    form.append("color_count", els.colorCountInput.value);

    const response = await fetch("/api/line-cleaner-process", {
      method: "POST",
      body: form,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "line cleaner process failed");
    }

    const resultFrames = data.result.frames || [];
    for (const resultFrame of resultFrames) {
      const frame = state.frames[resultFrame.index];
      if (!frame) {
        continue;
      }
      releaseProcessedFrame(frame);
      frame.processedUrl = `${resultFrame.url}?ts=${Date.now()}`;
      frame.processedWidth = Number(resultFrame.width || 0);
      frame.processedHeight = Number(resultFrame.height || 0);
      frame.processedBytes = Number(resultFrame.bytes || 0);
      frame.processedBitmap = await loadImage(frame.processedUrl);
      state.currentIndex = resultFrame.index;
      updateStats();
      renderCurrentFrame();
      setStatus(`\u5df2\u63a5\u6536 ${resultFrame.index + 1} / ${resultFrames.length} \u5e27...`);
      await nextFrame();
    }

    updateStats();
    renderCurrentFrame();
    startPlayback();
    setStatus(formatDoneStatus(data.result), "ok");
  } catch (error) {
    setStatus(error?.message || String(error), "warn");
  } finally {
    state.processing = false;
    setBusy(false);
    syncButtons();
  }
}

function renderCurrentFrame() {
  const frame = state.frames[state.currentIndex];
  if (!frame) {
    drawEmptyCanvases();
    updateFrameLabel();
    return;
  }

  drawImageToCanvas(els.sourceCanvas, frame.sourceBitmap);
  drawImageToCanvas(els.processedCanvas, frame.processedBitmap || frame.sourceBitmap);
  updateFrameLabel();
  updateActiveThumb();
}

function drawImageToCanvas(canvas, image) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  if (!image) {
    return;
  }

  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  const fitScale = Math.min(width / sourceWidth, height / sourceHeight);
  const scale = fitScale * state.previewZoom;
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
  const x = Math.round((width - drawWidth) / 2);
  const y = Math.round((height - drawHeight) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
}

function drawEmptyCanvases() {
  drawImageToCanvas(els.sourceCanvas, null);
  drawImageToCanvas(els.processedCanvas, null);
}

function renderFrameStrip() {
  els.frameStrip.innerHTML = "";
  state.frames.forEach((frame, index) => {
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = frame.sourceUrl;
    img.alt = `frame ${index + 1}`;
    img.addEventListener("click", () => {
      state.currentIndex = index;
      restartPlayback(false);
      renderCurrentFrame();
    });
    els.frameStrip.appendChild(img);
  });
  updateActiveThumb();
}

function updateActiveThumb() {
  els.frameStrip.querySelectorAll(".thumb").forEach((thumb, index) => {
    thumb.classList.toggle("active", index === state.currentIndex);
  });
}

function updateFrameLabel() {
  const total = state.frames.length;
  const frame = state.frames[state.currentIndex];
  els.frameLabel.textContent = total ? `#${String(state.currentIndex + 1).padStart(3, "0")} / ${total}` : "#000";
  els.frameName.textContent = frame ? frame.name : "-";
}

function updateStats() {
  const totalFrames = state.frames.length;
  const sourceBytes = sum(state.frames.map((frame) => frame.sourceBytes));
  const processedFrames = state.frames.filter((frame) => frame.processedUrl);
  const processedBytes = sum(processedFrames.map((frame) => frame.processedBytes));
  const maxProcessedWidth = Math.max(0, ...processedFrames.map((frame) => frame.processedWidth));
  const maxProcessedHeight = Math.max(0, ...processedFrames.map((frame) => frame.processedHeight));
  const maxSourceWidth = Math.max(0, ...state.frames.map((frame) => frame.sourceWidth));
  const maxSourceHeight = Math.max(0, ...state.frames.map((frame) => frame.sourceHeight));
  const ratio = sourceBytes > 0 && processedBytes > 0 ? 1 - processedBytes / sourceBytes : null;

  els.frameCount.textContent = String(totalFrames);
  els.sourceBytes.textContent = sourceBytes ? formatBytes(sourceBytes) : "-";
  els.processedBytes.textContent = processedBytes ? formatBytes(processedBytes) : "-";
  els.canvasSize.textContent = processedFrames.length
    ? `${maxProcessedWidth} x ${maxProcessedHeight}`
    : maxSourceWidth
      ? `${maxSourceWidth} x ${maxSourceHeight}`
      : "-";
  els.savingRatio.textContent = ratio === null ? "-" : `${Math.round(ratio * 100)}%`;
}

function togglePlayback() {
  if (state.playing) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

function startPlayback() {
  if (!state.frames.length || state.playing) {
    return;
  }
  state.playing = true;
  state.playbackStartedAt = performance.now();
  state.playbackStartIndex = state.currentIndex;
  els.playButton.textContent = "\u6682\u505c";
  tickPlayback();
}

function stopPlayback() {
  state.playing = false;
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  if (els.playButton) {
    els.playButton.textContent = "\u64ad\u653e";
  }
}

function restartPlayback(autoplay = state.playing) {
  stopPlayback();
  state.currentIndex = 0;
  renderCurrentFrame();
  if (autoplay) {
    startPlayback();
  }
}

function tickPlayback() {
  if (!state.playing) {
    return;
  }
  const fps = clamp(Math.round(Number(els.fpsInput.value) || 12), 1, 60);
  const elapsed = performance.now() - state.playbackStartedAt;
  const step = Math.floor(elapsed / (1000 / fps));
  const nextIndex = (state.playbackStartIndex + step) % state.frames.length;
  if (nextIndex !== state.currentIndex) {
    state.currentIndex = nextIndex;
    renderCurrentFrame();
  }
  state.rafId = requestAnimationFrame(tickPlayback);
}

async function downloadCurrentFrame() {
  const frame = state.frames[state.currentIndex];
  if (!frame?.processedUrl) {
    return;
  }
  downloadBlob(await fetchBlob(frame.processedUrl), processedFileName(frame.name, state.currentIndex));
}

async function downloadAllFrames() {
  const frames = state.frames.filter((frame) => frame.processedUrl);
  if (!frames.length) {
    return;
  }
  setStatus("\u6b63\u5728\u6253\u5305 TAR...");
  const parts = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const bytes = new Uint8Array(await (await fetchBlob(frame.processedUrl)).arrayBuffer());
    parts.push(createTarHeader(processedFileName(frame.name, index), bytes.length));
    parts.push(bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding > 0) {
      parts.push(new Uint8Array(padding));
    }
  }
  parts.push(new Uint8Array(1024));
  downloadBlob(new Blob(parts, { type: "application/x-tar" }), "sprite-shrink-processed-frames.tar");
  setStatus("\u5df2\u751f\u6210 TAR \u4e0b\u8f7d\u3002", "ok");
}

function createTarHeader(name, size) {
  const header = new Uint8Array(512);
  const write = (value, offset, length) => {
    const text = String(value).slice(0, length);
    for (let index = 0; index < text.length; index += 1) {
      header[offset + index] = text.charCodeAt(index) & 0xff;
    }
  };
  const writeOctal = (value, offset, length) => {
    const text = value.toString(8).padStart(length - 1, "0").slice(-(length - 1)) + "\0";
    write(text, offset, length);
  };

  write(sanitizeTarName(name), 0, 100);
  writeOctal(0o644, 100, 8);
  writeOctal(0, 108, 8);
  writeOctal(0, 116, 8);
  writeOctal(size, 124, 12);
  writeOctal(Math.floor(Date.now() / 1000), 136, 12);
  for (let index = 148; index < 156; index += 1) {
    header[index] = 32;
  }
  header[156] = "0".charCodeAt(0);
  write("ustar", 257, 6);
  write("00", 263, 2);

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  write(checksum.toString(8).padStart(6, "0"), 148, 6);
  header[154] = 0;
  header[155] = 32;
  return header;
}

function setBusy(isBusy) {
  els.processButton.disabled = isBusy || state.frames.length === 0;
  els.fileInput.disabled = isBusy;
  els.folderInput.disabled = isBusy;
  els.methodInput.disabled = isBusy;
}

function syncButtons() {
  const hasFrames = state.frames.length > 0;
  const hasProcessed = state.frames.some((frame) => frame.processedUrl);
  els.processButton.disabled = !hasFrames || state.processing;
  els.playButton.disabled = !hasFrames;
  els.restartButton.disabled = !hasFrames;
  els.downloadCurrentButton.disabled = !hasProcessed;
  els.downloadAllButton.disabled = !hasProcessed;
  els.zoomOutButton.disabled = !hasFrames || state.previewZoom <= 0.25;
  els.zoomInButton.disabled = !hasFrames || state.previewZoom >= 4;
}

function clearFrames() {
  state.frames.forEach((frame) => {
    URL.revokeObjectURL(frame.sourceUrl);
    if (frame.sourceBitmap?.close) {
      frame.sourceBitmap.close();
    }
    releaseProcessedFrame(frame);
  });
  state.frames = [];
  els.frameStrip.innerHTML = "";
  updateStats();
  syncButtons();
}

function clearProcessedFrames() {
  state.frames.forEach(releaseProcessedFrame);
  updateStats();
  syncButtons();
}

function releaseProcessedFrame(frame) {
  frame.processedUrl = "";
  frame.processedBitmap = null;
  frame.processedWidth = 0;
  frame.processedHeight = 0;
  frame.processedBytes = 0;
}

function setStatus(message, tone = "") {
  els.status.textContent = message;
  els.status.className = `status ${tone}`.trim();
}

function setPreviewZoom(value) {
  state.previewZoom = clamp(Math.round(value * 4) / 4, 0.25, 4);
  els.zoomLabel.textContent = `${Math.round(state.previewZoom * 100)}%`;
  renderCurrentFrame();
  syncButtons();
}

function formatDoneStatus(result) {
  const method = result.method === "realesrgan_anime" ? "Real-ESRGAN anime" : "Lanczos";
  return `${method} \u5904\u7406\u5b8c\u6210\uff1a${result.frame_count} \u5e27\uff0c\u8f93\u51fa\u500d\u6570 ${result.scale}\u3002`;
}

function sortFiles(files) {
  return [...files].sort((a, b) => {
    const left = a.webkitRelativePath || a.name || "";
    const right = b.webkitRelativePath || b.name || "";
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  });
}

function isSupportedImageFile(file) {
  const name = (file.name || "").toLowerCase();
  return /\.(png|jpe?g|webp|bmp)$/u.test(name) || (file.type || "").startsWith("image/");
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("failed to load processed preview"));
    image.src = url;
  });
}

async function fetchBlob(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("failed to download processed frame");
  }
  return response.blob();
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function processedFileName(name, index) {
  const base = String(name || `frame_${index + 1}`)
    .replace(/\\/gu, "/")
    .split("/")
    .pop()
    .replace(/\.[^.]+$/u, "");
  const prefix = String(index + 1).padStart(3, "0");
  return `${prefix}-${sanitizeFilePart(base || `frame_${index + 1}`)}.png`;
}

function sanitizeFilePart(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "frame";
}

function sanitizeTarName(name) {
  const ascii = `${sanitizeFilePart(name.replace(/\.[^.]+$/iu, ""))}.png`;
  return ascii.length <= 100 ? ascii : `${ascii.slice(0, 96)}.png`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
