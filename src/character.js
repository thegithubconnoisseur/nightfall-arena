// The hero, built from primitives so it ships without any model files.
// start.ng's style is painted onto it: two colours, a skin tone, a hat, an accessory.
// Everything above the shadow sits in an inner `body` group, so the game can tumble
// the whole figure during a dodge roll without dragging the shadow disc along.

import * as THREE from 'three';

export const DEFAULT_STYLE = {
  primaryColor: '#c8553d',
  secondaryColor: '#2b2f4a',
  skinColor: '#8d5524',
  hairColor: '#3b2b1e',
  hat: 'none',
  accessory: 'none',
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const HATS = new Set(['none', 'cap', 'beanie', 'tophat', 'crown']);
const ACCESSORIES = new Set(['none', 'glasses', 'scarf', 'backpack']);

const pickColor = (value, fallback) => (typeof value === 'string' && HEX.test(value) ? value : fallback);

/**
 * start.ng may send missing, unknown or future values, so every field falls back
 * to a default rather than breaking the model.
 */
export function normalizeStyle(raw) {
  const style = raw && typeof raw === 'object' ? raw : {};
  return {
    primaryColor: pickColor(style.primaryColor, DEFAULT_STYLE.primaryColor),
    secondaryColor: pickColor(style.secondaryColor, DEFAULT_STYLE.secondaryColor),
    skinColor: pickColor(style.skinColor, DEFAULT_STYLE.skinColor),
    hairColor: pickColor(style.hairColor, DEFAULT_STYLE.hairColor),
    hat: HATS.has(style.hat) ? style.hat : 'none',
    accessory: ACCESSORIES.has(style.accessory) ? style.accessory : 'none',
  };
}

export const STYLE_LIST = {
  hats: [...HATS],
  accessories: [...ACCESSORIES],
};

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function ball(r, material, x = 0, y = 0, z = 0, squash = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), material);
  mesh.position.set(x, y, z);
  mesh.scale.y = squash;
  return mesh;
}

function tube(r, h, material, x = 0, y = 0, z = 0, alongZ = false, segments = 14) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), material);
  if (alongZ) mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

function taper(rTop, rBottom, h, material, x = 0, y = 0, z = 0, segments = 14) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A rounded limb: reads as flesh or padded cloth far better than a box. */
function limb(r, length, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, length, 4, 12), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function dome(r, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function spike(r, h, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function buildHat(kind, materials) {
  const group = new THREE.Group();
  const { primary, secondary, dark, steel } = materials;
  if (kind === 'cap') {
    group.add(dome(0.235, primary, 0, 0.02, 0));
    const brim = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 8, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.42, Math.PI * 0.16), dark);
    brim.position.set(0, 0.04, 0.03);
    group.add(brim);
    group.add(ball(0.035, secondary, 0, 0.25, 0));
  } else if (kind === 'beanie') {
    const cap = dome(0.245, primary, 0, 0.0, 0);
    cap.scale.y = 1.15;
    group.add(cap);
    group.add(tube(0.252, 0.1, secondary, 0, -0.02, 0));
    group.add(ball(0.075, secondary, 0, 0.3, 0));
  } else if (kind === 'tophat') {
    group.add(taper(0.33, 0.35, 0.035, dark, 0, -0.02, 0, 20));
    group.add(taper(0.185, 0.2, 0.42, primary, 0, 0.22, 0, 18));
    group.add(tube(0.207, 0.08, secondary, 0, 0.06, 0, false, 18));
    group.add(box(0.05, 0.05, 0.02, steel, 0, 0.06, 0.2));
  } else if (kind === 'crown') {
    group.add(tube(0.215, 0.15, primary, 0, 0.05, 0, false, 18));
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * 0.19;
      const z = Math.sin(a) * 0.19;
      group.add(spike(0.045, 0.2, primary, x, 0.2, z));
      if (i % 2 === 0) {
        const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), steel);
        jewel.position.set(x * 0.98, 0.06, z * 0.98);
        group.add(jewel);
      }
    }
  }
  return group;
}

function buildAccessory(kind, materials) {
  const group = new THREE.Group();
  const { primary, secondary, dark, steel } = materials;
  if (kind === 'glasses') {
    for (const sx of [-0.088, 0.088]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.014, 8, 16), dark);
      ring.position.set(sx, 0.03, 0.185);
      group.add(ring);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.058, 14), steel);
      lens.position.set(sx, 0.03, 0.185);
      group.add(lens);
    }
    group.add(box(0.05, 0.016, 0.02, dark, 0, 0.03, 0.19));
    for (const sx of [-0.15, 0.15]) group.add(box(0.02, 0.016, 0.14, dark, sx, 0.03, 0.11));
  } else if (kind === 'scarf') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.075, 10, 22), primary);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);
    const tail = box(0.15, 0.46, 0.05, secondary, 0.06, -0.26, 0.14);
    tail.rotation.set(0.16, 0, -0.1);
    group.add(tail);
    group.add(box(0.16, 0.06, 0.06, primary, 0.06, -0.5, 0.19));
  } else if (kind === 'backpack') {
    const shell = box(0.46, 0.54, 0.22, secondary, 0, 0, -0.31);
    group.add(shell);
    group.add(dome(0.2, secondary, 0, 0.26, -0.31));
    group.add(box(0.4, 0.1, 0.05, dark, 0, 0.12, -0.43));
    group.add(box(0.4, 0.1, 0.05, dark, 0, -0.14, -0.43));
    const roll = tube(0.09, 0.5, primary, 0, -0.34, -0.32, false, 12);
    roll.rotation.z = Math.PI / 2;
    group.add(roll);
    for (const sx of [-0.15, 0.15]) group.add(box(0.07, 0.4, 0.05, dark, sx, 0.1, -0.18));
  }
  return group;
}

