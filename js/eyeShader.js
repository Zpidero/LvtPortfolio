/* ===========================
   Lluc Vivet Torras — Portfolio
   js/eyeShader.js  ·  one eye shader for the samurai's eyes and the gallery's giant eye

   Drawn on the front of a sphere (local +z = forward):
     - almond-shaped opening with upper / lower eyelids (outside is discarded)
     - off-white sclera, fibrous amber iris, dark limbal ring, pupil, wet glint
     - uLook (vec2, -1..1) moves the iris to look somewhere
     - uOpen (0..1) closes the lids (blink), uPupil dilates the pupil
   =========================== */
import * as THREE from 'three';

export function makeEyeMaterial({ almond = true, lid = '#1a0b08', fog = false } = {}) {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      uPupil: { value: 0.22 }, uTime: { value: 0 }, uGlow: { value: 0.3 },
      uLook: { value: new THREE.Vector2() }, uOpen: { value: 1 },
      uAlmond: { value: almond ? 1 : 0 }, uLid: { value: new THREE.Color(lid) }
    },
    vertexShader: `
      varying vec3 vP;
      void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uPupil, uTime, uGlow, uOpen, uAlmond; uniform vec2 uLook; uniform vec3 uLid;
      varying vec3 vP;
      void main(){
        if (vP.z < 0.0) discard;
        vec2 q = vP.xy;

        // almond opening: lids meet at the corners, open most in the middle
        float open = uOpen * (0.5 + 0.06 * sin(q.x * 3.0)) * max(0.0, 1.0 - pow(abs(q.x) / 0.97, 2.4));
        float upper = open + 0.03, lower = open * 0.86;
        float dy = q.y - 0.02;
        float edge = dy > 0.0 ? upper - dy : lower + dy;          // distance inside the lids
        if (uAlmond > 0.5 && edge < 0.0) discard;
        float inside = uAlmond > 0.5 ? smoothstep(0.0, 0.025, edge) : 1.0;

        // iris centre follows uLook
        vec2 c = clamp(uLook, -1.0, 1.0) * vec2(0.36, 0.2);
        vec2 d = q - c;
        float r = length(d);
        float a = atan(d.y, d.x);
        float irisR = 0.6;

        float f1 = 0.5 + 0.5 * sin(a * 54.0 + sin(a * 7.0 + uTime * 0.25) * 2.2 + r * 24.0);
        float f2 = 0.5 + 0.5 * sin(a * 21.0 - r * 38.0 + uTime * 0.4);
        float f3 = 0.5 + 0.5 * sin(a * 97.0 + r * 11.0);
        vec3 iris = mix(vec3(0.70, 0.28, 0.03), vec3(1.0, 0.80, 0.32), f1 * 0.55 + f2 * 0.3 + f3 * 0.15);
        iris *= mix(1.45, 0.55, smoothstep(uPupil, irisR, r));
        iris += vec3(1.0, 0.62, 0.18) * 0.4 * smoothstep(0.05, 0.0, abs(r - (uPupil + 0.07)));
        iris = mix(iris, vec3(0.09, 0.035, 0.02), smoothstep(irisR - 0.1, irisR, r));

        vec3 sclera = mix(vec3(0.80, 0.72, 0.62), vec3(0.5, 0.36, 0.3), smoothstep(0.3, 1.0, length(q)));
        vec3 col = mix(iris, sclera, smoothstep(irisR, irisR + 0.03, r));

        float pup = smoothstep(uPupil + 0.012, uPupil - 0.012, r);
        col = mix(col, vec3(0.012, 0.006, 0.004), pup);
        col += vec3(0.6, 0.12, 0.04) * 0.07 * pup * smoothstep(uPupil, 0.0, r) * (0.6 + 0.4 * sin(uTime * 1.7));

        // wet glint (fixed to the eyeball, not the iris)
        col += vec3(1.0, 0.97, 0.9) * smoothstep(0.085, 0.035, length(q - vec2(-0.27, 0.26))) * 0.8 * inside;
        col += vec3(1.0, 0.97, 0.9) * smoothstep(0.04, 0.015, length(q - vec2(0.2, -0.16))) * 0.35 * inside;

        col *= 1.0 + uGlow * 0.55 * (1.0 - pup);

        // eyelid shadow + lash line
        if (uAlmond > 0.5) {
          float shade = smoothstep(0.0, 0.16, edge);
          col *= mix(0.25, 1.0, shade);
          col = mix(uLid, col, smoothstep(0.0, 0.02, edge));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`
  });
}
