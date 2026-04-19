/**
 * main.js  (Exercise 3)
 * ──────────────────────
 * Scene, WebXR, animation loop — nearly identical to Ex2.
 * Extra: a visible light direction arrow that rotates with the compass.
 */

import * as THREE                   from 'three';
import { OrbitControls }            from 'three/addons/controls/OrbitControls.js';
import { VRButton }                 from 'three/addons/webxr/VRButton.js';
import { ARButton }                 from 'three/addons/webxr/ARButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

import { HeightField }              from './heightfield.js';
import { UI }                       from './ui.js';

// ─────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// ─────────────────────────────────────────────
// Scene
// ─────────────────────────────────────────────
const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x090810);

// Faint grid for spatial grounding
const grid = new THREE.GridHelper(2, 20, 0x1a1828, 0x100f1a);
grid.position.y = -0.05;
scene.add(grid);

// ─────────────────────────────────────────────
// Camera + Controls
// ─────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0.8, 0.9, 1.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0.1, 0);
controls.minDistance = 0.3;
controls.maxDistance = 4;
controls.update();

// ─────────────────────────────────────────────
// Light direction arrow (visual aid)
// An ArrowHelper that mirrors the uLightDir uniform so you can see
// the light angle in 3D while dragging the compass.
// ─────────────────────────────────────────────
const arrowDir    = new THREE.Vector3(0.57, 0.57, 0.57).normalize();
const arrowOrigin = new THREE.Vector3(0, 0.6, 0);
const lightArrow  = new THREE.ArrowHelper(arrowDir, arrowOrigin, 0.35, 0xe8a230, 0.08, 0.06);
scene.add(lightArrow);

// ─────────────────────────────────────────────
// HeightField + UI
// ─────────────────────────────────────────────
const hf = new HeightField();
let currentGridSize  = 128;
let pendingImageData = null;

// Wrap setLightDirection so we also update the arrow
const origSetLight = hf.setLightDirection.bind(hf);
hf.setLightDirection = (elev, azim) => {
  origSetLight(elev, azim);
  // Mirror to arrow
  const e = (elev * Math.PI) / 180;
  const a = (azim * Math.PI) / 180;
  lightArrow.setDirection(
    new THREE.Vector3(
      Math.cos(e) * Math.cos(a),
      Math.cos(e) * Math.sin(a),
      Math.sin(e)
    ).normalize()
  );
};

const ui = new UI(
  hf,
  (imageData) => {
    pendingImageData = imageData;
    hf.build(imageData, scene, currentGridSize);
    ui.updateStats(currentGridSize);
  },
  (newSize) => {
    currentGridSize = newSize;
    if (pendingImageData) hf.rebuildGeometry(newSize);
    ui.updateStats(newSize);
  }
);

ui.loadDefaultImage((imageData) => {
  pendingImageData = imageData;
  hf.build(imageData, scene, currentGridSize);
  ui.updateStats(currentGridSize);
  ui.hideLoading();
});

// ─────────────────────────────────────────────
// WebXR Buttons
// ─────────────────────────────────────────────
const xrContainer = document.getElementById('xr-buttons');

function styleXRButton(btn, label) {
  btn.style.cssText = `
    padding: 7px 14px;
    background: rgba(11,10,20,0.90);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 4px;
    color: #5a5570;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.1em;
    cursor: pointer;
  `;
  const obs = new MutationObserver(() => { if (btn.textContent !== label) btn.textContent = label; });
  obs.observe(btn, { childList: true, subtree: true, characterData: true });
  btn.textContent = label;
}

try {
  const vrBtn = VRButton.createButton(renderer);
  styleXRButton(vrBtn, 'Enter VR');
  xrContainer.appendChild(vrBtn);
} catch(e) { console.warn('VR unavailable'); }

try {
  const arBtn = ARButton.createButton(renderer, {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
  });
  styleXRButton(arBtn, 'Enter MR');
  xrContainer.appendChild(arBtn);
} catch(e) { console.warn('MR unavailable'); }

// ─────────────────────────────────────────────
// XR Controllers
// ─────────────────────────────────────────────
const modelFactory  = new XRControllerModelFactory();
const xrControllers = [];

for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(modelFactory.createControllerModel(grip));
  scene.add(ctrl);
  scene.add(grip);

  ctrl.addEventListener('selectstart', () => { ctrl.userData.selectPressed = true;  });
  ctrl.addEventListener('selectend',   () => { ctrl.userData.selectPressed = false; });

  const rayGeo  = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-1)
  ]);
  const rayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0xe8a230 }));
  rayLine.scale.z = 3;
  ctrl.add(rayLine);

  xrControllers.push(ctrl);
}

// ─────────────────────────────────────────────
// XR Panel
// ─────────────────────────────────────────────
const { panel: xrPanel, update: updateXRPanel } = ui.buildXRPanel();
scene.add(xrPanel);
xrPanel.visible = false;

renderer.xr.addEventListener('sessionstart', () => {
  xrPanel.visible  = true;
  controls.enabled = false;
  xrPanel.position.set(0, 1.4, -0.6);
});
renderer.xr.addEventListener('sessionend', () => {
  xrPanel.visible  = false;
  controls.enabled = true;
});

// ─────────────────────────────────────────────
// Resize
// ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────
// Animation loop
// ─────────────────────────────────────────────
renderer.setAnimationLoop(() => {
  controls.update();
  if (renderer.xr.isPresenting) updateXRPanel(xrControllers);
  renderer.render(scene, camera);
});