/** Cloth that hangs from the shoulders and bulges away from the back. */
function buildCape(material) {
  const geometry = new THREE.PlaneGeometry(0.6, 0.95, 8, 10);
  const points = geometry.attributes.position;
  for (let i = 0; i < points.count; i += 1) {
    const x = points.getX(i);
    const y = points.getY(i);
    const t = (0.475 - y) / 0.95; // 0 at the collar, 1 at the hem
    points.setX(i, x * (1 + t * 0.3));
    points.setY(i, y - t * t * 0.06 - 0.04 * t * Math.sin(x * 7.0 + 2.0));
    points.setZ(i, 0.16 * Math.sin(t * 2.2) + 0.075 * Math.cos(x * 7.0) * (0.2 + t));
  }
  geometry.computeVertexNormals();

  const cape = new THREE.Group();
  cape.rotation.y = Math.PI; // hang it behind the hero, bulging backwards
  const cloth = new THREE.Mesh(geometry, material);
  cloth.rotation.x = -0.1;
  cape.add(cloth);
  cape.position.set(0, 0.98, -0.21);
  return cape;
}

/**
 * Builds the hero. Returns the group plus the handles the game needs:
 * setStyle() to repaint, the inner body to tumble, arm groups for the swing
 * animation, and the materials used for the damage flash.
 */
