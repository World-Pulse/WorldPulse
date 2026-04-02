// Wind particle update fragment shader
// Reads current particle state, samples wind field, writes new position
precision highp float;

uniform sampler2D u_particles;    // current particle state (lng, lat, age, speed)
uniform sampler2D u_wind;         // wind vector field (u, v encoded in RG channels)
uniform vec2 u_wind_res;          // wind texture resolution (256, 128)
uniform vec2 u_wind_min;          // (uMin, vMin)
uniform vec2 u_wind_max;          // (uMax, vMax)
uniform float u_speed_factor;     // particle speed multiplier
uniform float u_drop_rate;        // base particle drop/respawn rate
uniform float u_drop_rate_bump;   // additional drop rate for fast particles
uniform float u_rand_seed;        // random seed for respawn
varying vec2 v_tex_pos;           // texture coordinate of this particle

// Pseudo-random number generator
float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// Lookup wind vector at a geographic position (lng, lat in 0-1 range)
vec2 lookupWind(vec2 uv) {
  // Flip V because texture is top-to-bottom but UV is bottom-to-top
  vec2 windUV = vec2(uv.x, 1.0 - uv.y);
  vec4 sample_ = texture2D(u_wind, windUV);

  // Decode: wind values are normalized to 0-1 range in the texture
  // Denormalize back to m/s using min/max
  float u = mix(u_wind_min.x, u_wind_max.x, sample_.r);
  float v = mix(u_wind_min.y, u_wind_max.y, sample_.g);
  return vec2(u, v);
}

void main() {
  vec4 particle = texture2D(u_particles, v_tex_pos);

  // Current position in 0-1 normalized coordinates
  // x = longitude (0-1 maps to -180 to 180)
  // y = latitude  (0-1 maps to -90 to 90)
  vec2 pos = particle.xy;
  float age = particle.z;
  float speed = particle.w;

  // Sample wind at current position
  vec2 wind = lookupWind(pos);
  float windSpeed = length(wind);

  // Convert wind vector (m/s) to degree offset
  // At equator, 1 degree longitude ~= 111km
  // Scale: m/s → degrees/frame at 60fps
  float dt = u_speed_factor / 60.0;
  float cosLat = cos(mix(-1.5708, 1.5708, pos.y)); // cos(latitude in radians)
  float dLng = wind.x * dt / (111320.0 * max(cosLat, 0.01));
  float dLat = wind.y * dt / 110540.0;

  // Advance position
  vec2 newPos = pos + vec2(dLng, dLat);

  // Wrap longitude
  newPos.x = fract(newPos.x + 1.0);

  // Clamp latitude
  newPos.y = clamp(newPos.y, 0.0, 1.0);

  // Age the particle
  float newAge = age + 1.0;

  // Random respawn check
  float seed = v_tex_pos.y * 999.0 + v_tex_pos.x * 1999.0 + u_rand_seed;
  float dropChance = u_drop_rate + windSpeed * u_drop_rate_bump;
  bool shouldDrop = rand(vec2(seed, newAge)) < dropChance;
  bool outOfBounds = newPos.y <= 0.001 || newPos.y >= 0.999;

  if (shouldDrop || outOfBounds || newAge > 200.0) {
    // Respawn at random position
    newPos = vec2(
      rand(vec2(seed + 1.3, seed + 2.7)),
      rand(vec2(seed + 3.1, seed + 4.9))
    );
    newAge = 0.0;
  }

  gl_FragColor = vec4(newPos, newAge, windSpeed);
}
