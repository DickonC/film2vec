import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import Fuse from "fuse";

const SPREAD = 10;          // world units per unit of RMS radius in the projection
const DIM = 0.18;           // brightness of non-highlighted points while a film is selected

const films = await (await fetch("/api/films")).json();

// Shrink points as the cloud gets denser so large datasets don't become a white blob.
const DENSITY = Math.min(1, Math.max(0.3, Math.cbrt(100 / films.length)));
const BASE_SIZE = 0.12 * DENSITY;

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 1000);
const HOME = new THREE.Vector3(SPREAD * 1.2, SPREAD * 0.8, SPREAD * 2.4);
camera.position.copy(HOME);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.3;
controls.zoomSpeed = 15;
controls.zoomToCursor = true;  // scroll zooms toward whatever is under the mouse
controls.minDistance = 0.05;
controls.maxDistance = SPREAD * 8;
controls.screenSpacePanning = true;

// ---------- axes ----------
// UMAP axes have no inherent meaning; they are a spatial reference while orbiting.
const AXIS_LEN = SPREAD * 1.6;
const TICK = 0.15;
const axisPos = [];
for (let a = 0; a < 3; a++) {
  const end = [0, 0, 0];
  end[a] = AXIS_LEN;
  axisPos.push(...end.map((v) => -v), ...end);
  // Ticks every half-spread, drawn perpendicular to the axis.
  const perp = a === 1 ? 0 : 1;
  for (let t = -AXIS_LEN + SPREAD * 0.1; t <= AXIS_LEN; t += SPREAD / 2) {
    const p = [0, 0, 0];
    p[a] = Math.round(t / (SPREAD / 2)) * (SPREAD / 2);
    if (p[a] === 0) continue;
    const q = [...p];
    p[perp] = -TICK;
    q[perp] = TICK;
    axisPos.push(...p, ...q);
  }
}
const axes = new THREE.LineSegments(
  new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(axisPos, 3)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })
);
scene.add(axes);

// One Points object = one draw call, so this scales to tens of thousands of films.
const n = films.length;
const positions = new Float32Array(n * 3);
const brightness = new Float32Array(n).fill(1);
const sizes = new Float32Array(n).fill(BASE_SIZE);
films.forEach((f, i) => positions.set(f.xyz.map((v) => v * SPREAD), i * 3));

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("brightness", new THREE.BufferAttribute(brightness, 1));
geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

const material = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { scale: { value: innerHeight / 2 } },
  vertexShader: /* glsl */ `
    attribute float brightness;
    attribute float size;
    uniform float scale;
    varying float vBrightness;
    void main() {
      vBrightness = brightness;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = min(size * scale / -mv.z * 6.0, 24.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying float vBrightness;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.2, d);
      if (a < 0.01) discard;
      gl_FragColor = vec4(vec3(1.0), a * vBrightness);
    }`,
});
const points = new THREE.Points(geometry, material);
scene.add(points);

// Lines from the selected film to its neighbours.
const links = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 })
);
scene.add(links);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  material.uniforms.scale.value = innerHeight / 2;
});

// ---------- hover / click ----------
const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 0.25 * DENSITY;
const pointer = new THREE.Vector2(9, 9);
const tooltip = document.getElementById("tooltip");
let hovered = -1;

renderer.domElement.addEventListener("pointermove", (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  tooltip.style.left = e.clientX + "px";
  tooltip.style.top = e.clientY + "px";
});
renderer.domElement.addEventListener("pointerleave", () => pointer.set(9, 9));

// Treat as a click only if the pointer barely moved (otherwise it was an orbit drag).
let downAt = null;
renderer.domElement.addEventListener("pointerdown", (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener("pointerup", (e) => {
  if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4) {
    // Clicking a film selects it; clicking empty space goes back to the overview.
    if (hovered >= 0) select(hovered);
    else if (selected >= 0) clearSelection();
  }
});

function updateHover() {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(points)[0];
  const i = hit ? hit.index : -1;
  if (i === hovered) return;
  hovered = i;
  renderer.domElement.style.cursor = i >= 0 ? "pointer" : "";
  if (i < 0) return (tooltip.hidden = true);
  const f = films[i];
  tooltip.innerHTML = `${escapeHtml(label(f))}<div class="meta">${escapeHtml(f.genres)} · ★ ${f.vote}</div>`;
  tooltip.hidden = false;
}

// ---------- search ----------
const fuse = new Fuse(films, { keys: ["title"], threshold: 0.4, ignoreLocation: true });
const input = document.getElementById("search");
const suggestions = document.getElementById("suggestions");
const results = document.getElementById("results");
const backButton = document.getElementById("back");
const modeButtons = document.querySelectorAll("#mode button");
let mode = "most";

modeButtons.forEach((b) =>
  b.addEventListener("click", () => {
    mode = b.dataset.mode;
    modeButtons.forEach((o) => o.classList.toggle("active", o === b));
    input.placeholder = mode === "most" ? "find me a film like…" : "find me a film unlike…";
    if (selected >= 0) select(selected);
  })
);
let matches = [];
let active = 0;

input.addEventListener("input", () => {
  matches = input.value.trim() ? fuse.search(input.value, { limit: 6 }).map((r) => r.item) : [];
  active = 0;
  renderSuggestions();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!matches.length) return;
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
    renderSuggestions();
  } else if (e.key === "Enter" && matches[active]) {
    select(matches[active].i);
  } else if (e.key === "Escape") {
    clearSelection();
  }
});

