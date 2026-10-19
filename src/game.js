// Nightfall Arena: a third-person souls-like boss rush.
// Three bosses, in order, with monsters in between. Sword, gun, dodge roll,
// stamina, and a handful of healing flasks. The camera follows behind the hero.

import * as THREE from 'three';
import { createHero, DEFAULT_STYLE } from './character.js';

const ARENA_RADIUS = 20;

// Third-person camera: how far behind the hero and how high above the sand.
// Height and aim are set so the stands stay in frame above the fight.
const CAM_DIST = 9.5;
const CAM_HEIGHT = 5.5;
const CAM_LOOK_Y = 2.2;
// Camera lock-on, Elden Ring style: the hero keeps his eyes on the boss and the
// lens orbits behind him as he circles, without snapping or drifting on its own
// when the keys are released. With no live boss he runs free, camera following
// only while he moves.
const CAM_FOLLOW_LOCK = 6;
const CAM_FOLLOW_MOVE = 1.6;
// How quickly the hero turns to face the boss while locked, or his stride when free.
const LOCK_TURN = 10;
const RUN_TURN = 14;
// A roll tumbles the body around this point, roughly the chest, not the feet.
const ROLL_PIVOT = 0.95;

// The bowl is only ~32 wide, so the fog has to start well past it or the
// seats dissolve into the dark before you ever see them.
const FOG_NEAR = 60;
const FOG_FAR = 130;

const PLAYER = {
  maxHp: 100,
  maxStamina: 100,
  staminaRegen: 30,
  staminaDelay: 0.4,
  speed: 6.6,
  rollSpeed: 13.5,
  rollTime: 0.34,
  rollCost: 26,
  rollIframes: 0.28,
  swingTime: 0.4,
  swingHitAt: 0.3,
  swingCost: 16,
  swingReach: 3.1,
  swingArc: Math.PI * 0.8,
  swingDamage: 24,
  shotCooldown: 0.3,
  shotCost: 9,
  shotDamage: 16,
  shotRange: 28,
  shotCone: 0.22,
  gunKickTime: 0.18,
  flasks: 3,
  flaskHeal: 45,
  flaskTime: 0.6,
  hurtIframes: 0.5,
};

const GRUNT = {
  kind: 'grunt',
  hp: 36,
  speed: 2.7,
  radius: 0.55,
  reach: 1.9,
  damage: 9,
  windup: 0.5,
  recover: 0.55,
  cooldown: 1.1,
  score: 100,
  body: 0x6f4436,
  accent: 0xff5a3c,
};

const SPITTER = {
  kind: 'spitter',
  hp: 26,
  speed: 2.1,
  radius: 0.5,
  reach: 15,
  keepAway: 8,
  damage: 12,
  windup: 0.65,
  recover: 0.7,
  cooldown: 2.2,
  score: 150,
  body: 0x4a6b35,
  accent: 0xa8ff5c,
  ranged: true,
};

const BOSSES = [
  {
    name: 'The Ashen Warden',
    title: 'Warden of the burnt gate',
    shape: 'brute',
    hp: 340,
    speed: 2.3,
    radius: 1.15,
    scale: 1.55,
    body: 0x8a3b2c,
    accent: 0xff7a45,
    focus: 0x2a1a14,
    fog: 0x0d0a0a,
    light: 0xffb37a,
    moves: ['swipe', 'swipe', 'slam'],
    cooldown: 1.5,
    summons: 0,
  },
  {
    name: 'Venomfang',
    title: 'It has grown fat on the fallen',
    shape: 'beast',
    hp: 420,
    speed: 3.4,
    radius: 1.05,
    scale: 1.45,
    body: 0x4d7a2c,
    accent: 0x9bff5c,
    focus: 0x12200f,
    fog: 0x081007,
    light: 0xaaff88,
    moves: ['dash', 'spit', 'swipe'],
    cooldown: 1.15,
    summons: 0,
  },
  {
    name: 'The Hollow King',
    title: 'Last of a kingdom that forgot him',
    shape: 'wraith',
    hp: 560,
    speed: 2.6,
    radius: 1.25,
    scale: 1.75,
    body: 0x3b3f6e,
    accent: 0xa9b6ff,
    focus: 0x161a34,
    fog: 0x08091a,
    light: 0xbcc6ff,
    moves: ['summon', 'slam', 'spit', 'swipe'],
    cooldown: 1.35,
    summons: 2,
  },
];

const MOVES = {
  swipe: { windup: 0.55, strike: 0.18, recover: 0.6, reach: 4.0, arc: Math.PI * 0.85, damage: 21 },
  slam: { windup: 1.0, strike: 0.16, recover: 0.85, radius: 4.6, damage: 30 },
  spit: { windup: 0.6, strike: 0.12, recover: 0.7, damage: 13, count: 3, spread: 0.32 },
  dash: { windup: 0.5, strike: 0.34, recover: 0.8, distance: 9.5, damage: 24 },
  summon: { windup: 0.9, strike: 0.12, recover: 0.85, count: 2 },
};

// Geometry shared by every telegraph ring, so attacks don't allocate.
// Cached rather than reused-single, because a slash effect can still be on
// screen when the next telegraph asks for a different arc.
const ringCache = new Map();

function fullRing() {
  if (!ringCache.has('full')) ringCache.set('full', new THREE.RingGeometry(0.9, 1, 48));
  return ringCache.get('full');
}

function arcRing(arc) {
  const key = `arc:${arc.toFixed(3)}`;
  if (!ringCache.has(key)) ringCache.set(key, new THREE.RingGeometry(0.86, 1, 48, 1, -arc / 2, arc));
  return ringCache.get(key);
}

function isCachedRing(geometry) {
  for (const cached of ringCache.values()) if (cached === geometry) return true;
  return false;
}

const shadowDisc = (radius) => {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  return mesh;
};

const block = (w, h, d, material, x, y, z) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
};

const limb = (r, length, material, x, y, z) => {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, length, 4, 12), material);
  mesh.position.set(x, y, z);
  return mesh;
};

const spike = (r, h, material, x, y, z) => {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), material);
  mesh.position.set(x, y, z);
  return mesh;
};

// A bowl of stone seats around a sand pit, so the fight has somewhere to happen.
const TIER_COUNT = 5;
const TIER_HEIGHT = 0.9;
const TIER_DEPTH = 2.2;
const STAND_RADIUS = ARENA_RADIUS + TIER_COUNT * TIER_DEPTH;
const STAND_TOP = TIER_COUNT * TIER_HEIGHT;
const GATE_RADIUS = STAND_RADIUS + 0.9;
// The gate sits at this angle, so the crowd and the banners leave it clear.
const GATE_ANGLE = Math.PI;

/** True when an angle is inside the mouth of the gate. */
function nearGate(angle, slack = 0.22) {
  let diff = angle - GATE_ANGLE;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff) < slack;
}

