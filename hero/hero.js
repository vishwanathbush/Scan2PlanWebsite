import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);
const Q = new URLSearchParams(location.search);
// the first wipe is gentle, so the floors it reveals pop at distinct scroll positions; the second is exponential;
// moves ease both ends
const EASE = { wipe1: gsap.parseEase('power1.inOut'), wipe: gsap.parseEase('expo.inOut'), move: gsap.parseEase('power2.inOut') };
const CAL = Q.has('cal');            // overlay the storyboard frame, draw in blue
const INK = 0x000000, PAPER = 0xffffff, BLUE = 0x2561f7, DEEP = 0x123ea8;
// what the drawn model is inked in. deep (Owen's ruling, 2026-10-31): real = black, the scan = white, the model = the
// deep blue, with what each level adds and the x-rays arriving in the brand blue. blue: the model in the brand blue,
// the additions arriving in the deep. ink (the kickoff): the model in black, the additions arriving in blue.
// ?model=ink|blue for the others
const MODEL = Q.get('model') ?? 'deep';
const BASE = MODEL === 'blue' ? BLUE : MODEL === 'deep' ? DEEP : INK, ARRIVE = MODEL === 'blue' ? DEEP : BLUE;

/* ───────── the building, in feet ─────────
   Modelled to hero/ref/base-model.jpg. The street corner is the origin. A, the short front (five bays), runs from
   the corner along +x in the plane z = 0. B, the long front (six bays, a narrow bay, the end pavilion, the fire
   escape on its sixth bay), runs along +z in the plane x = 0. The block fills x in [0, A.len], z in [0, B.len];
   the camera stands outside the corner at -x, -z, so A is on the left of the picture and B on the right.
   Each front is modelled in its own frame (u along the front from the corner, v up, w outward) and placed by a
   matrix, so every façade part is written once. */
const WALL = 1.5;
const V = {
  glass: 10.4, store: 11.5, storeTop: 15.5,  // storefront transom, head; top of the storefront cornice, the f2 sill
  f2: [16.5, 23], band: [25.5, 27.5],        // second floor; the string course and frieze over its hoods
  f3: [29.2, 35.7], f4: [39.2, 47.2], f5: [50.7, 58.7],
  course: [61.8, 64.8], sill6: 65.8, f6: 66.8, spring: 74.6,   // the panelled course and sill under the arcade
  pf2: [18.5, 25], pf3: [30.5, 37], pf4: [41.5, 49], pf5: [53, 60],   // the pavilion's own storeys
  frieze: 79.2, cornice: 80.5, corona: 82.5, top: 85.5, roof: 83,
};
const A = { len: 72, bays: 5, bay: 13.6, start: 2.0, win: 8.5, r: 4.75, spring: 72, mull: 0.7,
            store: [0, 15.3, 29.1, 42.9, 57.5, 72], door: 2 };
const B = { len: 128, bays: 6, bay: 15.25, start: 0, win: 6.5, light: 2.9, r: 1.45, mull: 0.5,
            narrow: [97, 101], pav: 110, pavWin: [116, 122], pavTop: 83.3,
            store: [0, 14, 28, 42, 58, 74, 90, 110, 128], door: 4, pavDoor: 7, fire: [82, 107] };
const TANK = { x: 12, z: 113, r: 5.4, stand: [V.roof, 90.3], body: [90.3, 97], cone: 99.8 };
// inside: floor slabs, a column grid, a corridor wall with doors, the stair shaft the section looks into
const FLOORS = [14.5, 26.2, 36.2, 47.7, 63.8];          // tops of the upper floor slabs; the roof slab tops at V.roof
const GRID = { x: [23, 43, 63], z: [20, 40, 60, 80, 100, 120] };
const CORR = { x: 24.5, t: 1.0 };
const STAIR = { x0: 25.5, x1: 36, z0: 50, z1: 68 };
// the section: everything nearer the long front than d, from the corner to z1 along it, is cut away
const CUT = { d: 22, z1: 80 };

/* ───────── recording ───────── */
const lines = {}, solids = {};
const rec = (g, ...p) => (lines[g] ??= []).push(...p);
const M_A = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
const M_B = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0));
const I4 = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

// the walls meet at the plan corners; the seams of their coincident faces are not lines of the building
const innerCorners = [[0, WALL], [WALL, 0], [A.len, WALL], [A.len - WALL, 0],
                      [WALL, B.len], [0, B.len - WALL], [A.len, B.len - WALL], [A.len - WALL, B.len]];
const notSeam = (ax, ay, az, bx, by, bz) => {
  if (Math.abs(ax - bx) > 1e-3 || Math.abs(az - bz) > 1e-3) return true;
  return !innerCorners.some(([x, z]) => Math.abs(ax - x) < 1e-3 && Math.abs(az - z) < 1e-3);
};

function edges(group, geom, M = I4, { thr = 30, keep = null } = {}) {
  const p = new THREE.EdgesGeometry(geom, thr).attributes.position.array;
  for (let i = 0; i < p.length; i += 6) {
    _a.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(M);
    _b.set(p[i + 3], p[i + 4], p[i + 5]).applyMatrix4(M);
    if (keep && !keep(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z)) continue;
    rec(group, _a.x, _a.y, _a.z, _b.x, _b.y, _b.z);
  }
}
// a placing matrix that reflects (the short front's, the flights') turns the triangles inside out; the section's
// poché paints back faces, so the winding is put right again
function flipWinding(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const name of ['position', 'normal', 'uv']) {
    const at = ng.attributes[name]; if (!at) continue;
    const a = at.array, s = at.itemSize;
    for (let i = 0; i < at.count; i += 3) for (let k = 0; k < s; k++) { const t = a[(i + 1) * s + k]; a[(i + 1) * s + k] = a[(i + 2) * s + k]; a[(i + 2) * s + k] = t; }
  }
  return ng;
}
function solid(cat, geom, M = I4) { const g = geom.applyMatrix4(M); (solids[cat] ??= []).push(M.determinant() < 0 ? flipWinding(g) : g); }
function part(cat, group, geom, M = I4, opts) { edges(group, geom, M, opts); solid(cat, geom, M); }
const box = (u, v, w, du, dv, dw) => { const g = new THREE.BoxGeometry(du, dv, dw); g.translate(u + du / 2, v + dv / 2, w + dw / 2); return g; };
const plane = (u0, v0, u1, v1, w) => { const g = new THREE.PlaneGeometry(u1 - u0, v1 - v0); g.translate((u0 + u1) / 2, (v0 + v1) / 2, w); return g; };
function line(group, M, u1, v1, w1, u2, v2, w2) {
  _a.set(u1, v1, w1).applyMatrix4(M); _b.set(u2, v2, w2).applyMatrix4(M);
  rec(group, _a.x, _a.y, _a.z, _b.x, _b.y, _b.z);
}
function poly(group, M, pts) { for (let i = 1; i < pts.length; i++) line(group, M, ...pts[i - 1], ...pts[i]); }
function arcPts(c, v, r, a0, a1, n, w) { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([c + r * Math.cos(a), v + r * Math.sin(a), w]); } return o; }

/* ───────── openings ───────── */
function rectHole(u0, v0, u1, v1) { const p = new THREE.Path(); p.moveTo(u0, v0); p.lineTo(u1, v0); p.lineTo(u1, v1); p.lineTo(u0, v1); p.closePath(); return p; }
function archHole(u0, v0, u1, vs, r) { const p = new THREE.Path(); p.moveTo(u0, v0); p.lineTo(u1, v0); p.lineTo(u1, vs); p.absarc((u0 + u1) / 2, vs, r, 0, Math.PI, false); p.lineTo(u0, v0); p.closePath(); return p; }
function circleHole(c, v, r) { const p = new THREE.Path(); p.absarc(c, v, r, 0, 2 * Math.PI, false); p.closePath(); return p; }

const rect = (u0, u1, f, mull, extra = {}) => ({ kind: 'rect', u0, u1, v0: V[f][0], v1: V[f][1], floor: f, mull, ...extra });
const arch = (u0, u1, v0, vs, r, mull, extra = {}) => ({ kind: 'arch', u0, u1, v0, vs, r, v1: vs + r, mull, ...extra });

function openingsA() {
  const ops = [];
  for (let i = 0; i < A.bays; i++) {
    const u0 = A.start + i * A.bay + (A.bay - A.win) / 2, u1 = u0 + A.win;
    for (const f of ['f2', 'f3', 'f4', 'f5']) ops.push(rect(u0, u1, f, A.mull, { bay: i }));
    ops.push(arch(u0 - 0.5, u1 + 0.5, V.f6, A.spring, A.r, A.mull, { bay: i, fan: true, ring: true }));
  }
  return ops;
}
function openingsB() {
  const ops = [];
  for (let i = 0; i < B.bays; i++) {
    const u0 = B.start + i * B.bay + (B.bay - B.win) / 2, u1 = u0 + B.win;
    for (const f of ['f2', 'f3', 'f4', 'f5']) ops.push(rect(u0, u1, f, B.mull, { bay: i }));
    ops.push(arch(u0, u1, V.f6, 75.3, B.win / 2, B.mull, { bifora: true, ring: true }));   // two lights under one arch
  }
  const [n0, n1] = B.narrow;
  for (const f of ['f2', 'f3', 'f4', 'f5']) ops.push(rect(n0, n1, f, 0));
  ops.push(arch(n0, n1, V.f6, 75, 2, 0, { ring: true }));
  const [p0, p1] = B.pavWin;
  for (const f of ['pf2', 'pf3', 'pf4', 'pf5']) ops.push(rect(p0, p1, f, 0.5, { pav: true }));
  ops.push(arch(p0, p1, V.f6, 69.5, 3, 0.5, { ring: true }));
  ops.push({ kind: 'oculus', c: (p0 + p1) / 2, v: 76.3, r: 1.4, u0: p0, u1: p1, v0: 74.9, v1: 77.7 });
  return ops;
}
function storeOps(F) {
  const ops = [];
  for (let j = 0; j + 1 < F.store.length; j++) {
    const door = j === F.door || j === F.pavDoor;
    ops.push({ kind: 'store', u0: F.store[j] + 0.65, u1: F.store[j + 1] - 0.65, v0: 0, v1: V.store, door, bay: j });
  }
  return ops;
}

/* ───────── a wall: an outline with holes, extruded inward ───────── */
function wall(M, outline, ops, t = WALL, cat = 'walls', group = 'massing') {
  const sh = new THREE.Shape();
  outline.forEach(([u, v], i) => (i ? sh.lineTo(u, v) : sh.moveTo(u, v)));
  sh.closePath();
  for (const o of ops) sh.holes.push(
    o.kind === 'arch' ? archHole(o.u0, o.v0, o.u1, o.vs, o.r)
    : o.kind === 'oculus' ? circleHole(o.c, o.v, o.r)
    : rectHole(o.u0, o.v0, o.u1, o.v1));
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -t);
  solid(cat, g, M);
  // The wall's lines come from its paths, not from the mesh: the triangulation of a face with this many holes
  // leaves slivers that the edge finder draws as lines across the piers.
  const ring = (pts) => {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], o = pts[(i + n - 1) % n];
      line(group, M, p.x, p.y, 0, q.x, q.y, 0);
      line(group, M, p.x, p.y, -t, q.x, q.y, -t);
      const a1 = Math.atan2(p.y - o.y, p.x - o.x), a2 = Math.atan2(q.y - p.y, q.x - p.x);
      let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > Math.PI / 6) {                                   // a sharp corner: the reveal shows an edge
        _a.set(p.x, p.y, 0).applyMatrix4(M); _b.set(p.x, p.y, -t).applyMatrix4(M);
        if (notSeam(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z)) rec(group, _a.x, _a.y, _a.z, _b.x, _b.y, _b.z);
      }
    }
  };
  ring(outline.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const h of sh.holes) {
    const pts = h.getPoints(10);
    if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
    ring(pts);
  }
}

