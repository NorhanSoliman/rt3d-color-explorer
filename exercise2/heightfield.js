/**
 * heightfield.js
 * ──────────────
 * Builds and owns the elevation-map surface (THREE.Mesh with PlaneGeometry).
 *
 * How it works
 * ────────────
 * • A PlaneGeometry of NxN segments is created on the CPU.
 *   Each vertex maps to a UV in [0,1]^2 covering the image.
 * • The VERTEX SHADER reads the image texture at each vertex's UV,
 *   converts the pixel to the chosen color space, picks one component,
 *   and displaces the vertex along +Z by that value × heightScale.
 * • The FRAGMENT SHADER colours each fragment with the original pixel's
 *   RGB colour (no lighting — that's Exercise 3).
 * • Surface mode: solid, wireframe, or both (solid + wire overlay).
 *
 * Switching color space or channel = one uniform update, no rebuild.
 * Changing grid resolution = rebuild geometry (cheap, < 1 ms for N≤256).
 */

import * as THREE from 'three';
import { GLSL_HELPERS, GLSL_SPACES, SPACE_KEYS } from './colorspaces.js';

// ─────────────────────────────────────────────
// Build combined conversion GLSL
// Rename each space's spaceConvert() to spaceN(), dispatch via uniform.
// ─────────────────────────────────────────────
function buildConversionGLSL() {
  const renamed = SPACE_KEYS.map((key, i) =>
    GLSL_SPACES[key].replace(/spaceConvert/g, `space${i}`)
  );
  const dispatch = `
    vec3 spaceConvert(vec3 c) {
      ${SPACE_KEYS.map((_, i) => `if (uColorSpace == ${i}) return space${i}(c);`).join('\n      ')}
      return c;
    }
  `;
  return renamed.join('\n') + '\n' + dispatch;
}

// ─────────────────────────────────────────────
// Vertex shader
// ─────────────────────────────────────────────
const VERTEX_SHADER = /* glsl */`
  precision highp float;

  uniform sampler2D uTexture;
  uniform int       uColorSpace;   // 0-5
  uniform int       uChannel;      // 0=comp0, 1=comp1, 2=comp2
  uniform float     uHeightScale;

  varying vec2 vUV;
  varying vec3 vColor;       // original RGB for colouring
  varying float vHeight;     // normalised height value [0,1]

  ${GLSL_HELPERS}
  ${buildConversionGLSL()}

  void main() {
    vUV = uv;

    // Sample original pixel colour
    vec4 pixel = texture2D(uTexture, uv);
    vColor = pixel.rgb;

    // Convert to chosen space → pick height channel
    vec3 converted = spaceConvert(pixel.rgb);
    float h = (uChannel == 0) ? converted.x
            : (uChannel == 1) ? converted.y
            :                   converted.z;
    vHeight = h;

    // Displace along Z (plane starts in XY, we push Z up)
    vec3 displaced = position + vec3(0.0, 0.0, h * uHeightScale);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

// ─────────────────────────────────────────────
// Fragment shader  (solid — coloured by original RGB)
// ─────────────────────────────────────────────
const FRAGMENT_SHADER = /* glsl */`
  precision highp float;

  varying vec2  vUV;
  varying vec3  vColor;
  varying float vHeight;

  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

// ─────────────────────────────────────────────
// Wireframe fragment shader (dim green tint)
// ─────────────────────────────────────────────
const WIRE_FRAGMENT_SHADER = /* glsl */`
  precision highp float;
  varying vec3  vColor;
  varying float vHeight;

  void main() {
    // Tint wires with a dim version of the surface colour
    gl_FragColor = vec4(vColor * 0.45 + 0.1, 0.6);
  }
`;

// ─────────────────────────────────────────────
// HeightField class
// ─────────────────────────────────────────────
export class HeightField {
  constructor() {
    this.solidMesh = null;
    this.wireMesh  = null;
    this._material = null;
    this._wireMat  = null;
    this._geometry = null;
    this._texture  = null;
    this._gridSize = 128;
    this._scene    = null;
  }

