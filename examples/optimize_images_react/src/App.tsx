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

interface BatchItem {
  id: string;
  name: string;
  originalSize: number;
  originalWidth?: number;
  originalHeight?: number;
  processedSize?: number;
  processedUrl?: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
}

export default function App() {
  const [activeMode, setActiveMode] = useState<'single' | 'batch'>('single');

  // ——— Single Mode States ———
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [imageSize, setImageSize] = useState(0);
  const [naturalDims, setNaturalDims] = useState({ w: 0, h: 0 });

  const [processed, setProcessed] = useState<ProcessedResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const cropBoxRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, panX: 0, panY: 0 });

  // ——— Batch Mode States ———
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);

  // ——— Single Mode Helpers ———
  const getCoverScale = useCallback(() => {
    const box = cropBoxRef.current;
    if (!box || !naturalDims.w) return 1;
    const r = box.getBoundingClientRect();
    return Math.max(r.width / naturalDims.w, r.height / naturalDims.h);
  }, [naturalDims]);

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

  const applyZoom = (nextZoom: number) => {
    const z = Math.max(1, Math.min(5, nextZoom));
    setZoom(z);
    setPan((prev) => clampPan(prev.x, prev.y, z));
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    applyZoom(zoom - e.deltaY * 0.002);
  };

  const handleProcess = async () => {
    if (!imageUrl || !naturalDims.w) return;
    setIsProcessing(true);
    try {
      const freshImg = await loadImage(imageUrl);
      const box = cropBoxRef.current;
      if (!box) throw new Error('Crop box not mounted');
      const r = box.getBoundingClientRect();
      const cs = getCoverScale() * zoom;

      const imgLeft = (r.width - naturalDims.w * cs) / 2 + pan.x;
      const imgTop = (r.height - naturalDims.h * cs) / 2 + pan.y;

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

      const result = await processProfileAsset(freshImg, cropData);
      setProcessed({ ...result, cropData });
    } catch (err) {
      console.error('Processing failed:', err);
    } finally {
      setIsProcessing(false);
    }
  };

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

  // ——— Batch Mode Helpers ———
  const handleBatchFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    // Convert FileList to Array and filter images
    const targetFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (targetFiles.length === 0) return;

    // Build pending items state
    const newItems: BatchItem[] = targetFiles.map(file => ({
      id: Math.random().toString(36).substring(2, 9),
      name: file.name,
      originalSize: file.size,
      status: 'pending',
    }));

    setBatchItems(prev => [...prev, ...newItems]);
    e.target.value = '';

    // Process each image sequentially
    for (let i = 0; i < targetFiles.length; i++) {
      const file = targetFiles[i];
      const item = newItems[i];

      setBatchItems(prev =>
        prev.map(x => (x.id === item.id ? { ...x, status: 'processing' } : x))
      );

      try {
        const objectUrl = URL.createObjectURL(file);
        const imgElement = await loadImage(objectUrl);
        
        const w = imgElement.naturalWidth;
        const h = imgElement.naturalHeight;
        
        // Auto-Crop Math: target aspect ratio is 4/5 (0.8)
        // Center horizontally, align to the top vertically (y = 0)
        const ratio = w / h;
        const targetRatio = 4 / 5;
        let cropX = 0;
        let cropY = 0;
        let cropW = w;
        let cropH = h;

        if (ratio > targetRatio) {
          // Wider than 4:5 - crop sides, keep full height (so y = 0 spans full height)
          cropH = h;
          cropW = Math.round(h * targetRatio);
          cropX = Math.round((w - cropW) / 2);
          cropY = 0;
        } else {
          // Taller than 4:5 - crop bottom, keep full width, lock to top y = 0
          cropW = w;
          cropH = Math.round(w / targetRatio);
          cropX = 0;
          cropY = 0;
        }

        const cropData: CropData = {
          x: cropX,
          y: cropY,
          width: cropW,
          height: cropH,
        };

        const result = await processProfileAsset(imgElement, cropData);
        URL.revokeObjectURL(objectUrl);

        setBatchItems(prev =>
          prev.map(x =>
            x.id === item.id
              ? {
                  ...x,
                  status: 'done',
                  originalWidth: w,
                  originalHeight: h,
                  processedSize: result.blob.size,
                  processedUrl: result.url,
                }
              : x
          )
        );
      } catch (err: any) {
        console.error('Failed to process batch item:', file.name, err);
        setBatchItems(prev =>
          prev.map(x =>
            x.id === item.id
              ? {
                  ...x,
                  status: 'error',
                  error: err.message || 'Processing failed',
                }
              : x
          )
        );
      }
    }
  };

  const handleDownloadBatchItem = (item: BatchItem) => {
    if (!item.processedUrl) return;
    const a = document.createElement('a');
    a.href = item.processedUrl;
    a.download = `${item.name.replace(/\.[^/.]+$/, '')}_${TARGET_WIDTH}x${TARGET_HEIGHT}.jpg`;
    a.click();
  };

  const handleDownloadAllBatch = () => {
    const doneItems = batchItems.filter(item => item.status === 'done' && item.processedUrl);
    doneItems.forEach((item, index) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = item.processedUrl!;
        a.download = `${item.name.replace(/\.[^/.]+$/, '')}_${TARGET_WIDTH}x${TARGET_HEIGHT}.jpg`;
        a.click();
      }, index * 250); // space downloads to prevent browser blocking
    });
  };

  const handleClearBatch = () => {
    batchItems.forEach(item => {
      if (item.processedUrl) URL.revokeObjectURL(item.processedUrl);
    });
    setBatchItems([]);
  };

  // ——— Derived display values (Single Mode) ———
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

      {/* Mode Selector Tabs */}
      <div className="tab-container">
        <button
          onClick={() => setActiveMode('single')}
          className={`tab-btn ${activeMode === 'single' ? 'active' : ''}`}
        >
          Single Image Editor
        </button>
        <button
          onClick={() => setActiveMode('batch')}
          className={`tab-btn ${activeMode === 'batch' ? 'active' : ''}`}
        >
          Batch Auto-Cropper
        </button>
      </div>

      <main className="main">
        {activeMode === 'single' ? (
          /* ——— SINGLE IMAGE EDITOR MODE ——— */
          imageUrl ? (
            <div className="editor">
              <div className="info-bar">
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
                <button className="reset-btn" onClick={handleReset}>✕ Reset</button>
              </div>

              <div className="editor-body">
                <div className="viewport-panel">
                  <div
                    ref={cropBoxRef}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onWheel={onWheel}
                    className="viewport"
                  >
                    <img
                      src={imageUrl}
                      alt={imageName}
                      onLoad={onImageLoad}
                      draggable={false}
                      className="viewport-image"
                      style={{
                        width: displayW || 'auto',
                        height: displayH || 'auto',
                        transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
                      }}
                    />
                    
                    {/* Shroud overlays around the 4:5 aperture */}
                    <div className="shroud">
                      <div className="shroud-row" />
                      <div className="shroud-middle" style={{ height: 350 }}>
                        <div className="shroud-cell" />
                        <div className="aperture" style={{ width: 280, height: 350 }} />
                        <div className="shroud-cell" />
                      </div>
                      <div className="shroud-row" />
                    </div>
                  </div>

                  <div className="zoom-controls">
                    <button className="zoom-btn" onClick={() => applyZoom(zoom - 0.15)}>−</button>
                    <span className="zoom-level">{(zoom * 100).toFixed(0)}%</span>
                    <button className="zoom-btn" onClick={() => applyZoom(zoom + 0.15)}>+</button>
                  </div>
                  <div className="viewport-hint">Drag to Pan · Scroll to Zoom</div>
                </div>

                <div className="result-panel">
                  <div className="action-section">
                    <h3>Pipeline Blueprint</h3>
                    <div className="pipeline-steps">
                      <div className="step">
                        <span className="step-num">1</span>
                        <div>
                          <strong>Crop Frame</strong>
                          <p>Isolates a 4:5 aspect ratio region.</p>
                        </div>
                      </div>
                      <div className="step">
                        <span className="step-num">2</span>
                        <div>
                          <strong>Resize Dims</strong>
                          <p>Scales exactly to {TARGET_WIDTH}×{TARGET_HEIGHT}px.</p>
                        </div>
                      </div>
                      <div className="step">
                        <span className="step-num">3</span>
                        <div>
                          <strong>JPEG Compress</strong>
                          <p>Shrinks file size using {Math.round(JPEG_QUALITY * 100)}% quality compression.</p>
                        </div>
                      </div>
                    </div>
                    <button
                      className="process-button"
                      onClick={handleProcess}
                      disabled={isProcessing || !naturalDims.w}
                    >
                      {isProcessing ? <span className="spinner" /> : <>✦ Process Image</>}
                    </button>
                  </div>

                  {processed && (
                    <div className="result-section">
                      <h3>Refined Asset</h3>
                      <div className="result-preview-wrap">
                        <img src={processed.url} alt="Processed output" className="result-preview" />
                      </div>
                      <div className="result-stats">
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
                      </div>
                      <button className="download-button" onClick={handleDownload}>
                        ⬇ Download Asset
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="upload-zone">
              <div className="upload-content">
                <div className="upload-icon">📷</div>
                <h2>Optimize Single Profile Asset</h2>
                <p>Drag, zoom, and crop a custom image to fit the 1080×1350px Tinder-style aspect ratio.</p>
                <div className="upload-buttons">
                  <label className="upload-button" htmlFor="single-file-input">
                    Choose Image
                  </label>
                  <input
                    id="single-file-input"
                    type="file"
                    accept="image/*"
                    onChange={onFileChange}
                    hidden
                  />
                  <button className="sample-button" onClick={loadSample}>
                    Load Sample
                  </button>
                </div>
                <div className="spec-badge">
                  <span>Target: {TARGET_WIDTH}×{TARGET_HEIGHT}px</span>
                  <span>•</span>
                  <span>Format: JPEG (75% Q)</span>
                </div>
              </div>
            </div>
          )
        ) : (
          /* ——— BATCH AUTO-CROPTER MODE ——— */
          <div className="batch-workspace">
            <div className="batch-controls">
              <label className="upload-button" htmlFor="batch-file-input">
                Add Images to Batch
              </label>
              <input
                id="batch-file-input"
                type="file"
                accept="image/*"
                multiple
                onChange={handleBatchFileChange}
                hidden
              />
              
              {batchItems.length > 0 && (
                <>
                  <button
                    className="sample-button"
                    onClick={handleDownloadAllBatch}
                    disabled={!batchItems.some(x => x.status === 'done')}
                  >
                    ⬇ Download All
                  </button>
                  <button
                    className="reset-btn"
                    onClick={handleClearBatch}
                    style={{ margin: 0 }}
                  >
                    ✕ Clear Batch
                  </button>
                </>
              )}
              
              <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
                Rule: Auto center-horizontal, align to top-vertical (y = 0)
              </div>
            </div>

            {batchItems.length > 0 ? (
              <div className="batch-grid">
                {batchItems.map(item => (
                  <div key={item.id} className="batch-card">
                    <div className="batch-preview-wrap">
                      {item.processedUrl ? (
                        <img src={item.processedUrl} alt={item.name} className="batch-preview" />
                      ) : (
                        <span style={{ fontSize: '24px' }}>🖼️</span>
                      )}

                      {item.status !== 'done' && (
                        <div className="batch-card-status">
                          {item.status === 'processing' ? (
                            <>
                              <span className="spinner" style={{ borderTopColor: 'var(--accent-gold)' }} />
                              <span>Processing...</span>
                            </>
                          ) : item.status === 'pending' ? (
                            <span>Waiting...</span>
                          ) : (
                            <span style={{ color: 'var(--accent-red)' }}>Error</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="batch-card-info">
                      <div className="batch-card-title" title={item.name}>
                        {item.name}
                      </div>

                      <div className="batch-card-stats">
                        <div className="batch-card-stat">
                          <span>Original size:</span>
                          <span className="batch-card-stat-val">
                            {formatBytes(item.originalSize)}
                          </span>
                        </div>
                        {item.status === 'done' && item.processedSize && (
                          <>
                            <div className="batch-card-stat">
                              <span>Output size:</span>
                              <span className="batch-card-stat-val">
                                {formatBytes(item.processedSize)}
                              </span>
                            </div>
                            <div className="batch-card-stat">
                              <span>Compression:</span>
                              <span className="batch-card-stat-val highlight">
                                {((1 - item.processedSize / item.originalSize) * 100).toFixed(1)}% saved
                              </span>
                            </div>
                            <div className="batch-card-stat">
                              <span>Orig. Dims:</span>
                              <span className="batch-card-stat-val">
                                {item.originalWidth}×{item.originalHeight}
                              </span>
                            </div>
                          </>
                        )}
                        {item.status === 'error' && (
                          <div className="batch-card-stat" style={{ color: 'var(--accent-red)' }}>
                            <span>Failed: {item.error}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {item.status === 'done' && (
                      <button
                        className="download-button"
                        onClick={() => handleDownloadBatchItem(item)}
                        style={{ padding: '8px', fontSize: '12px' }}
                      >
                        ⬇ Download
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="upload-zone" style={{ padding: 0 }}>
                <div className="upload-content" style={{ padding: '48px 24px' }}>
                  <div className="upload-icon">📚</div>
                  <h2>Batch Auto-Crop & Optimize</h2>
                  <p>
                    Select multiple character portraits. The pipeline will automatically crop them
                    (centered horizontally, aligned to the top) and compress them into 1080×1350px JPEGs.
                  </p>
                  <label className="upload-button" htmlFor="batch-file-input-empty">
                    Choose Multiple Images
                  </label>
                  <input
                    id="batch-file-input-empty"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleBatchFileChange}
                    hidden
                  />
                </div>
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