/* ───────── windows: glass, frame, sill, head ───────── */
function window_(M, o) {
  const w = -0.6, i = 0.3;
  if (o.kind === 'oculus') {
    solid('glass', plane(o.u0, o.v0, o.u1, o.v1, -0.7), M);
    poly('openings', M, arcPts(o.c, o.v, o.r - 0.22, 0, 2 * Math.PI, 20, w));
    line('detail', M, o.c - o.r + 0.3, o.v, w, o.c + o.r - 0.3, o.v, w);
    line('detail', M, o.c, o.v - o.r + 0.3, w, o.c, o.v + o.r - 0.3, w);
    return;
  }
  solid('glass', plane(o.u0 + 0.05, o.v0 + 0.05, o.u1 - 0.05, o.v1 - 0.05, -0.7), M);
  const u0 = o.u0 + i, u1 = o.u1 - i, v0 = o.v0 + 0.35, c = (o.u0 + o.u1) / 2;
  if (o.kind === 'rect') {
    const v1 = o.v1 - i, vm = v0 + (v1 - v0) * 0.5;
    poly('openings', M, [[u0, v0, w], [u1, v0, w], [u1, v1, w], [u0, v1, w], [u0, v0, w]]);
    if (o.mull) {
      const h = o.mull / 2;
      line('openings', M, c - h, v0, w, c - h, v1, w); line('openings', M, c + h, v0, w, c + h, v1, w);
      line('openings', M, u0, vm, w, c - h, vm, w); line('openings', M, c + h, vm, w, u1, vm, w);
    } else line('openings', M, u0, vm, w, u1, vm, w);
    const ww = o.u1 - o.u0;
    part('walls', 'openings', box(o.u0 - 0.5, o.v0 - 0.45, -0.2, ww + 1, 0.45, 0.6), M);                 // sill
    if (o.floor === 'f2' || o.floor === 'pf2') hood(M, o); else part('walls', 'openings', box(o.u0 - 0.4, o.v1, -0.2, ww + 0.8, 0.55, 0.5), M);   // head
  } else {                                  // arch
    const r = o.r - i, vs = o.vs;
    poly('openings', M, [[u0, v0, w], [u1, v0, w], [u1, vs, w], ...arcPts(c, vs, r, 0, Math.PI, 12, w), [u0, v0, w]]);
    const vm = v0 + (vs - v0) * 0.5;
    if (o.mull) {
      const h = o.mull / 2;
      line('openings', M, c - h, v0, w, c - h, vs, w); line('openings', M, c + h, v0, w, c + h, vs, w);
      line('openings', M, u0, vs, w, u1, vs, w);
      line('openings', M, u0, vm, w, c - h, vm, w); line('openings', M, c + h, vm, w, u1, vm, w);
    } else line('openings', M, u0, vm, w, u1, vm, w);
    if (o.fan) for (const a of [Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4]) line('detail', M, c, vs, w, c + r * Math.cos(a), vs + r * Math.sin(a), w);
    if (o.bifora) {                            // the two round-headed lights inside the arch, and the roundel between
      const ri = (u1 - u0 - o.mull) / 4, vi = vs + 1.2;
      for (const cx of [u0 + ri, u1 - ri]) poly('openings', M, [[cx - ri, vs, w], [cx - ri, vi, w], ...arcPts(cx, vi, ri, Math.PI, 0, 10, w), [cx + ri, vs, w]]);
      poly('detail', M, arcPts(c, vs + r - 1.2, 0.55, 0, 2 * Math.PI, 12, w));
    }
    if (o.ring) ring(M, c, vs, o.r + 0.1, o.r + 0.6, 0, Math.PI, 0.3, 'detail');   // the archivolt
  }
}
// a segmental pediment hood over a second-floor window
function hood(M, o) {
  const ch = (o.u1 - o.u0) + 1.2, rise = 1.0, t = 0.65, uc = (o.u0 + o.u1) / 2, vb = o.v1 + 0.3;
  const R = (ch * ch / 4 + rise * rise) / (2 * rise), cy = vb - (R - rise);
  const ph = Math.atan2(R - rise, ch / 2);
  ring(M, uc, cy, R - t, R, ph, Math.PI - ph, 0.55, 'detail');
}
function ring(M, c, v, r0, r1, a0, a1, depth, group) {
  const s = new THREE.Shape();
  s.moveTo(c + r1 * Math.cos(a0), v + r1 * Math.sin(a0));
  s.absarc(c, v, r1, a0, a1, false);
  s.lineTo(c + r0 * Math.cos(a1), v + r0 * Math.sin(a1));
  s.absarc(c, v, r0, a1, a0, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
  part('walls', group, g, M);
}

/* ───────── storefront ───────── */
function column(M, u) {
  part('walls', 'openings', box(u - 0.65, 0, -1.1, 1.3, V.store, 1.4), M);
  part('walls', 'detail', box(u - 0.9, 0, -1.1, 1.8, 2.8, 1.65), M);
  part('walls', 'detail', box(u - 0.95, V.glass - 0.6, -1.1, 1.9, V.store - V.glass + 0.6, 1.7), M);
}
function storefront(M, F, ops) {
  const gt = V.glass, tb = gt + 0.5;                                                        // transom bar
  for (const o of ops) {
    const { u0, u1 } = o;
    if (o.bay > 0) column(M, F.store[o.bay]);
    part('walls', 'openings', box(u0, gt, -0.75, u1 - u0, 0.5, 0.45), M);
    solid('glass', plane(u0, tb, u1, V.store, -0.6), M);
    const dc = (u0 + u1) / 2, dw = 2.3;
    const glassRuns = o.door ? [[u0, dc - 2.5], [dc + 2.5, u1]] : [[u0, u1]];
    for (const [g0, g1] of glassRuns) {
      part('walls', 'openings', box(g0, 0, -1.5, g1 - g0, 2.8, 1.1), M);                   // bulkhead
      solid('glass', plane(g0, 2.8, g1, gt, -0.6), M);
      const n = Math.max(1, Math.round((g1 - g0) / 4.6));
      for (let k = 1; k < n; k++) {                                                        // mullions, as double lines
        const u = g0 + (g1 - g0) * k / n;
        for (const d of [-0.15, 0.15]) { line('openings', M, u + d, 2.8, -0.55, u + d, gt, -0.55); line('openings', M, u + d, tb, -0.55, u + d, V.store, -0.55); }
      }
      const pn = Math.max(1, Math.round((g1 - g0) / 5)), pw = (g1 - g0 - 0.5 * (pn + 1)) / pn;
      for (let k = 0; k < pn; k++) part('walls', 'detail', box(g0 + 0.5 + k * (pw + 0.5), 0.5, -0.4, pw, 1.8, 0.1), M);   // bulkhead panels
    }
    if (o.door) {
      for (const s of [-1, 1]) {
        const lu = dc + (s < 0 ? -dw - 0.05 : 0.05);
        part('walls', 'openings', box(lu, 0, -0.95, dw, 8.5, 0.2), M);
        poly('detail', M, [[lu + 0.35, 0.8, -0.7], [lu + dw - 0.35, 0.8, -0.7], [lu + dw - 0.35, 3.8, -0.7], [lu + 0.35, 3.8, -0.7], [lu + 0.35, 0.8, -0.7]]);
        poly('detail', M, [[lu + 0.35, 4.5, -0.7], [lu + dw - 0.35, 4.5, -0.7], [lu + dw - 0.35, 7.8, -0.7], [lu + 0.35, 7.8, -0.7], [lu + 0.35, 4.5, -0.7]]);
      }
      part('walls', 'openings', box(dc - 2.5, 8.5, -0.9, 5, 0.4, 0.4), M);                   // transom bar over the door
      part('walls', 'openings', box(dc - 2.5, 0, -0.9, 0.2, 8.5, 0.4), M);
      part('walls', 'openings', box(dc + 2.3, 0, -0.9, 0.2, 8.5, 0.4), M);
      solid('glass', plane(dc - 2.5, 8.9, dc + 2.5, gt, -0.6), M);
    }
  }
}

/* ───────── courses that wrap the corner: an L in plan ───────── */
function lSlab(cat, group, y0, y1, proj, zEnd, xEnd = A.len) {
  const s = new THREE.Shape();                       // drawn in (x, -z)
  const P = [[-proj, proj], [-proj, -zEnd], [0, -zEnd], [0, 0], [xEnd + proj, 0], [xEnd + proj, proj]];
  P.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  part(cat, group, g);
}

/* ───────── cornice brackets and dentils, per front ───────── */
function brackets(M, u0, u1, v0, v1, proj, pitch) {
  for (let u = u0 + pitch / 2; u < u1; u += pitch) {
    part('walls', 'detail', box(u - 0.35, v0, 0, 0.7, v1 - v0, proj), M);
    for (const k of [1 / 3, 2 / 3]) {
      const d = u + pitch * k;
      if (d < u1) part('walls', 'detail', box(d - 0.18, v1 - 0.7, 0, 0.36, 0.5, 0.4), M);
    }
  }
}

/* ───────── the fire escape, on B ───────── */
function fireEscape(M) {
  const [u0, u1] = B.fire, d = 4.2, lv = [V.f2[0], V.f3[0], V.f4[0], V.f5[0], V.f6];
  for (let k = 0; k < lv.length; k++) {
    const v = lv[k];
    part('fire', 'openings', box(u0, v, 0, u1 - u0, 0.35, d), M);
    const t = v + 3.2, m = v + 1.7;
    poly('openings', M, [[u0, t, 0], [u0, t, d], [u1, t, d], [u1, t, 0]]);
    poly('openings', M, [[u0, m, 0], [u0, m, d], [u1, m, d], [u1, m, 0]]);
    for (let j = 0; j <= 6; j++) { const u = u0 + (u1 - u0) * j / 6; line('openings', M, u, v + 0.35, d, u, t, d); }
    for (const x of [0, d / 2]) { line('openings', M, u0, v + 0.35, x, u0, t, x); line('openings', M, u1, v + 0.35, x, u1, t, x); }
    for (let u = u0 + 0.45; u < u1; u += 0.46) line('detail', M, u, v + 0.35, d, u, t, d);
    if (k + 1 < lv.length) {                                                // the flight up to the next platform
      const v1 = lv[k + 1], a = [u1 - 0.9, v + 0.35], b = [u0 + 0.9, v1];
      for (const x of [1.3, 3.3]) line('openings', M, a[0], a[1], x, b[0], b[1], x);
      line('openings', M, a[0], a[1] + 2.8, 3.3, b[0], b[1] + 2.8, 3.3);
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const u = a[0] + (b[0] - a[0]) * i / n, vv = a[1] + (b[1] - a[1]) * i / n;
        line('detail', M, u, vv, 1.3, u, vv, 3.3);
        if (i % 3 === 1) line('detail', M, u, vv, 3.3, u, vv + 2.8, 3.3);
      }
    }
  }
}

/* ───────── the water tank ───────── */
function waterTank() {
  const { x, z, r } = TANK, [s0, s1] = TANK.stand, [b0, b1] = TANK.body;
  const legs = [[-4, -4], [4, -4], [4, 4], [-4, 4]];
  for (const [dx, dz] of legs) part('roofscape', 'openings', box(x + dx - 0.3, s0, z + dz - 0.3, 0.6, s1 - s0, 0.6));
  for (let i = 0; i < 4; i++) {
    const [ax, az] = legs[i], [bx, bz] = legs[(i + 1) % 4];
    line('detail', I4, x + ax, s0, z + az, x + bx, s1, z + bz); line('detail', I4, x + ax, s1, z + az, x + bx, s0, z + bz);
  }
  part('roofscape', 'openings', box(x - 6, s1 - 0.4, z - 6, 12, 0.4, 12));
  const cyl = new THREE.CylinderGeometry(r, r, b1 - b0, 24, 1, false); cyl.translate(x, (b0 + b1) / 2, z);
  part('roofscape', 'openings', cyl);
  const cone = new THREE.ConeGeometry(r + 0.4, TANK.cone - b1, 24); cone.translate(x, (b1 + TANK.cone) / 2, z);
  part('roofscape', 'openings', cone);
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI / 12, px = x + r * Math.cos(a), pz = z + r * Math.sin(a);
    line(i % 2 ? 'detail' : 'openings', I4, px, b0, pz, px, b1, pz);
    if (i % 2 === 0) line('detail', I4, x + (r + 0.4) * Math.cos(a), b1, z + (r + 0.4) * Math.sin(a), x, TANK.cone, z);
  }
  for (const h of [b0 + 1.2, (b0 + b1) / 2, b1 - 1.2]) poly('detail', I4, arcPts(0, 0, r + 0.08, 0, 2 * Math.PI, 36, 0).map(([cx, cz]) => [x + cx, h, z + cz]));
}

