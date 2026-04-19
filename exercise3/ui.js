/**
 * ui.js  (Exercise 3)
 * ───────────────────
 * Same structure as Ex2 but wires the new lighting controls:
 *   • Light direction compass (drag to orbit the light)
 *   • Light color picker
 *   • kd (diffuse) and ka (ambient) sliders
 * Also updates the XR panel to include lighting controls.
 */

import * as THREE from 'three';
import { SPACE_KEYS, SPACE_NAMES, CHANNEL_NAMES } from './colorspaces.js';

export class UI {
  constructor(hf, onImageLoad, onGridChange) {
    this.hf           = hf;
    this.onImageLoad  = onImageLoad;
    this.onGridChange = onGridChange;

    // Current spherical light coords (degrees)
    this._elevDeg = 60;
    this._azimDeg = 45;

    this._bind();
    this._buildChannelButtons(0);
    this._updateCompassDot();
  }

  _bind() {
    // ── File loader ──
    document.getElementById('file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      this._loadImage(URL.createObjectURL(file));
    });

    // ── Color space buttons ──
    document.querySelectorAll('.cs-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cs-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const idx = parseInt(btn.dataset.space);
        this.hf.setColorSpace(idx);
        this.hf.setChannel(0);
        this._buildChannelButtons(idx);
        document.getElementById('stat-space').textContent = SPACE_NAMES[idx];
      });
    });

    // ── Surface mode ──
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.hf.setSurfaceMode(parseInt(btn.dataset.wire));
      });
    });

    // ── Height scale ──
    const hs = document.getElementById('height-scale');
    hs.addEventListener('input', () => {
      document.getElementById('height-scale-val').textContent = parseFloat(hs.value).toFixed(2);
      this.hf.setHeightScale(parseFloat(hs.value));
    });

    // ── Grid resolution ──
    const gr = document.getElementById('grid-res');
    let grTimer = null;
    gr.addEventListener('input', () => {
      const v = parseInt(gr.value);
      document.getElementById('grid-res-val').textContent = v;
      document.getElementById('stat-res').textContent = `${v}×${v}`;
      clearTimeout(grTimer);
      grTimer = setTimeout(() => this.onGridChange(v), 200);
    });

    // ── kd slider ──
    const kd = document.getElementById('kd');
    kd.addEventListener('input', () => {
      document.getElementById('kd-val').textContent = parseFloat(kd.value).toFixed(2);
      this.hf.setKd(parseFloat(kd.value));
    });

    // ── ka slider ──
    const ka = document.getElementById('ka');
    ka.addEventListener('input', () => {
      document.getElementById('ka-val').textContent = parseFloat(ka.value).toFixed(2);
      this.hf.setKa(parseFloat(ka.value));
    });

    // ── Light color picker ──
    document.getElementById('light-color').addEventListener('input', e => {
      this.hf.setLightColor(e.target.value);
    });

    // ── Light direction compass (drag) ──
    this._bindCompass();
  }

  _bindCompass() {
    const compass = document.getElementById('light-compass');
    let dragging = false;

    const updateFromPointer = (e) => {
      const rect = compass.getBoundingClientRect();
      const cx = rect.left + rect.width  / 2;
      const cy = rect.top  + rect.height / 2;
      const dx = (e.clientX - cx) / (rect.width  / 2);   // [-1,1]
      const dy = (e.clientY - cy) / (rect.height / 2);   // [-1,1]

      // Clamp to unit circle
      const r = Math.min(1, Math.sqrt(dx*dx + dy*dy));

      // Azimuth: angle in XY plane (atan2 from +X axis)
      this._azimDeg = Math.atan2(-dy, dx) * 180 / Math.PI;
      // Elevation: distance from centre → outer edge = 0°, centre = 90°
      this._elevDeg = (1 - r) * 90;

      this.hf.setLightDirection(this._elevDeg, this._azimDeg);
      this._updateCompassDot();
    };

    compass.addEventListener('mousedown',  e => { dragging = true;  updateFromPointer(e); });
    window .addEventListener('mousemove',  e => { if (dragging) updateFromPointer(e); });
    window .addEventListener('mouseup',    () => { dragging = false; });

    compass.addEventListener('touchstart', e => { dragging = true;  updateFromPointer(e.touches[0]); }, { passive: true });
    window .addEventListener('touchmove',  e => { if (dragging) updateFromPointer(e.touches[0]); }, { passive: true });
    window .addEventListener('touchend',   () => { dragging = false; });
  }

  _updateCompassDot() {
    const dot    = document.getElementById('light-dot');
    const compass = document.getElementById('light-compass');
    const r = compass.offsetWidth / 2;

    const elevRad = this._elevDeg * Math.PI / 180;
    const azimRad = this._azimDeg * Math.PI / 180;
    // Distance from centre: 0 = elevation 90°, 1 = elevation 0°
    const dist = (1 - this._elevDeg / 90);
    const dx =  dist * Math.cos(azimRad);
    const dy = -dist * Math.sin(azimRad);

    dot.style.left = `${50 + dx * 50}%`;
    dot.style.top  = `${50 + dy * 50}%`;

    document.getElementById('lbl-elev').textContent = `${Math.round(this._elevDeg)}°`;
    document.getElementById('lbl-azim').textContent = `${Math.round((this._azimDeg + 360) % 360)}°`;
  }

  _buildChannelButtons(spaceIdx) {
    const names     = CHANNEL_NAMES[SPACE_KEYS[spaceIdx]];
    const container = document.getElementById('ch-buttons');
    container.innerHTML = '';
    names.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.className = 'ch-btn' + (i === 0 ? ' active' : '');
      btn.innerHTML = `<span class="btn-dot"></span>${name}`;
      btn.addEventListener('click', () => {
        container.querySelectorAll('.ch-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.hf.setChannel(i);
        document.getElementById('stat-channel').textContent = name.split(' ')[0];
      });
      container.appendChild(btn);
    });
    document.getElementById('stat-channel').textContent = names[0].split(' ')[0];
  }

  _loadImage(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      this.onImageLoad(canvas.getContext('2d').getImageData(0, 0, w, h));
    };
    img.src = url;
  }

  loadDefaultImage(cb) {
    const W = 256, H = 256;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x/W, v = y/H;
        const r = Math.sqrt((u-.5)**2+(v-.5)**2)*Math.SQRT2;
        const hue = Math.atan2(v-.5,u-.5)/(2*Math.PI)+.5;
        const h6=hue*6, s=Math.min(1,r*1.5), l=.35+(1-r)*.45;
        const c=(1-Math.abs(2*l-1))*s;
        const xp=c*(1-Math.abs(h6%2-1)), m=l-c/2;
        let [rr,gg,bb]=h6<1?[c,xp,0]:h6<2?[xp,c,0]:h6<3?[0,c,xp]:h6<4?[0,xp,c]:h6<5?[xp,0,c]:[c,0,xp];
        ctx.fillStyle=`rgb(${Math.round((rr+m)*255)},${Math.round((gg+m)*255)},${Math.round((bb+m)*255)})`;
        ctx.fillRect(x,y,1,1);
      }
    }
    cb(ctx.getImageData(0,0,W,H));
  }

  updateStats(gridSize) {
    document.getElementById('stat-res').textContent = `${gridSize}×${gridSize}`;
  }

  hideLoading() {
    document.getElementById('loading').classList.add('hidden');
  }

  // ── WebXR 3D Panel ────────────────────────────────────────────────────────
  buildXRPanel() {
    const PANEL_W = 0.55, PANEL_H = 0.55;
    const texW = 512, texH = Math.round(texW * (PANEL_H / PANEL_W));
    const canvas = document.createElement('canvas');
    canvas.width = texW; canvas.height = texH;
    const ctx = canvas.getContext('2d');

    let activeSpace = 0, activeChannel = 0;
    // Lighting state mirrored in XR panel
    let xrKd = 0.9, xrKa = 0.12;

    const SPACES = SPACE_NAMES;

    const redraw = () => {
      ctx.clearRect(0, 0, texW, texH);
      ctx.fillStyle = 'rgba(9,8,16,0.94)';
      ctx.beginPath(); ctx.roundRect(0, 0, texW, texH, 12); ctx.fill();

      // ── Section: Color Space ──
      ctx.fillStyle = '#5a5570'; ctx.font = '18px monospace';
      ctx.fillText('SPACE', 20, 30);

      const bW=220, bH=38, gap=7, sx=16, sy=40;
      SPACES.forEach((name, i) => {
        const col=i%2, row=Math.floor(i/2);
        const bx=sx+col*(bW+gap), by=sy+row*(bH+gap);
        const active=i===activeSpace;
        ctx.fillStyle = active?'rgba(232,162,48,0.2)':'rgba(255,255,255,0.03)';
        ctx.strokeStyle= active?'#e8a230':'rgba(255,255,255,0.07)';
        ctx.lineWidth  = active?2:1;
        ctx.beginPath(); ctx.roundRect(bx,by,bW,bH,5); ctx.fill(); ctx.stroke();
        ctx.fillStyle  = active?'#ede8f5':'#5a5570';
        ctx.font       = '20px monospace';
        ctx.fillText(name, bx+12, by+24);
      });

      // ── Section: Channel ──
      const chY = sy + 3*(bH+gap) + 14;
      ctx.fillStyle='#5a5570'; ctx.font='18px monospace'; ctx.fillText('CHANNEL', 20, chY+20);
      const channels = CHANNEL_NAMES[SPACE_KEYS[activeSpace]];
      const cW=(texW-40-gap*2)/3;
      channels.forEach((name,i)=>{
        const bx=20+i*(cW+gap), by=chY+28;
        const active=i===activeChannel;
        ctx.fillStyle  = active?'rgba(232,162,48,0.2)':'rgba(255,255,255,0.03)';
        ctx.strokeStyle= active?'#e8a230':'rgba(255,255,255,0.07)';
        ctx.lineWidth  = active?2:1;
        ctx.beginPath(); ctx.roundRect(bx,by,cW,40,5); ctx.fill(); ctx.stroke();
        ctx.fillStyle  = active?'#ede8f5':'#5a5570';
        ctx.font='16px monospace'; ctx.fillText(name.split(' ')[0], bx+8, by+24);
      });

      // ── Section: Lighting (kd / ka +/-) ──
      const lY = chY + 28 + 40 + 18;
      ctx.fillStyle='#5a5570'; ctx.font='18px monospace'; ctx.fillText('LIGHTING', 20, lY+20);

      const drawLightBtn = (label, val, bx, by, bw, bh) => {
        ctx.fillStyle='rgba(255,255,255,0.04)'; ctx.strokeStyle='rgba(255,255,255,0.1)';
        ctx.lineWidth=1; ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,5); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#ede8f5'; ctx.font='16px monospace';
        ctx.fillText(`${label}: ${val.toFixed(2)}`, bx+10, by+22);
      };

      // kd row
      drawLightBtn(`kd`, xrKd, 20, lY+30, 180, 36);
      ctx.fillStyle='#e8a230'; ctx.font='bold 22px monospace';
      ctx.fillText('−', 210, lY+54); ctx.fillText('+', 250, lY+54);

      // ka row
      drawLightBtn(`ka`, xrKa, 20, lY+76, 180, 36);
      ctx.fillStyle='#e8a230'; ctx.font='bold 22px monospace';
      ctx.fillText('−', 210, lY+100); ctx.fillText('+', 250, lY+100);
    };

    redraw();

    const texture = new THREE.CanvasTexture(canvas);
    const geo  = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
    const mat  = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
    const panel = new THREE.Mesh(geo, mat);
    panel.position.set(0, 1.4, -0.6);

    const raycaster = new THREE.Raycaster();

    const update = (controllers) => {
      for (const ctrl of controllers) {
        if (!ctrl.userData.selectPressed) continue;
        const matrix = new THREE.Matrix4().extractRotation(ctrl.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
        raycaster.ray.direction.set(0,0,-1).applyMatrix4(matrix);
        const hits = raycaster.intersectObject(panel);
        if (!hits.length) continue;

        const px = hits[0].uv.x * texW;
        const py = (1 - hits[0].uv.y) * texH;

        // Space buttons
        const bW=220, bH=38, gap=7, sx=16, sy=40;
        for (let i=0; i<6; i++) {
          const bx=sx+(i%2)*(bW+gap), by=sy+Math.floor(i/2)*(bH+gap);
          if (px>=bx&&px<=bx+bW&&py>=by&&py<=by+bH) {
            activeSpace=i; activeChannel=0;
            this.hf.setColorSpace(i); this.hf.setChannel(0);
            redraw(); texture.needsUpdate=true;
          }
        }

        // Channel buttons
        const chY=sy+3*(bH+gap)+14+28;
        const cW=(texW-40-gap*2)/3;
        const channels=CHANNEL_NAMES[SPACE_KEYS[activeSpace]];
        channels.forEach((_,i)=>{
          const bx=20+i*(cW+gap);
          if (px>=bx&&px<=bx+cW&&py>=chY&&py<=chY+40) {
            activeChannel=i; this.hf.setChannel(i);
            redraw(); texture.needsUpdate=true;
          }
        });

        // kd −/+
        const lY=chY+40+18+30;
        if (py>=lY&&py<=lY+36) {
          if (px>=210&&px<=240) { xrKd=Math.max(0, xrKd-0.05); this.hf.setKd(xrKd); redraw(); texture.needsUpdate=true; }
          if (px>=248&&px<=280) { xrKd=Math.min(1, xrKd+0.05); this.hf.setKd(xrKd); redraw(); texture.needsUpdate=true; }
        }
        // ka −/+
        if (py>=lY+46&&py<=lY+82) {
          if (px>=210&&px<=240) { xrKa=Math.max(0, xrKa-0.02); this.hf.setKa(xrKa); redraw(); texture.needsUpdate=true; }
          if (px>=248&&px<=280) { xrKa=Math.min(.5, xrKa+0.02); this.hf.setKa(xrKa); redraw(); texture.needsUpdate=true; }
        }
      }
    };

    return { panel, update };
  }
}
