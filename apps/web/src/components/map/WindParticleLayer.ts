/**
 * WindParticleLayer — WebGL custom layer for MapLibre GL
 *
 * Renders animated wind-driven particles on the map surface using GPU-based
 * particle simulation. Implements maplibregl.CustomLayerInterface.
 *
 * Architecture:
 *   - Ping-pong particle state textures (256×256 Float32) store [lng, lat, age, speed]
 *   - UPDATE pass: fragment shader samples wind field, advances particles
 *   - DRAW pass: vertex shader reads particle state, projects to map coordinates
 *   - Trail effect via screen-space framebuffer composited at 97% opacity
 *
 * @see BAT-13 — Animated Wind Particle Flow (WebGL Layer)
 */

// ── Shader Sources (inlined to avoid bundler GLSL import issues) ─────────────

const QUAD_VS = `
precision highp float;
attribute vec2 a_pos;
varying vec2 v_tex_pos;
void main() {
  v_tex_pos = a_pos;
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}
`

const UPDATE_FS = `
precision highp float;
uniform sampler2D u_particles;
uniform sampler2D u_wind;
uniform vec2 u_wind_res;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform float u_speed_factor;
uniform float u_drop_rate;
uniform float u_drop_rate_bump;
uniform float u_rand_seed;
varying vec2 v_tex_pos;

float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

vec2 lookupWind(vec2 uv) {
  vec2 windUV = vec2(uv.x, 1.0 - uv.y);
  vec4 s = texture2D(u_wind, windUV);
  float u = mix(u_wind_min.x, u_wind_max.x, s.r);
  float v = mix(u_wind_min.y, u_wind_max.y, s.g);
  return vec2(u, v);
}

void main() {
  vec4 particle = texture2D(u_particles, v_tex_pos);
  vec2 pos = particle.xy;
  float age = particle.z;
  vec2 wind = lookupWind(pos);
  float windSpeed = length(wind);
  float dt = u_speed_factor / 60.0;
  float cosLat = cos(mix(-1.5708, 1.5708, pos.y));
  float dLng = wind.x * dt / (111320.0 * max(cosLat, 0.01));
  float dLat = wind.y * dt / 110540.0;
  vec2 newPos = pos + vec2(dLng, dLat);
  newPos.x = fract(newPos.x + 1.0);
  newPos.y = clamp(newPos.y, 0.0, 1.0);
  float newAge = age + 1.0;
  float seed = v_tex_pos.y * 999.0 + v_tex_pos.x * 1999.0 + u_rand_seed;
  float dropChance = u_drop_rate + windSpeed * u_drop_rate_bump;
  bool shouldDrop = rand(vec2(seed, newAge)) < dropChance;
  bool outOfBounds = newPos.y <= 0.001 || newPos.y >= 0.999;
  if (shouldDrop || outOfBounds || newAge > 200.0) {
    newPos = vec2(rand(vec2(seed + 1.3, seed + 2.7)), rand(vec2(seed + 3.1, seed + 4.9)));
    newAge = 0.0;
  }
  gl_FragColor = vec4(newPos, newAge, windSpeed);
}
`

const DRAW_VS = `
precision highp float;
attribute float a_index;
uniform sampler2D u_particles;
uniform float u_particles_res;
uniform mat4 u_matrix;
uniform float u_point_size;
varying float v_speed;
varying float v_age;
void main() {
  float i = a_index;
  vec2 texCoord = vec2(fract(i / u_particles_res), floor(i / u_particles_res) / u_particles_res);
  vec4 particle = texture2D(u_particles, texCoord);
  float lng = particle.x * 360.0 - 180.0;
  float lat = particle.y * 170.102 - 85.051;
  float x = (lng + 180.0) / 360.0;
  float latRad = lat * 3.14159265 / 180.0;
  float y = (1.0 - log(tan(latRad) + 1.0 / cos(latRad)) / 3.14159265) / 2.0;
  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  v_speed = particle.w;
  v_age = particle.z;
  gl_PointSize = u_point_size * (0.5 + min(v_speed / 15.0, 1.0));
}
`