/* ───────── inside ───────── */
// level 350 inside: the trim along a wall's face, storey by storey, in the detail group. A baseboard and a two-member
// cornice on every floor; on the storefront floor a deeper cornice with a dentil course; on the tall fifth floor a
// chair rail over a panelled wainscot, a picture rail, a three-member crown and a head over each door. Every run
// breaks at the openings (ops: u0, u1, v0, v1), so nothing floats across a door or a window.
const LEVELS = [0, ...FLOORS, V.roof - 0.5], TALL = 4;
function runs(u0, u1, y, ops) {
  const cuts = ops.filter(o => o.u1 > u0 && o.u0 < u1 && y > o.v0 - 1e-6 && y < o.v1 + 1e-6).sort((a, b) => a.u0 - b.u0);
  const out = []; let u = u0;
  for (const o of cuts) { if (o.u0 > u + 0.2) out.push([u, o.u0]); u = Math.max(u, o.u1); }
  if (u1 > u + 0.2) out.push([u, u1]);
  return out;
}
function trim(M, u0, u1, ops, w = 0.05, yMin = 0) {
  const rule = (y) => { for (const [a, b] of runs(u0, u1, y, ops)) line('detail', M, a, y, w, b, y, w); };
  const free = (u, y) => !ops.some(o => u > o.u0 && u < o.u1 && y > o.v0 && y < o.v1);
  const panel = (a, v0, b, v1) => poly('detail', M, [[a, v0, w], [b, v0, w], [b, v1, w], [a, v1, w], [a, v0, w]]);
  for (let i = 0; i + 1 < LEVELS.length; i++) {
    const y0 = LEVELS[i], c = LEVELS[i + 1] - 1;                 // the floor and the underside of the slab over it
    if (y0 < yMin - 0.01) continue;
    rule(y0 + 0.5); rule(c - 1.9); rule(c - 1.3);
    if (i === 0) {                                                // the storefront floor: the deep cornice and its dentils
      rule(c - 2.8);
      for (let u = Math.ceil(u0) + 0.5; u < u1 - 0.4; u += 1) if (free(u, c - 2.1)) line('detail', M, u, c - 2.3, w, u, c - 1.9, w);
    }
    if (i === TALL) {
      rule(c - 2.5); rule(y0 + 11.5); rule(y0 + 2.9); rule(y0 + 3.1);
      for (const [a, b] of runs(u0, u1, y0 + 1.7, ops)) {
        const n = Math.max(1, Math.round((b - a) / 3.2)), pw = (b - a) / n;
        for (let k = 0; k < n; k++) {
          const pa = a + k * pw + 0.35, pb = a + (k + 1) * pw - 0.35;
          if (pb - pa < 0.8) continue;
          panel(pa, y0 + 0.9, pb, y0 + 2.5); panel(pa + 0.25, y0 + 1.15, pb - 0.25, y0 + 2.25);
        }
      }
      for (const o of ops) if (o.door && Math.abs(o.v0 - y0) < 0.1) panel(o.u0 - 0.6, o.v1 + 0.3, o.u1 + 0.6, o.v1 + 1.1);
    }
  }
}
function doorWall(M, u0, u1, doors, t) {
  const pts = [[u0, 0]], ops = [];
  for (const d of doors) {
    if (d < u0 + 1 || d + 3.5 > u1 - 1) continue;
    pts.push([d, 0], [d, 7.5], [d + 3.5, 7.5], [d + 3.5, 0]);                       // a notch at the ground
    for (const y of FLOORS) ops.push({ kind: 'rect', u0: d, u1: d + 3.5, v0: y, v1: y + 7.5, door: true });   // a hole at each floor
    for (const y of [0, ...FLOORS]) {                                                 // level 300: the frame and the leaf
      poly('openings', M, [[d - 0.3, y, 0.05], [d - 0.3, y + 7.8, 0.05], [d + 3.8, y + 7.8, 0.05], [d + 3.8, y, 0.05]]);
      poly('openings', M, [[d + 0.15, y, -0.5], [d + 0.15, y + 7.35, -0.5], [d + 3.35, y + 7.35, -0.5], [d + 3.35, y, -0.5], [d + 0.15, y, -0.5]]);
      poly('detail', M, [[d + 0.6, y + 1, -0.5], [d + 2.9, y + 1, -0.5], [d + 2.9, y + 6.5, -0.5], [d + 0.6, y + 6.5, -0.5], [d + 0.6, y + 1, -0.5]]);
    }
  }
  pts.push([u1, 0], [u1, V.roof - 1], [u0, V.roof - 1]);
  wall(M, pts, ops, t, 'interior', 'interior');
  trim(M, u0, u1, [...ops, ...doors.map(d => ({ u0: d, u1: d + 3.5, v0: 0, v1: 7.5, door: true }))]);
}
// a flight of nine risers between za and zb, drawn as its side profile and extruded 4 ft along x
function flight(x0, za, zb, y0, y1) {
  const n = 9, dz = (zb - za) / n, dy = (y1 - y0) / n;
  const pts = [[za, y0]];
  for (let i = 1; i <= n; i++) pts.push([za + (i - 1) * dz, y0 + i * dy], [za + i * dz, y0 + i * dy]);
  // the stringer's underside, 1.2 ft under the treads; at grade it meets the ground instead of going under it
  if (y0 - 1.2 >= 0) pts.push([zb, y1 - 1.2], [za, y0 - 1.2]);
  else pts.push([zb, y1 - 1.2], [zb + (za - zb) * (y1 - 1.2) / (y1 - y0), 0]);
  const s = new THREE.Shape(); pts.forEach(([u, v], i) => (i ? s.lineTo(u, v) : s.moveTo(u, v))); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 4, bevelEnabled: false });
  const M = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)).setPosition(x0, 0, 0);
  part('interior', 'interior', g, M);
  // level 300: the handrail on the open side, with its posts
  const xr = x0 + 0.3;
  line('openings', I4, xr, y0 + 3, za, xr, y1 + 3, zb);
  for (let i = 0; i <= 3; i++) { const f = i / 3; line('openings', I4, xr, y0 + f * (y1 - y0), za + f * (zb - za), xr, y0 + 3 + f * (y1 - y0), za + f * (zb - za)); }
}
function interior() {
  for (const y of FLOORS) part('slabs', 'interior', box(WALL, y - 1, WALL, A.len - 2 * WALL, 1, B.len - 2 * WALL));
  for (const x of GRID.x) for (const z of GRID.z) {
    part('interior', 'interior', box(x - 0.6, 0, z - 0.6, 1.2, V.roof - 1, 1.2));
    for (const y of [...FLOORS, V.roof - 0.5]) part('interior', 'detail', box(x - 0.95, y - 2.2, z - 0.95, 1.9, 1.0, 1.9));   // level 350: capitals
  }
  // level 350 on the long front's inner face, which the section looks along: the trim, breaking at the windows
  trim(M_B, WALL + 0.3, B.pav - 0.3, [...openingsB(), ...storeOps(B)], -WALL - 0.05);
  const M_C = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)).setPosition(CORR.x, 0, 0);
  doorWall(M_C, WALL, STAIR.z0 - 1, [8, 23, 38], CORR.t);
  doorWall(M_C, STAIR.z1 + 1, B.len - WALL, [74, 89, 104, 119], CORR.t);
  // the corridor is 7 ft wide: its other wall, with its own doors, faces the loft behind
  const M_C2 = M_C.clone().setPosition(CORR.x + 7, 0, 0);
  doorWall(M_C2, WALL, STAIR.z0 - 1, [15, 33], CORR.t);
  doorWall(M_C2, STAIR.z1 + 1, B.len - WALL, [80, 92, 114], CORR.t);
  // the front rooms: a partition every two bays between the long front and the corridor, from the first floor up
  const M_P = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  const y1 = FLOORS[0] - 1, yT = V.roof - 1;
  for (const z of [30.5, 61, 91.5]) wall(M_P.clone().setPosition(0, 0, z), [[WALL, y1], [CORR.x, y1], [CORR.x, yT], [WALL, yT]], [], 0.5, 'interior', 'interior');
  trim(M_P.clone().setPosition(0, 0, 91.5), WALL + 0.3, CORR.x - 0.3, [], 0.05, y1);            // the partition the cut looks at
  // the loft behind the corridor: one cross wall; the elevator core with a door per floor; the toilet rooms beside it
  wall(M_P.clone().setPosition(0, 0, 92), [[CORR.x + 8, y1], [A.len - WALL, y1], [A.len - WALL, yT], [CORR.x + 8, yT]], [], 0.5, 'interior', 'interior');
  trim(M_P.clone().setPosition(0, 0, 92), CORR.x + 8.3, A.len - WALL - 0.3, [], 0.05, y1);
  const { x0: cx0, x1: cx1, z0: cz0, z1: cz1 } = CORE;
  part('interior', 'interior', box(cx0, 0, cz0, cx1 - cx0, V.roof + 5, 1));
  part('interior', 'interior', box(cx0, 0, cz1 - 1, cx1 - cx0, V.roof + 5, 1));
  part('interior', 'interior', box(cx1 - 1, 0, cz0, 1, V.roof + 5, cz1 - cz0));
  doorWall(M_C.clone().setPosition(cx0, 0, 0), cz0 + 1, cz1 - 1, [cz0 + 4.25], 1);
  doorWall(M_C.clone().setPosition(58, 0, 0), 98, 110, [100], 0.5);
  for (const z of [98, 109.5]) wall(M_P.clone().setPosition(0, 0, z), [[58.5, 0], [A.len - WALL, 0], [A.len - WALL, yT], [58.5, yT]], [], 0.5, 'interior', 'interior');
  const { x0, x1, z0, z1 } = STAIR;
  part('interior', 'interior', box(x0, 0, z0 - 1, x1 - x0, V.roof - 1, 1));           // shaft walls
  part('interior', 'interior', box(x0, 0, z1, x1 - x0, V.roof - 1, 1));
  part('interior', 'interior', box(x1, 0, z0 - 1, 1, V.roof - 1, z1 - z0 + 2));
  const levels = [0, ...FLOORS, V.roof - 0.5];
  for (let i = 0; i + 1 < levels.length; i++) {
    const y0 = levels[i], y1 = levels[i + 1], ym = (y0 + y1) / 2;
    flight(x0 + 0.5, z0 + 1, z0 + 9, y0, ym);                                        // up along the shaft, nearest the cut
    part('interior', 'interior', box(x0 + 0.5, ym - 0.8, z0 + 9, x1 - x0 - 1, 0.8, z1 - z0 - 10));   // the half landing
    flight(x0 + 5.5, z0 + 9, z0 + 1, ym, y1);                                        // and back, behind
  }
}

