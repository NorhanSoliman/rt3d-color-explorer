/**
 * pointcloud.js
 * ─────────────
 * Owns the THREE.Points object.
 *
 * Architecture
 * ────────────
 * • One ShaderMaterial with a big `if/else` tree in the vertex shader.
 *   Switching color spaces only updates a uniform — no recompile needed.
 * • The image is uploaded to the GPU as a THREE.DataTexture.
 *   Each point's UV maps back to its original pixel.
 * • Two visualisation modes:
 *     0 = Direct  — each point is coloured with its original pixel RGB.
 *     1 = Density — points are semi-transparent white; dense regions
 *                   appear brighter due to additive blending.
 */

import * as THREE from 'three';
import { GLSL_HELPERS, GLSL_SPACES, SPACE_KEYS } from './colorspaces.js';

// ─────────────────────────────────────────────
// Build the combined GLSL conversion block:
// One toColorSpace() function per space, all reachable via uColorSpace.
// ─────────────────────────────────────────────
function buildConversionGLSL() {
  // Each entry in GLSL_SPACES defines `vec3 toColorSpace(vec3 c)`.
  // We rename them to toSpace0…toSpace5 and dispatch via uniform.
  const renames = SPACE_KEYS.map((key, i) =>
    GLSL_SPACES[key].replace(/toColorSpace/g, `toSpace${i}`)
  );

  const dispatcher = `
    vec3 toColorSpace(vec3 c) {
      ${SPACE_KEYS.map((_, i) => `if (uColorSpace == ${i}) return toSpace${i}(c);`).join('\n      ')}
      return c; // fallback
    }
  `;

  return renames.join('\n') + '\n' + dispatcher;
}

// ─────────────────────────────────────────────
// Vertex shader
// ─────────────────────────────────────────────
const VERTEX_SHADER = /* glsl */`
  precision highp float;

  uniform sampler2D uTexture;
  uniform int       uColorSpace;   // 0=RGB 1=HSV 2=XYZ 3=xyY 4=LAB 5=LCH
  uniform float     uPointSize;
  uniform int       uDensityMode;  // 0=direct, 1=density
  uniform float     uOpacity;

  varying vec3  vColor;
  varying float vOpacity;

  ${GLSL_HELPERS}
  ${buildConversionGLSL()}

  void main() {
    // Each point stores its UV in the position attribute (set on the CPU side)
    // We use position.xy as UV into the image texture.
    vec2 uv    = position.xy;
    vec4 pixel = texture2D(uTexture, uv);
    vec3 srgb  = pixel.rgb;

    // Convert to chosen color space → use as 3D position
    vec3 pos3d = toColorSpace(srgb);

    // Shift so the cloud is centred at origin
    gl_Position   = projectionMatrix * modelViewMatrix * vec4(pos3d - 0.5, 1.0);
    gl_PointSize  = uPointSize;

    vColor   = srgb;
    vOpacity = (uDensityMode == 1) ? 0.08 : uOpacity;
  }
`;

// ─────────────────────────────────────────────
// Fragment shader
// ─────────────────────────────────────────────
const FRAGMENT_SHADER = /* glsl */`
  precision highp float;

  uniform int   uDensityMode;

  varying vec3  vColor;
  varying float vOpacity;

  void main() {
    // Circular point (discard corners of the gl_PointSize quad)
    vec2  coord = gl_PointCoord - 0.5;
    float r     = dot(coord, coord);
    if (r > 0.25) discard;

    if (uDensityMode == 1) {
      // Density mode: bright white, very transparent → additive blending
      // creates bright "hotspots" where many points overlap
      gl_FragColor = vec4(1.0, 1.0, 1.0, vOpacity);
    } else {
      gl_FragColor = vec4(vColor, vOpacity); //each point keeps original color
    }
  }
`;

// ─────────────────────────────────────────────
// PointCloud class
// ─────────────────────────────────────────────
export class PointCloud {
  constructor() {
    this.points   = null;   // THREE.Points
    this.material = null;   // THREE.ShaderMaterial
    this.geometry = null;   // THREE.BufferGeometry
    this._width   = 0;
    this._height  = 0;
  }

  /**
   * Build (or rebuild) the point cloud from an ImageData object.
   * @param {ImageData} imageData  — from a canvas 2d context
   * @param {THREE.Scene} scene
   */
  build(imageData, scene) {
    // Remove previous cloud
    if (this.points) {
      scene.remove(this.points);
      this.geometry.dispose();
      this.material.dispose();
    }

    const { width, height, data } = imageData;
    this._width  = width;
    this._height = height;
    const count  = width * height;

    // ── Geometry: each point stores its UV in the position attribute ──
    // We pack (u, v, 0) into position; the shader fetches the pixel at that UV.
    const positions = new Float32Array(count * 3);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        positions[i]     = x / (width  - 1);   // u ∈ [0,1]
        positions[i + 1] = 1.0 - y / (height - 1); // v ∈ [0,1], flip Y
        positions[i + 2] = 0.0;
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // ── Texture: upload the raw pixel data to the GPU ──
    // THREE.DataTexture expects Uint8Array in RGBA order.
    const texData = new Uint8Array(data.buffer);
    const texture  = new THREE.DataTexture(texData, width, height, THREE.RGBAFormat);
    texture.needsUpdate = true;

    // ── Material ──
    this.material = new THREE.ShaderMaterial({
      vertexShader:   VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uTexture:     { value: texture },
        uColorSpace:  { value: 0 },
        uPointSize:   { value: 2.0 },
        uDensityMode: { value: 0 },
        uOpacity:     { value: 0.8 },
      },
      transparent: true,
      depthWrite:  false,           // important for additive density blending
      blending:    THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    scene.add(this.points);
  }

  // ── Public setters (called from UI) ──

  setColorSpace(index) {
    if (this.material) this.material.uniforms.uColorSpace.value = index;
  }

  setPointSize(size) {
    if (this.material) this.material.uniforms.uPointSize.value = size;
  }

  setDensityMode(on) {
    if (this.material) this.material.uniforms.uDensityMode.value = on ? 1 : 0;
  }

  setOpacity(v) {
    if (this.material) this.material.uniforms.uOpacity.value = v;
  }

  get pointCount() { return this._width * this._height; }
  get resolution()  { return `${this._width}×${this._height}`; }
}
