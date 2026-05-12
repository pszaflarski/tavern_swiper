import * as CANNON from 'cannon-es';
import { createDiePhysicsShape, getDieFaceNormals, DICE_TYPES, computeFaceMapping } from './diceConfig';

const SETTLE_THRESHOLD = 0.08;
const MAX_FRAMES = 600;

function generateThrow(halfW, halfH) {
  const margin = 1.0;
  const edge = Math.floor(Math.random() * 4);
  let startX, startZ, velX, velZ;

  switch (edge) {
    case 0:
      startX = -halfW + margin;
      startZ = (Math.random() - 0.5) * halfH * 0.6;
      velX = 5 + Math.random() * 7;
      velZ = (Math.random() - 0.5) * 6;
      break;
    case 1:
      startX = halfW - margin;
      startZ = (Math.random() - 0.5) * halfH * 0.6;
      velX = -(5 + Math.random() * 7);
      velZ = (Math.random() - 0.5) * 6;
      break;
    case 2:
      startX = (Math.random() - 0.5) * halfW * 0.6;
      startZ = -halfH + margin;
      velX = (Math.random() - 0.5) * 6;
      velZ = 5 + Math.random() * 7;
      break;
    default:
      startX = (Math.random() - 0.5) * halfW * 0.6;
      startZ = halfH - margin;
      velX = (Math.random() - 0.5) * 6;
      velZ = -(5 + Math.random() * 7);
      break;
  }

  return {
    position: [startX, 2 + Math.random(), startZ],
    velocity: [velX, -(2 + Math.random() * 2), velZ],
    angularVelocity: [
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 15,
    ],
    euler: [
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    ],
  };
}

function getTopFaceIndex(body, faceNormals) {
  const worldUp = new CANNON.Vec3(0, 1, 0);
  let bestDot = -Infinity;
  let bestIndex = 0;

  for (let i = 0; i < faceNormals.length; i++) {
    const n = faceNormals[i];
    const wn = body.quaternion.vmult(new CANNON.Vec3(n[0], n[1], n[2]));
    const dot = wn.dot(worldUp);
    if (dot > bestDot) {
      bestDot = dot;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Pre-simulate a dice roll for any die type.
 *
 * @param {string} dieType - 'd4' | 'd6' | 'd8' | 'd12' | 'd20'
 * @param {number} halfW - half-width of playing field
 * @param {number} halfH - half-height of playing field
 * @returns {{ frames: Array<{px:number,py:number,pz:number,qx:number,qy:number,qz:number,qw:number}>, resultIndex: number }}
 */
export function preSimulate(dieType, halfW, halfH) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -40, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 20;

  // Floor
  const floorMat = new CANNON.Material({ friction: 0.6, restitution: 0.25 });
  const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: floorMat });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);

  // Walls
  const wW = halfW - 0.5;
  const wH = halfH - 0.5;
  const wallMat = new CANNON.Material({ friction: 0.3, restitution: 0.6 });
  [
    { pos: [wW, 2, 0], axis: [0, 1, 0], angle: -Math.PI / 2 },
    { pos: [-wW, 2, 0], axis: [0, 1, 0], angle: Math.PI / 2 },
    { pos: [0, 2, wH], axis: [0, 1, 0], angle: Math.PI },
    { pos: [0, 2, -wH], axis: [0, 1, 0], angle: 0 },
  ].forEach(({ pos, axis, angle }) => {
    const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: wallMat });
    wall.position.set(pos[0], pos[1], pos[2]);
    wall.quaternion.setFromAxisAngle(new CANNON.Vec3(axis[0], axis[1], axis[2]), angle);
    world.addBody(wall);
  });

  // Die with correct physics shape
  const dieMat = new CANNON.Material({ friction: 0.4, restitution: 0.45 });
  const dieShape = createDiePhysicsShape(dieType);
  const die = new CANNON.Body({
    mass: 1,
    shape: dieShape,
    material: dieMat,
    linearDamping: 0.2,
    angularDamping: 0.25,
  });
  world.addBody(die);

  world.addContactMaterial(new CANNON.ContactMaterial(floorMat, dieMat, { friction: 0.5, restitution: 0.25 }));
  world.addContactMaterial(new CANNON.ContactMaterial(wallMat, dieMat, { friction: 0.3, restitution: 0.6 }));

  // Throw
  const t = generateThrow(wW, wH);
  die.position.set(...t.position);
  die.velocity.set(...t.velocity);
  die.angularVelocity.set(...t.angularVelocity);
  die.quaternion.setFromEuler(...t.euler);
  die.wakeUp();

  // Record frames
  const frames = [];
  let settleCount = 0;

  for (let i = 0; i < MAX_FRAMES; i++) {
    world.step(1 / 60);
    frames.push({
      px: die.position.x, py: die.position.y, pz: die.position.z,
      qx: die.quaternion.x, qy: die.quaternion.y, qz: die.quaternion.z, qw: die.quaternion.w,
    });
    if (die.velocity.length() < SETTLE_THRESHOLD && die.angularVelocity.length() < SETTLE_THRESHOLD) {
      settleCount++;
      if (settleCount >= 30) break;
    } else {
      settleCount = 0;
    }
  }

  // Detect result face
  const faceNormals = getDieFaceNormals(dieType);
  const worldUp = new CANNON.Vec3(0, 1, 0);
  let resultIndex;

  if (DICE_TYPES[dieType].isBottom) {
    // d4: result is the BOTTOM face (most downward-pointing normal)
    let bestDot = Infinity;
    resultIndex = 0;
    for (let i = 0; i < faceNormals.length; i++) {
      const n = faceNormals[i];
      const wn = die.quaternion.vmult(new CANNON.Vec3(n[0], n[1], n[2]));
      const dot = wn.dot(worldUp);
      if (dot < bestDot) { bestDot = dot; resultIndex = i; }
    }

    // ─── Flip-over animation: reveal the bottom face ───
    const lastFrame = frames[frames.length - 1];
    const finalQ = new CANNON.Quaternion(lastFrame.qx, lastFrame.qy, lastFrame.qz, lastFrame.qw);

    // Pause before flip (20 frames ≈ 0.33s)
    for (let i = 0; i < 20; i++) frames.push({ ...lastFrame });

    // Compute target: rotate 180° around world X axis
    const flipQ = new CANNON.Quaternion();
    flipQ.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI);
    const targetQ = flipQ.mult(finalQ);

    // Flip frames with ease-in-out + vertical arc (50 frames ≈ 0.83s)
    const FLIP_FRAMES = 50;
    const ARC_HEIGHT = 1.8;
    for (let i = 0; i <= FLIP_FRAMES; i++) {
      const t = i / FLIP_FRAMES;
      // Ease in-out cubic
      const te = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      // SLERP quaternion
      const q = new CANNON.Quaternion();
      finalQ.slerp(targetQ, te, q);

      // Arc position (sine curve up and back down)
      const y = lastFrame.py + ARC_HEIGHT * Math.sin(t * Math.PI);

      frames.push({
        px: lastFrame.px, py: y, pz: lastFrame.pz,
        qx: q.x, qy: q.y, qz: q.z, qw: q.w,
      });
    }

    // Hold at flipped position (20 frames ≈ 0.33s)
    const flippedFrame = frames[frames.length - 1];
    for (let i = 0; i < 20; i++) frames.push({ ...flippedFrame });
  } else {
    // All others: result is the TOP face (most upward-pointing normal)
    resultIndex = getTopFaceIndex(die, faceNormals);
  }

  return { frames, resultIndex };
}

// Re-export for convenience
export { computeFaceMapping } from './diceConfig';