function buildArena() {
  const group = new THREE.Group();

  const sandMat = new THREE.MeshStandardMaterial({ color: 0xb09668, roughness: 1 });
  const wornMat = new THREE.MeshStandardMaterial({ color: 0x8a7348, roughness: 1 });
  const riserMat = new THREE.MeshStandardMaterial({ color: 0x847c6a, roughness: 0.95, side: THREE.DoubleSide });
  const standMat = new THREE.MeshStandardMaterial({ color: 0x635c4a, roughness: 1, side: THREE.DoubleSide });
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x8f8672, roughness: 0.9 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6d6455, roughness: 1 });
  const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const bannerMat = new THREE.MeshStandardMaterial({
    color: 0x2c2a3a,
    roughness: 0.9,
    side: THREE.DoubleSide,
    emissive: 0x8fa0ff,
    emissiveIntensity: 0.22,
  });
  const runeMat = new THREE.MeshBasicMaterial({ color: 0x6f7bff, side: THREE.DoubleSide });
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x05050a });

  // The pit floor: packed sand, ringed where uncounted fights ended.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA_RADIUS, 72), sandMat);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  for (const r of [4.5, 9, 13.5, 17.5]) {
    const worn = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.45, 72), wornMat);
    worn.rotation.x = -Math.PI / 2;
    worn.position.y = 0.012;
    group.add(worn);
  }

  // Cracks fanning out from where the heavy things landed.
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const length = 3.5 + ((i * 37) % 5);
    const crack = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.01, length), wornMat);
    crack.position.set(Math.sin(a) * (6 + length / 2), 0.014, Math.cos(a) * (6 + length / 2));
    crack.rotation.y = a;
    group.add(crack);
  }

  // A ring of runes round the middle of the pit, lit in each boss's colour.
  const runeRing = new THREE.Mesh(new THREE.TorusGeometry(7.2, 0.05, 6, 96), runeMat);
  runeRing.rotation.x = Math.PI / 2;
  runeRing.position.y = 0.05;
  group.add(runeRing);
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.24), runeMat);
    rune.position.set(Math.sin(a) * 7.2, 0.06, Math.cos(a) * 7.2);
    rune.scale.set(1, 0.12, 1);
    rune.rotation.y = a;
    group.add(rune);
  }
  for (const [w, d, rot] of [[6.4, 0.12, 0], [6.4, 0.12, Math.PI / 2]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), runeMat);
    bar.position.y = 0.05;
    bar.rotation.y = rot;
    group.add(bar);
  }

  // The glowing line on the sand: the edge you are not allowed past.
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(ARENA_RADIUS - 0.4, ARENA_RADIUS, 96),
    new THREE.MeshBasicMaterial({ color: 0x6f7bff, side: THREE.DoubleSide }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.04;
  group.add(rim);

  // Rubble and broken columns half-buried in the sand.
  for (let i = 0; i < 11; i += 1) {
    const a = (i / 11) * Math.PI * 2 + 0.7;
    const r = 12 + ((i * 53) % 7);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 + ((i * 29) % 5) * 0.07, 0), rockMat);
    rock.position.set(Math.sin(a) * r, -0.06, Math.cos(a) * r);
    rock.rotation.set(i * 0.7, i * 1.3, i * 0.4);
    group.add(rock);
  }
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + 2.1;
    const r = 17.6;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.9, 12), pillarMat);
    drum.position.set(Math.sin(a) * r, 0.4, Math.cos(a) * r);
    drum.rotation.z = 0.16 * (i - 1);
    group.add(drum);
    const fallen = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.4, 12), pillarMat);
    fallen.position.set(Math.sin(a) * (r - 2.2), 0.5, Math.cos(a) * (r - 2.2));
    fallen.rotation.set(Math.PI / 2, 0, a + 0.5);
    group.add(fallen);
  }

  // Five rings of seating, each one step higher than the last.
  for (let i = 0; i < TIER_COUNT; i += 1) {
    const inner = ARENA_RADIUS + i * TIER_DEPTH;
    const top = (i + 1) * TIER_HEIGHT;

    const riser = new THREE.Mesh(new THREE.CylinderGeometry(inner, inner, TIER_HEIGHT, 96, 1, true), riserMat);
    riser.position.y = top - TIER_HEIGHT / 2;
    group.add(riser);

    const walk = new THREE.Mesh(new THREE.RingGeometry(inner, inner + TIER_DEPTH, 96), standMat);
    walk.rotation.x = -Math.PI / 2;
    walk.position.y = top;
    group.add(walk);
  }

  // The audience: one instanced mesh, so a full house costs a single draw call.
  const crowd = [];
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  for (let i = 0; i < TIER_COUNT; i += 1) {
    const inner = ARENA_RADIUS + i * TIER_DEPTH;
    const top = (i + 1) * TIER_HEIGHT;
    for (const offset of [0.8, 1.65]) {
      const r = inner + offset;
      const count = Math.round((Math.PI * 2 * r) / 1.25);
      for (let j = 0; j < count; j += 1) {
        const a = (j / count) * Math.PI * 2 + i * 0.31;
        if (nearGate(a, 0.26)) continue;
        crowd.push({
          x: Math.sin(a) * r + Math.sin(j * 3.7) * 0.3,
          y: top,
          z: Math.cos(a) * r + Math.cos(j * 2.3) * 0.3,
          yaw: a + Math.PI + Math.sin(j * 5.1) * 0.5,
          scale: 0.85 + ((j * 17) % 6) * 0.07,
          shade: 0.5 + ((j * 31) % 8) * 0.07,
          hue: 0.58 + ((j * 13) % 10) * 0.028,
        });
      }
    }
  }
  const spectator = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.24, 0.68, 2, 6), crowdMat, crowd.length);
  for (let i = 0; i < crowd.length; i += 1) {
    const c = crowd[i];
    dummy.position.set(c.x, c.y + 0.58 * c.scale, c.z);
    dummy.rotation.set(0, c.yaw, 0);
    dummy.scale.setScalar(c.scale);
    dummy.updateMatrix();
    spectator.setMatrixAt(i, dummy.matrix);
    tint.setHSL(c.hue, 0.16, c.shade * 0.22);
    spectator.setColorAt(i, tint);
  }
  spectator.instanceMatrix.needsUpdate = true;
  if (spectator.instanceColor) spectator.instanceColor.needsUpdate = true;
  group.add(spectator);

  // A colonnade above the top row, with banners hung between the pillars.
  const pillarH = 3.6;
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    const x = Math.sin(a) * GATE_RADIUS;
    const z = Math.cos(a) * GATE_RADIUS;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, pillarH, 12), pillarMat);
    pillar.position.set(x, STAND_TOP + pillarH / 2, z);
    group.add(pillar);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.3, 1.15), pillarMat);
    cap.position.set(x, STAND_TOP + pillarH + 0.15, z);
    group.add(cap);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.28, 1.1), pillarMat);
    base.position.set(x, STAND_TOP + 0.14, z);
    group.add(base);
  }

  for (let i = 0; i < 16; i += 1) {
    const a = ((i + 0.5) / 16) * Math.PI * 2;
    if (nearGate(a, 0.28)) continue;
    const banner = new THREE.Group();
    const clothGeo = new THREE.PlaneGeometry(1.7, 2.2, 10, 12);
    const cp = clothGeo.attributes.position;
    for (let k = 0; k < cp.count; k += 1) {
      const bx = cp.getX(k);
      const by = cp.getY(k);
      const bt = (1.1 - by) / 2.2; // 0 at the hoist, 1 at the hem
      cp.setZ(k, 0.3 * Math.cos(bx * 1.5) - 0.3 + 0.09 * Math.sin(bx * 5.0) * (0.3 + bt));
      cp.setY(k, by - 0.06 * bt * bt - 0.05 * bt * Math.sin(bx * 3.0 + 1.0));
    }
    clothGeo.computeVertexNormals();
    const cloth = new THREE.Mesh(clothGeo, bannerMat);
    cloth.position.y = STAND_TOP + 2.1;
    banner.add(cloth);
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.9, 4), bannerMat);
    point.position.y = STAND_TOP + 0.55;
    point.rotation.y = Math.PI / 4;
    banner.add(point);
    const sigil = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), runeMat);
    sigil.position.set(0, STAND_TOP + 2.2, 0.03);
    sigil.scale.z = 0.25;
    banner.add(sigil);
    banner.position.set(Math.sin(a) * (GATE_RADIUS - 0.75), 0, Math.cos(a) * (GATE_RADIUS - 0.75));
    banner.rotation.y = a + Math.PI;
    group.add(banner);
  }

  // The gate the challenger walked in through, black behind it, and its guardians.
  const gate = new THREE.Group();
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 3.5), voidMat);
  mouth.position.set(0, STAND_TOP + 1.8, -0.55);
  gate.add(mouth);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.0, pillarH, 1.0), pillarMat);
    post.position.set(side * 3.4, STAND_TOP + pillarH / 2, 0);
    gate.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.9, 1.2), pillarMat);
  lintel.position.set(0, STAND_TOP + pillarH + 0.45, 0);
  gate.add(lintel);
  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.1, 4), pillarMat);
  crest.position.set(0, STAND_TOP + pillarH + 1.4, 0);
  crest.rotation.y = Math.PI / 4;
  gate.add(crest);
  gate.position.set(0, 0, -GATE_RADIUS);
  group.add(gate);

  // Two hooded statues flanking the gate, each with a brazier burning beside it.
  const braziers = [];
  for (const side of [-1, 1]) {
    const statue = new THREE.Group();
    statue.add(block(1.5, 0.5, 1.5, pillarMat, 0, STAND_TOP + 0.25, 0));
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.72, 2.5, 10), pillarMat);
    robe.position.y = STAND_TOP + 1.75;
    statue.add(robe);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.7), pillarMat);
    hood.position.y = STAND_TOP + 3.0;
    statue.add(hood);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), voidMat);
    face.position.set(0, STAND_TOP + 2.92, 0.22);
    statue.add(face);
    const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 8), pillarMat);
    spear.position.set(0.55, STAND_TOP + 2.1, 0.1);
    statue.add(spear);
    const spearTip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 8), runeMat);
    spearTip.position.set(0.55, STAND_TOP + 3.95, 0.1);
    statue.add(spearTip);
    statue.position.set(side * 6.2, 0, -GATE_RADIUS + 0.2);
    statue.rotation.y = side > 0 ? -0.3 : 0.3;
    group.add(statue);

    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.5, 12), rockMat);
    bowl.position.set(side * 4.9, STAND_TOP + 0.85, -GATE_RADIUS + 1.2);
    group.add(bowl);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.7, 8), rockMat);
    stand.position.set(side * 4.9, STAND_TOP + 0.35, -GATE_RADIUS + 1.2);
    group.add(stand);
    const fire = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb04a }));
    fire.position.set(side * 4.9, STAND_TOP + 1.25, -GATE_RADIUS + 1.2);
    fire.scale.y = 1.4;
    group.add(fire);
    const light = new THREE.PointLight(0xffa45c, 26, 22, 2);
    light.position.set(side * 4.9, STAND_TOP + 1.4, -GATE_RADIUS + 1.2);
    group.add(light);
    braziers.push({ flame: fire, light });
  }

  // Torches at the foot of the stands. Unlit spheres, so they cost no light.
  const torchMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb04a });
  const flames = [];
  const torchR = ARENA_RADIUS + 1.1;
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.sin(a) * torchR;
    const z = Math.cos(a) * torchR;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 1.5, 6), torchMat);
    post.position.set(x, 0.75, z);
    group.add(post);
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.12, 0.22, 8), torchMat);
    basket.position.set(x, 1.55, z);
    group.add(basket);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), flameMat);
    flame.position.set(x, 1.78, z);
    flame.scale.y = 1.5;
    group.add(flame);
    flames.push(flame);
  }

  // Stars above the open roof. They ignore the fog, or they would vanish in it.
  const starCount = 340;
  const starPoints = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const a = (i / starCount) * Math.PI * 2 * 7.3;
    const r = 95 + ((i * 61) % 55);
    const h = 14 + ((i * 37) % 90);
    starPoints[i * 3] = Math.sin(a) * r;
    starPoints[i * 3 + 1] = h;
    starPoints[i * 3 + 2] = Math.cos(a) * r;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPoints, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xcdd8ff, size: 0.85, sizeAttenuation: true, fog: false }),
  );
  group.add(stars);

  const focus = new THREE.PointLight(0x8fa0ff, 60, 60, 2);
  focus.position.set(0, 9, 0);
  group.add(focus);

  return {
    group,
    setFocus(color, fog) {
      focus.color.set(color);
      rim.material.color.set(color);
      runeMat.color.set(color);
      bannerMat.emissive.set(color);
      return fog;
    },
    /** Torch and brazier flicker. Called once per frame while a run is live. */
    update(time) {
      for (let i = 0; i < flames.length; i += 1) {
        const n = 0.85 + Math.sin(time * 9.3 + i * 1.7) * 0.1 + Math.sin(time * 21.7 + i * 3.1) * 0.06;
        flames[i].scale.set(n, 1.5 * (1.9 - n), n);
      }
      for (let i = 0; i < braziers.length; i += 1) {
        const b = braziers[i];
        const n = 0.85 + Math.sin(time * 7.1 + i * 2.4) * 0.1 + Math.sin(time * 17.3 + i) * 0.06;
        b.flame.scale.set(n, 1.4 * (1.9 - n), n);
        b.light.intensity = 20 + n * 9;
      }
    },
  };
}

// Each boss is built to its own silhouette, so you can tell what you are fighting
// before the name banner fades: a hulk, a bloated beast, a crowned floating wraith.
// All three return the same handles — arms to swing, parts to animate.

function bossMaterials(def) {
  return {
    mat: new THREE.MeshStandardMaterial({ color: def.body, roughness: 0.72, metalness: 0.15 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15121a, roughness: 0.8 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xcfc4a8, roughness: 0.65 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9c373, roughness: 0.32, metalness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8f97a8, roughness: 0.35, metalness: 0.85 }),
    glow: null, // set by the caller: the shared accent material
  };
}