input.addEventListener("blur", () => setTimeout(() => (suggestions.hidden = true), 120));
input.addEventListener("focus", () => (suggestions.hidden = !matches.length));

function renderSuggestions() {
  suggestions.hidden = !matches.length;
  suggestions.innerHTML = matches
    .map((f, k) => `<li data-i="${f.i}" class="${k === active ? "active" : ""}">${escapeHtml(label(f))}</li>`)
    .join("");
}

suggestions.addEventListener("mousedown", (e) => {
  const li = e.target.closest("li");
  if (li) select(+li.dataset.i);
});
backButton.addEventListener("click", () => clearSelection());
results.addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (li) select(+li.dataset.i);
});

// ---------- selection ----------
const targetGoal = new THREE.Vector3();
const cameraGoal = new THREE.Vector3();
let flying = false;
let selected = -1;
// Let the user take over the camera mid-flight.
controls.addEventListener("start", () => {
  flying = false;
  controls.autoRotate = false;  // resumes when going back to all films
});

async function select(i) {
  selected = i;
  const f = films[i];
  input.value = f.title;
  matches = [];
  suggestions.hidden = true;
  input.blur();

  const neighbours = await (await fetch(`/api/similar/${i}?k=5&least=${mode === "least"}`)).json();

  results.innerHTML = neighbours
    .map((r) => `<li data-i="${r.i}"><span class="title">${escapeHtml(label(r))}</span><span class="score">${r.score.toFixed(3)}</span></li>`)
    .join("");
  results.hidden = false;
  backButton.hidden = false;

  brightness.fill(DIM);
  sizes.fill(BASE_SIZE);
  brightness[i] = 1;
  sizes[i] = BASE_SIZE * 2.2;
  const linePos = [];
  for (const r of neighbours) {
    brightness[r.i] = 1;
    sizes[r.i] = BASE_SIZE * 1.5;
    linePos.push(...positions.subarray(i * 3, i * 3 + 3), ...positions.subarray(r.i * 3, r.i * 3 + 3));
  }
  geometry.attributes.brightness.needsUpdate = true;
  geometry.attributes.size.needsUpdate = true;
  links.geometry.setAttribute("position", new THREE.Float32BufferAttribute(linePos, 3));

  controls.autoRotate = false;
  targetGoal.fromArray(positions, i * 3);
  // Keep the current viewing angle, just translate the camera with the pivot.
  cameraGoal.copy(camera.position).add(targetGoal).sub(controls.target);
  flying = true;
}

function clearSelection() {
  selected = -1;
  input.value = "";
  matches = [];
  suggestions.hidden = true;
  results.hidden = true;
  backButton.hidden = true;
  brightness.fill(1);
  sizes.fill(BASE_SIZE);
  geometry.attributes.brightness.needsUpdate = true;
  geometry.attributes.size.needsUpdate = true;
  links.geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
  targetGoal.set(0, 0, 0);
  cameraGoal.copy(HOME);
  flying = true;
  controls.autoRotate = true;
}

addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.activeElement !== input) clearSelection();
});

// ---------- loop ----------
renderer.setAnimationLoop(() => {
  if (flying) {
    // Ease the orbit pivot and camera toward their goals.
    controls.target.lerp(targetGoal, 0.08);
    camera.position.lerp(cameraGoal, 0.08);
    if (controls.target.distanceToSquared(targetGoal) + camera.position.distanceToSquared(cameraGoal) < 1e-4) {
      flying = false;
    }
  }
  controls.update();
  updateHover();
  renderer.render(scene, camera);
});

// Year disambiguates remakes that share a title.
function label(f) {
  return f.year ? `${f.title} (${f.year})` : f.title;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
