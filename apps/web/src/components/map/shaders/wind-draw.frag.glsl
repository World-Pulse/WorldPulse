// Wind particle draw fragment shader
// Colors particles by wind speed: blue → cyan → green → yellow
precision highp float;

varying float v_speed;
varying float v_age;

void main() {
  // Soft circle shape
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;

  // Normalize speed for color ramp (0-25 m/s range)
  float t = clamp(v_speed / 25.0, 0.0, 1.0);

  // Color ramp: blue → cyan → green → yellow
  vec3 color;
  if (t < 0.33) {
    float s = t / 0.33;
    color = mix(vec3(0.1, 0.3, 0.9), vec3(0.0, 0.8, 0.9), s);   // blue → cyan
  } else if (t < 0.66) {
    float s = (t - 0.33) / 0.33;
    color = mix(vec3(0.0, 0.8, 0.9), vec3(0.2, 0.9, 0.3), s);   // cyan → green
  } else {
    float s = (t - 0.66) / 0.34;
    color = mix(vec3(0.2, 0.9, 0.3), vec3(1.0, 0.9, 0.1), s);   // green → yellow
  }

  // Age-based fade: fully opaque for young particles, fade out near end of life
  float ageFade = 1.0 - smoothstep(150.0, 200.0, v_age);

  // Distance-based soft edge
  float edgeFade = 1.0 - smoothstep(0.3, 0.5, dist);

  float alpha = 0.85 * ageFade * edgeFade;

  gl_FragColor = vec4(color * alpha, alpha);
}
