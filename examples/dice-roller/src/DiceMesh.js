import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { createDieGeometry, DICE_TYPES } from './diceConfig';

/**
 * Create a texture for a square face (d6).
 * Number centered with rounded-rect border.
 */
function createSquareTexture(value) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');

  // Background
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size*0.7);
  g.addColorStop(0, '#2a3a5c'); g.addColorStop(1, '#1a2744');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

  // Border
  ctx.strokeStyle = 'rgba(245,158,11,0.3)'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.roundRect(4, 4, size-8, size-8, 16); ctx.stroke();

  // Number
  const fontSize = size * 0.4;
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillText(String(value), size/2+2, size/2+2);
  const tg = ctx.createLinearGradient(size*0.3, size*0.3, size*0.7, size*0.7);
  tg.addColorStop(0, '#fde68a'); tg.addColorStop(0.5, '#f59e0b'); tg.addColorStop(1, '#d97706');
  ctx.fillStyle = tg; ctx.fillText(String(value), size/2, size/2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Create a texture for a triangular face (d4, d8, d20).
 */
function createTriangleTexture(value) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#1a2744';
  ctx.fillRect(0, 0, size, size);

  const tri = [[0.5*size, 0.12*size], [0.08*size, 0.88*size], [0.92*size, 0.88*size]];
  ctx.beginPath();
  ctx.moveTo(tri[0][0], tri[0][1]);
  ctx.lineTo(tri[1][0], tri[1][1]);
  ctx.lineTo(tri[2][0], tri[2][1]);
  ctx.closePath();
  const g = ctx.createRadialGradient(size/2, size*0.6, 0, size/2, size*0.6, size*0.5);
  g.addColorStop(0, '#2a3a5c'); g.addColorStop(1, '#1e2d4a');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(245,158,11,0.2)'; ctx.lineWidth = 2; ctx.stroke();

  const cx = size * 0.5;
  const cy = size * 0.63;
  const fontSize = value >= 10 ? size * 0.22 : size * 0.28;
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillText(String(value), cx+2, cy+2);
  const tg = ctx.createLinearGradient(cx-20, cy-20, cx+20, cy+20);
  tg.addColorStop(0, '#fde68a'); tg.addColorStop(0.5, '#f59e0b'); tg.addColorStop(1, '#d97706');
  ctx.fillStyle = tg; ctx.fillText(String(value), cx, cy);

  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Create a texture for a pentagonal face (d12).
 */
function createPentagonTexture(value) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#1a2744';
  ctx.fillRect(0, 0, size, size);

  const cx = size/2, cy = size/2, r = size * 0.44;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI/2 + (i * 2 * Math.PI) / 5;
    const px = cx + r * Math.cos(angle);
    const py = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, '#2a3a5c'); g.addColorStop(1, '#1e2d4a');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(245,158,11,0.2)'; ctx.lineWidth = 2; ctx.stroke();

  const fontSize = value >= 10 ? size * 0.26 : size * 0.32;
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillText(String(value), cx+2, cy+2);
  const tg = ctx.createLinearGradient(cx-20, cy-20, cx+20, cy+20);
  tg.addColorStop(0, '#fde68a'); tg.addColorStop(0.5, '#f59e0b'); tg.addColorStop(1, '#d97706');
  ctx.fillStyle = tg; ctx.fillText(String(value), cx, cy);

  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Texture factory per die type
const TEXTURE_FN = {
  d4: createTriangleTexture,
  d6: createSquareTexture,
  d8: createTriangleTexture,
  d12: createPentagonTexture,
  d20: createTriangleTexture,
};

/**
 * DiceMesh — renders any platonic solid die with dynamically mapped face values.
 */
export default function DiceMesh({ meshRef, dieType, faceMapping }) {
  const config = DICE_TYPES[dieType];
  const mappingKey = faceMapping ? faceMapping.join(',') : 'default';

  const geometry = useMemo(() => createDieGeometry(dieType), [dieType]);

  const materials = useMemo(() => {
    const values = faceMapping || Array.from({ length: config.sides }, (_, i) => i + 1);
    const texFn = TEXTURE_FN[dieType];
    return values.map(v => new THREE.MeshStandardMaterial({ map: texFn(v), roughness: 0.4, metalness: 0.15 }));
  }, [dieType, mappingKey]);

  useEffect(() => {
    return () => { materials.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); };
  }, [materials]);

  return <mesh ref={meshRef} geometry={geometry} material={materials} castShadow receiveShadow />;
}
