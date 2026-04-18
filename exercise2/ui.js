/**
 * ui.js  (Exercise 2)
 * ───────────────────
 * Wires HTML controls to the HeightField instance.
 * Also builds the WebXR 3D panel.
 */

import * as THREE from 'three';
import { SPACE_KEYS, SPACE_NAMES, CHANNEL_NAMES } from './colorspaces.js';

export class UI {
  /**
   * @param {HeightField} hf
   * @param {Function} onImageLoad   — called with ImageData
   * @param {Function} onGridChange  — called with new grid size (number)
   */
  constructor(hf, onImageLoad, onGridChange) {
    this.hf           = hf;
    this.onImageLoad  = onImageLoad;
    this.onGridChange = onGridChange;
    this._currentSpace   = 0;
    this._currentChannel = 0;
    this._bind();
    this._buildChannelButtons(0);   // default: RGB channels
  }

  _bind() {
    // ── File loader ──
    document.getElementById('file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      this._loadImage(url);
    });

    // ── Color space buttons ──
    document.querySelectorAll('.cs-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cs-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const idx = parseInt(btn.dataset.space);
        this._currentSpace = idx;
        this._currentChannel = 0;
        this.hf.setColorSpace(idx);
        this.hf.setChannel(0);
        this._buildChannelButtons(idx);
        document.getElementById('stat-space').textContent = SPACE_NAMES[idx];
      });
    });

    // ── Surface mode ──
    document.querySelectorAll('.wire-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.wire-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.hf.setSurfaceMode(parseInt(btn.dataset.wire));
      });
    });

    // ── Height scale ──
    const hsSlider = document.getElementById('height-scale');
    const hsVal    = document.getElementById('height-scale-val');
    hsSlider.addEventListener('input', () => {
      const v = parseFloat(hsSlider.value);
      hsVal.textContent = v.toFixed(2);
      this.hf.setHeightScale(v);
    });

    // ── Grid resolution ──
    const grSlider = document.getElementById('grid-res');
    const grVal    = document.getElementById('grid-res-val');
    let   grTimer  = null;
    grSlider.addEventListener('input', () => {
      const v = parseInt(grSlider.value);
      grVal.textContent = v;
      document.getElementById('stat-res').textContent = `${v}×${v}`;
      // Debounce: rebuild only after user stops dragging for 200 ms
      clearTimeout(grTimer);
      grTimer = setTimeout(() => this.onGridChange(v), 200);
    });
  }

  /** Rebuild the channel buttons whenever the color space changes. */
  _buildChannelButtons(spaceIdx) {
    const key      = SPACE_KEYS[spaceIdx];
    const names    = CHANNEL_NAMES[key];
    const container = document.getElementById('ch-buttons');
    container.innerHTML = '';

    names.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.className = 'ch-btn' + (i === 0 ? ' active' : '');
      btn.innerHTML = `<span class="btn-dot"></span>${name}`;
      btn.addEventListener('click', () => {
        container.querySelectorAll('.ch-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._currentChannel = i;
        this.hf.setChannel(i);
        document.getElementById('stat-channel').textContent = name.split(' ')[0];
      });
      container.appendChild(btn);
    });

    // Update stats
    document.getElementById('stat-channel').textContent = names[0].split(' ')[0];
  }

  _loadImage(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      URL.revokeObjectURL(url);
      this.onImageLoad(imageData);
    };
    img.src = url;
  }

  /** Generate a default colourful image (same rainbow as Ex1). */
  loadDefaultImage(cb) {
    const W = 256, H = 256;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W, v = y / H;
        const r = Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2) * Math.SQRT2;
        const hue = Math.atan2(v - 0.5, u - 0.5) / (2 * Math.PI) + 0.5;
        const h6 = hue * 6, s = Math.min(1, r * 1.5), l = 0.35 + (1 - r) * 0.45;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const xp = c * (1 - Math.abs(h6 % 2 - 1)), m = l - c / 2;
        let [rr, gg, bb] = h6 < 1 ? [c, xp, 0] : h6 < 2 ? [xp, c, 0]
          : h6 < 3 ? [0, c, xp] : h6 < 4 ? [0, xp, c]
          : h6 < 5 ? [xp, 0, c] : [c, 0, xp];
        ctx.fillStyle = `rgb(${Math.round((rr+m)*255)},${Math.round((gg+m)*255)},${Math.round((bb+m)*255)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    cb(ctx.getImageData(0, 0, W, H));
  }

  updateStats(gridSize) {
    document.getElementById('stat-res').textContent = `${gridSize}×${gridSize}`;
  }

  hideLoading() {
    document.getElementById('loading').classList.add('hidden');
  }

  // ── WebXR 3D Panel ────────────────────────────────────────────────────────
  buildXRPanel() {
    const PANEL_W = 0.5, PANEL_H = 0.45;
    const SPACES   = SPACE_NAMES;
    const texW = 512, texH = Math.round(texW * (PANEL_H / PANEL_W));
    const canvas = document.createElement('canvas');
    canvas.width = texW; canvas.height = texH;
    const ctx = canvas.getContext('2d');

    let activeSpace = 0, activeChannel = 0;

    const redraw = () => {
      ctx.clearRect(0, 0, texW, texH);
      ctx.fillStyle = 'rgba(8,8,16,0.92)';
      ctx.beginPath(); ctx.roundRect(0, 0, texW, texH, 12); ctx.fill();

      ctx.fillStyle = '#556060';
      ctx.font = '20px monospace';
      ctx.fillText('SPACE', 24, 36);

      // Space buttons (2 col × 3 row)
      const bW = 220, bH = 44, gap = 8, sx = 20, sy = 50;
      SPACES.forEach((name, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const bx = sx + col * (bW + gap), by = sy + row * (bH + gap);
        const active = i === activeSpace;
        ctx.fillStyle = active ? 'rgba(0,201,167,0.2)' : 'rgba(255,255,255,0.03)';
        ctx.strokeStyle = active ? '#00c9a7' : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = active ? 2 : 1;
        ctx.beginPath(); ctx.roundRect(bx, by, bW, bH, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = active ? '#dde8e4' : '#556060';
        ctx.font = '22px monospace';
        ctx.fillText(name, bx + 14, by + 28);
      });

      // Channel buttons (horizontal)
      const channels = CHANNEL_NAMES[SPACE_KEYS[activeSpace]];
      const cy = sy + 3 * (bH + gap) + 16;
      ctx.fillStyle = '#556060'; ctx.font = '20px monospace';
      ctx.fillText('CHANNEL', 24, cy + 20);

      const cW = (texW - 40 - gap * 2) / 3;
      channels.forEach((name, i) => {
        const bx = 20 + i * (cW + gap), by = cy + 28;
        const active = i === activeChannel;
        ctx.fillStyle = active ? 'rgba(0,201,167,0.2)' : 'rgba(255,255,255,0.03)';
        ctx.strokeStyle = active ? '#00c9a7' : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = active ? 2 : 1;
        ctx.beginPath(); ctx.roundRect(bx, by, cW, 44, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = active ? '#dde8e4' : '#556060';
        ctx.font = '18px monospace';
        ctx.fillText(name.split(' ')[0], bx + 10, by + 27);
      });
    };

    redraw();

    const texture = new THREE.CanvasTexture(canvas);
    const geo  = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
    const mat  = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
    const panel = new THREE.Mesh(geo, mat);
    panel.position.set(0, 1.4, -0.6);

    const raycaster = new THREE.Raycaster();
    const SPACES_COUNT = 6;
    const CHANNEL_NAMES_REF = CHANNEL_NAMES;

    const update = (controllers) => {
      for (const ctrl of controllers) {
        if (!ctrl.userData.selectPressed) continue;
        const matrix = new THREE.Matrix4().extractRotation(ctrl.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(matrix);
        const hits = raycaster.intersectObject(panel);
        if (!hits.length) continue;

        const uv = hits[0].uv;
        const px = uv.x * texW;
        const py = (1 - uv.y) * texH;

        // Check space buttons
        const bW = 220, bH = 44, gap = 8, sx = 20, sy = 50;
        for (let i = 0; i < SPACES_COUNT; i++) {
          const col = i % 2, row = Math.floor(i / 2);
          const bx = sx + col * (bW + gap), by = sy + row * (bH + gap);
          if (px >= bx && px <= bx + bW && py >= by && py <= by + bH) {
            activeSpace = i; activeChannel = 0;
            this.hf.setColorSpace(i); this.hf.setChannel(0);
            redraw(); texture.needsUpdate = true;
          }
        }

        // Check channel buttons
        const cy = sy + 3 * (bH + gap) + 16 + 28;
        const cW = (texW - 40 - gap * 2) / 3;
        const channels = CHANNEL_NAMES_REF[SPACE_KEYS[activeSpace]];
        channels.forEach((_, i) => {
          const bx = 20 + i * (cW + gap);
          if (px >= bx && px <= bx + cW && py >= cy && py <= cy + 44) {
            activeChannel = i;
            this.hf.setChannel(i);
            redraw(); texture.needsUpdate = true;
          }
        });
      }
    };

    return { panel, update };
  }
}