/* ───────── the x-rays: the steel frame, then MEP. Lines only, drawn through the faded building ───────── */
const CORE = { x0: 40, x1: 52, z0: 98, z1: 110 };            // the elevator core, framed and braced
function structure() {
  const g = 'structure', lv = [...FLOORS, V.roof], bx = (...a) => edges(g, box(...a)), ln = (...a) => line(g, I4, ...a);
  const colsA = [], colsB = [];
  for (let i = 0; i <= A.bays; i++) colsA.push(A.start + i * A.bay);
  for (let i = 0; i <= B.bays; i++) colsB.push(B.start + i * B.bay);
  colsB.push(B.pav, B.len - 2.5);
  for (const x of GRID.x) for (const z of GRID.z) bx(x - 0.5, 0, z - 0.5, 1, V.roof - 1, 1);   // the interior grid
  for (const x of colsA) bx(x - 0.5, 0, 2, 1, V.roof - 1, 1);                                // a column behind every pier
  for (const z of colsB) bx(2, 0, z - 0.5, 1, V.roof - 1, 1);
  for (const z of GRID.z) bx(A.len - 3, 0, z - 0.5, 1, V.roof - 1, 1);                        // and along the blind walls
  for (const x of GRID.x) bx(x - 0.5, 0, B.len - 3, 1, V.roof - 1, 1);
  const zl = [2.5, ...GRID.z, B.len - 2.5], xl = [2.5, ...GRID.x, A.len - 2.5];
  for (const y of lv) {
    for (const z of zl) bx(2.5, y - 2.4, z - 0.4, A.len - 5, 1.4, 0.8);                        // girders across
    for (const x of xl) bx(x - 0.4, y - 2.4, 2.5, 0.8, 1.4, B.len - 5);                        // girders along
    for (let z = 10.5; z < B.len - 3; z += 8) if (!zl.some(gz => Math.abs(gz - z) < 2)) ln(2.5, y - 1.9, z, A.len - 2.5, y - 1.9, z);   // joists
  }
  bx(0.4, V.store - 0.3, 0.4, A.len - 0.8, 2, 1.1); bx(0.4, V.store - 0.3, 0.4, 1.1, 2, B.len - 0.8);   // the storefront's transfer girders
  // the elevator core: four posts, a rail every 4 ft, X-bracing each storey on every face, machine beams on top
  const { x0, x1, z0, z1 } = CORE, cs = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], lv0 = [0, ...lv];
  for (const [x, z] of cs) bx(x - 0.4, 0, z - 0.4, 0.8, V.roof + 5, 0.8);
  for (let i = 0; i < 4; i++) {
    const [ax, az] = cs[i], [cx, cz] = cs[(i + 1) % 4];
    for (let y = 4; y < V.roof + 5; y += 4) ln(ax, y, az, cx, y, cz);
    for (let k = 0; k + 1 < lv0.length; k++) { ln(ax, lv0[k], az, cx, lv0[k + 1], cz); ln(cx, lv0[k], cz, ax, lv0[k + 1], az); }
  }
  bx(x0 - 1, V.roof + 5, z0 - 1, x1 - x0 + 2, 1.2, z1 - z0 + 2);
  bx(TANK.x - 6.5, V.roof, TANK.z - 0.6, 13, 1.6, 1.2); bx(TANK.x - 0.6, V.roof, TANK.z - 6.5, 1.2, 1.6, 13);   // the tank's dunnage
  // footings under every column, a strip footing under each wall
  const feet = [];
  for (const x of GRID.x) for (const z of GRID.z) feet.push([x, z]);
  for (const x of colsA) feet.push([x, 2.5]);
  for (const z of colsB) feet.push([2.5, z]);
  for (const [x, z] of feet) { bx(x - 2.2, -4, z - 2.2, 4.4, 1.5, 4.4); bx(x - 1, -2.5, z - 1, 2, 2.5, 2); }
  bx(-1.5, -3, -1.5, A.len + 3, 1.2, 4.5); bx(-1.5, -3, -1.5, 4.5, 1.2, B.len + 3); bx(A.len - 3, -3, -1.5, 4.5, 1.2, B.len + 3); bx(-1.5, -3, B.len - 3, A.len + 3, 1.2, 4.5);
  // the stair: two stringers per flight and the landing beams
  const { x0: sx0, x1: sx1, z0: sz0 } = STAIR, levels = [0, ...FLOORS, V.roof - 0.5];
  for (let i = 0; i + 1 < levels.length; i++) {
    const y0 = levels[i], y1 = levels[i + 1], ym = (y0 + y1) / 2;
    for (const x of [sx0 + 0.5, sx0 + 4.5]) ln(x, y0 - 1.2, sz0 + 1, x, ym - 1.2, sz0 + 9);
    for (const x of [sx0 + 5.5, sx0 + 9.5]) ln(x, ym - 1.2, sz0 + 9, x, y1 - 1.2, sz0 + 1);
    bx(sx0 + 0.5, ym - 1.6, sz0 + 9, sx1 - sx0 - 1, 0.8, 0.6);
  }
  // a lintel over every window on both fronts
  for (const [F, M] of [[A, M_A], [B, M_B]]) for (let i = 0; i < F.bays; i++) {
    const u0 = F.start + i * F.bay + (F.bay - F.win) / 2 - 0.8;
    for (const f of ['f2', 'f3', 'f4', 'f5']) edges(g, box(u0, V[f][1], -2.2, F.win + 1.6, 0.8, 1.6), M);
  }
}
function cyl(g, x, y0, y1, z, r, n = 8) {
  const c = new THREE.CylinderGeometry(r, r, y1 - y0, 16, 1, false); c.translate(x, (y0 + y1) / 2, z); edges(g, c);
  for (let i = 0; i < n; i++) { const a = i * 2 * Math.PI / n; line(g, I4, x + r * Math.cos(a), y0, z + r * Math.sin(a), x + r * Math.cos(a), y1, z + r * Math.sin(a)); }
}
function mep() {
  const g = 'mep', floors = [0, ...FLOORS], ceil = (i) => (i + 1 < floors.length ? floors[i + 1] : V.roof) - 1;
  const bx = (...a) => edges(g, box(...a)), ln = (...a) => line(g, I4, ...a);
  const rect = (x0, y, z0, x1, z1) => poly(g, I4, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, y, z0]]);
  const face = (x0, y0, x1, y1, z) => poly(g, I4, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [x0, y0, z]]);
  // ── mechanical: the air handler and exhaust fans on the roof, two duct shafts, a supply and a return trunk on every floor
  bx(5, V.roof, 4, 15, 6, 9); face(6.5, V.roof + 1, 10.5, V.roof + 5, 3.95); face(12, V.roof + 1, 16, V.roof + 5, 3.95);
  for (const x of [23, 27]) { bx(x, V.roof, 5, 3, 2.5, 3); for (let k = 0.5; k < 3; k += 0.5) ln(x + k, V.roof + 2.5, 5, x + k, V.roof + 2.5, 8); }
  bx(11, 2, 11, 3.5, V.roof, 3.5); bx(14.5, V.roof + 0.6, 11, 5.5, 2.4, 3.5);                  // the supply shaft and its elbow to the unit
  bx(55, 2, 100, 3, V.roof - 1, 3); bx(40, V.roof, 100, 12, 5, 8); bx(43, V.roof + 0.6, 101, 12, 2.2, 2.2);   // the return shaft and the second unit
  for (let i = 0; i < floors.length; i++) {
    const c = ceil(i), f = floors[i];
    bx(11, c - 2.2, 14.5, 3.5, 1.8, B.len - 18);                                                // supply trunk
    bx(50, c - 2.0, 8, 2.8, 1.6, 92);                                                           // return trunk
    for (let z = 20; z < B.len - 8; z += 12) {
      bx(14.5, c - 1.6, z - 0.6, A.len - 20, 1.1, 1.2);                                         // branch
      bx(16.5, c - 2.0, z - 1.2, 3, 1.8, 2.4);                                                   // VAV box
      for (let x = 26; x < A.len - 6; x += 12) bx(x - 1, c - 0.45, z - 1, 2, 0.35, 2);          // diffusers
      bx(50, c - 1.2, z - 0.5, 2.8, 0.8, 1);                                                     // return grille
    }
    if (i > 0) {                                                                                 // a radiator under every window of both fronts
      for (let b = 0; b < A.bays; b++) { const x = A.start + b * A.bay + (A.bay - 3.6) / 2; bx(x, f + 0.6, 1.6, 3.6, 2.2, 0.8); for (let k = 0.5; k < 3.6; k += 0.6) ln(x + k, f + 0.6, 2.4, x + k, f + 2.8, 2.4); }
      for (let b = 0; b < B.bays; b++) { const z = B.start + b * B.bay + (B.bay - 3.6) / 2; bx(1.6, f + 0.6, z, 0.8, 2.2, 3.6); for (let k = 0.5; k < 3.6; k += 0.6) ln(2.4, f + 0.6, z + k, 2.4, f + 2.8, z + k); }
    }
    // ── electrical: a cable tray as a ladder along the corridor, a panel board per floor with its door, conduit drops, the lighting grid
    ln(21.2, c - 0.9, 3, 21.2, c - 0.9, B.len - 3); ln(22.2, c - 0.9, 3, 22.2, c - 0.9, B.len - 3);
    for (let z = 4; z < B.len - 3; z += 1.5) ln(21.2, c - 0.9, z, 22.2, c - 0.9, z);
    bx(24.55, f + 3.5, 42, 0.5, 3.5, 2.4); poly(g, I4, [[24.5, f + 3.8, 42.3], [24.5, f + 6.7, 42.3], [24.5, f + 6.7, 44.1], [24.5, f + 3.8, 44.1], [24.5, f + 3.8, 42.3]]);
    for (let z = 12; z < B.len - 6; z += 24) ln(21.7, c - 0.9, z, 24.5, f + 7, z);
    for (let x = 6; x < A.len - 8; x += 10) for (let z = 6; z < B.len - 8; z += 10) rect(x, c - 0.12, z, x + 4, z + 2);
    // ── plumbing: the toilet room at the stack, its fixtures, the pipe runs along the ceiling
    rect(58, f + 0.05, 98, 70, 110);
    for (const x of [60, 63.5, 67]) { bx(x, f, 107.5, 1.4, 1.3, 2.2); bx(x, f + 1.3, 108.8, 1.4, 1.1, 0.6); }
    for (const x of [60, 64]) bx(x, f + 2.6, 98.6, 2, 0.5, 1.6);
    for (const x of [61, 61.6, 62.2]) ln(x, c - 1.3, 3, x, c - 1.3, B.len - 3);
    ln(3, c - 1.4, 100, A.len - 3, c - 1.4, 100);
    // ── fire: the sprinkler main and branches with their heads, the standpipe's hose valve at the stair
    ln(30, c - 0.3, 3, 30, c - 0.3, B.len - 3);
    for (let z = 6; z < B.len - 3; z += 8) { ln(3, c - 0.2, z, A.len - 3, c - 0.2, z); for (let x = 7; x < A.len - 3; x += 8) { ln(x, c - 0.2, z, x, c - 0.9, z); ln(x - 0.4, c - 0.9, z, x + 0.4, c - 0.9, z); } }
    bx(27.3, f + 3.5, 51.5, 0.9, 1.2, 0.9);
  }
  // the risers: the plumbing stack, the standpipe, the tank's downpipe
  for (const [x, z] of [[61, 102], [61.8, 102], [62.6, 102], [61, 103], [61.8, 103], [62.6, 103]]) ln(x, 0, z, x, V.roof + 1, z);
  ln(27.7, 0, 52, 27.7, V.roof + 2, 52); ln(28.1, 0, 52, 28.1, V.roof + 2, 52);
  ln(TANK.x, TANK.body[0], TANK.z, TANK.x, 0, TANK.z);
  // the plant on the ground floor: switchgear, a transformer, the boiler and its flue, the water heater, pumps, the fire pump, the alarm panel
  for (let k = 0; k < 3; k++) { const x = 44 + k * 3.2; bx(x, 0, 123.5, 3, 7, 2.5); face(x + 0.4, 0.5, x + 2.6, 6.5, 123.45); face(x + 0.8, 4.5, x + 2.2, 6, 123.4); }
  bx(54, 0, 122, 5, 5, 4);
  bx(30, 0, 118, 6, 7, 5); ln(33, 7, 120.5, 33, V.roof + 3, 120.5);
  cyl(g, 40, 0, 6.5, 118, 2);
  for (const z of [106, 110]) { bx(8, 0, z, 4, 2.2, 2.2); bx(12, 0.4, z + 0.3, 3, 1.6, 1.6); ln(6, 1.6, z + 1.1, 8, 1.6, z + 1.1); }
  bx(20, 0, 104, 5, 2.5, 3); cyl(g, 27, 0, 3, 105.5, 1.2); ln(20, 2.5, 105.5, 27.7, 2.5, 105.5);
  bx(38, 3, 123.8, 2, 3, 0.4);
}

