import { useState, useCallback, useRef } from 'react';
import {
  loadImage,
  processProfileAsset,
  formatBytes,
  TARGET_WIDTH,
  TARGET_HEIGHT,
  JPEG_QUALITY,
  type CropData,
} from './lib/imageProcessing';
import './App.css';

interface ProcessedResult {
  url: string;
  blob: Blob;
  width: number;
  height: number;
  cropData?: CropData;
}

export default function App() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [imageSize, setImageSize] = useState(0);
  const [naturalDims, setNaturalDims] = useState({ w: 0, h: 0 });

  const [processed, setProcessed] = useState<ProcessedResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // — Crop viewport state —
  const cropBoxRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1); // 1 = image covers crop box, >1 = zoomed in
  const [pan, setPan] = useState({ x: 0, y: 0 }); // screen-px offset from center
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, panX: 0, panY: 0 });

  // ——— Helpers ———

  /** Scale at which the image exactly covers the 4:5 crop box */
  const getCoverScale = useCallback(() => {
    const box = cropBoxRef.current;
    if (!box || !naturalDims.w) return 1;
    const r = box.getBoundingClientRect();
    return Math.max(r.width / naturalDims.w, r.height / naturalDims.h);
  }, [naturalDims]);

  /** Clamp pan so the image always fully covers the crop box */
  const clampPan = useCallback(
    (px: number, py: number, z: number) => {
      const box = cropBoxRef.current;
      if (!box || !naturalDims.w) return { x: 0, y: 0 };
      const r = box.getBoundingClientRect();
      const cs = getCoverScale() * z;
      const dw = naturalDims.w * cs;
      const dh = naturalDims.h * cs;
      const maxX = Math.max(0, (dw - r.width) / 2);
      const maxY = Math.max(0, (dh - r.height) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, px)),
        y: Math.max(-maxY, Math.min(maxY, py)),
      };
    },
    [naturalDims, getCoverScale],
  );

  // ——— File handling ———

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setImageName(file.name);
    setImageSize(file.size);
    setProcessed(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const loadSample = useCallback(async () => {
    try {
      const resp = await fetch('/sample.jpg');
      if (!resp.ok) return;
      const blob = await resp.blob();
      handleFile(new File([blob], 'sample_profile.jpg', { type: blob.type || 'image/jpeg' }));
    } catch (err) {
      console.error('Failed to load sample:', err);
    }
  }, [handleFile]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setNaturalDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
  };

  // ——— Pan (drag) ———

  const onPointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan(clampPan(dragRef.current.panX + dx, dragRef.current.panY + dy, zoom));
  };

  const onPointerUp = () => setIsDragging(false);

  // ——— Zoom ———

  const applyZoom = (nextZoom: number) => {
    const z = Math.max(1, Math.min(5, nextZoom));
    setZoom(z);
    setPan((prev) => clampPan(prev.x, prev.y, z));
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    applyZoom(zoom - e.deltaY * 0.002);
  };

  // ——— Process ———

  const handleProcess = async () => {
    if (!imageUrl || !naturalDims.w) return;
    setIsProcessing(true);
    try {
      const freshImg = await loadImage(imageUrl);
      const box = cropBoxRef.current;
      if (!box) throw new Error('Crop box not mounted');
      const r = box.getBoundingClientRect();

      const cs = getCoverScale() * zoom;

      // Image top-left in crop-box space (centered + pan)
      const imgLeft = (r.width - naturalDims.w * cs) / 2 + pan.x;
      const imgTop = (r.height - naturalDims.h * cs) / 2 + pan.y;

      // Map the crop-box window back to natural image pixels
      const cropX = Math.max(0, Math.round(-imgLeft / cs));
      const cropY = Math.max(0, Math.round(-imgTop / cs));
      const cropW = Math.round(r.width / cs);
      const cropH = Math.round(r.height / cs);

      const cropData: CropData = {
        x: cropX,
        y: cropY,
        width: Math.min(cropW, naturalDims.w - cropX),
        height: Math.min(cropH, naturalDims.h - cropY),
      };

      console.log('Crop data:', cropData, '| scale:', cs, '| pan:', pan);

      const result = await processProfileAsset(freshImg, cropData);
      setProcessed({ ...result, cropData });
    } catch (err) {
      console.error('Processing failed:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // ——— Download / Reset ———

  const handleDownload = () => {
    if (!processed) return;
    const a = document.createElement('a');
    a.href = processed.url;
    a.download = `${imageName.replace(/\.[^/.]+$/, '')}_${TARGET_WIDTH}x${TARGET_HEIGHT}.jpg`;
    a.click();
  };

  const handleReset = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (processed) URL.revokeObjectURL(processed.url);
    setImageUrl(null);
    setImageName('');
    setImageSize(0);
    setNaturalDims({ w: 0, h: 0 });
    setProcessed(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // ——— Derived display values ———

  const effectiveScale = getCoverScale() * zoom;
  const displayW = naturalDims.w * effectiveScale;
  const displayH = naturalDims.h * effectiveScale;

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">✦</span>
            <h1>Image Alchemist</h1>
          </div>
          <p className="subtitle">
            Crop · Resize · Compress — Tavern Swiper Profile Spec
          </p>
        </div>
      </header>

      <main className="main" style={{ padding: 24, overflow: 'auto', flexDirection: 'column' }}>
        {/* Controls */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center' }}>
          <label className="upload-button" htmlFor="file-input">Choose File</label>
          <input id="file-input" type="file" accept="image/*" onChange={onFileChange} hidden />
          <button className="sample-button" onClick={loadSample}>Load Sample</button>
          {imageUrl && (
            <button className="reset-btn" onClick={handleReset}>✕ Reset</button>
          )}
        </div>

        {imageUrl && (
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            {/* ——— Source / Crop Panel ——— */}
            <div style={{ flex: '1 1 400px', minWidth: 300 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-gold)', marginBottom: 12 }}>
                Source — Drag to pan, scroll to zoom
              </h3>

              {/* Info chips */}
              <div className="info-bar" style={{ marginBottom: 12 }}>
                <div className="info-chip">
                  <span className="info-label">File</span>
                  <span className="info-value">
                    {imageName.length > 28 ? imageName.slice(0, 25) + '…' : imageName}
                  </span>
                </div>
                {naturalDims.w > 0 && (
                  <div className="info-chip">
                    <span className="info-label">Dims</span>
                    <span className="info-value">{naturalDims.w}×{naturalDims.h}</span>
                  </div>
                )}
                <div className="info-chip">
                  <span className="info-label">Size</span>
                  <span className="info-value">{formatBytes(imageSize)}</span>
                </div>
              </div>

              {/* ——— Crop Viewport ——— */}
              <div
                ref={cropBoxRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onWheel={onWheel}
                style={{
                  width: '100%',
                  maxWidth: 500,
                  aspectRatio: '4 / 5',
                  overflow: 'hidden',
                  position: 'relative',
                  borderRadius: 'var(--radius-md)',
                  border: '2px solid var(--border-accent)',
                  background: '#111',
                  cursor: isDragging ? 'grabbing' : 'grab',
                  touchAction: 'none',
                  userSelect: 'none',
                }}
              >
                {/* The image — absolutely positioned, transformed via left/top */}
                <img
                  src={imageUrl}
                  alt={imageName}
                  onLoad={onImageLoad}
                  draggable={false}
                  style={{
                    position: 'absolute',
                    width: displayW || 'auto',
                    height: displayH || 'auto',
                    left: '50%',
                    top: '50%',
                    transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
                    pointerEvents: 'none',
                  }}
                />
                {/* Corner marks */}
                <div style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  border: '2px solid rgba(255,255,255,0.15)',
                }}>
                  {/* Top-left corner */}
                  <div style={{
                    position: 'absolute', top: -1, left: -1,
                    width: 24, height: 24,
                    borderTop: '3px solid var(--accent-gold)',
                    borderLeft: '3px solid var(--accent-gold)',
                  }} />
                  {/* Bottom-right corner */}
                  <div style={{
                    position: 'absolute', bottom: -1, right: -1,
                    width: 24, height: 24,
                    borderBottom: '3px solid var(--accent-gold)',
                    borderRight: '3px solid var(--accent-gold)',
                  }} />
                </div>
              </div>

              {/* Zoom bar */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                marginTop: 12, maxWidth: 500,
              }}>
                <button className="zoom-btn" onClick={() => applyZoom(zoom - 0.15)} title="Zoom Out">−</button>
                <div style={{
                  flex: 1, height: 4, background: 'var(--bg-elevated)',
                  borderRadius: 2, position: 'relative',
                }}>
                  <div style={{
                    position: 'absolute', top: -4, height: 12, width: 12,
                    borderRadius: '50%', background: 'var(--accent-gold)',
                    left: `${((zoom - 1) / 4) * 100}%`,
                    transform: 'translateX(-50%)',
                    transition: 'left 0.1s',
                  }} />
                </div>
                <button className="zoom-btn" onClick={() => applyZoom(zoom + 0.15)} title="Zoom In">+</button>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 44, textAlign: 'right' }}>
                  {(zoom * 100).toFixed(0)}%
                </span>
              </div>

              {/* Process button */}
              <div style={{ marginTop: 20, maxWidth: 500 }}>
                <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                  Pipeline: crop visible region → resize to {TARGET_WIDTH}×{TARGET_HEIGHT} → JPEG {Math.round(JPEG_QUALITY * 100)}%
                </div>
                <button
                  className="process-button"
                  onClick={handleProcess}
                  disabled={isProcessing || !naturalDims.w}
                >
                  {isProcessing ? <span className="spinner" /> : <>✦ Finalize Ritual</>}
                </button>
              </div>
            </div>

            {/* ——— Result Panel ——— */}
            {processed && (
              <div style={{ flex: '1 1 300px', minWidth: 260, animation: 'fadeIn 0.4s ease' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-gold)', marginBottom: 12 }}>
                  Result
                </h3>
                <img
                  src={processed.url}
                  alt="Processed"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '60vh',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    boxShadow: 'var(--shadow-card)',
                  }}
                />
                <div className="result-stats" style={{ marginTop: 16 }}>
                  <div className="stat">
                    <span className="stat-label">Output</span>
                    <span className="stat-value">{processed.width}×{processed.height}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">File Size</span>
                    <span className="stat-value">{formatBytes(processed.blob.size)}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Reduction</span>
                    <span className="stat-value highlight">
                      {((1 - processed.blob.size / imageSize) * 100).toFixed(1)}%
                    </span>
                  </div>
                  {processed.cropData && (
                    <div className="stat">
                      <span className="stat-label">Crop</span>
                      <span className="stat-value mono">
                        ({processed.cropData.x}, {processed.cropData.y}) {processed.cropData.width}×{processed.cropData.height}
                      </span>
                    </div>
                  )}
                </div>
                <button className="download-button" onClick={handleDownload} style={{ marginTop: 8 }}>
                  ⬇ Download
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="footer">
        <p>
          Standalone web port of the Tavern Swiper client-side image pipeline.
          Uses Canvas API for crop, resize &amp; JPEG compression.
        </p>
      </footer>
    </div>
  );
}