  /**
   * Build (or rebuild) the heightfield from an ImageData.
   * Called on first load and whenever the user changes grid resolution.
   *
   * @param {ImageData} imageData
   * @param {THREE.Scene} scene
   * @param {number} gridSize  — number of segments per side (N×N quads)
   */
  build(imageData, scene, gridSize = 128) {
    this._scene    = scene;
    this._gridSize = gridSize;

    // Remove old meshes
    if (this.solidMesh) { scene.remove(this.solidMesh); this.solidMesh.geometry.dispose(); }
    if (this.wireMesh)  { scene.remove(this.wireMesh);  this.wireMesh.geometry.dispose();  }
    if (this._texture)  { this._texture.dispose(); }

    // ── Texture ──
    const texData = new Uint8Array(imageData.data.buffer);
    this._texture = new THREE.DataTexture(
      texData, imageData.width, imageData.height, THREE.RGBAFormat
    );
    this._texture.needsUpdate = true;

    // ── Geometry: a flat N×N grid in XY, centred at origin ──
    // PlaneGeometry lies in XY plane by default (normal = +Z)
    // We displace vertices along +Z in the vertex shader.
    const N = gridSize;
    this._geometry = new THREE.PlaneGeometry(1, 1, N, N);

    // ── Solid material ──
    const uniforms = {
      uTexture:     { value: this._texture },
      uColorSpace:  { value: 0 },
      uChannel:     { value: 0 },
      uHeightScale: { value: 0.4 },
    };

    this._material = new THREE.ShaderMaterial({
      vertexShader:   VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      side: THREE.DoubleSide,
    });

    this.solidMesh = new THREE.Mesh(this._geometry, this._material);

    // ── Wireframe overlay ──
    // We create a separate WireframeGeometry so edges align with triangles.
    const wireGeo = new THREE.WireframeGeometry(this._geometry);
    this._wireMat = new THREE.ShaderMaterial({
      vertexShader:   VERTEX_SHADER,         // same displacement
      fragmentShader: WIRE_FRAGMENT_SHADER,
      uniforms:       this._material.uniforms, // shared uniforms → stays in sync
      transparent:    true,
      depthTest:      true,
    });
    this.wireMesh = new THREE.LineSegments(wireGeo, this._wireMat);

    scene.add(this.solidMesh);
    scene.add(this.wireMesh);

    // Apply current visibility based on stored surface mode
    this._applySurfaceMode(this._surfaceMode ?? 0);
  }

  // ── Setters called from UI ────────────────────────────────────────────

  setColorSpace(idx) {
    if (!this._material) return;
    this._material.uniforms.uColorSpace.value = idx;
  }

  setChannel(idx) {
    if (!this._material) return;
    this._material.uniforms.uChannel.value = idx;
  }

  setHeightScale(v) {
    if (!this._material) return;
    this._material.uniforms.uHeightScale.value = v;
  }

  setSurfaceMode(mode) {
    this._surfaceMode = mode;
    this._applySurfaceMode(mode);
  }

  _applySurfaceMode(mode) {
    // 0 = solid only, 1 = wire only, 2 = both
    if (this.solidMesh) this.solidMesh.visible = (mode === 0 || mode === 2);
    if (this.wireMesh)  this.wireMesh.visible  = (mode === 1 || mode === 2);
  }

  /**
   * Rebuild the geometry at a new resolution (same texture).
   * Called when the user moves the grid-resolution slider.
   */
  rebuildGeometry(gridSize) {
    if (!this._scene || !this._texture) return;

    // Fake an ImageData-like object to reuse build()
    // (texture data is already on GPU — we just need width/height)
    // Instead, directly swap geometry.
    if (this.solidMesh) this._scene.remove(this.solidMesh);
    if (this.wireMesh)  this._scene.remove(this.wireMesh);
    if (this._geometry) this._geometry.dispose();

    this._gridSize = gridSize;
    const N   = gridSize;
    const geo = new THREE.PlaneGeometry(1, 1, N, N);
    this._geometry = geo;

    this.solidMesh = new THREE.Mesh(geo, this._material);

    const wireGeo = new THREE.WireframeGeometry(geo);
    this.wireMesh  = new THREE.LineSegments(wireGeo, this._wireMat);

    this._scene.add(this.solidMesh);
    this._scene.add(this.wireMesh);
    this._applySurfaceMode(this._surfaceMode ?? 0);
  }

  get gridSize() { return this._gridSize; }
}