/* ───────── build ───────── */
/* ───────── people: a few figures on the sidewalk, drawn in ink over the engraving and then ghosts in the scan, and a
   few inside as ghosts only, the way a person who stood still for a scanner leaves a silhouette in the cloud. They are
   not part of the model. Each figure is a silhouette polygon facing the camera, extruded 0.8 ft for the point
   sampler. ───────── */
const FIG = {
  stand: [[-0.2, 4.85], [-0.75, 4.6], [-0.95, 3.0], [-0.65, 2.9], [-0.55, 3.6], [-0.5, 2.6], [-0.5, 0], [-0.12, 0], [0, 2.1], [0.12, 0], [0.5, 0], [0.5, 2.6], [0.55, 3.6], [0.65, 2.9], [0.95, 3.0], [0.75, 4.6], [0.2, 4.85]],
  walk: [[-0.15, 4.85], [-0.5, 4.6], [-0.7, 3.9], [-0.55, 3.6], [-0.4, 3.0], [-0.5, 2.7], [-1.0, 1.5], [-1.2, 0.1], [-0.85, 0], [-0.65, 1.0], [-0.1, 1.9], [0.6, 0.9], [0.75, 0], [1.1, 0], [1.05, 0.4], [0.5, 1.6], [0.3, 2.7], [0.45, 3.0], [0.95, 3.7], [0.85, 4.0], [0.4, 3.5], [0.35, 4.6], [0.15, 4.85]],
};
const PEOPLE = [
  { x: -7, z: 30, kind: 'walk' }, { x: -11, z: 50, kind: 'stand', s: 0.95 }, { x: -9.4, z: 51.6, kind: 'stand' }, { x: -8, z: 96, kind: 'walk', flip: true },
  { x: 22, z: -8, kind: 'walk' }, { x: 47, z: -10, kind: 'stand' }, { x: 48.7, z: -10, kind: 'stand', s: 0.6 }, { x: -5, z: -5, kind: 'stand', s: 1.05 },
  { x: 12, y: FLOORS[3], z: 20, kind: 'stand', inside: true }, { x: 10, y: FLOORS[1], z: 40, kind: 'walk', inside: true },
  { x: 28, y: FLOORS[0], z: 12, kind: 'walk', flip: true, inside: true }, { x: 45, y: FLOORS[2], z: 60, kind: 'stand', inside: true },
  { x: 12, y: 0, z: 100, kind: 'stand', inside: true }, { x: 50, y: FLOORS[4], z: 30, kind: 'walk', inside: true },
];
const FACING = 39.3 * Math.PI / 180;                          // cal.yaw: the figures face the camera
const figures = [];
function people() {
  const u = new THREE.Vector3(Math.cos(FACING), 0, -Math.sin(FACING)), d = new THREE.Vector3(Math.sin(FACING), 0, Math.cos(FACING));
  for (const f of PEOPLE) {
    const s = f.s ?? 1;
    const M = new THREE.Matrix4().makeBasis(u.clone().multiplyScalar(s * (f.flip ? -1 : 1)), new THREE.Vector3(0, s, 0), d.clone().multiplyScalar(s)).setPosition(f.x, f.y ?? 0, f.z);
    const body = new THREE.Shape(); FIG[f.kind].forEach(([x, y], i) => (i ? body.lineTo(x, y) : body.moveTo(x, y))); body.closePath();
    const hc = f.kind === 'walk' ? 0.1 : 0, head = new THREE.Shape(); head.absarc(hc, 5.3, 0.42, 0, 2 * Math.PI, false);
    const g = new THREE.ExtrudeGeometry([body, head], { depth: 0.8, bevelEnabled: false, curveSegments: 8 }); g.translate(0, 0, -0.4);
    figures.push(g.applyMatrix4(M));
    if (f.inside) continue;                                   // inside, a figure is a ghost in the scan only
    poly('people', M, [...FIG[f.kind], FIG[f.kind][0]].map(([x, y]) => [x, y, 0]));
    poly('people', M, arcPts(hc, 5.3, 0.42, 0, 2 * Math.PI, 12, 0));
    for (let i = 0; i < 3; i++) line('people', M, -0.3, 2.8 + i * 0.55, 0, 0.3, 3.2 + i * 0.55, 0);   // a few strokes, like the engraving's
  }
}

function build() {
  const opsA = openingsA(), opsB = openingsB(), stA = storeOps(A), stB = storeOps(B);
  wall(M_A, [[0, 0], [A.len, 0], [A.len, V.top], [0, V.top]], [...opsA, ...stA]);
  wall(M_B, [[WALL, 0], [B.len, 0], [B.len, B.pavTop], [B.pav, B.pavTop], [B.pav, V.top], [WALL, V.top]], [...opsB, ...stB]);
  part('walls', 'massing', box(A.len - WALL, 0, WALL, WALL, V.top, B.len - WALL), I4, { keep: notSeam });             // lot-line wall
  part('walls', 'massing', box(WALL, 0, B.len - WALL, A.len - 2 * WALL, B.pavTop, WALL), I4, { keep: notSeam });     // rear wall
  part('slabs', 'massing', box(WALL, V.roof - 0.5, WALL, A.len - 2 * WALL, 0.5, B.len - 2 * WALL));                   // roof

  for (const o of opsA) window_(M_A, o);
  for (const o of opsB) window_(M_B, o);
  storefront(M_A, A, stA); storefront(M_B, B, stB);
  part('walls', 'openings', box(-0.35, 0, -0.35, 1.65, V.store, 1.65));                    // corner pier, once
  part('walls', 'detail', box(-0.55, 0, -0.55, 2.05, 2.8, 2.05));
  part('walls', 'detail', box(-0.6, 11.5, -0.6, 2.2, 2, 2.2));
  part('walls', 'openings', box(A.len - 1.3, 0, -0.35, 1.3, V.store, 1.85), M_A);            // end pier of A

  // courses
  lSlab('walls', 'openings', V.store, 13.3, 0.35, B.len);                                    // storefront lintel band
  lSlab('walls', 'openings', 13.3, 14.3, 0.6, B.len);                                        // storefront cornice, two steps
  lSlab('walls', 'openings', 14.3, V.storeTop, 1.2, B.len);
  lSlab('walls', 'openings', V.band[0], V.band[0] + 0.8, 0.5, B.len);                        // string course over the hoods
  lSlab('walls', 'openings', V.band[1], V.f3[0], 0.4, B.len);                                // f3 sill course
  lSlab('walls', 'openings', V.sill6, V.f6, 0.5, B.len);                                     // sill course under the arcade
  lSlab('walls', 'openings', V.frieze, V.frieze + 0.8, 0.3, B.pav);                          // frieze
  lSlab('walls', 'detail', V.frieze + 0.8, V.cornice, 0.8, B.pav);                           // bed mould
  lSlab('walls', 'massing', V.corona, V.corona + 1.3, 2.4, B.pav);                           // corona
  lSlab('walls', 'massing', V.corona + 1.3, V.top, 2.8, B.pav);                              // crown
  brackets(M_A, 0, A.len + 2.0, V.cornice, V.corona, 1.8, 3.5);
  brackets(M_B, -2.0, B.pav, V.cornice, V.corona, 1.8, 3.5);
  // the pavilion's own, smaller cornice
  part('walls', 'openings', box(B.pav, 78.8, 0, B.len - B.pav, 0.5, 0.6), M_B);
  brackets(M_B, B.pav, B.len + 1.4, 79.3, 81.2, 1.4, 2.6);
  part('walls', 'massing', box(B.pav, 81.2, 0, B.len - B.pav + 1.6, 1.1, 1.6), M_B);
  part('walls', 'massing', box(B.pav, 82.3, 0, B.len - B.pav + 1.9, B.pavTop - 82.3, 1.9), M_B);

  // panels and capitals, per front
  for (const [M, F, ops] of [[M_A, A, opsA], [M_B, B, opsB]]) {
    for (const o of ops) {
      if (o.kind !== 'rect' || o.pav) continue;
      const ww = o.u1 - o.u0;
      if (o.floor === 'f3' || o.floor === 'f4') {
        const nv = o.floor === 'f3' ? V.f4[0] : V.f5[0];
        part('walls', 'detail', box(o.u0 + 0.3, o.v1 + 0.75, 0, ww - 0.6, nv - o.v1 - 1.4, 0.12), M);
      }
      if (o.floor === 'f5') part('walls', 'detail', box(o.u0 - 0.5, V.course[0] + 0.4, 0, ww + 1, V.course[1] - V.course[0] - 0.8, 0.12), M);
    }
    for (let i = 0; i <= F.bays; i++) {
      const u = F.start + i * F.bay;
      if (u < 1 || u > F.len - 1) continue;
      part('walls', 'detail', box(u - 0.9, V.sill6 - 1.5, 0, 1.8, 1.4, 0.35), M);
      part('walls', 'detail', box(u - 1.2, V.band[0] + 0.9, 0, 2.4, 1.0, 0.12), M);
    }
  }
  fireEscape(M_B);
  waterTank();
  people();
  interior();
  structure();
  mep();
}
build();

/* ───────── the cloud: points sampled on the solids and on the people. The scan bursts on: inside, a burst is one
   room of one storey (nine per storey, by plan), the top floor first; outside, a station along the fronts from the corner, then the roofscape and the rear. A point is
   inside by where it is: within the walls, so the rooms are the plates, the partitions, the corridors and the columns
   the cut shows later, and the fronts' inner skins come on with the fronts. Every point carries its burst and the
   point shader shows the bursts that have fired. Two parts, nearer the long front's far end or not, so the cut needs one
   plane each. ───────── */