function buildBrute(def, glow, m) {
  const group = new THREE.Group();
  const parts = {};

  // Legs on hip pivots, so the brute lumbers with its whole weight.
  const legs = {};
  for (const [key, side] of [['left', -1], ['right', 1]]) {
    const sx = side * 0.36;
    const hip = new THREE.Group();
    hip.position.set(sx, 0.98, 0);
    hip.add(limb(0.24, 0.42, m.dark, 0, -0.32, 0));
    hip.add(limb(0.19, 0.3, m.mat, 0, -0.7, 0.02));
    const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.22, 10), m.dark);
    hoof.position.set(0, -0.87, 0.05);
    hip.add(hoof);
    const toe = spike(0.07, 0.22, m.bone, 0, -0.86, 0.28);
    toe.rotation.x = Math.PI / 2.4;
    hip.add(toe);
    const knee = spike(0.09, 0.26, m.bone, 0, -0.46, 0.2);
    knee.rotation.x = Math.PI / 2.6;
    hip.add(knee);
    const greave = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 10), m.dark);
    greave.position.set(0, -0.76, 0.02);
    hip.add(greave);
    group.add(hip);
    legs[key] = hip;
  }

  // Hips and a barrel chest, with embers glowing through the plate.
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.62, 0.34, 14), m.dark);
  hips.position.y = 1.02;
  group.add(hips);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.12, 14), m.dark);
  belt.position.y = 1.08;
  group.add(belt);
  for (let i = -1; i <= 1; i += 1) {
    const tasset = block(0.3, 0.42, 0.06, m.steel, i * 0.3, 0.82, 0.52);
    tasset.rotation.x = -0.18;
    tasset.rotation.z = -i * 0.15;
    group.add(tasset);
  }
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.56, 1.0, 14), m.mat);
  torso.position.y = 1.62;
  group.add(torso);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 12), m.mat);
  belly.position.set(0, 1.24, 0.12);
  belly.scale.set(1.05, 0.9, 0.9);
  group.add(belly);
  const plate = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m.dark);
  plate.position.set(0, 1.72, 0.06);
  plate.scale.set(1.1, 1, 0.7);
  group.add(plate);
  for (const [x, y] of [[-0.24, 1.78], [0.24, 1.78], [0, 1.52]]) {
    const ember = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), glow);
    ember.position.set(x, y, 0.5);
    group.add(ember);
  }
  for (let i = 0; i < 5; i += 1) {
    const back = spike(0.1, 0.34 - i * 0.04, m.bone, 0, 1.3 + i * 0.22, -0.42 - i * 0.03);
    back.rotation.x = -0.7;
    group.add(back);
  }

  // Head: a horned helm over a small, mean skull.
  const head = new THREE.Group();
  head.position.set(0, 2.28, 0.02);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), m.mat));
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.33, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), m.dark);
  helm.position.y = 0.03;
  head.add(helm);
  for (const sx of [-0.3, 0.3]) {
    const horn = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 8, 12, Math.PI * 0.85), m.bone);
    horn.position.set(sx, 0.12, -0.02);
    horn.rotation.set(0.2, sx > 0 ? -Math.PI / 2 : Math.PI / 2, sx > 0 ? 0.4 : -0.4);
    head.add(horn);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.14, 0.04);
  jaw.add(block(0.26, 0.1, 0.26, m.bone, 0, -0.05, 0.16));
  for (const sx of [-0.08, 0, 0.08]) {
    const tooth = spike(0.03, 0.1, m.bone, sx, 0.02, 0.24);
    tooth.rotation.x = Math.PI;
    jaw.add(tooth);
  }
  head.add(jaw);
  for (const sx of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), glow);
    eye.position.set(sx, 0.02, 0.26);
    head.add(eye);
  }
  for (const sx of [-0.09, 0.09]) {
    const tooth = spike(0.035, 0.12, m.bone, sx, -0.16, 0.22);
    tooth.rotation.x = Math.PI;
    head.add(tooth);
  }
  group.add(head);
  parts.head = head;
  parts.jaw = jaw;

  // Shoulders and heavy arms.
  const arms = {};
  for (const [key, sx] of [['left', -1], ['right', 1]]) {
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), m.dark);
    shoulder.position.set(sx * 0.86, 2.02, 0);
    group.add(shoulder);
    for (let i = 0; i < 3; i += 1) {
      const stud = spike(0.07, 0.3, m.bone, sx * (0.72 + i * 0.16), 2.24, -0.06 + i * 0.06);
      stud.rotation.z = -sx * 0.7;
      group.add(stud);
    }

    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.86, 1.96, 0);
    pivot.add(limb(0.21, 0.4, m.mat, 0, -0.36, 0));
    pivot.add(limb(0.23, 0.36, m.dark, 0, -0.82, 0.02));
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), m.mat);
    fist.position.set(0, -1.16, 0.03);
    pivot.add(fist);
    for (let i = 0; i < 3; i += 1) {
      const knuckle = spike(0.055, 0.18, m.bone, (i - 1) * 0.14, -1.2, 0.24);
      knuckle.rotation.x = Math.PI / 2.2;
      pivot.add(knuckle);
    }
    group.add(pivot);
    arms[key] = pivot;
  }

  // A spiked mace, hung from the right fist.
  const club = new THREE.Group();
  club.position.set(0, -1.16, 0.03);
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.3, 10), m.dark);
  haft.position.y = -0.45;
  club.add(haft);
  const maceHead = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36, 0), m.dark);
  maceHead.position.y = -1.2;
  club.add(maceHead);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const stud = spike(0.09, 0.34, m.steel, Math.sin(a) * 0.3, -1.2, Math.cos(a) * 0.3);
    stud.rotation.set(Math.cos(a) * -Math.PI / 2.4, 0, Math.sin(a) * Math.PI / 2.4);
    club.add(stud);
  }
  const spikeBottom = spike(0.1, 0.3, m.steel, 0, -1.6, 0);
  spikeBottom.rotation.x = Math.PI;
  club.add(spikeBottom);
  arms.right.add(club);
  parts.weapon = club;

  group.add(shadowDisc(1.1));
  parts.shadow = group.children[group.children.length - 1];
  parts.legs = legs;
  return { group, mat: m.mat, arms, parts };
}

function buildBeast(def, glow, m) {
  const group = new THREE.Group();
  const parts = {};

  // Digitigrade hind legs, splayed toes, hinged at the hip so it can lope.
  const legs = {};
  for (const [key, side] of [['left', -1], ['right', 1]]) {
    const sx = side * 0.34;
    const hip = new THREE.Group();
    hip.position.set(sx, 0.98, 0);
    const thigh = limb(0.23, 0.34, m.mat, 0, -0.32, 0.06);
    thigh.rotation.x = -0.5;
    hip.add(thigh);
    const shin = limb(0.16, 0.34, m.dark, 0, -0.68, -0.06);
    shin.rotation.x = 0.55;
    hip.add(shin);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), m.dark);
    foot.position.set(0, -0.88, 0.1);
    foot.scale.set(1, 0.6, 1.7);
    hip.add(foot);
    for (let i = 0; i < 3; i += 1) {
      const claw = spike(0.045, 0.2, m.bone, (i - 1) * 0.11, -0.92, 0.3);
      claw.rotation.x = Math.PI / 2.2;
      hip.add(claw);
    }
    const hock = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), m.dark);
    hock.position.set(0, -0.06, -0.14);
    hip.add(hock);
    group.add(hip);
    legs[key] = hip;
  }
  // Flank scales, so the hide reads as hide and not a bare sphere.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      const scale = new THREE.Mesh(new THREE.SphereGeometry(0.075 - i * 0.012, 10, 8), m.dark);
      scale.position.set(sx * (0.48 - i * 0.04), 1.28 + i * 0.13, -0.16 + i * 0.03);
      scale.scale.y = 0.65;
      group.add(scale);
    }
  }

  // A belly that has eaten too well, with the venom sac swelling behind it.
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 14), m.mat);
  belly.position.set(0, 1.16, 0.02);
  belly.scale.set(1, 0.94, 1.12);
  group.add(belly);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const lump = new THREE.Mesh(new THREE.SphereGeometry(0.1 + (i % 3) * 0.03, 10, 8), m.dark);
    lump.position.set(Math.sin(a) * 0.5, 1.16 + Math.cos(a) * 0.34, 0.36 + (i % 2) * 0.08);
    group.add(lump);
  }
  const sac = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12), m.dark);
  sac.position.set(0, 1.28, -0.52);
  sac.scale.set(1, 0.9, 1);
  group.add(sac);
  const sacGlow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), glow);
  sacGlow.position.set(0, 1.3, -0.86);
  sacGlow.userData.base = 1;
  group.add(sacGlow);
  parts.sac = sacGlow;

  // Hunched chest, spine ridges running up over the shoulders.
  const chest = new THREE.Group();
  chest.position.set(0, 1.62, 0.06);
  chest.rotation.x = 0.5;
  chest.add(new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.58, 0.72, 14), m.mat));
  const collar = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), m.dark);
  collar.position.y = 0.32;
  chest.add(collar);
  group.add(chest);
  for (let i = 0; i < 7; i += 1) {
    const ridge = spike(0.11 - i * 0.008, 0.4 - i * 0.03, m.bone, 0, 1.2 + i * 0.2, -0.34 - i * 0.05);
    ridge.rotation.x = -0.85;
    group.add(ridge);
  }

  // Long neck, narrow skull, a jaw that unhinges.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.5, 12), m.mat);
  neck.position.set(0, 2.02, 0.16);
  neck.rotation.x = 0.5;
  group.add(neck);

  const head = new THREE.Group();
  head.position.set(0, 2.14, 0.5);
  head.rotation.x = 0.22;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), m.mat);
  skull.scale.set(0.92, 0.86, 1.15);
  head.add(skull);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 12), m.mat);
  snout.position.set(0, -0.05, 0.42);
  snout.rotation.x = Math.PI / 2;
  snout.scale.y = 1;
  head.add(snout);
  for (const sx of [-0.1, 0.1]) {
    const fang = spike(0.045, 0.26, m.bone, sx, -0.15, 0.42);
    fang.rotation.x = Math.PI;
    head.add(fang);
  }
  for (const [sx, sy, r] of [[-0.13, 0.1, 0.07], [0.13, 0.1, 0.07], [-0.22, 0.02, 0.04], [0.22, 0.02, 0.04]]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), glow);
    eye.position.set(sx, sy, 0.22);
    head.add(eye);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.16, 0.1);
  const mandible = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 12), m.mat);
  mandible.position.set(0, -0.03, 0.22);
  mandible.rotation.x = Math.PI / 2;
  jaw.add(mandible);
  for (const sx of [-0.09, 0, 0.09]) {
    const tooth = spike(0.035, 0.13, m.bone, sx, 0.05, 0.34);
    tooth.rotation.x = Math.PI;
    jaw.add(tooth);
  }
  head.add(jaw);
  group.add(head);
  parts.head = head;
  parts.jaw = jaw;

  // Long arms that reach the sand, each ending in three claws.
  const arms = {};
  for (const [key, sx] of [['left', -1], ['right', 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.6, 1.92, 0.04);
    pivot.rotation.z = -sx * 0.22;
    pivot.add(limb(0.16, 0.5, m.mat, 0, -0.4, 0));
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), m.dark);
    elbow.position.y = -0.72;
    pivot.add(elbow);
    pivot.add(limb(0.13, 0.55, m.dark, 0, -1.06, 0.02));
    const hand = new THREE.Group();
    hand.position.set(0, -1.42, 0.04);
    hand.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), m.mat));
    for (let i = 0; i < 3; i += 1) {
      const claw = spike(0.05, 0.34, m.bone, (i - 1) * 0.12, -0.1, 0.14);
      claw.rotation.x = Math.PI / 1.9;
      hand.add(claw);
    }
    pivot.add(hand);
    group.add(pivot);
    arms[key] = pivot;
  }

  // A tail that drags behind and swings when it walks.
  const tail = new THREE.Group();
  tail.position.set(0, 1.0, -0.5);
  let z = 0;
  for (let i = 0; i < 5; i += 1) {
    const r = 0.24 - i * 0.04;
    const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), i % 2 ? m.dark : m.mat);
    seg.position.set(0, -i * 0.12, z - r);
    seg.scale.z = 1.5;
    tail.add(seg);
    z -= r * 1.7;
  }
  const stinger = spike(0.09, 0.42, m.bone, 0, -0.5, z - 0.2);
  stinger.rotation.x = -Math.PI / 2.6;
  tail.add(stinger);
  group.add(tail);
  parts.tail = tail;

  group.add(shadowDisc(1.05));
  parts.shadow = group.children[group.children.length - 1];
  parts.spread = 0.22; // its arms hang splayed out from the shoulders
  parts.legs = legs;
  return { group, mat: m.mat, arms, parts };
}

