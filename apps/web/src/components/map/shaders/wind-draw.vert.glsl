// Wind particle draw vertex shader
// Reads particle position from state texture and projects to screen space
precision highp float;

attribute float a_index;          // particle index (0 to numParticles-1)

uniform sampler2D u_particles;    // particle state texture
uniform float u_particles_res;    // particle texture resolution (e.g., 256)
uniform mat4 u_matrix;            // MapLibre projection matrix
uniform float u_point_size;       // base point size

varying float v_speed;            // pass speed to fragment shader for coloring
varying float v_age;              // pass age for fade

void main() {
  // Convert linear index to 2D texture coordinate
  float i = a_index;
  vec2 texCoord = vec2(
    fract(i / u_particles_res),
    floor(i / u_particles_res) / u_particles_res
  );

  vec4 particle = texture2D(u_particles, texCoord);

  // particle.xy = position in 0-1 (lng, lat normalized)
  // Convert to world coordinates: lng [-180, 180], lat [-85.051, 85.051] (Web Mercator)
  float lng = particle.x * 360.0 - 180.0;
  float lat = particle.y * 170.102 - 85.051;

  // Web Mercator projection
  float x = (lng + 180.0) / 360.0;
  float latRad = lat * 3.14159265 / 180.0;
  float y = (1.0 - log(tan(latRad) + 1.0 / cos(latRad)) / 3.14159265) / 2.0;

  // Transform to clip space using MapLibre's matrix
  // MapLibre uses tile coordinates where [0,0] is top-left and [1,1] is bottom-right of world
  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);

  v_speed = particle.w;
  v_age = particle.z;

  // Point size varies with speed
  gl_PointSize = u_point_size * (0.5 + min(v_speed / 15.0, 1.0));
}
