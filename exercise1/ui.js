/**
 * ui.js
 * ─────
 * Wires all HTML controls to the PointCloud instance and keeps the
 * stats bar up to date.
 *
 * Also exposes buildXRPanel() which creates a flat 3D mesh panel that
 * can be grabbed / raycasted inside a WebXR session.
 */

import * as THREE from 'three';

export class UI {
  /**
   * @param {PointCloud} cloud
   * @param {Function}   onImageLoad  — called with ImageData when user loads an image
   */
  constructor(cloud, onImageLoad) {
    this.cloud       = cloud;
    this.onImageLoad = onImageLoad;
    this._bind();
  }

  _bind() {
    // ── File loader ──
    document.getElementById('file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      this._loadImageFromURL(url);
    });

    // ── Color space buttons ──
    document.querySelectorAll('.cs-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cs-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const idx = parseInt(btn.dataset.space);
        this.cloud.setColorSpace(idx);
        document.getElementById('stat-space').textContent = btn.textContent.trim();
      });
    });

    // ── Visualisation mode ──
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.cloud.setDensityMode(btn.dataset.mode === '1');
      });
    });

    // ── Point size slider ──
    const ptSize = document.getElementById('pt-size');
    const ptSizeVal = document.getElementById('pt-size-val');
    ptSize.addEventListener('input', () => {
      ptSizeVal.textContent = ptSize.value;
      this.cloud.setPointSize(parseFloat(ptSize.value));
    });

    // ── Opacity slider ──
    const ptOpacity = document.getElementById('pt-opacity');
    const ptOpacityVal = document.getElementById('pt-opacity-val');
    ptOpacity.addEventListener('input', () => {
      ptOpacityVal.textContent = parseFloat(ptOpacity.value).toFixed(2);
      this.cloud.setOpacity(parseFloat(ptOpacity.value));
    });
  }

  _loadImageFromURL(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Downsample large images to keep point count manageable on GPU
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      URL.revokeObjectURL(url);

      this.onImageLoad(imageData);
    };
    img.src = url;
  }

  /**
   * Load a default built-in image (a colourful gradient) so the app
   * has something to show on first load without requiring user action.
   */
  loadDefaultImage(onImageLoad) {
    const W = 256, H = 256;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Radial gradient + hue sweep — exercises all parts of every color space
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / H;
        const r = Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2) * Math.SQRT2;
        const hue = Math.atan2(v - 0.5, u - 0.5) / (2 * Math.PI) + 0.5;
        // HSL → RGB manually for the gradient
        const h6 = hue * 6;
        const s  = Math.min(1, r * 1.5);
        const l  = 0.35 + (1 - r) * 0.45;
        const c  = (1 - Math.abs(2 * l - 1)) * s;
        const x_ = c * (1 - Math.abs(h6 % 2 - 1));
        const m  = l - c / 2;
        let [rr, gg, bb] = h6 < 1 ? [c, x_, 0] : h6 < 2 ? [x_, c, 0]
          : h6 < 3 ? [0, c, x_] : h6 < 4 ? [0, x_, c]
          : h6 < 5 ? [x_, 0, c] : [c, 0, x_];
        ctx.fillStyle = `rgb(${Math.round((rr+m)*255)},${Math.round((gg+m)*255)},${Math.round((bb+m)*255)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    const imageData = ctx.getImageData(0, 0, W, H);
    onImageLoad(imageData);
  }

  /** Update the stats bar after the cloud is rebuilt. */
  updateStats(cloud) {
    document.getElementById('stat-points').textContent =
      cloud.pointCount.toLocaleString();
    document.getElementById('stat-res').textContent =
      cloud.resolution;
  }

  /** Hide the loading overlay. */
  hideLoading() {
    document.getElementById('loading').classList.add('hidden');
  }

  // ── WebXR 3D panel ──────────────────────────────────────────────────────────
  /**
   * Creates a flat 3D panel mesh with labelled buttons for color space
   * selection. Attach it to the XR controller or a fixed position in the scene.
   *
   * Returns { panel: THREE.Mesh, update: fn } where update() handles
   * controller raycasting and button highlighting.
   *
   * @param {THREE.WebGLRenderer} renderer
   */
  buildXRPanel(renderer) {
    const PANEL_W = 0.4, PANEL_H = 0.35;
    const BUTTON_LABELS = ['RGB','HSV','XYZ','xyY','LAB','LCH'];

    // ── Render the panel to a canvas texture ──
    const texW = 512, texH = Math.round(texW * (PANEL_H / PANEL_W));
    const canvas = document.createElement('canvas');
    canvas.width  = texW;
    canvas.height = texH;
    const ctx = canvas.getContext('2d');

    const redraw = (activeIdx = 0) => {
      ctx.clearRect(0, 0, texW, texH);

      // Background
      ctx.fillStyle = 'rgba(10,10,20,0.9)';
      ctx.roundRect(0, 0, texW, texH, 12);
      ctx.fill();

      // Title
      ctx.fillStyle = '#888';
      ctx.font = '24px monospace';
      ctx.fillText('COLOR SPACE', 28, 44);

      // Buttons (2 columns × 3 rows)
      const bW = 210, bH = 52, gap = 12, startX = 24, startY = 64;
      BUTTON_LABELS.forEach((lbl, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const bx = startX + col * (bW + gap);
        const by = startY + row * (bH + gap);
        const active = i === activeIdx;

        ctx.fillStyle = active ? 'rgba(124,106,255,0.25)' : 'rgba(255,255,255,0.04)';
        ctx.strokeStyle = active ? '#7c6aff' : 'rgba(255,255,255,0.1)';
        ctx.lineWidth = active ? 2 : 1;
        ctx.beginPath();
        ctx.roundRect(bx, by, bW, bH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = active ? '#e8e8f0' : '#888';
        ctx.font = `${active ? '500' : '400'} 28px monospace`;
        ctx.fillText(lbl, bx + 18, by + 34);
      });
    };

    redraw(0);

    const texture = new THREE.CanvasTexture(canvas);
    const geo     = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
    const mat     = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
    const panel   = new THREE.Mesh(geo, mat);

    // Place panel in front and slightly below the camera default position
    panel.position.set(0, 1.4, -0.6);

    let activeIdx = 0;

    // ── Raycasting helper ──
    const raycaster = new THREE.Raycaster();

    const update = (controllers) => {
      for (const ctrl of controllers) {
        const matrix = new THREE.Matrix4().extractRotation(ctrl.matrixWorld);
        const ray = new THREE.Ray(
          ctrl.getWorldPosition(new THREE.Vector3()),
          new THREE.Vector3(0, 0, -1).applyMatrix4(matrix)
        );
        raycaster.ray.copy(ray);
        const hits = raycaster.intersectObject(panel);
        if (hits.length > 0 && ctrl.userData.selectPressed) {
          const uv = hits[0].uv;
          // Map UV to button index
          const BUTTON_LABELS_COUNT = 6;
          const bW = 210, bH = 52, gap = 12, startX = 24, startY = 64;
          for (let i = 0; i < BUTTON_LABELS_COUNT; i++) {
            const col = i % 2, row = Math.floor(i / 2);
            const bx = startX + col * (bW + gap);
            const by = startY + row * (bH + gap);
            const px = uv.x * 512;
            const py = (1 - uv.y) * Math.round(512 * (PANEL_H / PANEL_W));
            if (px >= bx && px <= bx + bW && py >= by && py <= by + bH) {
              activeIdx = i;
              this.cloud.setColorSpace(i);
              redraw(i);
              texture.needsUpdate = true;
              document.getElementById('stat-space').textContent = BUTTON_LABELS[i];
              // Sync HTML buttons
              document.querySelectorAll('.cs-btn').forEach((b, bi) =>
                b.classList.toggle('active', bi === i)
              );
            }
          }
        }
      }
    };

    return { panel, update };
  }
}