const ROOMS = 9, STATIONS = 6, NB = 6 * ROOMS + STATIONS;
const BURST = { gap: 0.0025, lead: 0.004, station: 0.011, flash: 0.016 };   // scroll between a storey's rooms, before the first station, between stations; a flash's length
// a scanner stood in each room (plan, feet; 5.5 ft up) and at six places on the sidewalk and above the roof. A point
// is lit about its own station, so each room is its own pool of light and the fronts pool about the sidewalk stations.
const ROOM_ST = [[13, 16], [13, 46], [13, 76], [13, 109], [28, 32], [28, 96], [50, 25], [50, 70], [50, 110]];
const ROOM_ORDER = [0, 4, 1, 6, 2, 5, 7, 3, 8];                            // the rooms fire nearest the camera first
const OUT_ST = [[-12, 0, 20], [18, 0, -12], [-12, 0, 64], [54, 0, -12], [-12, 0, 108], [36, 95, 64]];
const stations = [];
for (let s = 0; s < 6; s++) for (const [x, z] of ROOM_ST) stations.push(new THREE.Vector3(x, LEVELS[5 - s] + 5.5, z));
for (const [x, y, z] of OUT_ST) stations.push(new THREE.Vector3(x, y, z));
const burstAt = new Float32Array(NB);
function sampleCloud(nOut, nIn, nPerson) {
  const storey = (y) => { let i = 0; while (i < FLOORS.length && y >= FLOORS[i]) i++; return i; };   // 0 ground … 5 top
  // the rooms: four along the long front, the corridor in two halves, the loft in two, the core and toilets
  const room = (x, z) => x < CORR.x ? (z < 30.5 ? 0 : z < 61 ? 1 : z < 91.5 ? 2 : 3) : x < CORR.x + 7 ? (z < 64 ? 4 : 5) : z < 92 ? (z < 48 ? 6 : 7) : 8;
  const inside = (p) => p.x > WALL + 0.1 && p.z > WALL + 0.1 && p.x < A.len - WALL - 0.1 && p.z < B.len - WALL - 0.1 && p.y < V.roof - 0.4;   // the fronts' inner skins stay with the fronts: boxed in them, the rooms were a block
  const burstOf = (p) => {
    if (inside(p)) return (5 - storey(p.y)) * ROOMS + room(p.x, p.z);
    if (p.y > V.roof - 0.5 || p.x > A.len - 0.1 || p.z > B.len - 0.1) return 6 * ROOMS + 5;
    if (p.z < WALL) return 6 * ROOMS + (p.x < A.len / 2 ? 1 : 3);
    return 6 * ROOMS + (p.z < 43 ? 0 : p.z < 86 ? 2 : 4);
  };
  const take = (geos, n) => {
    const geo = mergeGeometries(geos.map(g => g.index ? g.toNonIndexed() : g), false);
    const s = new MeshSurfaceSampler(new THREE.Mesh(geo)).build(), p = new THREE.Vector3(), m = new THREE.Vector3();
    const pos = new Float32Array(n * 3), nor = new Int8Array(n * 3), burst = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s.sample(p, m); pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; burst[i] = burstOf(p);
      nor[i * 3] = Math.round(m.x * 127); nor[i * 3 + 1] = Math.round(m.y * 127); nor[i * 3 + 2] = Math.round(m.z * 127);   // the surface's normal: a wall faces the camera, a plate does not
    }
    geo.dispose(); return { pos, nor, burst, n };
  };
  const of = (...cats) => cats.flatMap(c => solids[c] ?? []);
  // the inside gets two budgets, most of it to the walls: the plates have most of the area, and seen edge on they
  // saturate anyway, while a wall facing the camera needs the points to read as a surface
  const sets = [take(of('slabs'), Math.round(nIn * 0.2)), take(of('interior'), Math.round(nIn * 0.8)), take(of('walls', 'roofscape', 'fire'), nOut),
                take(figures, nPerson * figures.length)];
  const parts = [];
  for (const near of [true, false]) {
    let n = 0;
    for (const s of sets) for (let i = 0; i < s.n; i++) if ((s.pos[i * 3 + 2] < CUT.z1) === near) n++;
    const pos = new Float32Array(n * 3), nor = new Int8Array(n * 3), burst = new Uint8Array(n); let j = 0;
    for (const s of sets) for (let i = 0; i < s.n; i++) {
      if ((s.pos[i * 3 + 2] < CUT.z1) !== near) continue;
      for (let k = 0; k < 3; k++) { pos[j * 3 + k] = s.pos[i * 3 + k]; nor[j * 3 + k] = s.nor[i * 3 + k]; }
      burst[j++] = s.burst[i];
    }
    parts.push({ near, pos, nor, burst });
  }
  return parts;
}
const DESKTOP = Q.has('plate') || innerWidth > 640;
const cloudParts = sampleCloud(DESKTOP ? 340000 : 170000, DESKTOP ? 300000 : 150000, DESKTOP ? 600 : 300);

/* ───────── scene ───────── */
/* ───────── mount ─────────
   [data-hero] is the scroll track, [data-hero-stage] the screen it pins, [data-hero-layer] where the drawing's layers
   go (under the page's copy), [data-hero-frame] the rect the plate is fitted into when the page draws one. The hero
   makes its own layers: the reality plate, the black wipe, the canvas, the label. */
const HERO_BASE = new URL('./', import.meta.url).href;
const host = document.querySelector('[data-hero]') || document.body;
const stage = host.querySelector('[data-hero-stage]') || host;
const layer = stage.querySelector('[data-hero-layer]') || stage;
const frameEl = stage.querySelector('[data-hero-frame]');
const el = (tag, cls, parent, attrs = {}) => { const e = document.createElement(tag); if (cls) e.className = cls; Object.assign(e, attrs); parent.appendChild(e); return e; };
const plateImg = CAL ? el('img', 'hero-plate', layer, { src: HERO_BASE + 'ref/base-model.jpg', alt: '' }) : null;
const reality = el('img', 'hero-reality', layer, { src: HERO_BASE + 'reality.webp', alt: '' });   // beat 1: the drawing of the building as it stands
const wipe = el('div', 'hero-wipe', layer);                                                        // the black ground, wiped down and wiped away
const canvas = el('canvas', 'hero-canvas', layer);
const label = el('div', 'hero-label', frameEl || layer);
const stateItems = [...host.querySelectorAll('.seq-states li')], bar = host.querySelector('.seq-bar i');
const copyEls = [...host.querySelectorAll('.seq-copy > *, .seq-states, .seq-cue')];   // each block flips as the wipe line passes it
const scene = new THREE.Scene();
// the section is a box cut: nearer the long front than d, and short of z1 along it. A fragment is clipped only when
// it is inside both half-spaces (clipIntersection), so the planes carve a notch, not a slice.
const cutPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 8), new THREE.Plane(new THREE.Vector3(0, 0, 1), -CUT.z1)];
const clip = { clippingPlanes: cutPlanes, clipIntersection: true };