function buildWraith(def, glow, m) {
  const group = new THREE.Group();
  const parts = { float: true };

  // A robe with no legs inside it, and tatters hanging from the hem.
  const robe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 1.0, 2.1, 16, 1, true),
    new THREE.MeshStandardMaterial({ color: def.body, roughness: 0.85, side: THREE.DoubleSide }),
  );
  robe.position.y = 1.1;
  group.add(robe);
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2;
    const tatter = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6 + (i % 3) * 0.2, 4), m.dark);
    tatter.position.set(Math.sin(a) * 0.92, 0.2 - (i % 3) * 0.1, Math.cos(a) * 0.92);
    tatter.rotation.x = Math.PI;
    tatter.rotation.y = a;
    group.add(tatter);
  }

  // Gaunt torso with the ribs showing, wrapped in a cloak that trails behind.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.26, 0.8, 14), m.mat);
  torso.position.y = 2.0;
  group.add(torso);
  for (let i = 0; i < 4; i += 1) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.3 - i * 0.02, 0.035, 6, 14, Math.PI), m.bone);
    rib.position.set(0, 1.78 + i * 0.14, 0.06);
    rib.rotation.set(Math.PI / 2, 0, Math.PI);
    group.add(rib);
  }
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(1.05, 2.6, 12, 1, true), m.dark);
  cloak.material.side = THREE.DoubleSide;
  cloak.position.set(0, 1.75, -0.34);
  cloak.rotation.x = -0.16;
  group.add(cloak);
  parts.cloak = cloak;

  // A pale skull under a gold crown, eyes burning in the sockets.
  const head = new THREE.Group();
  head.position.set(0, 2.62, 0);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), m.bone);
  skull.scale.set(0.92, 1.06, 1);
  head.add(skull);
  const brow = block(0.34, 0.07, 0.12, m.bone, 0, 0.08, 0.2);
  head.add(brow);
  for (const sx of [-0.11, 0.11]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), m.dark);
    socket.position.set(sx, 0.0, 0.22);
    head.add(socket);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glow);
    eye.position.set(sx, 0.0, 0.25);
    head.add(eye);
  }
  head.add(block(0.06, 0.12, 0.08, m.bone, 0, -0.1, 0.24));
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.14, 0.02);
  jaw.add(block(0.22, 0.07, 0.2, m.bone, 0, -0.05, 0.1));
  for (let i = 0; i < 5; i += 1) jaw.add(spike(0.022, 0.07, m.bone, (i - 2) * 0.045, 0.0, 0.16));
  head.add(jaw);

  const crown = new THREE.Group();
  crown.position.y = 0.24;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.045, 8, 20), m.gold);
  band.rotation.x = Math.PI / 2;
  crown.add(band);
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2;
    const point = spike(0.045, 0.42 + (i % 2) * 0.16, m.gold, Math.sin(a) * 0.24, 0.2, Math.cos(a) * 0.24);
    point.rotation.set(Math.cos(a) * 0.22, 0, -Math.sin(a) * 0.22);
    crown.add(point);
  }
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), glow);
  gem.position.set(0, 0.1, 0.26);
  crown.add(gem);
  head.add(crown);
  group.add(head);
  parts.head = head;
  parts.jaw = jaw;

  // Long skeletal arms, and floating shards where pauldrons would be.
  const arms = {};
  for (const [key, sx] of [['left', -1], ['right', 1]]) {
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), m.dark);
    shard.position.set(sx * 0.58, 2.34, 0);
    shard.scale.set(1, 0.7, 1.3);
    group.add(shard);

    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.48, 2.22, 0);
    pivot.add(limb(0.1, 0.44, m.mat, 0, -0.32, 0));
    pivot.add(limb(0.085, 0.44, m.bone, 0, -0.84, 0.02));
    const hand = new THREE.Group();
    hand.position.set(0, -1.16, 0.03);
    hand.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), m.bone));
    for (let i = 0; i < 4; i += 1) {
      const finger = spike(0.03, 0.26, m.bone, (i - 1.5) * 0.06, -0.14, 0.05);
      finger.rotation.x = Math.PI / 1.7;
      hand.add(finger);
    }
    pivot.add(hand);
    group.add(pivot);
    arms[key] = pivot;
  }

  // A greatsword carried point-up, like a standard.
  const club = new THREE.Group();
  club.position.set(0, -1.16, 0.03);
  club.rotation.z = 0.14;
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.4, 10), m.dark);
  hilt.position.y = -0.16;
  club.add(hilt);
  const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), glow);
  pommel.position.y = -0.4;
  club.add(pommel);
  club.add(block(0.56, 0.09, 0.12, m.gold, 0, 0.08, 0));
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.02, 2.0, 4), m.steel);
  blade.position.y = 1.1;
  blade.scale.z = 0.28;
  club.add(blade);
  const edge = block(0.035, 1.9, 0.02, glow, 0, 1.1, 0.04);
  club.add(edge);
  const tip = spike(0.11, 0.34, m.steel, 0, 2.22, 0);
  tip.scale.z = 0.3;
  club.add(tip);
  arms.right.add(club);
  parts.weapon = club;

  group.add(shadowDisc(1.15));
  parts.shadow = group.children[group.children.length - 1];
  return { group, mat: m.mat, arms, parts };
}

function buildBossBody(def, accentMaterial) {
  const m = bossMaterials(def);
  m.glow = accentMaterial;
  const built = def.shape === 'beast' ? buildBeast(def, accentMaterial, m) : def.shape === 'wraith' ? buildWraith(def, accentMaterial, m) : buildBrute(def, accentMaterial, m);
  built.group.rotation.order = 'YXZ';
  built.group.scale.setScalar(def.scale);
  return built;
}

function buildMinionBody(kind) {
  const def = kind === 'spitter' ? SPITTER : GRUNT;
  const m = {
    mat: new THREE.MeshStandardMaterial({ color: def.body, roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x120f18, roughness: 0.9 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xcfc4a8, roughness: 0.7 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8f97a8, roughness: 0.4, metalness: 0.8 }),
    glow: new THREE.MeshBasicMaterial({ color: def.accent }),
  };
  const built = kind === 'spitter' ? buildSpitter(m) : buildGrunt(m);
  built.group.rotation.order = 'YXZ';
  return built;
}

/** A hunched scavenger in rags, carrying a rusted cleaver. */
function buildGrunt(m) {
  const group = new THREE.Group();
  const parts = {};
  const arms = {};

  const legs = {};
  for (const [key, side] of [['left', -1], ['right', 1]]) {
    const sx = side * 0.17;
    const hip = new THREE.Group();
    hip.position.set(sx, 0.55, 0);
    hip.add(limb(0.1, 0.22, m.dark, 0, -0.13, 0));
    hip.add(limb(0.07, 0.16, m.dark, 0, -0.32, 0.02));
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 8), m.bone);
    wrap.position.set(0, -0.3, 0.02);
    hip.add(wrap);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), m.dark);
    foot.position.set(0, -0.48, 0.06);
    foot.scale.set(1, 0.7, 1.7);
    hip.add(foot);
    const toe = block(0.1, 0.04, 0.08, m.bone, 0, -0.49, 0.2);
    hip.add(toe);
    group.add(hip);
    legs[key] = hip;
  }

  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.36, 10, 1, true), m.dark);
  skirt.material.side = THREE.DoubleSide;
  skirt.position.y = 0.72;
  group.add(skirt);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.23, 0.56, 12), m.mat);
  torso.position.set(0, 1.06, 0);
  torso.rotation.x = 0.18;
  group.add(torso);
  const hunch = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 12), m.mat);
  hunch.position.set(0, 1.22, -0.12);
  hunch.scale.set(1.1, 0.85, 1);
  group.add(hunch);
  for (let i = 0; i < 3; i += 1) {
    const quill = spike(0.05, 0.24 - i * 0.05, m.bone, 0, 1.34 - i * 0.1, -0.24 - i * 0.04);
    quill.rotation.x = -0.9;
    group.add(quill);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.52, 0.06);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 12), m.mat);
  skull.scale.set(0.95, 1, 1.05);
  head.add(skull);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), m.dark);
  hood.position.set(0, 0.02, -0.03);
  head.add(hood);
  for (const sx of [-0.09, 0.09]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), m.glow);
    eye.position.set(sx, 0.0, 0.2);
    head.add(eye);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.1, 0.04);
  jaw.add(block(0.16, 0.06, 0.16, m.bone, 0, -0.04, 0.1));
  for (const sx of [-0.05, 0.05]) {
    const tooth = spike(0.022, 0.08, m.bone, sx, 0.01, 0.15);
    tooth.rotation.x = Math.PI;
    jaw.add(tooth);
  }
  head.add(jaw);
  for (const sx of [-0.06, 0.06]) {
    const fang = spike(0.025, 0.09, m.bone, sx, -0.12, 0.17);
    fang.rotation.x = Math.PI;
    head.add(fang);
  }
  group.add(head);
  parts.head = head;
  parts.jaw = jaw;

  for (const [key, sx] of [['left', -1], ['right', 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.33, 1.24, 0);
    pivot.add(limb(0.085, 0.22, m.mat, 0, -0.2, 0));
    pivot.add(limb(0.07, 0.2, m.dark, 0, -0.46, 0.02));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), m.mat);
    hand.position.set(0, -0.62, 0.03);
    pivot.add(hand);
    for (let i = 0; i < 3; i += 1) {
      const claw = spike(0.025, 0.14, m.bone, (i - 1) * 0.05, -0.7, 0.1);
      claw.rotation.x = Math.PI / 2.1;
      pivot.add(claw);
    }
    if (key === 'right') {
      const cleaver = new THREE.Group();
      cleaver.position.set(0, -0.64, 0.04);
      const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.3, 8), m.dark);
      haft.position.y = -0.06;
      cleaver.add(haft);
      cleaver.add(block(0.05, 0.42, 0.24, m.steel, 0, -0.4, 0.06));
      const edge = block(0.012, 0.4, 0.05, m.bone, 0, -0.42, 0.19);
      cleaver.add(edge);
      pivot.add(cleaver);
      parts.weapon = cleaver;
    }
    group.add(pivot);
    arms[key] = pivot;
  }

  group.add(shadowDisc(GRUNT.radius * 0.95));
  parts.shadow = group.children[group.children.length - 1];
  parts.legs = legs;
  return { group, mat: m.mat, arms, parts };
}