export function createHero() {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const body = new THREE.Group();
  group.add(body);

  const primary = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.25 });
  const secondary = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x191b24, roughness: 0.55, metalness: 0.35 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9c2d0, roughness: 0.3, metalness: 0.8 });
  const capeCloth = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x3b2b1e, roughness: 0.95 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x9fe8ff });

  // Legs: rounded thighs and shins, plated knees, heavy boots.
  for (const sx of [-0.155, 0.155]) {
    body.add(limb(0.115, 0.24, secondary, sx, 0.62, 0));
    body.add(limb(0.095, 0.2, secondary, sx, 0.28, 0));
    const knee = ball(0.09, dark, sx, 0.45, 0.05, 0.8);
    body.add(knee);
    const boot = ball(0.13, dark, sx, 0.075, 0.035, 0.72);
    boot.scale.set(1.12, 1, 1.7);
    body.add(boot);
    body.add(tube(0.105, 0.05, steel, sx, 0.17, 0, false, 12));
  }

  // Hips, belt and buckle
  body.add(taper(0.245, 0.27, 0.22, secondary, 0, 0.9, 0, 16));
  body.add(tube(0.275, 0.09, dark, 0, 0.95, 0, false, 16));
  const buckle = new THREE.Mesh(new THREE.OctahedronGeometry(0.055), steel);
  buckle.position.set(0, 0.95, 0.26);
  body.add(buckle);

  // Torso: a tapered chest over a waist, with a breastplate and a collar.
  body.add(taper(0.3, 0.235, 0.52, primary, 0, 1.19, 0, 16));
  const plate = ball(0.29, primary, 0, 1.27, 0.02, 0.92);
  plate.scale.z = 0.8;
  body.add(plate);
  const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), steel);
  emblem.position.set(0, 1.31, 0.245);
  body.add(emblem);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.045, 8, 18), dark);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 1.46, 0);
  body.add(collar);

  body.add(buildCape(capeCloth));

  // Neck and head. The head is a group so hats and accessories stay undistorted.
  body.add(taper(0.085, 0.1, 0.13, skin, 0, 1.52, 0, 12));
  const head = new THREE.Group();
  head.position.set(0, 1.73, 0);
  const skull = ball(0.225, skin, 0, 0, 0);
  skull.scale.set(0.96, 1.04, 0.98);
  head.add(skull);
  const jaw = ball(0.16, skin, 0, -0.1, 0.03, 0.72);
  jaw.scale.x = 0.92;
  head.add(jaw);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.232, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
  hair.position.set(0, 0.02, -0.012);
  hair.scale.set(0.98, 1.02, 1);
  head.add(hair);
  // Back half-shell so the nape reads as hair, not bare skull, from the camera's view.
  const nape = new THREE.Mesh(new THREE.SphereGeometry(0.234, 16, 12, Math.PI, Math.PI, 0, Math.PI * 0.8), hairMat);
  nape.position.set(0, 0.015, -0.012);
  nape.scale.set(0.98, 1.04, 1);
  head.add(nape);
  for (const sx of [-0.082, 0.082]) head.add(ball(0.032, dark, sx, 0.02, 0.196));
  for (const sx of [-0.085, 0.085]) {
    const brow = box(0.075, 0.022, 0.03, dark, sx, 0.075, 0.185);
    brow.rotation.z = sx > 0 ? -0.18 : 0.18;
    head.add(brow);
  }
  body.add(head);

  // Arms on pivots, so rotating a pivot swings the whole arm, pauldron and weapon.
  function buildArm(side) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.41, 1.41, 0);
    arm.rotation.z = -side * 0.14;

    arm.add(dome(0.185, primary, 0, 0.02, 0));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.035, 8, 18), dark);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.01;
    arm.add(rim);
    const stud = spike(0.045, 0.15, steel, side * 0.13, 0.1, 0);
    stud.rotation.z = -side * 0.9;
    arm.add(stud);

    arm.add(limb(0.085, 0.2, secondary, 0, -0.22, 0));
    arm.add(ball(0.075, dark, 0, -0.37, 0));
    arm.add(limb(0.072, 0.18, secondary, 0, -0.52, 0.01));
    arm.add(tube(0.09, 0.17, dark, 0, -0.52, 0.01, false, 12));
    arm.add(ball(0.092, skin, 0, -0.69, 0.02));
    return arm;
  }

  const rightArm = buildArm(1);
  const leftArm = buildArm(-1);
  body.add(rightArm);
  body.add(leftArm);

  // Sword in the right hand, pointing forward along +Z.
  const sword = new THREE.Group();
  sword.position.set(0, -0.69, 0.05);
  sword.add(tube(0.04, 0.2, dark, 0, 0, -0.1, true, 10));
  sword.add(ball(0.055, steel, 0, 0, -0.22));
  sword.add(box(0.3, 0.05, 0.07, steel, 0, 0, 0.03));
  for (const sx of [-0.16, 0.16]) {
    const tip = spike(0.03, 0.1, steel, sx, 0.03, 0.03);
    tip.rotation.z = sx > 0 ? 0.7 : -0.7;
    sword.add(tip);
  }
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.016, 1.02, 4), steel);
  blade.rotation.x = Math.PI / 2;
  blade.scale.z = 0.42;
  blade.position.set(0, 0, 0.57);
  sword.add(blade);
  const point = spike(0.05, 0.2, steel, 0, 0, 1.17);
  point.rotation.x = Math.PI / 2;
  point.scale.z = 0.42;
  sword.add(point);
  rightArm.add(sword);

  // Gun in the left hand: a stubby revolver shape with a glowing cell.
  const gun = new THREE.Group();
  gun.position.set(0, -0.69, 0.04);
  gun.add(box(0.1, 0.15, 0.34, dark, 0, 0.02, 0.12));
  gun.add(tube(0.06, 0.2, dark, 0, 0.045, 0.32, true, 12));
  gun.add(tube(0.042, 0.26, steel, 0, 0.045, 0.42, true, 12));
  gun.add(tube(0.052, 0.06, dark, 0, 0.045, 0.56, true, 12));
  gun.add(ball(0.02, glow, 0, 0.045, 0.595));
  const grip = box(0.09, 0.2, 0.11, dark, 0, -0.12, -0.03);
  grip.rotation.x = 0.24;
  gun.add(grip);
  gun.add(box(0.075, 0.16, 0.09, secondary, 0, -0.11, 0.11));
  gun.add(box(0.105, 0.05, 0.13, primary, 0, 0.11, 0.1));
  gun.add(box(0.03, 0.045, 0.05, steel, 0, 0.13, 0.26));
  gun.add(ball(0.016, glow, 0, 0.155, 0.26));
  leftArm.add(gun);

  // A soft dark disc keeps everyone grounded without a shadow map.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  let hat = new THREE.Group();
  let accessory = new THREE.Group();
  head.add(hat);
  head.add(accessory);

  const materials = { primary, secondary, skin, dark, steel };

  function setStyle(style) {
    primary.color.set(style.primaryColor);
    secondary.color.set(style.secondaryColor);
    skin.color.set(style.skinColor);
    hairMat.color.set(style.hairColor);
    capeCloth.color.set(style.secondaryColor);

    head.remove(hat);
    head.remove(accessory);
    hat = buildHat(style.hat, materials);
    accessory = buildAccessory(style.accessory, materials);
    hat.position.y = 0.14;
    accessory.position.y = -0.05;
    head.add(hat);
    head.add(accessory);
  }

  setStyle(DEFAULT_STYLE);

  return { group, body, setStyle, rightArm, leftArm, sword, gun, materials };
}
