/**
 * main.js
 * ───────
 * Entry point. Sets up:
 *   • THREE.WebGLRenderer + resize handling
 *   • Scene, Camera, OrbitControls
 *   • WebXR (VR + MR) via VRButton / ARButton
 *   • PointCloud + UI instances
 *   • Animation loop
 */

import * as THREE             from 'three';
import { OrbitControls }      from 'three/addons/controls/OrbitControls.js';
import { VRButton }           from 'three/addons/webxr/VRButton.js';
import { ARButton }           from 'three/addons/webxr/ARButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

import { PointCloud }         from './pointcloud.js';
import { UI }                 from './ui.js';

// ─────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;   // enable WebXR
document.getElementById('canvas-container').appendChild(renderer.domElement);

// ─────────────────────────────────────────────
// Scene + Camera
// ─────────────────────────────────────────────
const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0f);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0, 2.0);   // stand back from the unit cube

// ─────────────────────────────────────────────
// OrbitControls (desktop)
// ─────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance   = 0.5;
controls.maxDistance   = 5.0;
controls.target.set(0, 0, 0);

// ─────────────────────────────────────────────
// Subtle grid helper so the cube has a sense of ground
// ─────────────────────────────────────────────
const grid = new THREE.GridHelper(1, 10, 0x222233, 0x151520);
grid.position.y = -0.5;   // sits under the cloud (cloud is centred at 0)
scene.add(grid);

// Wireframe unit cube for spatial reference
const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const cubeEdges = new THREE.EdgesGeometry(cubeGeo);
const cubeLine  = new THREE.LineSegments(
  cubeEdges,
  new THREE.LineBasicMaterial({ color: 0x2a2a3a })
);
scene.add(cubeLine);

// ─────────────────────────────────────────────
// PointCloud + UI
// ─────────────────────────────────────────────
const cloud = new PointCloud();

const ui = new UI(cloud, (imageData) => {
  cloud.build(imageData, scene);
  ui.updateStats(cloud);
});

// Load built-in default image immediately
ui.loadDefaultImage((imageData) => {
  cloud.build(imageData, scene);
  ui.updateStats(cloud);
  ui.hideLoading();
});

// ─── After creating `cloud` and `ui` ─────────────────────────────
let originalCloudPosition = new THREE.Vector3(0, 0, 0);
let originalPointSize = 2.0;   // default from UI

// ─── XR session events ──────────────────────────────────────────
renderer.xr.addEventListener('sessionstart', () => {
  xrPanel.visible = true;
  controls.enabled = false;

  // Move cloud 1.2 units in front of the camera (negative Z)
  if (cloud.points) {
    originalCloudPosition.copy(cloud.points.position);
    cloud.points.position.set(0, 0, -1.2);
  }

  // Enlarge points for better visibility in VR
  originalPointSize = cloud.material?.uniforms.uPointSize.value || 2;
  cloud.setPointSize(6.0);
});

renderer.xr.addEventListener('sessionend', () => {
  xrPanel.visible = false;
  controls.enabled = true;

  // Restore cloud position
  if (cloud.points) {
    cloud.points.position.copy(originalCloudPosition);
  }

  // Restore original point size
  cloud.setPointSize(originalPointSize);
});
// ─────────────────────────────────────────────
// WebXR — VR + MR buttons
// ─────────────────────────────────────────────
const xrContainer = document.getElementById('xr-buttons');

// Helper: style the auto-generated Three.js XR buttons to match our UI
function styleXRButton(btn, label) {
  btn.style.cssText = `
    padding: 7px 14px;
    background: rgba(12,12,20,0.85);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    color: #666680;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.1em;
    cursor: pointer;
  `;
  // Override inner text set by Three.js
  const observer = new MutationObserver(() => {
    if (btn.textContent !== label) btn.textContent = label;
  });
  observer.observe(btn, { childList: true, subtree: true, characterData: true });
  btn.textContent = label;
}

try {
  const vrBtn = VRButton.createButton(renderer);
  styleXRButton(vrBtn, 'Enter VR');
  xrContainer.appendChild(vrBtn);
} catch(e) { console.warn('VR not available:', e); }

try {
  const arBtn = ARButton.createButton(renderer, {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
  });
  styleXRButton(arBtn, 'Enter MR');
  xrContainer.appendChild(arBtn);
} catch(e) { console.warn('MR not available:', e); }

// ─────────────────────────────────────────────
// XR Controllers
// ─────────────────────────────────────────────
const controllerModelFactory = new XRControllerModelFactory();
const xrControllers = [];

for (let i = 0; i < 2; i++) {
  const ctrl  = renderer.xr.getController(i);
  const grip  = renderer.xr.getControllerGrip(i);
  const model = controllerModelFactory.createControllerModel(grip);
  grip.add(model);
  scene.add(ctrl);
  scene.add(grip);

  // Track select button state for UI raycasting
  ctrl.addEventListener('selectstart', () => { ctrl.userData.selectPressed = true;  });
  ctrl.addEventListener('selectend',   () => { ctrl.userData.selectPressed = false; });

  // Visual ray line from controller
  const rayGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const rayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0x7c6aff, linewidth: 2 }));
  rayLine.scale.z = 3;
  ctrl.add(rayLine);

  xrControllers.push(ctrl);
}

// ─────────────────────────────────────────────
// XR panel (built once, added to scene)
// ─────────────────────────────────────────────
const { panel: xrPanel, update: updateXRPanel } = ui.buildXRPanel(renderer);
scene.add(xrPanel);
// Hide on desktop; becomes visible and interactive in XR
xrPanel.visible = false;

renderer.xr.addEventListener('sessionstart', () => {
  xrPanel.visible = true;
  controls.enabled = false;   // disable orbit during XR
});
renderer.xr.addEventListener('sessionend', () => {
  xrPanel.visible = false;
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

  // Slowly auto-rotate the cloud when not in XR and no interaction
  if (cloud.points && !renderer.xr.isPresenting) {
    cloud.points.rotation.y += 0.0015;
  }

  // XR panel raycasting
  if (renderer.xr.isPresenting) {
    updateXRPanel(xrControllers);
  }

  renderer.render(scene, camera);
});