/** A bloated toad-thing that swells its throat sac before it spits. */
function buildSpitter(m) {
  const group = new THREE.Group();
  const parts = {};
  const arms = {};

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12), m.mat);
  body.position.set(0, 0.7, 0);
  body.scale.set(1, 0.88, 1.12);
  group.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), m.dark);
  belly.position.set(0, 0.58, 0.16);
  belly.scale.set(1, 0.8, 1);
  group.add(belly);
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2 + 0.6;
    const wart = new THREE.Mesh(new THREE.SphereGeometry(0.055 + (i % 3) * 0.015, 8, 6), m.dark);
    wart.position.set(Math.sin(a) * 0.28, 0.86 + (i % 2) * 0.1, Math.cos(a) * 0.3 - 0.08);
    group.add(wart);
  }

  // Four stubby legs on hip pivots, so it scurries rather than slides.
  const legs = [];
  for (const [sx, sz] of [[-0.3, 0.16], [0.3, 0.16], [-0.32, -0.2], [0.32, -0.2]]) {
    const hip = new THREE.Group();
    hip.position.set(sx, 0.42, sz);
    const leg = limb(0.09, 0.18, m.dark, 0, -0.12, 0);
    leg.rotation.z = sx > 0 ? -0.35 : 0.35;
    hip.add(leg);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), m.dark);
    foot.position.set(sx * 0.25, -0.34, 0.06);
    foot.scale.set(1.1, 0.6, 1.5);
    hip.add(foot);
    group.add(hip);
    legs.push(hip);
  }

  const head = new THREE.Group();
  head.position.set(0, 0.98, 0.28);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), m.mat);
  skull.scale.set(1.15, 0.8, 1);
  head.add(skull);
  for (const sx of [-0.14, 0.14]) {
    const eyeball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), m.mat);
    eyeball.position.set(sx, 0.16, 0.0);
    head.add(eyeball);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), m.glow);
    pupil.position.set(sx, 0.19, 0.06);
    head.add(pupil);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.08, 0.02);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), m.dark);
  mouth.scale.set(1.1, 1, 1.1);
  jaw.add(mouth);
  jaw.add(block(0.3, 0.05, 0.16, m.bone, 0, -0.04, 0.12));
  head.add(jaw);
  group.add(head);
  parts.head = head;
  parts.jaw = jaw;

  // The sac it fills before a spit. It swells with the windup.
  const sac = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), m.glow);
  sac.position.set(0, 0.84, 0.1);
  sac.scale.setScalar(0.55);
  sac.userData.base = 0.55;
  head.add(sac);
  parts.sac = sac;

  for (const [key, sx] of [['left', -1], ['right', 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.3, 0.86, 0.12);
    pivot.add(limb(0.065, 0.2, m.mat, 0, -0.16, 0));
    for (let i = 0; i < 3; i += 1) {
      const finger = spike(0.03, 0.18, m.bone, (i - 1) * 0.06, -0.32, 0.06);
      finger.rotation.x = Math.PI / 2.4;
      pivot.add(finger);
    }
    group.add(pivot);
    arms[key] = pivot;
  }

  group.add(shadowDisc(SPITTER.radius * 1.1));
  parts.shadow = group.children[group.children.length - 1];
  parts.legs = legs;
  return { group, mat: m.mat, arms, parts };
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0b12);
    this.scene.fog = new THREE.Fog(0x0a0b12, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 300);
    this.camera.position.set(0, CAM_HEIGHT, CAM_DIST);

    this.hemi = new THREE.HemisphereLight(0x9fb4ff, 0x141019, 0.85);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xaab4d8, 0.35);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffd9b8, 1.45);
    this.sun.position.set(10, 18, 8);
    this.scene.add(this.sun);

    this.world = buildArena();
    this.scene.add(this.world.group);

    this.hero = createHero();
    this.hero.group.visible = false;
    this.scene.add(this.hero.group);

    this.enemies = [];
    this.projectiles = [];
    this.effects = [];
    this.warning = null;

    this.keys = new Set();
    this.camYaw = Math.PI;

    this.shake = 0;
    this.running = false;
    this.dead = false;
    this.restTimer = 0;
    this.bossesDefeated = 0;
    this.lastFrame = 0;

    this._tick = this._tick.bind(this);
    this._bindInput();
    this._bindResize();
  }

  // ---------------------------------------------------------------- input

  _bindInput() {
    this.onKeyDown = (e) => {
      if (!this.running) return;
      const key = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) e.preventDefault();
      if (this.keys.has(key)) return; // held keys repeat; a roll needs a fresh press
      this.keys.add(key);
      if (key === 'q') this._drink();
      if (key === ' ' || key === 'shift') this._roll();
    };
    this.onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
    this.onBlur = () => this.keys.clear();

    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);

    this.onMouseDown = (e) => {
      if (!this.running) return;
      if (e.button === 0) this._swing();
      if (e.button === 2) this._shoot();
    };
    this.onContext = (e) => e.preventDefault();

    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('contextmenu', this.onContext);
  }

  _bindResize() {
    this.onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    };
    addEventListener('resize', this.onResize);
  }

  // ----------------------------------------------------------------- life

  start({ style, onHud, onEnd }) {
    this.onHud = onHud;
    this.onEnd = onEnd;
    this.setStyle(style ?? DEFAULT_STYLE);

    this.score = 0;
    this.bossesDefeated = 0;
    this.bossIndex = -1;
    this.restTimer = 0;
    this.dead = false;
    this.shake = 0;
    this.bannerTimer = 0;

    this._clearEnemies();
    this._clearProjectiles();
    this._clearEffects();

    this.player = {
      hp: PLAYER.maxHp,
      stamina: PLAYER.maxStamina,
      flasks: PLAYER.flasks,
      staminaIdle: 0,
      aim: new THREE.Vector3(0, 0, -1),
      facing: Math.PI, // facing up the pit at the gate, the same way the camera looks
      invuln: 0,
      roll: { active: false, t: 0, dx: 0, dz: 0 },
      swing: { active: false, t: 0, hit: false },
      shotTimer: 0,
      gunKick: 0,
      flaskTimer: 0,
      hurtFlash: 0,
      fallTime: 0,
      moveX: 0,
      moveZ: 0,
      moving: false,
      locked: false,
      runPhase: 0,
      runAmount: 0,
    };

    this.hero.group.visible = true;
    this.hero.group.position.set(0, 0, 9);
    this.hero.group.rotation.set(0, Math.PI, 0);
    this.hero.body.rotation.set(0, 0, 0);
    this.hero.body.position.set(0, 0, 0);
    this.hero.rightArm.rotation.set(0, 0, -0.14);
    this.hero.leftArm.rotation.set(0, 0, 0.14);
    for (const leg of Object.values(this.hero.legs)) {
      leg.hip.rotation.set(0, 0, 0);
      leg.knee.rotation.set(0, 0, 0);
    }
    this.hero.cape.rotation.set(0, Math.PI, 0);
    this.hero.materials.primary.emissive.setHex(0x000000);

    // Start looking the same way the hero is facing: down the pit, at the gate.
    this.camYaw = Math.PI;
    this.camera.position.set(0, CAM_HEIGHT, 9 + CAM_DIST);
    this.world.setFocus(0x8fa0ff, 0x0a0b12);
    this.scene.background.set(0x0a0b12);
    this.scene.fog = new THREE.Fog(0x0a0b12, FOG_NEAR, FOG_FAR);

    this._beginBoss(0);
    this._pushHud(true);

    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    this.hero.group.visible = false;
    this._clearEnemies();
    this._clearProjectiles();
    this._clearEffects();
    this._hideWarning();
  }

  setStyle(style) {
    this.hero.setStyle(style);
  }

  /** Draws one frame of the empty arena, used as the menu backdrop. */
  preview() {
    this.camYaw = Math.PI * 0.78;
    const f = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    this.camera.position.set(-f.x * 13, 7.4, -f.z * 13);
    this.camera.lookAt(0, 1.6, 0);
    this.world.update(performance.now() / 1000);
    this.renderer.render(this.scene, this.camera);
  }

  _beginBoss(index) {
    this.bossIndex = index;
    const def = BOSSES[index];

    this.scene.background.set(def.fog);
    this.scene.fog = new THREE.Fog(def.fog, FOG_NEAR, FOG_FAR);
    this.world.setFocus(def.light, def.fog);

    const accentMaterial = new THREE.MeshBasicMaterial({ color: def.accent });
    const body = buildBossBody(def, accentMaterial);
    const spawn = new THREE.Vector3(0, 0, -13);
    body.group.position.copy(spawn);
    this.scene.add(body.group);

    const boss = {
      kind: 'boss',
      def,
      group: body.group,
      mat: body.mat,
      arms: body.arms,
      parts: body.parts,
      phase: Math.random() * Math.PI * 2,
      gait: 0,
      gaitPhase: Math.random() * Math.PI * 2,
      gaitSpeed: 0,
      radius: def.radius,
      hp: def.hp,
      maxHp: def.hp,
      speed: def.speed,
      accent: def.accent,
      state: 'spawning',
      timer: 1.4,
      hitFlash: 0,
      dead: false,
      move: null,
      moveTimer: 0,
      dashTimer: 0,
      dashX: 0,
      dashZ: 0,
      summonTimer: 5,
      facing: 0,
      struck: false,
    };
    this.enemies.push(boss);
    this.boss = boss;

    this._setBanner(`Boss ${index + 1} of ${BOSSES.length}`, def.name);
  }

  _nextBoss() {
    this.scene.background.set(0x0a0b12);
    if (this.bossesDefeated >= BOSSES.length) {
      this._end(true);
      return;
    }
    this._beginBoss(this.bossIndex + 1);
  }

  _end(victory) {
    if (!this.running) return;
    this.running = false;
    this._hideWarning();
    this.onEnd?.({
      score: this.score,
      bossesDefeated: victory ? BOSSES.length : this.bossesDefeated,
      bossTotal: BOSSES.length,
      victory,
    });
  }

  // ---------------------------------------------------------------- hud

  _setBanner(title, subtitle) {
    this.banner = { title, subtitle };
    this.bannerKey = (this.bannerKey ?? 0) + 1;
    this.bannerTimer = 3.2;
  }

  _pushHud() {
    this.onHud?.({
      hp: Math.max(0, Math.round(this.player.hp)),
      maxHp: PLAYER.maxHp,
      stamina: Math.max(0, Math.round(this.player.stamina)),
      maxStamina: PLAYER.maxStamina,
      flasks: this.player.flasks,
      maxFlasks: PLAYER.flasks,
      score: Math.round(this.score),
      boss: this.boss && !this.boss.dead ? { name: this.boss.def.name, hp: Math.max(0, Math.round(this.boss.hp)), maxHp: this.boss.maxHp } : null,
      bossNumber: this.bossIndex + 1,
      bossTotal: BOSSES.length,
      bossesDefeated: this.bossesDefeated,
      banner: this.banner ?? null,
      bannerKey: this.bannerKey ?? 0,
      dead: this.dead,
    });
  }

  // --------------------------------------------------------------- effects

  _addEffect(mesh, life, spin = 0) {
    this.scene.add(mesh);
    this.effects.push({ mesh, life, maxLife: life, spin });
  }

  _flashRing(x, z, facing, radius, arc, color, life = 0.35, grow = false) {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const geometry = arc >= Math.PI * 2 - 0.01 ? fullRing() : arcRing(arc);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.set(-Math.PI / 2, 0, arc >= Math.PI * 2 - 0.01 ? 0 : Math.atan2(-Math.cos(facing), Math.sin(facing)));
    mesh.position.set(x, 0.06, z);
    mesh.scale.set(radius, radius, radius);
    this._addEffect(mesh, life, grow ? 1 : 0);
    if (grow) mesh.scale.setScalar(radius * 0.15);
  }

  _sfxlessHit(x, y, z, color) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 12, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    mesh.position.set(x, y, z);
    this._addEffect(mesh, 0.28, -1);
  }

  _tracer(from, to, color) {
    const length = from.distanceTo(to);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, length),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.lookAt(to);
    this._addEffect(mesh, 0.09);
  }

  _shotTrail(x, z, color) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    puff.position.set(x, 0.6, z);
    this._addEffect(puff, 0.22, -1);
  }

  _clearEffects() {
    for (const effect of this.effects) {
      this.scene.remove(effect.mesh);
      effect.mesh.material.dispose();
      if (!isCachedRing(effect.mesh.geometry)) effect.mesh.geometry.dispose();
    }
    this.effects.length = 0;
  }

  // ------------------------------------------------------------- telegraph

  _showWarning(entity, type, value) {
    const geometry = type === 'ring' ? fullRing() : arcRing(value.arc);
    if (!this.warning) {
      this.warning = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: entity.accent, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
      );
      this.warning.rotation.x = -Math.PI / 2;
      this.warning.renderOrder = 2;
      this.scene.add(this.warning);
    }
    this.warning.geometry = geometry;
    this.warning.material.color.set(entity.accent);
    this.warning.position.set(entity.group.position.x, 0.07, entity.group.position.z);
    this.warning.rotation.set(
      -Math.PI / 2,
      0,
      type === 'ring' ? 0 : Math.atan2(-Math.cos(entity.facing), Math.sin(entity.facing)),
    );
    this.warning.scale.setScalar(type === 'ring' ? value.radius : value.reach);
    this.warning.visible = true;
    this.warningPulse = 0;
  }

  _hideWarning() {
    if (this.warning) this.warning.visible = false;
  }

  // -------------------------------------------------------------- spawning

  _spawnMinion(kind, x, z) {
    const body = buildMinionBody(kind);
    const def = kind === 'spitter' ? SPITTER : GRUNT;
    body.group.position.set(x, 0, z);
    this.scene.add(body.group);
    this.enemies.push({
      kind,
      def,
      group: body.group,
      mat: body.mat,
      arms: body.arms,
      parts: body.parts,
      phase: Math.random() * Math.PI * 2,
      gait: 0,
      gaitPhase: Math.random() * Math.PI * 2,
      gaitSpeed: 0,
      radius: def.radius,
      hp: def.hp,
      maxHp: def.hp,
      speed: def.speed,
      accent: def.accent,
      state: 'approach',
      timer: 0.4 + Math.random() * 0.5,
      hitFlash: 0,
      dead: false,
      struck: false,
      facing: 0,
      strafe: Math.random() < 0.5 ? -1 : 1,
    });
  }

  _clearEnemies() {
    for (const e of this.enemies) {
      this.scene.remove(e.group);
      e.group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose?.();
      });
    }
    this.enemies.length = 0;
    this.boss = null;
  }

  _clearProjectiles() {
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.projectiles.length = 0;
  }

  // ---------------------------------------------------------------- combat

  _swing() {
    const p = this.player;
    if (this.dead || p.roll.active || p.flaskTimer > 0) return;
    if (p.swing.active || p.stamina < PLAYER.swingCost) return;
    p.swing = { active: true, t: 0, hit: false };
    p.stamina -= PLAYER.swingCost;
    p.staminaIdle = 0;
  }

  _shoot() {
    const p = this.player;
    if (this.dead || p.roll.active || p.flaskTimer > 0) return;
    if (p.shotTimer > 0 || p.stamina < PLAYER.shotCost) return;
    p.shotTimer = PLAYER.shotCooldown;
    p.stamina -= PLAYER.shotCost;
    p.staminaIdle = 0;
    p.gunKick = PLAYER.gunKickTime;

    const origin = this.hero.group.position.clone();
    origin.y = 1.15;
    const end = origin.clone().addScaledVector(p.aim, PLAYER.shotRange);
    end.y = 1.15;

    let target = null;
    let bestDist = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const to = e.group.position.clone().sub(origin);
      to.y = 0;
      const dist = to.length();
      if (dist > PLAYER.shotRange + e.radius) continue;
      to.normalize();
      if (to.dot(p.aim) < 1 - PLAYER.shotCone) continue;
      if (dist < bestDist) {
        bestDist = dist;
        target = e;
      }
    }

    if (target) {
      end.copy(origin).addScaledVector(p.aim, Math.max(1.2, bestDist - target.radius));
      this._damageEnemy(target, PLAYER.shotDamage);
      this._sfxlessHit(end.x, 1.0, end.z, 0xffe9b0);
    }
    this._tracer(origin, end, 0xffd98a);
    this._shotTrail(
      origin.x + p.aim.x * 0.8,
      origin.z + p.aim.z * 0.8,
      0xffbb55,
    );
    this.shake = Math.max(this.shake, 0.12);
  }

  _drink() {
    const p = this.player;
    if (this.dead || p.flasks <= 0 || p.flaskTimer > 0 || p.hp >= PLAYER.maxHp) return;
    if (p.roll.active || p.swing.active) return;
    p.flasks -= 1;
    p.flaskTimer = PLAYER.flaskTime;
    p.hp = Math.min(PLAYER.maxHp, p.hp + PLAYER.flaskHeal);
    this._sfxlessHit(this.hero.group.position.x, 1.2, this.hero.group.position.z, 0x6cff9e);
  }

  _roll() {
    const p = this.player;
    if (this.dead || p.roll.active || p.flaskTimer > 0 || p.stamina < PLAYER.rollCost) return;
    p.stamina -= PLAYER.rollCost;
    p.staminaIdle = 0;
    p.swing.active = false; // a roll cuts a swing short, which is the point of one
    p.roll = { active: true, t: 0, dx: p.moveX, dz: p.moveZ };
    if (p.moveX === 0 && p.moveZ === 0) {
      p.roll.dx = Math.sin(p.facing);
      p.roll.dz = Math.cos(p.facing);
    }
    p.invuln = Math.max(p.invuln, PLAYER.rollIframes);
  }

  /**
   * Tumbles the hero end over end around chest height. Rotating the body group
   * alone would pivot at the feet, so the group is also shifted by the difference.
   */
  _poseRoll(t) {
    const body = this.hero.body;
    if (t === 0) {
      body.rotation.set(0, 0, 0);
      body.position.set(0, 0, 0);
      this.hero.rightArm.rotation.set(0, 0, -0.14);
      this.hero.leftArm.rotation.set(0, 0, 0.14);
      for (const leg of Object.values(this.hero.legs)) {
        leg.hip.rotation.set(0, 0, 0);
        leg.knee.rotation.set(0, 0, 0);
      }
      return;
    }
    const angle = t * Math.PI * 2;
    body.rotation.x = angle;
    body.position.set(
      0,
      ROLL_PIVOT * (1 - Math.cos(angle)) + Math.sin(Math.PI * Math.abs(t)) * 0.14,
      -ROLL_PIVOT * Math.sin(angle),
    );
    this.hero.rightArm.rotation.set(-1.5, 0, -0.5);
    this.hero.leftArm.rotation.set(-1.5, 0, 0.5);
    for (const leg of Object.values(this.hero.legs)) {
      leg.hip.rotation.x = -1.0;
      leg.knee.rotation.x = 1.5;
    }
  }

  _resolveSwing() {
    const p = this.player;
    const origin = this.hero.group.position;
    const hit = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.group.position.x - origin.x;
      const dz = e.group.position.z - origin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > PLAYER.swingReach + e.radius) continue;
      const angle = Math.atan2(dx, dz);
      let diff = angle - p.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > PLAYER.swingArc / 2) continue;
      hit.push(e);
    }
    for (const e of hit) this._damageEnemy(e, PLAYER.swingDamage);
    this._flashRing(origin.x, origin.z, p.facing, PLAYER.swingReach, PLAYER.swingArc, 0xdff1ff, 0.28, true);
    this.shake = Math.max(this.shake, 0.18);
  }

  _damageEnemy(e, amount) {
    if (e.dead) return;
    e.hp -= amount;
    e.hitFlash = 0.16;
    this.score += Math.round(amount);
    const pos = e.group.position;
    const impactY = e.kind === 'boss' ? 1.6 * e.def.scale : 1.0;
    this._sfxlessHit(pos.x, impactY, pos.z, 0xfff0c0);
    if (e.hp <= 0) {
      e.dead = true;
      this.score += e.kind === 'boss' ? 1000 : e.def.score;
      this._flashRing(pos.x, pos.z, 0, 3.4, Math.PI * 2, e.accent, 0.5, true);
      if (e.kind === 'boss') {
        this.bossesDefeated += 1;
        this.boss = null;
        this.shake = 0.9;
        this._hideWarning();
        this._setBanner(`${e.def.name} falls`, 'Flask refilled — breathe');
        this.player.hp = Math.min(PLAYER.maxHp, this.player.hp + 45);
        this.player.flasks = PLAYER.flasks;
        this.restTimer = 3.4; // a breather before the next one walks in
      }
      this.scene.remove(e.group);
    }
  }

  _damagePlayer(amount) {
    const p = this.player;
    if (this.dead || p.invuln > 0) return;
    p.hp -= amount;
    p.invuln = PLAYER.hurtIframes;
    p.hurtFlash = 0.25;
    this.shake = Math.max(this.shake, 0.55);
    if (p.hp <= 0) {
      p.hp = 0;
      this.dead = true;
      this._setBanner('You died', 'The night keeps its arena');
      setTimeout(() => this._end(false), 1400);
    }
  }

  // ------------------------------------------------------------------ loop

  _tick(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    this._updatePlayer(dt);
    this._updateEnemies(dt);
    this._updateProjectiles(dt);
    this._updateEffects(dt);
    this._updateRest(dt);
    this._updateCamera(dt);
    this.world.update(now / 1000);

    this.bannerTimer = Math.max(0, this.bannerTimer - dt);
    if (this.bannerTimer === 0 && this.banner) this.banner = null;

    this.renderer.render(this.scene, this.camera);
    this._pushHud();
    requestAnimationFrame(this._tick);
  }

  _updateRest(dt) {
    if (this.dead || this.restTimer <= 0) return;
    this.restTimer -= dt;
    if (this.restTimer <= 0) this._nextBoss();
  }

  /** Turns the hero toward an angle the short way — quickly, but not a snap. */
  _faceTowards(angle, dt, rate = 12) {
    const p = this.player;
    let diff = angle - p.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.facing += diff * Math.min(1, dt * rate);
  }

  /**
   * The run cycle, in the hero's own frame: forward and back steps swing the
   * hips, side steps lift and plant the legs one at a time, and the chest leans
   * and rolls into the stride. Everything is damped, so stopping eases back
   * into the idle stance rather than snapping.
   */
  _poseRun(dt) {
    const p = this.player;
    const hero = this.hero;
    const a = p.runAmount;
    const k = Math.min(1, dt * 14);
    const sinF = Math.sin(p.facing);
    const cosF = Math.cos(p.facing);
    const fx = p.moveX * sinF + p.moveZ * cosF; // forward part of the stride
    const sx = -p.moveX * cosF + p.moveZ * sinF; // sideways part, positive right
    const swing = Math.sin(p.runPhase) * 0.75 * fx * a;
    const liftR = Math.max(0, Math.sin(p.runPhase)) * Math.abs(sx);
    const liftL = Math.max(0, -Math.sin(p.runPhase)) * Math.abs(sx);
    const sideOut = -0.3 * sx * a;
    const targets = {
      lh: swing,
      rh: -swing,
      lk: Math.max(0, swing) * 1.25 + liftL * 0.55,
      rk: Math.max(0, -swing) * 1.25 + liftR * 0.55,
      lz: sideOut * liftL,
      rz: sideOut * liftR,
      ra: swing * 0.55,
      la: -swing * 0.55,
      bob: Math.abs(Math.sin(p.runPhase)) * 0.055 * a,
      lean: 0.11 * fx * a,
      tilt: -0.055 * sx * a,
    };
    hero.legs.left.hip.rotation.x += (targets.lh - hero.legs.left.hip.rotation.x) * k;
    hero.legs.right.hip.rotation.x += (targets.rh - hero.legs.right.hip.rotation.x) * k;
    hero.legs.left.knee.rotation.x += (targets.lk - hero.legs.left.knee.rotation.x) * k;
    hero.legs.right.knee.rotation.x += (targets.rk - hero.legs.right.knee.rotation.x) * k;
    hero.legs.left.hip.rotation.z += (targets.lz - hero.legs.left.hip.rotation.z) * k;
    hero.legs.right.hip.rotation.z += (targets.rz - hero.legs.right.hip.rotation.z) * k;
    if (!p.swing.active) hero.rightArm.rotation.x += (targets.ra - hero.rightArm.rotation.x) * k;
    if (p.gunKick <= 0) hero.leftArm.rotation.x += (targets.la - hero.leftArm.rotation.x) * k;
    hero.body.position.y += (targets.bob - hero.body.position.y) * k;
    hero.body.rotation.x += (targets.lean - hero.body.rotation.x) * k;
    hero.body.rotation.z += (targets.tilt - hero.body.rotation.z) * k;
    const capeTarget = -0.08 - 0.3 * a + Math.sin(p.runPhase * 2) * 0.04 * a;
    hero.cape.rotation.x += (capeTarget - hero.cape.rotation.x) * k;
  }

  _updatePlayer(dt) {
    const p = this.player;
    const pos = this.hero.group.position;

    p.invuln = Math.max(0, p.invuln - dt);
    p.shotTimer = Math.max(0, p.shotTimer - dt);
    p.gunKick = Math.max(0, p.gunKick - dt);
    p.flaskTimer = Math.max(0, p.flaskTimer - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt);

    if (this.dead) {
      p.roll.active = false;
      this.hero.body.rotation.set(0, 0, 0);
      this.hero.body.position.set(0, 0, 0);
      for (const leg of Object.values(this.hero.legs)) {
        leg.hip.rotation.set(0, 0, 0);
        leg.knee.rotation.set(0, 0, 0);
      }
      p.fallTime = Math.min(1, p.fallTime + dt * 2.4);
      this.hero.group.rotation.z = -p.fallTime * (Math.PI / 2);
      this.hero.group.position.y = -p.fallTime * 0.35;
      return;
    }

    // Elden Ring lock-on. With a live boss the hero squares up to it by himself:
    // W closes the gap, S backs away still facing it, A/D circles it, and the
    // camera orbits because it rides on his facing. No key, no force — letting
    // go stops him dead. With no boss alive he runs free, camera-relative,
    // facing his stride.
    const k = this.keys;
    let fwd = 0;
    let side = 0;
    if (k.has('w') || k.has('arrowup')) fwd += 1;
    if (k.has('s') || k.has('arrowdown')) fwd -= 1;
    if (k.has('a') || k.has('arrowleft')) side -= 1;
    if (k.has('d') || k.has('arrowright')) side += 1;

    const boss = this.boss && !this.boss.dead ? this.boss : null;
    const moving = fwd !== 0 || side !== 0;
    p.moving = moving;
    p.locked = Boolean(boss);

    let mx = 0;
    let mz = 0;
    if (moving) {
      const norm = fwd !== 0 && side !== 0 ? Math.SQRT1_2 : 1;
      if (boss) {
        const bx = boss.group.position.x - pos.x;
        const bz = boss.group.position.z - pos.z;
        // Move in the frame of the boss itself, not the hero's still-turning
        // facing: otherwise circling slowly spirals away from him.
        const aim = Math.atan2(bx, bz);
        this._faceTowards(aim, dt, LOCK_TURN);
        const sin = Math.sin(aim);
        const cos = Math.cos(aim);
        mx = (sin * fwd - cos * side) * norm;
        mz = (cos * fwd + sin * side) * norm;
      } else {
        const camSin = Math.sin(this.camYaw);
        const camCos = Math.cos(this.camYaw);
        mx = (camSin * fwd - camCos * side) * norm;
        mz = (camCos * fwd + camSin * side) * norm;
        this._faceTowards(Math.atan2(mx, mz), dt, RUN_TURN);
      }
    } else if (boss) {
      const bx = boss.group.position.x - pos.x;
      const bz = boss.group.position.z - pos.z;
      if (bx * bx + bz * bz > 0.0001) this._faceTowards(Math.atan2(bx, bz), dt, LOCK_TURN);
    }
    p.moveX = mx;
    p.moveZ = mz;

    if (k.has('j')) this._swing();
    if (k.has('k')) this._shoot();

    if (p.roll.active) {
      p.roll.t += dt;
      const step = PLAYER.rollSpeed * dt;
      pos.x += p.roll.dx * step;
      pos.z += p.roll.dz * step;
      this._poseRoll(Math.min(1, p.roll.t / PLAYER.rollTime));
      if (p.roll.t >= PLAYER.rollTime) {
        p.roll.active = false;
        this._poseRoll(0);
      }
    } else if (p.flaskTimer <= 0) {
      const slow = p.swing.active ? 0.35 : 1;
      pos.x += mx * PLAYER.speed * slow * dt;
      pos.z += mz * PLAYER.speed * slow * dt;
    }

    // Aim rides on the facing. Mid-roll the body points where it tumbles.
    p.aim.set(Math.sin(p.facing), 0, Math.cos(p.facing));
    this.hero.group.rotation.y = p.roll.active ? Math.atan2(p.roll.dx, p.roll.dz) : p.facing;

    // Run cycle, blended in while the keys are held and out when they stop.
    const gait = moving && !p.roll.active && p.flaskTimer <= 0 ? 1 : 0;
    p.runAmount += (gait - p.runAmount) * Math.min(1, dt * 9);
    if (moving) p.runPhase += dt * 10.5 * (p.swing.active ? 0.5 : 1);
    if (!p.roll.active) this._poseRun(dt);

    // Swing animation: wind up, snap through, settle.
    if (p.swing.active) {
      p.swing.t += dt;
      const t = p.swing.t / PLAYER.swingTime;
      const arm = this.hero.rightArm;
      if (t < 0.3) {
        arm.rotation.x = -0.15 - (t / 0.3) * 1.6;
        arm.rotation.y = -(t / 0.3) * 0.5;
      } else if (t < 0.55) {
        const s = (t - 0.3) / 0.25;
        arm.rotation.x = -1.75 + s * 2.65;
        arm.rotation.y = -0.5 + s * 1.1;
      } else {
        const s = Math.min(1, (t - 0.55) / 0.45);
        arm.rotation.x = 0.9 - s * 1.05;
        arm.rotation.y = 0.6 - s * 0.6;
      }
      if (!p.swing.hit && t >= PLAYER.swingHitAt) {
        p.swing.hit = true;
        this._resolveSwing();
      }
      if (t >= 1) {
        p.swing.active = false;
        arm.rotation.set(0, 0, -0.14);
      }
    }

    if (!p.roll.active && p.gunKick > 0) {
      this.hero.leftArm.rotation.x = -1.5 * (p.gunKick / PLAYER.gunKickTime);
      this.hero.leftArm.rotation.z = 0.14;
    }

    // Stamina comes back after a short pause, so you can't swing forever.
    if (p.staminaIdle > PLAYER.staminaDelay) {
      p.stamina = Math.min(PLAYER.maxStamina, p.stamina + PLAYER.staminaRegen * dt);
    } else {
      p.staminaIdle += dt;
    }

    const hurt = p.hurtFlash / 0.25;
    this.hero.materials.primary.emissive.setRGB(hurt, hurt * 0.15, hurt * 0.15);

    // Body block: monsters are solid, so you can't stand inside one.
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = pos.x - e.group.position.x;
      const dz = pos.z - e.group.position.z;
      const dist = Math.hypot(dx, dz);
      const min = e.radius + 0.45;
      if (dist < min && dist > 0.0001) {
        const push = min - dist;
        pos.x += (dx / dist) * push;
        pos.z += (dz / dist) * push;
      }
    }

    const limit = ARENA_RADIUS - 0.6;
    const dist = Math.hypot(pos.x, pos.z);
    if (dist > limit) {
      pos.x = (pos.x / dist) * limit;
      pos.z = (pos.z / dist) * limit;
    }
  }

  _updateEnemies(dt) {
    const playerPos = this.hero.group.position;
    const p = this.player;

    for (const e of this.enemies) {
      if (e.dead) continue;
      e.hitFlash = Math.max(0, e.hitFlash - dt);

      const dx = playerPos.x - e.group.position.x;
      const dz = playerPos.z - e.group.position.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      const nx = dx / dist;
      const nz = dz / dist;
      const startX = e.group.position.x;
      const startZ = e.group.position.z;

      if (e.kind === 'boss') {
        this._updateBoss(e, dt, nx, nz, dist);
      } else {
        this._updateMinion(e, dt, nx, nz, dist);
      }
      e.gaitSpeed = dt > 0 ? Math.hypot(e.group.position.x - startX, e.group.position.z - startZ) / dt : 0;

      // Face the player, except mid-attack for the boss.
      if (!(e.kind === 'boss' && e.move)) {
        e.facing = Math.atan2(nx, nz);
        e.group.rotation.y = e.facing;
      }

      const limit = ARENA_RADIUS - e.radius;
      const d = Math.hypot(e.group.position.x, e.group.position.z);
      if (d > limit) {
        e.group.position.x = (e.group.position.x / d) * limit;
        e.group.position.z = (e.group.position.z / d) * limit;
      }

      // Emissive tells you where an attack is coming from.
      const flash = e.hitFlash / 0.16;
      if (flash > 0) {
        e.mat.emissive.setRGB(flash, flash, flash);
      } else if (e.state === 'windup' || e.state === 'strike') {
        const pulse = 0.35 + Math.abs(Math.sin(performance.now() / 90)) * 0.5;
        e.mat.emissive.set(e.accent).multiplyScalar(pulse * 0.55);
      } else {
        e.mat.emissive.setHex(0x000000);
      }

      this._animateEnemy(e, dt);
    }

    this._separate();
  }

  /**
   * Poses a monster to match its attack state: arms up through the windup, swung
   * through on the strike, jaw and venom sac swelling before anything is spat.
   * Purely visual — damage still comes from positions and radii.
   */
  _animateEnemy(e, dt) {
    const parts = e.parts ?? {};
    const time = performance.now() / 1000;
    const walking = e.state === 'idle' || e.state === 'approach';
    const ranged = e.kind === 'boss' ? e.move === 'spit' || e.move === 'summon' : Boolean(e.def.ranged);

    // Track the gait from how far the monster actually travelled this frame, so
    // legs pump at walking pace, sprint when it dashes, and settle when it stops.
    const gaitTarget = Math.min(1.35, (e.gaitSpeed ?? 0) / Math.max(0.9, e.speed));
    e.gait = (e.gait ?? 0) + (gaitTarget - (e.gait ?? 0)) * Math.min(1, dt * 9);
    e.gaitPhase = (e.gaitPhase ?? e.phase) + dt * (4.5 + e.gait * 6.5);
    const gait = e.gait;

    const sway = Math.sin(time * (walking ? 4.2 : 1.9) + e.phase) * (0.18 + Math.min(1, gait) * 0.2);
    const pose = { lx: sway * 0.2, rx: -sway * 0.2, z: walking ? 0.08 : 0.14, lean: 0, jaw: 0, snap: 9 };

    if (e.state === 'windup') {
      const windup = e.kind === 'boss' ? MOVES[e.move]?.windup ?? 0.5 : e.def.windup;
      const progress = windup > 0 ? 1 - Math.max(0, e.timer) / windup : 1;
      if (e.move === 'dash') {
        pose.lx = pose.rx = 1.7 * progress;
        pose.lean = -0.26 * progress;
      } else if (ranged) {
        pose.lx = pose.rx = -0.4 * progress;
        pose.z = 0.5 * progress;
        pose.lean = -0.16 * progress;
        pose.jaw = progress;
      } else {
        pose.rx = 2.4 * progress;
        pose.lx = 1.5 * progress;
        pose.z = 0.3 + 0.25 * progress;
        pose.lean = -0.2 * progress;
      }
    } else if (e.state === 'strike') {
      pose.snap = 26;
      if (e.move === 'dash') {
        pose.lx = pose.rx = 2.1;
        pose.lean = 0.3;
      } else if (ranged) {
        pose.lx = pose.rx = -0.7;
        pose.z = 0.35;
        pose.lean = 0.2;
        pose.jaw = 1.2;
      } else if (e.move === 'slam') {
        pose.lx = pose.rx = -0.55;
        pose.z = 0.45;
        pose.lean = 0.34;
        pose.jaw = 0.6;
      } else {
        pose.rx = -1.3; // the right arm sweeps through; the left trails behind
        pose.lx = 1.5;
        pose.z = 0.5;
        pose.lean = 0.26;
        pose.jaw = 0.5;
      }
    } else if (e.state === 'recover') {
      pose.lx = pose.rx = 0.45;
      pose.lean = 0.1;
      pose.jaw = 0.25;
    } else if (e.state === 'spawning') {
      pose.lx = pose.rx = -0.45;
      pose.z = 0.6;
      pose.lean = -0.14;
      // It grows into the arena rather than popping into it.
      const rise = Math.max(0, Math.min(1, e.timer / 1.4));
      e.group.scale.setScalar((e.def.scale ?? 1) * (1 - rise * 0.45));
    }

    const k = Math.min(1, dt * pose.snap);
    const arms = e.arms ?? {};
    const spread = parts.spread ?? 0;
    if (arms.left) {
      arms.left.rotation.x += (pose.lx - arms.left.rotation.x) * k;
      arms.left.rotation.z += (-pose.z - spread - arms.left.rotation.z) * k;
    }
    if (arms.right) {
      arms.right.rotation.x += (pose.rx - arms.right.rotation.x) * k;
      arms.right.rotation.z += (pose.z + spread - arms.right.rotation.z) * k;
    }

    e.group.rotation.x += (pose.lean - e.group.rotation.x) * k;
    if (e.state !== 'spawning') e.group.scale.setScalar(e.def.scale ?? 1);

    if (parts.jaw) parts.jaw.rotation.x = pose.jaw * 0.85;
    if (parts.sac) parts.sac.scale.setScalar((parts.sac.userData.base ?? 1) * (1 + pose.jaw * 0.9));
    if (parts.tail) {
      parts.tail.rotation.y = Math.sin(time * 2.4 + e.phase) * 0.32;
      parts.tail.rotation.x = Math.sin(time * 1.7 + e.phase) * 0.05 + Math.min(1, gait) * 0.08;
    }
    if (parts.cloak) parts.cloak.rotation.x = -0.16 + Math.sin(time * 2.1 + e.phase) * 0.05 + gait * 0.08;

    // Legs, hinged at the hip. Quadrupeds scurry on diagonal pairs; bipeds stride.
    if (parts.legs) {
      if (Array.isArray(parts.legs)) {
        for (let i = 0; i < parts.legs.length; i += 1) {
          const offset = i === 0 || i === 3 ? 0 : Math.PI;
          parts.legs[i].rotation.x = Math.sin(e.gaitPhase + offset) * 0.5 * Math.min(1, gait);
        }
      } else {
        const stride = Math.sin(e.gaitPhase) * 0.62 * Math.min(1, gait);
        if (parts.legs.left) parts.legs.left.rotation.x = stride;
        if (parts.legs.right) parts.legs.right.rotation.x = -stride;
      }
    }

    // The Hollow King floats; everything else bobs on its stride.
    if (parts.float) {
      e.group.position.y = 0.3 + Math.sin(time * 1.6 + e.phase) * 0.12 + gait * 0.05;
    } else {
      e.group.position.y = Math.abs(Math.sin(e.gaitPhase)) * 0.07 * Math.min(1, gait);
    }
    if (parts.shadow) {
      const scale = e.group.scale.y || 1;
      parts.shadow.position.y = 0.02 - e.group.position.y / scale;
      parts.shadow.scale.setScalar(Math.max(0.55, 1 - e.group.position.y * 0.2));
    }
  }

  _separate() {    const live = this.enemies.filter((e) => !e.dead);
    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        const a = live[i];
        const b = live[j];
        if (a.kind === 'boss' && b.kind === 'boss') continue;
        let dx = b.group.position.x - a.group.position.x;
        let dz = b.group.position.z - a.group.position.z;
        const dist = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (dist >= min || dist === 0) continue;
        dx /= dist;
        dz /= dist;
        const push = (min - dist) / 2;
        // A boss shrugs off the shove from smaller monsters.
        const aWeight = a.kind === 'boss' ? 0.15 : 1;
        const bWeight = b.kind === 'boss' ? 0.15 : 1;
        a.group.position.x -= dx * push * aWeight;
        a.group.position.z -= dz * push * aWeight;
        b.group.position.x += dx * push * bWeight;
        b.group.position.z += dz * push * bWeight;
      }
    }
  }

  _updateMinion(e, dt, nx, nz, dist) {
    const p = this.player;
    const ranged = Boolean(e.def.ranged);

    if (e.state === 'windup') {
      e.timer -= dt;
      if (e.timer <= 0) {
        e.state = 'strike';
        e.timer = 0.12;
       if (ranged) {
          const from = e.group.position.clone();
          from.y = 1.05;
          const dir = new THREE.Vector3(
            Math.sin(e.facing),
            0,
            Math.cos(e.facing),
          ).normalize();
          this._fireProjectile(from, dir, e.def.damage, e.accent);
        } else if (dist <= e.def.reach + 0.6) {
          this._damagePlayer(e.def.damage);
        }
      }
      return;
    }

    if (e.state === 'strike') {
      e.timer -= dt;
      if (e.timer <= 0) {
        e.state = 'recover';
        e.timer = e.def.recover;
      }
      return;
    }

    if (e.state === 'recover') {
      e.timer -= dt;
      if (e.timer <= 0) e.state = 'approach';
      return;
    }

    e.timer -= dt;

    if (ranged) {
      // Spitters hold their ground and keep a gap open.
      if (dist > e.def.reach) {
        e.group.position.x += nx * e.speed * dt;
        e.group.position.z += nz * e.speed * dt;
      } else if (dist < e.def.keepAway) {
        e.group.position.x -= nx * e.speed * 0.8 * dt;
        e.group.position.z -= nz * e.speed * 0.8 * dt;
      } else {
        e.group.position.x += -nz * e.strafe * e.speed * 0.6 * dt;
        e.group.position.z += nx * e.strafe * e.speed * 0.6 * dt;
      }
      if (e.timer <= 0 && dist <= e.def.reach) {
        e.state = 'windup';
        e.timer = e.def.windup;
      }
      return;
    }

    if (dist > e.def.reach) {
      e.group.position.x += nx * e.speed * dt;
      e.group.position.z += nz * e.speed * dt;
    } else if (e.timer <= 0) {
      e.state = 'windup';
      e.timer = e.def.windup;
    }
  }

  _updateBoss(e, dt, nx, nz, dist) {
    if (e.state === 'spawning') {
      e.timer -= dt;
      if (e.timer <= 0) {
        e.state = 'idle';
        e.timer = 0.8;
      }
      e.group.rotation.y = Math.atan2(nx, nz);
      e.facing = e.group.rotation.y;
      return;
    }

    if (e.state === 'idle') {
      // Drift toward the player between attacks.
      if (dist > e.radius + 2.2) {
        e.group.position.x += nx * e.speed * dt;
        e.group.position.z += nz * e.speed * dt;
      }
      e.facing = Math.atan2(nx, nz);
      e.group.rotation.y = e.facing;

      e.timer -= dt;
      if (e.def.summons > 0) {
        e.summonTimer -= dt;
        if (e.summonTimer <= 0) {
          e.summonTimer = 9;
          const alive = this.enemies.filter((m) => !m.dead && m.kind !== 'boss').length;
          if (alive < 6) {
            for (let i = 0; i < e.def.summons; i += 1) {
              const a = (i / e.def.summons) * Math.PI * 2 + Math.random();
              this._spawnMinion(Math.random() < 0.4 ? 'spitter' : 'grunt', Math.cos(a) * 11, Math.sin(a) * 11);
            }
          }
        }
      }
      if (e.timer <= 0) this._chooseBossMove(e, dist);
      return;
    }

    if (e.state === 'windup') {
      e.timer -= dt;
      e.facing = Math.atan2(nx, nz);
      e.group.rotation.y = e.facing;
      if (this.warning?.visible) {
        this.warningPulse = (this.warningPulse ?? 0) + dt * 6;
        this.warning.material.opacity = 0.3 + Math.abs(Math.sin(this.warningPulse)) * 0.45;
        const spec = MOVES[e.move];
        if (spec.radius) {
          // The slam ring closes in on you as the attack lands.
          const progress = 1 - e.timer / spec.windup;
          this.warning.scale.setScalar(spec.radius * (0.35 + progress * 0.65));
        }
      }
      if (e.timer <= 0) {
        e.state = 'strike';
        e.timer = MOVES[e.move].strike;
        e.struck = false;
        this._hideWarning();
        if (e.move === 'dash') {
          e.dashTimer = MOVES.dash.strike;
          e.dashX = nx;
          e.dashZ = nz;
        }
      }
      return;
    }

    if (e.state === 'strike') {
      e.timer -= dt;
      const spec = MOVES[e.move];

      if (e.move === 'dash') {
        const step = (spec.distance / spec.strike) * dt;
        e.group.position.x += e.dashX * step;
        e.group.position.z += e.dashZ * step;
        if (!e.struck && Math.hypot(this.hero.group.position.x - e.group.position.x, this.hero.group.position.z - e.group.position.z) < e.radius + 1.1) {
          e.struck = true;
          this._damagePlayer(spec.damage);
        }
      } else if (!e.struck) {
        e.struck = true;
        const px = this.hero.group.position.x;
        const pz = this.hero.group.position.z;
        const bx = e.group.position.x;
        const bz = e.group.position.z;

        if (e.move === 'swipe') {
          const d = Math.hypot(px - bx, pz - bz);
          if (d <= spec.reach + 1) {
            const angle = Math.atan2(px - bx, pz - bz);
            let diff = angle - e.facing;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            if (Math.abs(diff) <= spec.arc / 2) this._damagePlayer(spec.damage);
          }
          this._flashRing(bx, bz, e.facing, spec.reach, spec.arc, e.accent, 0.32);
          this.shake = Math.max(this.shake, 0.3);
        } else if (e.move === 'slam') {
          if (Math.hypot(px - bx, pz - bz) <= spec.radius) this._damagePlayer(spec.damage);
          this._flashRing(bx, bz, 0, spec.radius, Math.PI * 2, e.accent, 0.4, true);
          this.shake = Math.max(this.shake, 0.6);
        } else if (e.move === 'spit') {
          for (let i = 0; i < spec.count; i += 1) {
            const offset = (i - (spec.count - 1) / 2) * spec.spread;
            const a = e.facing + offset;
            const from = e.group.position.clone();
            from.y = 2.2 * e.def.scale;
            this._fireProjectile(from, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), spec.damage, e.accent);
          }
        } else if (e.move === 'summon') {
          for (let i = 0; i < spec.count; i += 1) {
            const a = (i / spec.count) * Math.PI * 2;
            this._spawnMinion(Math.random() < 0.5 ? 'spitter' : 'grunt', bx + Math.cos(a) * 7, bz + Math.sin(a) * 7);
          }
          this._flashRing(bx, bz, 0, 6, Math.PI * 2, e.accent, 0.5, true);
        }
      }

      if (e.timer <= 0) {
        e.state = 'recover';
        e.timer = spec.recover;
        e.move = null;
      }
      return;
    }

    if (e.state === 'recover') {
      e.timer -= dt;
      if (e.timer <= 0) {
        e.state = 'idle';
        e.timer = e.def.cooldown * (0.7 + Math.random() * 0.6);
      }
    }
  }

  _chooseBossMove(e, dist) {
    const options = e.def.moves.filter((m) => (m === 'spit' || m === 'dash' ? dist > 3 : true));
    const move = options[Math.floor(Math.random() * options.length)] ?? 'swipe';
    const spec = MOVES[move];
    e.move = move;
    e.state = 'windup';
    e.timer = spec.windup * (this.bossesDefeated > 0 ? 0.9 : 1); // later bosses wind up a touch faster

    if (move === 'slam') this._showWarning(e, 'ring', { radius: spec.radius });
    else if (move === 'swipe') this._showWarning(e, 'arc', { reach: spec.reach, arc: spec.arc });
    else this._hideWarning();
  }

  _fireProjectile(from, dir, damage, color) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 8),
      new THREE.MeshBasicMaterial({ color }),
    );
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, x: dir.x * 11, z: dir.z * 11, damage, life: 2.4 });
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const p = this.projectiles[i];
      p.mesh.position.x += p.x * dt;
      p.mesh.position.z += p.z * dt;
      p.life -= dt;

      const heroPos = this.hero.group.position;
      const hit = Math.hypot(p.mesh.position.x - heroPos.x, p.mesh.position.z - heroPos.z) < 0.85;

      const outside = Math.hypot(p.mesh.position.x, p.mesh.position.z) > ARENA_RADIUS;
      if (hit) this._damagePlayer(p.damage);
      if (hit || outside || p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  _updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.life -= dt;
      const t = Math.max(0, effect.life / effect.maxLife);
      effect.mesh.material.opacity = t * 0.9;
      if (effect.spin > 0) effect.mesh.scale.multiplyScalar(1 + dt * 5);
      if (effect.spin < 0) effect.mesh.scale.multiplyScalar(1 - dt * 2.5);
      if (effect.life <= 0) {
        this.scene.remove(effect.mesh);
        effect.mesh.material.dispose();
        if (!isCachedRing(effect.mesh.geometry)) effect.mesh.geometry.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  _updateCamera(dt) {
    const target = this.hero.group.position;

    // Locked on, the lens rides the hero's facing and so orbits as he circles
    // the boss. Free, it only follows while he runs, and holds still when he
    // stops.
    let turn = this.player.facing - this.camYaw;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const follow = this.player.locked
      ? CAM_FOLLOW_LOCK
      : this.player.moving
        ? CAM_FOLLOW_MOVE
        : 0;
    this.camYaw += turn * Math.min(1, dt * follow);

    const desiredX = target.x - Math.sin(this.camYaw) * CAM_DIST;
    const desiredZ = target.z - Math.cos(this.camYaw) * CAM_DIST;
    const k = Math.min(1, dt * 6);
    this.camera.position.x += (desiredX - this.camera.position.x) * k;
    this.camera.position.z += (desiredZ - this.camera.position.z) * k;
    this.camera.position.y += (CAM_HEIGHT + target.y - this.camera.position.y) * k;

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.8);
      const s = this.shake * this.shake * 0.9;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }

    this.camera.lookAt(target.x, CAM_LOOK_Y, target.z);
  }

  dispose() {
    this.stop();
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('contextmenu', this.onContext);
    this.renderer.dispose();
  }
}

export { BOSSES };