const WEIGHT = { massing: 1.7, interior: 1.1, openings: 0.9, detail: 0.6, structure: 1.3, mep: 0.9, people: 1.0 };
const XRAY = new Set(['structure', 'mep']);          // drawn through the building: no depth test, no cut, always blue
const SWEEP = 60, LCAP = 40;                 // a line starts drawing by its distance from the corner; long lines draw faster
const mats = {}, lineObjs = {};
for (const g of Object.keys(lines)) {
  const a = lines[g], n = a.length / 6;
  const geo = new LineSegmentsGeometry().setPositions(new Float32Array(a));
  mats[g] = new LineMaterial({ color: CAL ? BLUE : g === 'people' ? INK : XRAY.has(g) ? ARRIVE : BASE, linewidth: WEIGHT[g] ?? 1, worldUnits: false, dashed: true,
                               dashSize: SWEEP + LCAP, gapSize: SWEEP + LCAP, dashOffset: 0, transparent: true,
                               ...(XRAY.has(g) ? { depthTest: false } : clip) });
  const o = new LineSegments2(geo, mats[g]); o.renderOrder = XRAY.has(g) ? 3 : 1; o.computeLineDistances();
  if (XRAY.has(g)) mats[g].fog = true;                              // the x-rays take the atmosphere
  const d = geo.attributes.instanceDistanceStart.data.array;      // [start, end] per segment, interleaved
  const topDown = g === 'massing' || g === 'interior';             // level 200 is revealed by a wipe from the top, so its pen works downward
  for (let i = 0; i < n; i++) {
    const ax = a[i * 6], ay = a[i * 6 + 1], az = a[i * 6 + 2], bx = a[i * 6 + 3], by = a[i * 6 + 4], bz = a[i * 6 + 5];
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const f = topDown ? 1 - Math.max(ay, by) / (V.top + 15) : ((ax + bx) / 2 + (az + bz) / 2) / (A.len + B.len);
    const delay = SWEEP * Math.min(1, Math.max(0, f));
    d[i * 2] = delay; d[i * 2 + 1] = delay + Math.min(len, LCAP);   // the dash window slides up to SWEEP + LCAP, so nothing wraps
  }
  geo.attributes.instanceDistanceStart.data.needsUpdate = true;
  scene.add(o); lineObjs[g] = o;
}
const offset = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, ...offset, ...clip });
// on paper the faces take a wash in three greys under a light from the upper left, the way the frames are toned
const gradient = new THREE.DataTexture(new Uint8Array([0xde, 0xde, 0xde, 255, 0xef, 0xef, 0xef, 255, 255, 255, 255, 255]), 3, 1);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter; gradient.needsUpdate = true;
const washMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient, side: THREE.DoubleSide, transparent: true, ...offset, ...clip });
const glassMat = new THREE.MeshBasicMaterial({ color: 0xefefef, side: THREE.DoubleSide, transparent: true, ...offset, ...clip });
const sun = new THREE.DirectionalLight(0xffffff, Math.PI); sun.position.set(-0.7, 1.0, -1.1); scene.add(sun);   // π: the wash is the gradient itself
// where the cut opens a closed solid its back faces show: painted ink, they are the section's poché. Transparent so
// it sorts after the wash, which is translucent and would otherwise paint over it.
const capMat = new THREE.MeshBasicMaterial({ color: BASE, side: THREE.BackSide, transparent: true, ...offset, ...clip });
const solidObjs = {}, capObjs = {};
for (const c of Object.keys(solids)) {
  const geo = mergeGeometries(solids[c].map(g => g.index ? g.toNonIndexed() : g), false);
  const m = new THREE.Mesh(geo, depthMat); m.renderOrder = 0; scene.add(m); solidObjs[c] = m;
  if (c !== 'glass') { const cap = new THREE.Mesh(geo, capMat); cap.renderOrder = 0.5; scene.add(cap); capObjs[c] = cap; }
}
// On the black side of the wipe line the points are white, on the paper side ink, so each part of the cloud has a
// white and an ink twin, and render() draws each side of the line in its own scissored pass. The point shader shows a
// point once its burst has fired (burstAt, set by setProgress), lands it large and bright and settles it over the
// flash, and dims the far rooms so the cloud has depth. A point on a surface facing the camera is drawn larger and
// brighter than one on a surface seen edge on, so the walls read as surfaces and the plates as lines; a room recedes
// once its burst has settled, so the storey being scanned is the bright one and the finished cloud is a bright shell
// over a faint interior, as the storyboard has it. uKeep thins the cloud by the plate's area, so its density on
// screen is the storyboard's whatever the frame's size; the points are sampled once, for the plate at full size.
const cloudShader = {
  vertex: `attribute float burst; uniform float uOn[${NB}]; uniform vec3 uSt[${NB}]; uniform float uP, uSize, uDpr, uNear, uFar, uFlash, uKeep; varying float vB;
    #include <clipping_planes_pars_vertex>
    void main() {
      int b = int(burst + 0.5);
      float t = uOn[b];
      vec3 toSt = position - uSt[b];
      float r = burst < float(${6 * ROOMS}) - 0.5 ? 14.0 : 40.0;                  // a room's pool is tighter than a street station's
      float pool = exp(-dot(toSt, toSt) / (r * r));
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      #include <clipping_planes_vertex>
      float k = clamp(1.0 - (uP - t) / uFlash, 0.0, 1.0);
      float facing = abs(dot(normalize(normalMatrix * normal), normalize(-mvPosition.xyz)));   // 1 square to the camera, 0 edge on
      float settle = burst < float(${6 * ROOMS}) - 0.5 ? 0.62 : 1.0;                 // a room that has been scanned recedes; the fronts stay bright
      vB = mix(1.0, 0.5, smoothstep(uNear, uFar, -mvPosition.z)) * (0.55 + 0.45 * facing) * (0.25 + 0.75 * pool) * mix(settle, 1.0, k) + 0.6 * k;
      gl_PointSize = uSize * uDpr * (0.7 + 0.8 * facing) * (1.0 + 1.8 * k * k);
      float h = fract(sin(dot(position.xz + position.y, vec2(12.9898, 78.233))) * 43758.5453);   // a point's own lot: drawn when it is under uKeep
      gl_Position = (uP < t || h > uKeep) ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mvPosition;
    }`,
  fragment: `uniform vec3 uColor; uniform float uOpacity; varying float vB;
    #include <clipping_planes_pars_fragment>
    void main() {
      #include <clipping_planes_fragment>
      gl_FragColor = vec4(uColor, uOpacity * min(vB, 1.0));
    }`,
};
const clouds = [];
for (const part of cloudParts) {
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(part.pos, 3)).setAttribute('normal', new THREE.BufferAttribute(part.nor, 3, true))
    .setAttribute('burst', new THREE.BufferAttribute(part.burst, 1));
  const mk = (color) => {
    const m = new THREE.ShaderMaterial({ vertexShader: cloudShader.vertex, fragmentShader: cloudShader.fragment, transparent: true, depthWrite: false, clipping: true,
      uniforms: { uOn: { value: burstAt }, uSt: { value: stations }, uP: { value: 0 }, uSize: { value: 1.1 }, uDpr: { value: Math.min(2, devicePixelRatio) }, uNear: { value: 150 }, uFar: { value: 340 },
                  uFlash: { value: BURST.flash }, uKeep: { value: 1 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
      ...(part.near ? { clippingPlanes: [cutPlanes[0]] } : {}) });
    const o = new THREE.Points(geo, m); o.renderOrder = 2; o.visible = false; scene.add(o); return o;
  };
  clouds.push({ geo, white: mk(PAPER), ink: mk(INK) });
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setClearColor(0, 0);
renderer.localClippingEnabled = true;

/* ───────── the storyboard's camera ─────────
   base-model.jpg is a 2528 × 1684 plate: a two-point perspective, verticals vertical, the eye 5 ft above the
   sidewalk, the horizon 1458 px down the plate (a rising front), focal length 2671 plate px, the view axis 39.3°
   off the long front. The plate is fitted into the frame rect, never cropped or stretched, and the camera is set
   so the building lands on the stage where it lands in the frame. */
const PLATE = { w: 2528, h: 1684 };
const BOX = { x: 259, y: 82, w: 2024, h: 1518 };   // the building's own bounds on the plate (Home v25, 2026-10-31): with data-hero-fit="box" on the frame the building, not the sheet, is fitted to the frame
const cal = { f: 2671, cx: 1264, cy: 1458, zc: [1280, 820], pos: [-102.8, 5.2, -121.3], yaw: 39.3 };   // zc: the building's centre on the plate
const frame = { left: 0.097, right: 0.097, top: 0.10, bottom: 0.18 };
const camera = new THREE.PerspectiveCamera(50, 1, 1, 2000);
let plate = { x: 0, y: 0, w: 1, h: 1, s: 1, W: 1, H: 1 };

/* ───────── the camera move ─────────
   On by default: a push to 118% about the building's centre over the section beats, back out for the x-rays; an orbit
   of 10° across the whole scroll, −5° to +5° about the building's centre, so the middle beat is the frame's own view;
   a rise of the eye by 10 ft during the x-rays, looking a little down into the floor plates, with the view shifted so
   the building stays put; and, for the x-rays only, atmosphere: the far end of the building a shade lighter than the
   near. ?cam=0 turns the moves off, ?cam=orbit or ?cam=push keeps one, ?atm=0 drops the atmosphere. The camera
   stays level throughout, so verticals stay vertical.
   The ending (elev, 0 to 1 over the last beat): the camera swings to face the long front square on and backs away
   until the perspective is gone, so the sequence ends on an orthographic elevation of the front at level 350, the
   sheet. The move is about an aim point that slides from the view axis at the building's depth to the front's centre:
   the azimuth swings to the front's normal, the perspective (1/distance) flattens evenly, the scale goes to the
   sheet's, and the aim point slides across the plate to its centre. */
const CAM = Q.get('cam') ?? '1', ATM = Q.get('atm') !== '0';
const cam = { zoom: 1, orbit: 0, rise: 0, elev: 0, pivot: new THREE.Vector3(A.len / 2, 0, B.len / 2), push: 0.18, swing: 10, lift: 10, depth: 231 };
const ELEV = { D: 4000, w: 134, h: 100, yc: 50, zc: 63.5, margin: 0.86 };   // the sheet: the front's extent in feet, with the tank; its share of the plate
function camFor(p) {
  const on = CAM !== '0';
  const push = EASE.move(seg(p, 0.32, 0.47)) - EASE.move(seg(p, 0.66, 0.80));
  const up = EASE.move(seg(p, 0.66, 0.80)) - EASE.move(seg(p, 0.88, 0.96));
  return { zoom: on && CAM !== 'orbit' ? 1 + cam.push * push : 1,
           orbit: on && CAM !== 'push' ? cam.swing * (EASE.move(seg(p, 0, 1)) - 0.5) : 0,
           rise: on ? cam.lift * up : 0,
           elev: EASE.move(seg(p, ...T.elev)) };
}

function layout() {
  const r = stage.getBoundingClientRect(), W = r.width, H = r.height;
  renderer.setSize(W, H, false);
  for (const m of Object.values(mats)) m.resolution.set(W, H);
  let fx, fy, fw, fh;
  if (Q.has('plate')) { fx = 0; fy = 0; fw = W; fh = H; }
  else if (frameEl) { const f = frameEl.getBoundingClientRect(); fx = f.left - r.left; fy = f.top - r.top; fw = f.width; fh = f.height; }
  else { fx = W * frame.left; fy = H * frame.top; fw = W * (1 - frame.left - frame.right); fh = H * (1 - frame.top - frame.bottom); }
  const box = frameEl && frameEl.dataset.heroFit === 'box';
  const s = box ? Math.min(fw / BOX.w, fh / BOX.h) : Math.min(fw / PLATE.w, fh / PLATE.h), pw = PLATE.w * s, ph = PLATE.h * s;
  plate = box ? { x: fx + (fw - BOX.w * s) / 2 - BOX.x * s, y: fy + (fh - BOX.h * s) / 2 - BOX.y * s, w: pw, h: ph, s, W, H, fx, fy, fw, fh }
              : { x: fx + (fw - pw) / 2, y: fy + (fh - ph) / 2, w: pw, h: ph, s, W, H, fx, fy, fw, fh };
  for (const img of [plateImg, reality]) if (img) Object.assign(img.style, { left: plate.x + 'px', top: plate.y + 'px', width: pw + 'px', height: ph + 'px' });
  const keep = Math.min(1, Math.max(0.12, (pw / 1264) ** 2 * (DESKTOP ? 1 : 2)));
  for (const c of clouds) for (const o of [c.white, c.ink]) o.material.uniforms.uKeep.value = keep;
  const strip = layer.querySelector('.hero-stills');
  if (strip) Object.assign(strip.style, { left: fx + 'px', top: fy + 'px', width: fw + 'px', height: fh + 'px' });
}
function aim() {
  const { s, W, H } = plate, fc = cal.f * s * cam.zoom;
  const ax = plate.x + cal.zc[0] * s, ay = plate.y + cal.zc[1] * s;                 // the push zooms about the building, not the horizon
  let ppx = ax + (plate.x + cal.cx * s - ax) * cam.zoom;
  let ppy = ay + (plate.y + cal.cy * s - ay) * cam.zoom - cam.rise * fc / cam.depth;   // the rise keeps the building where it was
  const th = cam.orbit * Math.PI / 180, a0 = (cal.yaw + cam.orbit) * Math.PI / 180;
  const dx = cal.pos[0] - cam.pivot.x, dz = cal.pos[2] - cam.pivot.z;
  let px = cam.pivot.x + dx * Math.cos(th) + dz * Math.sin(th), py = cal.pos[1] + cam.rise, pz = cam.pivot.z - dx * Math.sin(th) + dz * Math.cos(th);
  let a = a0, f = fc, R = cam.depth;
  const e = cam.elev;
  if (e > 0) {
    const L0 = [px + Math.sin(a0) * cam.depth, py, pz + Math.cos(a0) * cam.depth], L1 = [0, ELEV.yc, ELEV.zc];
    const L = L0.map((v, i) => v + (L1[i] - v) * e);                                    // the aim point
    const phi0 = Math.atan2(-Math.cos(a0), -Math.sin(a0)), phi1 = phi0 > 0 ? Math.PI : -Math.PI;   // the camera's azimuth about it, to -x
    const phi = phi0 + (phi1 - phi0) * e;
    R = 1 / ((1 - e) / cam.depth + e / ELEV.D);                                         // 1/R, the perspective, blends evenly
    const k1 = ELEV.margin * Math.min(plate.w / ELEV.w, plate.h / ELEV.h);               // the sheet's scale, px per ft
    f = ((1 - e) * fc / cam.depth + e * k1) * R;
    px = L[0] + R * Math.cos(phi); pz = L[2] + R * Math.sin(phi); py += (L[1] - py) * e;
    a = Math.atan2(L[0] - px, L[2] - pz);
    ppx += (plate.x + plate.w / 2 - ppx) * e; ppy += (plate.y + plate.h / 2 - ppy) * e + f * (L[1] - py) / R;
  }
  const fullW = 2 * Math.max(ppx, W - ppx), fullH = 2 * Math.max(ppy, H - ppy);
  camera.fov = 2 * Math.atan((fullH / 2) / f) * 180 / Math.PI;
  camera.aspect = fullW / fullH;
  camera.setViewOffset(fullW, fullH, fullW / 2 - ppx, fullH / 2 - ppy, W, H);
  camera.near = Math.max(1, R - 500); camera.far = R + 500;
  camera.updateProjectionMatrix();
  camera.position.set(px, py, pz);
  camera.lookAt(px + Math.sin(a), py, pz + Math.cos(a));
  camera.updateMatrixWorld();
}
function fit() { layout(); aim(); }

/* ───────── rendering: the wipe line splits the stage, and each side is its own scissored pass ─────────
   The black band shows the white cloud alone; the paper shows everything else. */
const paperSide = () => [...Object.values(lineObjs), ...Object.values(solidObjs), ...Object.values(capObjs), ...clouds.map(c => c.ink)];
const blackSide = () => clouds.map(c => c.white);
function pass(hide, y0, y1) {                     // y0, y1 in CSS px from the top of the stage
  if (y1 <= y0) return;
  const { W, H } = plate, saved = hide.map(o => o.visible);
  for (const o of hide) o.visible = false;
  renderer.setScissor(0, H - y1, W, y1 - y0); renderer.render(scene, camera);
  hide.forEach((o, i) => o.visible = saved[i]);
}
function render() {
  const { top, height } = state.wipe, { H } = plate;
  renderer.setScissorTest(false); renderer.clear(); renderer.autoClear = false; renderer.setScissorTest(true);
  const y0 = Math.round(top * H), y1 = Math.round((top + height) * H);   // the black band
  pass(blackSide(), 0, y0); pass(paperSide(), y0, y1); pass(blackSide(), y1, H);
  renderer.setScissorTest(false); renderer.autoClear = true;
}

/* ───────── the beats, from scroll progress ─────────
   One function of p in [0, 1] sets every state, so the scrub runs the same both ways. */
const BEATS = [
  ['The building', 0, 0.05], ['Scan', 0.05, 0.19], ['Point cloud', 0.19, 0.28], ['Section', 0.28, 0.38],
  ['Level 200', 0.38, 0.47], ['Level 300', 0.47, 0.57], ['Level 350', 0.57, 0.66],
  ['Structure', 0.66, 0.77], ['MEP', 0.77, 0.88], ['Level 350', 0.88, 1],
];
const T = { wipe1: [0.05, 0.19], cut: [0.28, 0.32], wipe2: [0.32, 0.43], pen200: [0.32, 0.40], wash: [0.36, 0.43], elev: [0.89, 0.985] };
const seg = (p, a, b) => Math.min(1, Math.max(0, (p - a) / (b - a)));
const ARRIVE_C = new THREE.Color(ARRIVE), BASE_C = new THREE.Color(BASE);
const state = { p: Q.has('p') ? +Q.get('p') : 0, beat: 0, wipe: { top: 0, height: 0 } };
const atmosphere = new THREE.Fog(PAPER, 140, 1e6);

// the pops ride the first wipe: a storey pops once the line has passed it, at its floor level on the near corner
const STEP_FLOORS = [FLOORS[4], FLOORS[3], FLOORS[2], FLOORS[1], FLOORS[0], 0];
const _sp = new THREE.Vector3();
const stepLine = (s) => { _sp.set(0, STEP_FLOORS[s], 0).project(camera); return (1 - _sp.y) / 2; };
const unwipe = (h) => h <= 0 ? 0 : h >= 1 ? 1 : h < 0.5 ? Math.sqrt(h / 2) : 1 - Math.sqrt((1 - h) / 2);   // the inverse of EASE.wipe1

function drawOn(g, p, a, b, blue, c, e, opacity = 1) {
  const m = mats[g], o = lineObjs[g]; if (!m) return;
  const t = seg(p, a, b);
  o.visible = t > 0 && opacity > 0.005;
  m.dashOffset = (SWEEP + LCAP) * (1 - t);
  m.opacity = opacity;
  if (CAL || XRAY.has(g) || g === 'people') return;
  if (blue) m.color.copy(ARRIVE_C).lerp(BASE_C, seg(p, c, e)); else m.color.copy(BASE_C);
}
function setProgress(p) {
  state.p = p;
  const bi = Math.max(0, BEATS.findIndex(b => p < b[2])); state.beat = p >= 1 ? BEATS.length - 1 : bi;
  if (label) label.textContent = BEATS[state.beat][0];
  Object.assign(cam, camFor(p)); aim();

  // the grounds: paper, then black wiped down over the drawing, then paper wiped down again over the cut cloud
  let top = 0, height = 0;
  if (p >= T.wipe1[0] && p < T.wipe2[0]) height = EASE.wipe1(seg(p, ...T.wipe1));
  else if (p >= T.wipe2[0] && p < T.wipe2[1]) { top = EASE.wipe(seg(p, ...T.wipe2)); height = 1 - top; }
  state.wipe = { top, height };
  if (wipe) { wipe.style.display = height > 0 ? 'block' : 'none'; wipe.style.top = top * 100 + '%'; wipe.style.height = height * 100 + '%'; }
  reality.classList.toggle('on', p < T.wipe1[1] && !CAL);                             // beat 1 is the drawing itself

  // the scan: under the first wipe the cloud bursts on room by room as the line passes each storey, the top floor
  // first, each burst landing large and settling; once the wipe has landed the outside bursts on station by station
  // from the corner. White on the black ground, each room lit about its own station, the near rooms brighter. Under
  // the second wipe its ink twin shows above the line and thins away as level 200 is revealed there.
  for (let s = 0; s < 6; s++) {
    const t0 = T.wipe1[0] + unwipe(stepLine(s)) * (T.wipe1[1] - T.wipe1[0]);     // when the line passes the storey
    for (let r = 0; r < ROOMS; r++) burstAt[s * ROOMS + r] = t0 + ROOM_ORDER.indexOf(r) * BURST.gap;
  }
  for (let k = 0; k < STATIONS; k++) burstAt[6 * ROOMS + k] = T.wipe1[1] + BURST.lead + k * BURST.station;
  const inkOpacity = 0.5 * (1 - EASE.move(seg(p, ...T.wipe2))), scanning = p >= T.wipe1[0];
  for (const c of clouds) {
    c.white.visible = scanning && p < T.wipe2[1];
    c.ink.visible = scanning && p >= T.wipe2[0] && inkOpacity > 0.005;
    c.white.material.uniforms.uP.value = c.ink.material.uniforms.uP.value = p;
    c.ink.material.uniforms.uOpacity.value = inkOpacity;
  }

  // the solids: a scan sees through everything, so they are off on the black ground; from the second wipe they hide
  // lines again and take the wash, all of it revealed by the wipe; the wash fades with the lines for the x-rays
  const fade = 1 - 0.84 * EASE.move(seg(p, 0.66, 0.72)) + 0.84 * EASE.move(seg(p, 0.88, 0.94));
  const solidsOn = p < T.wipe1[0] || p >= T.wipe2[0], washed = p >= T.wash[0] && !CAL;
  const washAmount = washed ? EASE.move(seg(p, ...T.wash)) * fade * (1 - EASE.move(seg(p, 0.92, 0.985))) : 0;   // the sheet is line work alone
  washMat.opacity = washAmount; glassMat.opacity = washAmount;
  for (const [c, m] of Object.entries(solidObjs)) { m.visible = solidsOn; m.material = washAmount > 0.01 ? (c === 'glass' ? glassMat : washMat) : depthMat; }
  const capAmount = EASE.move(seg(p, T.wipe2[0], T.wipe2[0] + 0.04)) * fade;   // the poché is level 200's; it fades with the drawing
  capMat.opacity = capAmount;
  for (const m of Object.values(capObjs)) m.visible = solidsOn && capAmount > 0.01;

  // the cut sweeps in through the cloud on the black ground, stays through the levels, and closes for the x-rays
  const d = -8 + (CUT.d + 8) * (EASE.move(seg(p, ...T.cut)) - EASE.move(seg(p, 0.66, 0.70)));
  cutPlanes[0].constant = -d;

  // the levels: 200 is drawn from the top down under the second wipe, which reveals it; what 300 and 350 add comes
  // in blue and settles to ink. For the x-rays the drawing fades to grey and the frame, then MEP, draw through it
  // in blue with the far end lighter; at the end the drawing returns to ink.
  drawOn('massing', p, ...T.pen200, false, 0, 0, fade);
  drawOn('interior', p, ...T.pen200, false, 0, 0, fade);
  drawOn('openings', p, 0.475, 0.555, true, 0.555, 0.57, fade);
  drawOn('detail', p, 0.575, 0.645, true, 0.645, 0.66, fade);
  drawOn('people', p, -1, -0.5, false, 0, 0, p < T.wipe2[0] ? 1 : 0);                 // on the engraving and in the scan only
  drawOn('structure', p, 0.68, 0.76, true, 0, 0, 1 - EASE.move(seg(p, 0.77, 0.80)));
  drawOn('mep', p, 0.785, 0.87, true, 0, 0, 1 - EASE.move(seg(p, 0.88, 0.92)));
  const air = ATM ? EASE.move(seg(p, 0.66, 0.74)) - EASE.move(seg(p, 0.88, 0.96)) : 0;
  atmosphere.far = 140 + 420 / Math.max(air, 1e-3);
  scene.fog = air > 0.01 ? atmosphere : null;
  page(p);
  render();
}

/* ───────── the page: the states list and the bar follow the beats; the copy flips with the ground ───────── */
const STATE_OF_BEAT = [0, 1, 1, 1, 2, 3, 4, 4, 4, 4];       // the v23 list has six states; the x-rays and the rest stay on 350
function page(p) {
  const k = STATE_OF_BEAT[state.beat];
  for (const li of stateItems) li.classList.toggle('on', +li.dataset.k === k);
  if (bar) bar.style.width = p * 100 + '%';
  const { top, height } = state.wipe, sr = stage.getBoundingClientRect();
  for (const e of copyEls) {
    const r = e.getBoundingClientRect(), c = (r.top + r.height / 2 - sr.top) / Math.max(1, sr.height);
    e.classList.toggle('dark', height > 0 && c >= top && c <= top + height);
  }
}

/* ───────── stills: the stage composited to a canvas, for the review shots and for reduced motion ───────── */
const loaded = (img) => img.complete ? Promise.resolve() : new Promise(res => { img.onload = res; img.onerror = res; });
async function composite(cropToPlate = false) {
  await document.fonts.ready;
  const dpr = renderer.getPixelRatio(), r = stage.getBoundingClientRect();
  const sx = cropToPlate ? plate.x : 0, sy = cropToPlate ? plate.y : 0, sw = cropToPlate ? plate.w : r.width, sh = cropToPlate ? plate.h : r.height;
  const out = document.createElement('canvas'); out.width = Math.round(sw * dpr); out.height = Math.round(sh * dpr);
  const ctx = out.getContext('2d');
  ctx.fillStyle = getComputedStyle(stage).backgroundColor; ctx.fillRect(0, 0, out.width, out.height);
  if (reality.classList.contains('on')) { await loaded(reality); ctx.drawImage(reality, (plate.x - sx) * dpr, (plate.y - sy) * dpr, plate.w * dpr, plate.h * dpr); }
  if (state.wipe.height > 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, (state.wipe.top * r.height - sy) * dpr, out.width, state.wipe.height * r.height * dpr + 1); }
  ctx.drawImage(canvas, sx * dpr, sy * dpr, sw * dpr, sh * dpr, 0, 0, out.width, out.height);
  if (!cropToPlate && getComputedStyle(label).display !== 'none') {
    const lr = label.getBoundingClientRect(), cs = getComputedStyle(label);
    ctx.font = `700 ${11 * dpr}px 'Roboto Mono'`; ctx.letterSpacing = `${0.16 * 11 * dpr}px`;
    ctx.fillStyle = cs.color; ctx.textBaseline = 'alphabetic';
    ctx.fillText(label.textContent.toUpperCase(), (lr.left - r.left) * dpr, (lr.bottom - r.top - 3) * dpr);
  }
  return out;
}
async function shot(name, dir = '') {
  fit(); setProgress(state.p);
  const out = await composite(false);
  const blob = await new Promise(res => out.toBlob(res, 'image/png'));
  const resp = await fetch(`/shot?name=${encodeURIComponent(name)}&dir=${encodeURIComponent(dir)}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
  return resp.text();
}

/* ───────── reduced motion: the stage is not pinned (the page's own rule) and shows one still per beat, in a strip
   the reader moves by hand ───────── */
const REDUCED = (matchMedia('(prefers-reduced-motion: reduce)').matches || Q.has('reduced')) && !Q.has('p') && !Q.has('motion');   // ?reduced forces it for review
const STILL_AT = [0.025, 0.12, 0.26, 0.31, 0.45, 0.545, 0.64, 0.76, 0.87, 0.995];
async function stills() {
  const strip = el('div', 'hero-stills', layer);
  layout();
  for (let i = 0; i < BEATS.length; i++) {
    setProgress(STILL_AT[i]);
    const c = await composite(true);
    const fig = el('figure', 'hero-still', strip);
    el('img', '', fig, { src: c.toDataURL('image/jpeg', 0.86), alt: BEATS[i][0], width: c.width, height: c.height });
    el('figcaption', 'hero-label', fig).textContent = BEATS[i][0];
  }
  for (const e of [canvas, wipe, reality, label]) e.style.display = 'none';
  for (const li of stateItems) li.classList.add('on');
  for (const e of copyEls) e.classList.remove('dark');
}

new ResizeObserver(() => { fit(); if (!REDUCED) setProgress(state.p); }).observe(stage);
fit();
setProgress(state.p);
if (REDUCED) stills();
else if (!Q.has('p')) {
  const sticky = getComputedStyle(stage).position === 'sticky';          // the v23 band pins its own stage
  if (!sticky) stage.style.top = '0px';   // Owen 2026-11-08: the band's top:96px is for the sticky stage; on the pinned stage GSAP copied it to the
                                          // pin-spacer's inset, a 96 px black gap between the splash and the building. The nav's 96 px is the pin start.
  ScrollTrigger.create({ trigger: host, start: sticky ? 'top top' : 'top 96px', end: 'bottom bottom', pin: sticky ? false : stage, scrub: 0.5,
                         onUpdate: (self) => setProgress(self.progress) });
}

const stats = () => ({
  segments: Object.fromEntries(Object.entries(lines).map(([g, a]) => [g, a.length / 6])),
  points: clouds.reduce((n, c) => n + c.geo.attributes.position.count, 0), drawCalls: renderer.info.render.calls, dpr: renderer.getPixelRatio(), plate, p: state.p, beat: BEATS[state.beat][0],
});
window.hero = { shot, fit, render, goto: setProgress, cal, cam, frame, scene, camera, renderer, lines: lineObjs, solids: solidObjs, caps: capObjs, mats, clouds, stats, raw: lines, BEATS, T, ELEV, MODEL, ScrollTrigger, REDUCED };