const DRAW_FS = `
precision highp float;
varying float v_speed;
varying float v_age;
void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;
  float t = clamp(v_speed / 25.0, 0.0, 1.0);
  vec3 color;
  if (t < 0.33) {
    float s = t / 0.33;
    color = mix(vec3(0.1, 0.3, 0.9), vec3(0.0, 0.8, 0.9), s);
  } else if (t < 0.66) {
    float s = (t - 0.33) / 0.33;
    color = mix(vec3(0.0, 0.8, 0.9), vec3(0.2, 0.9, 0.3), s);
  } else {
    float s = (t - 0.66) / 0.34;
    color = mix(vec3(0.2, 0.9, 0.3), vec3(1.0, 0.9, 0.1), s);
  }
  float ageFade = 1.0 - smoothstep(150.0, 200.0, v_age);
  float edgeFade = 1.0 - smoothstep(0.3, 0.5, dist);
  float alpha = 0.85 * ageFade * edgeFade;
  gl_FragColor = vec4(color * alpha, alpha);
}
`

const FADE_FS = `
precision highp float;
uniform sampler2D u_screen;
uniform float u_opacity;
varying vec2 v_tex_pos;
void main() {
  vec4 color = texture2D(u_screen, v_tex_pos);
  gl_FragColor = vec4(color.rgb, color.a * u_opacity);
}
`

