#!/usr/bin/env node
/**
 * Generate static PNG textures for all dice faces.
 * Run once: node scripts/generateTextures.js
 *
 * Outputs:
 *   assets/dice/square/1.png   .. 6.png   (d6 faces)
 *   assets/dice/triangle/1.png .. 20.png  (d4, d8, d20 faces)
 *   assets/dice/pentagon/1.png .. 12.png  (d12 faces)
 */
const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZE = 256;
const OUT = path.resolve(__dirname, '..', 'assets', 'dice');

// ─── Color palette (matches existing dice style) ───
const BG_DARK = '#1a2744';
const BG_MID  = '#2a3a5c';
const GOLD_LIGHT = '#fde68a';
const GOLD_MID   = '#f59e0b';
const GOLD_DARK  = '#d97706';
const BORDER_GOLD = 'rgba(245,158,11,0.25)';

// ─── Helpers ───
function createGoldGradient(ctx, x1, y1, x2, y2) {
  const g = ctx.createLinearGradient(x1, y1, x2, y2);
  g.addColorStop(0, GOLD_LIGHT);
  g.addColorStop(0.5, GOLD_MID);
  g.addColorStop(1, GOLD_DARK);
  return g;
}

function createBgGradient(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, BG_MID);
  g.addColorStop(1, BG_DARK);
  return g;
}

function drawNumber(ctx, value, cx, cy, fontSize) {
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText(String(value), cx + 2, cy + 2);
  // Gold number
  ctx.fillStyle = createGoldGradient(ctx, cx - 20, cy - 20, cx + 20, cy + 20);
  ctx.fillText(String(value), cx, cy);
}

function saveCanvas(canvas, dir, num) {
  const filePath = path.join(dir, `${num}.png`);
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(filePath, buf);
}

// ─── Square textures (d6: 1-6) ───
function generateSquare(value) {
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d');

  // Background gradient
  ctx.fillStyle = createBgGradient(ctx, SIZE/2, SIZE/2, SIZE * 0.7);
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Rounded border
  const r = 16, m = 4;
  ctx.strokeStyle = BORDER_GOLD;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(m + r, m);
  ctx.lineTo(SIZE - m - r, m);
  ctx.quadraticCurveTo(SIZE - m, m, SIZE - m, m + r);
  ctx.lineTo(SIZE - m, SIZE - m - r);
  ctx.quadraticCurveTo(SIZE - m, SIZE - m, SIZE - m - r, SIZE - m);
  ctx.lineTo(m + r, SIZE - m);
  ctx.quadraticCurveTo(m, SIZE - m, m, SIZE - m - r);
  ctx.lineTo(m, m + r);
  ctx.quadraticCurveTo(m, m, m + r, m);
  ctx.closePath();
  ctx.stroke();

  // Number
  drawNumber(ctx, value, SIZE/2, SIZE/2, SIZE * 0.4);

  saveCanvas(c, path.join(OUT, 'square'), value);
}

// ─── Triangle textures (d4, d8, d20: 1-20) ───
function generateTriangle(value) {
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d');

  // Full background
  ctx.fillStyle = BG_DARK;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Equilateral triangle matching UV coords
  const tri = [
    [0.5 * SIZE, 0.12 * SIZE],
    [0.08 * SIZE, 0.88 * SIZE],
    [0.92 * SIZE, 0.88 * SIZE],
  ];
  ctx.beginPath();
  ctx.moveTo(tri[0][0], tri[0][1]);
  ctx.lineTo(tri[1][0], tri[1][1]);
  ctx.lineTo(tri[2][0], tri[2][1]);
  ctx.closePath();
  ctx.fillStyle = createBgGradient(ctx, SIZE/2, SIZE * 0.6, SIZE * 0.5);
  ctx.fill();
  ctx.strokeStyle = BORDER_GOLD;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Number at centroid
  const cx = SIZE * 0.5;
  const cy = SIZE * 0.63;
  const fontSize = value >= 10 ? SIZE * 0.22 : SIZE * 0.28;
  drawNumber(ctx, value, cx, cy, fontSize);

  saveCanvas(c, path.join(OUT, 'triangle'), value);
}

// ─── Pentagon textures (d12: 1-12) ───
function generatePentagon(value) {
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d');

  // Full background
  ctx.fillStyle = BG_DARK;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Regular pentagon
  const cx = SIZE / 2, cy = SIZE / 2, r = SIZE * 0.44;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const px = cx + r * Math.cos(angle);
    const py = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = createBgGradient(ctx, cx, cy, r);
  ctx.fill();
  ctx.strokeStyle = BORDER_GOLD;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Number
  const fontSize = value >= 10 ? SIZE * 0.26 : SIZE * 0.32;
  drawNumber(ctx, value, cx, cy, fontSize);

  saveCanvas(c, path.join(OUT, 'pentagon'), value);
}

// ─── Generate all ───
console.log('Generating dice textures...');

for (let i = 1; i <= 6; i++)  generateSquare(i);
console.log('  ✓ square/1-6.png');

for (let i = 1; i <= 20; i++) generateTriangle(i);
console.log('  ✓ triangle/1-20.png');

for (let i = 1; i <= 12; i++) generatePentagon(i);
console.log('  ✓ pentagon/1-12.png');

console.log(`Done. ${6 + 20 + 12} textures written to ${OUT}`);
