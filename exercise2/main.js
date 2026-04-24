/**
 * main.js  (Exercise 2)
 * ──────────────────────
 * Scene setup, WebXR, animation loop for the color elevation map.
 */

import * as THREE                    from 'three';
import { OrbitControls }             from 'three/addons/controls/OrbitControls.js';
import { VRButton }                  from 'three/addons/webxr/VRButton.js';
import { ARButton }                  from 'three/addons/webxr/ARButton.js';
import { XRControllerModelFactory }  from 'three/addons/webxr/XRControllerModelFactory.js';

import { HeightField }               from './heightfield.js';
import { UI }                        from './ui.js';

// ─────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// ─────────────────────────────────────────────
// Scene + Camera
// ─────────────────────────────────────────────
const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x08080d);

// Thin grid on the floor for spatial reference
const grid = new THREE.GridHelper(2, 20, 0x1a2020, 0x0f1818);
grid.position.y = -0.05;
scene.add(grid);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 100);
// Position camera at an angle above the surface — isometric-ish view
camera.position.set(0.8, 0.9, 1.2);

// ─────────────────────────────────────────────
// OrbitControls
// ─────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0.1, 0);
controls.minDistance = 0.3;
controls.maxDistance = 4;
controls.update();

// ─────────────────────────────────────────────
// HeightField + UI
// ─────────────────────────────────────────────
const hf = new HeightField();
let currentGridSize = 128;
let pendingImageData = null;

const ui = new UI(
  hf,
  // onImageLoad
  (imageData) => {
    pendingImageData = imageData;
    hf.build(imageData, scene, currentGridSize);
    ui.updateStats(currentGridSize);
  },
  // onGridChange
  (newSize) => {
    currentGridSize = newSize;
    if (pendingImageData) {
      hf.rebuildGeometry(newSize);
    }
    ui.updateStats(newSize);
  }
);

// Load default image
ui.loadDefaultImage((imageData) => {
  pendingImageData = imageData;
  hf.build(imageData, scene, currentGridSize);
  ui.updateStats(currentGridSize);
  ui.hideLoading();
});


// ─────────────────────────────────────────────
// Make HeightField visible in VR/MR
// ─────────────────────────────────────────────
let originalHfPosition = new THREE.Vector3(0, 0, 0);

// Override the existing 'sessionstart' listener (or merge with it)
const originalSessionStart = renderer.xr._listeners?.sessionstart?.[0];
renderer.xr.removeEventListener('sessionstart', originalSessionStart);
renderer.xr.removeEventListener('sessionend', renderer.xr._listeners?.sessionend?.[0]);

renderer.xr.addEventListener('sessionstart', () => {
  xrPanel.visible  = true;
  controls.enabled = false;
  xrPanel.position.set(0, 1.4, -0.6);

  // Move the height field in front of the camera
  if (hf.mesh) {
    originalHfPosition.copy(hf.mesh.position);
    hf.mesh.position.set(0, -0.2, -1.2);   // y lowered a bit, z = -1.2 (in front)
  }

  // Optional: hide the reference grid to avoid visual clutter
  grid.visible = false;
});

renderer.xr.addEventListener('sessionend', () => {
  xrPanel.visible  = false;
  controls.enabled = true;

  // Restore original position
  if (hf.mesh) {
    hf.mesh.position.copy(originalHfPosition);
  }

  grid.visible = true;
});
// ─────────────────────────────────────────────
// WebXR Buttons
// ─────────────────────────────────────────────
const xrContainer = document.getElementById('xr-buttons');

function styleXRButton(btn, label) {
  btn.style.cssText = `
    padding: 7px 14px;
    background: rgba(10,10,18,0.88);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 4px;
    color: #556060;
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

  // Ray pointer
  const rayGeo  = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-1)]);
  const rayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0x00c9a7 }));
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
  // Position panel in front of the XR origin
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

  if (renderer.xr.isPresenting) {
    updateXRPanel(xrControllers);
  }

  renderer.render(scene, camera);
});