// ── Helpers ──────────────────────────────────────────────────────────────────

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Failed to create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile error: ${log}`)
  }
  return shader
}

function createProgram(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()
  if (!prog) throw new Error('Failed to create program')
  gl.attachShader(prog, createShader(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(prog, createShader(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog)
    gl.deleteProgram(prog)
    throw new Error(`Program link error: ${log}`)
  }
  return prog
}

function createTexture(gl: WebGLRenderingContext, filter: number, data: ArrayBufferView | null, width: number, height: number): WebGLTexture {
  const tex = gl.createTexture()
  if (!tex) throw new Error('Failed to create texture')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  if (data instanceof Uint8Array) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
  } else if (data instanceof Float32Array) {
    // For OES_texture_float
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, data)
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  }
  return tex
}

// ── Detect GPU tier ──────────────────────────────────────────────────────────

export type WindDensity = '16k' | '32k' | '65k'

function particleResolution(density: WindDensity): number {
  switch (density) {
    case '16k': return 128  // 128×128 = 16,384
    case '32k': return 181  // ~32,761
    case '65k': return 256  // 65,536
    default:    return 256
  }
}

export function detectOptimalDensity(): WindDensity {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl')
    if (!gl) return '16k'

    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (ext) {
      const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string
      const lower = renderer.toLowerCase()
      // High-end GPUs
      if (/apple m[1-9]|nvidia.*rtx|nvidia.*40[0-9]0|radeon.*rx.*[67][0-9]00/i.test(lower)) {
        return '65k'
      }
      // Mid-range
      if (/nvidia.*gtx|radeon|intel.*iris|apple.*gpu/i.test(lower)) {
        return '32k'
      }
    }

    // Check if running on mobile
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    return isMobile ? '16k' : '32k'
  } catch {
    return '32k'
  }
}

// ── Wind Data Types ──────────────────────────────────────────────────────────

interface WindData {
  width: number
  height: number
  uMin: number
  uMax: number
  vMin: number
  vMax: number
  image: Uint8Array  // RGBA encoded wind texture
}

// ── WindParticleLayer Class ──────────────────────────────────────────────────

export interface WindParticleLayerOptions {
  density?: WindDensity
  speedFactor?: number
  opacity?: number
  apiUrl?: string
}

export class WindParticleLayer {
  id = 'wind-particles'
  type = 'custom' as const
  renderingMode = '2d' as const

  private density: WindDensity
  private particleRes: number
  private speedFactor: number
  private opacity: number
  private apiUrl: string

  private gl: WebGLRenderingContext | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private map: any = null

  // Programs
  private updateProgram: WebGLProgram | null = null
  private drawProgram: WebGLProgram | null = null
  private fadeProgram: WebGLProgram | null = null

  // Textures
  private particleStateTextures: [WebGLTexture | null, WebGLTexture | null] = [null, null]
  private windTexture: WebGLTexture | null = null
  private screenTexture: WebGLTexture | null = null
  private backgroundTexture: WebGLTexture | null = null

  // Buffers
  private quadBuffer: WebGLBuffer | null = null
  private indexBuffer: WebGLBuffer | null = null
  private framebuffer: WebGLFramebuffer | null = null

  // State
  private particleStateIdx = 0
  private windData: WindData | null = null
  private numParticles = 0
  private frameCount = 0
  private ready = false

  constructor(options: WindParticleLayerOptions = {}) {
    this.density = options.density ?? detectOptimalDensity()
    this.particleRes = particleResolution(this.density)
    this.speedFactor = options.speedFactor ?? 0.25
    this.opacity = options.opacity ?? 0.97
    this.apiUrl = options.apiUrl ?? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001')
    this.numParticles = this.particleRes * this.particleRes
  }

  setDensity(density: WindDensity) {
    if (density === this.density) return
    this.density = density
    this.particleRes = particleResolution(density)
    this.numParticles = this.particleRes * this.particleRes
    if (this.gl) {
      this.initParticleState(this.gl)
      this.initIndexBuffer(this.gl)
    }
  }

  setSpeedFactor(speed: number) {
    this.speedFactor = speed
  }

  // ── CustomLayerInterface: onAdd ──────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onAdd(map: any, gl: WebGLRenderingContext) {
    this.map = map
    this.gl = gl

    // Check for required extensions
    const floatExt = gl.getExtension('OES_texture_float')
    if (!floatExt) {
      console.warn('[WindParticleLayer] OES_texture_float not supported — wind disabled')
      return
    }
    gl.getExtension('OES_texture_float_linear') // optional but nice

    try {
      // Compile shaders
      this.updateProgram = createProgram(gl, QUAD_VS, UPDATE_FS)
      this.drawProgram = createProgram(gl, DRAW_VS, DRAW_FS)
      this.fadeProgram = createProgram(gl, QUAD_VS, FADE_FS)

      // Quad buffer (for fullscreen passes)
      this.quadBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW)

      // Framebuffer for ping-pong and screen composite
      this.framebuffer = gl.createFramebuffer()

      // Initialize particle state textures
      this.initParticleState(gl)

      // Initialize index buffer
      this.initIndexBuffer(gl)

      // Initialize screen textures for trail effect
      this.initScreenTextures(gl)

      // Fetch wind data
      this.fetchWindData()

      this.ready = true
    } catch (err) {
      console.error('[WindParticleLayer] Init failed:', err)
    }
  }

  private initParticleState(gl: WebGLRenderingContext) {
    const res = this.particleRes
    const data = new Float32Array(res * res * 4)
    for (let i = 0; i < res * res; i++) {
      data[i * 4 + 0] = Math.random()     // lng (0-1)
      data[i * 4 + 1] = Math.random()     // lat (0-1)
      data[i * 4 + 2] = Math.random() * 200 // age (randomized for natural look)
      data[i * 4 + 3] = 0                 // speed (will be set by update shader)
    }

    // Clean up old textures
    if (this.particleStateTextures[0]) gl.deleteTexture(this.particleStateTextures[0])
    if (this.particleStateTextures[1]) gl.deleteTexture(this.particleStateTextures[1])

    this.particleStateTextures[0] = createTexture(gl, gl.NEAREST, data, res, res)
    this.particleStateTextures[1] = createTexture(gl, gl.NEAREST, new Float32Array(res * res * 4), res, res)
  }

  private initIndexBuffer(gl: WebGLRenderingContext) {
    const indices = new Float32Array(this.numParticles)
    for (let i = 0; i < this.numParticles; i++) indices[i] = i
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer)
    this.indexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW)
  }

  private initScreenTextures(gl: WebGLRenderingContext) {
    const w = gl.canvas.width
    const h = gl.canvas.height
    if (this.screenTexture) gl.deleteTexture(this.screenTexture)
    if (this.backgroundTexture) gl.deleteTexture(this.backgroundTexture)
    this.screenTexture = createTexture(gl, gl.NEAREST, null, w, h)
    this.backgroundTexture = createTexture(gl, gl.NEAREST, null, w, h)
  }

  private async fetchWindData() {
    try {
      const res = await fetch(`${this.apiUrl}/api/v1/wind/grid`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()

      // Decode base64 Float32Array
      const binary = atob(json.data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const floats = new Float32Array(bytes.buffer)

      // Convert to normalized RGBA texture (0-255 range)
      const width = json.width as number
      const height = json.height as number
      const image = new Uint8Array(width * height * 4)

      const uRange = json.uMax - json.uMin
      const vRange = json.vMax - json.vMin

      for (let i = 0; i < width * height; i++) {
        const u = floats[i * 2]
        const v = floats[i * 2 + 1]
        image[i * 4 + 0] = Math.round(((u - json.uMin) / uRange) * 255) // R = normalized U
        image[i * 4 + 1] = Math.round(((v - json.vMin) / vRange) * 255) // G = normalized V
        image[i * 4 + 2] = 0
        image[i * 4 + 3] = 255
      }

      this.windData = {
        width,
        height,
        uMin: json.uMin,
        uMax: json.uMax,
        vMin: json.vMin,
        vMax: json.vMax,
        image,
      }

      // Create wind texture
      if (this.gl) {
        if (this.windTexture) this.gl.deleteTexture(this.windTexture)
        this.windTexture = createTexture(this.gl, this.gl.LINEAR, image, width, height)
      }

      console.info(`[WindParticleLayer] Wind data loaded: ${width}×${height}, source=${json.source}`)
    } catch (err) {
      console.error('[WindParticleLayer] Failed to fetch wind data:', err)
    }
  }

  // ── CustomLayerInterface: render ─────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(gl: WebGLRenderingContext, matrix: number[] | Float32Array) {
    if (!this.ready || !this.windData || !this.windTexture) return

    // Save MapLibre GL state
    const prevBlend = gl.getParameter(gl.BLEND)
    const prevDepthTest = gl.getParameter(gl.DEPTH_TEST)
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM)

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)

    // ── UPDATE PASS: advance particle positions ────────────────────────────
    this.updateParticles(gl)

    // ── DRAW PASS: render particles to screen texture ──────────────────────
    this.drawParticles(gl, matrix)

    // Restore MapLibre state
    if (prevBlend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND)
    if (prevDepthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST)
    if (prevProgram) gl.useProgram(prevProgram)

    // Swap particle state textures (ping-pong)
    this.particleStateIdx = 1 - this.particleStateIdx
    this.frameCount++

    // Request next frame
    if (this.map) this.map.triggerRepaint()
  }

  private updateParticles(gl: WebGLRenderingContext) {
    const prog = this.updateProgram!
    const fb = this.framebuffer!

    gl.useProgram(prog)

    // Bind current particle state as input
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.particleStateTextures[this.particleStateIdx])
    gl.uniform1i(gl.getUniformLocation(prog, 'u_particles'), 0)

    // Bind wind texture
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.windTexture)
    gl.uniform1i(gl.getUniformLocation(prog, 'u_wind'), 1)

    // Uniforms
    gl.uniform2f(gl.getUniformLocation(prog, 'u_wind_res'), this.windData!.width, this.windData!.height)
    gl.uniform2f(gl.getUniformLocation(prog, 'u_wind_min'), this.windData!.uMin, this.windData!.vMin)
    gl.uniform2f(gl.getUniformLocation(prog, 'u_wind_max'), this.windData!.uMax, this.windData!.vMax)
    gl.uniform1f(gl.getUniformLocation(prog, 'u_speed_factor'), this.speedFactor)
    gl.uniform1f(gl.getUniformLocation(prog, 'u_drop_rate'), 0.003)
    gl.uniform1f(gl.getUniformLocation(prog, 'u_drop_rate_bump'), 0.01)
    gl.uniform1f(gl.getUniformLocation(prog, 'u_rand_seed'), Math.random())

    // Render to the OTHER particle state texture
    const targetIdx = 1 - this.particleStateIdx
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleStateTextures[targetIdx], 0)

    gl.viewport(0, 0, this.particleRes, this.particleRes)

    // Draw fullscreen quad
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    // Unbind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private drawParticles(gl: WebGLRenderingContext, matrix: number[] | Float32Array) {
    const prog = this.drawProgram!
    const canvasW = gl.canvas.width
    const canvasH = gl.canvas.height

    // First: draw fade of previous frame (trail effect)
    this.drawFade(gl, canvasW, canvasH)

    // Restore viewport to canvas size
    gl.viewport(0, 0, canvasW, canvasH)

    // Enable blending for particles
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    gl.useProgram(prog)

    // Bind the UPDATED particle state (the one we just wrote to)
    const updatedIdx = 1 - this.particleStateIdx
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.particleStateTextures[updatedIdx])
    gl.uniform1i(gl.getUniformLocation(prog, 'u_particles'), 0)

    // Uniforms
    gl.uniform1f(gl.getUniformLocation(prog, 'u_particles_res'), this.particleRes)
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'u_matrix'), false, matrix as Float32Array)
    gl.uniform1f(gl.getUniformLocation(prog, 'u_point_size'), devicePixelRatio >= 2 ? 2.0 : 1.5)

    // Bind index buffer
    const aIndex = gl.getAttribLocation(prog, 'a_index')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer)
    gl.enableVertexAttribArray(aIndex)
    gl.vertexAttribPointer(aIndex, 1, gl.FLOAT, false, 0, 0)

    // Draw particles
    gl.drawArrays(gl.POINTS, 0, this.numParticles)
  }

  private drawFade(gl: WebGLRenderingContext, w: number, h: number) {
    const prog = this.fadeProgram!

    // Swap screen/background textures
    const temp = this.screenTexture
    this.screenTexture = this.backgroundTexture
    this.backgroundTexture = temp

    // Render fade of background to screen framebuffer
    gl.useProgram(prog)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.backgroundTexture)
    gl.uniform1i(gl.getUniformLocation(prog, 'u_screen'), 0)
    gl.uniform1f(gl.getUniformLocation(prog, 'u_opacity'), this.opacity)

    gl.viewport(0, 0, w, h)

    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  // ── CustomLayerInterface: onRemove ───────────────────────────────────────

  onRemove() {
    const gl = this.gl
    if (!gl) return

    // Clean up all GL resources
    if (this.updateProgram) gl.deleteProgram(this.updateProgram)
    if (this.drawProgram) gl.deleteProgram(this.drawProgram)
    if (this.fadeProgram) gl.deleteProgram(this.fadeProgram)
    if (this.particleStateTextures[0]) gl.deleteTexture(this.particleStateTextures[0])
    if (this.particleStateTextures[1]) gl.deleteTexture(this.particleStateTextures[1])
    if (this.windTexture) gl.deleteTexture(this.windTexture)
    if (this.screenTexture) gl.deleteTexture(this.screenTexture)
    if (this.backgroundTexture) gl.deleteTexture(this.backgroundTexture)
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer)
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer)
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer)

    this.ready = false
    this.gl = null
    this.map = null
  }
}
