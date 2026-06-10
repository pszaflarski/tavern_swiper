import { useRef, useCallback, useEffect } from 'react';
import * as CANNON from 'cannon-es';

const HALF = 0.5; // half die size

/**
 * Custom hook that creates and manages the cannon-es physics world.
 *
 * Returns:
 * - worldRef: ref to the CANNON.World
 * - dieBodyRef: ref to the die's CANNON.Body
 * - step: function to advance physics by one frame
 * - rollDie: function to launch the die from a random edge
 * - rebuildWalls: function to reconfigure walls for new viewport dimensions
 */
export default function usePhysicsWorld() {
  const worldRef = useRef(null);
  const dieBodyRef = useRef(null);
  const wallBodiesRef = useRef([]);
  const dimsRef = useRef({ halfW: 6, halfH: 8 });
  const floorMatRef = useRef(null);

  // Initialize world once
  useEffect(() => {
    const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -40, 0),
    });
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 20;

    // Floor
    const floorMat = new CANNON.Material({ friction: 0.6, restitution: 0.25 });
    floorMatRef.current = floorMat;
    const floorBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: floorMat,
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floorBody);

    // Die
    const dieMat = new CANNON.Material({ friction: 0.4, restitution: 0.45 });
    const dieBody = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(new CANNON.Vec3(HALF, HALF, HALF)),
      material: dieMat,
      linearDamping: 0.2,
      angularDamping: 0.25,
    });
    dieBody.position.set(0, HALF + 0.01, 0);
    world.addBody(dieBody);

    // Contact material between floor and die
    const floorDieContact = new CANNON.ContactMaterial(floorMat, dieMat, {
      friction: 0.5,
      restitution: 0.25,
    });
    world.addContactMaterial(floorDieContact);

    worldRef.current = world;
    dieBodyRef.current = dieBody;

    return () => {
      worldRef.current = null;
      dieBodyRef.current = null;
    };
  }, []);

  // Rebuild walls to match viewport dimensions (in world units)
  const rebuildWalls = useCallback((halfW, halfH) => {
    const world = worldRef.current;
    if (!world) return;

    // Inset walls slightly so the die stays visually within bounds
    const inset = 0.5;
    const wW = halfW - inset;
    const wH = halfH - inset;
    dimsRef.current = { halfW: wW, halfH: wH };

    // Remove old walls
    wallBodiesRef.current.forEach((b) => world.removeBody(b));
    wallBodiesRef.current = [];

    const wallMat = new CANNON.Material({ friction: 0.3, restitution: 0.6 });

    // CANNON.Plane faces local +Z. We rotate so each wall faces inward.
    const wallDefs = [
      // Right wall at +X, facing -X
      { pos: [wW, 2, 0], axis: [0, 1, 0], angle: -Math.PI / 2 },
      // Left wall at -X, facing +X
      { pos: [-wW, 2, 0], axis: [0, 1, 0], angle: Math.PI / 2 },
      // Far wall at +Z, facing -Z
      { pos: [0, 2, wH], axis: [0, 1, 0], angle: Math.PI },
      // Near wall at -Z, facing +Z
      { pos: [0, 2, -wH], axis: [0, 1, 0], angle: 0 },
    ];

    wallDefs.forEach(({ pos, axis, angle }) => {
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Plane(),
        material: wallMat,
      });
      body.position.set(pos[0], pos[1], pos[2]);
      body.quaternion.setFromAxisAngle(new CANNON.Vec3(axis[0], axis[1], axis[2]), angle);
      world.addBody(body);
      wallBodiesRef.current.push(body);
    });

    // Wall-die contact material for good bouncing
    if (dieBodyRef.current) {
      const wallDieContact = new CANNON.ContactMaterial(wallMat, dieBodyRef.current.material, {
        friction: 0.3,
        restitution: 0.6,
      });
      world.addContactMaterial(wallDieContact);
    }
  }, []);

  // Step the physics world
  const step = useCallback(() => {
    if (worldRef.current) {
      worldRef.current.step(1 / 60, 1 / 60, 3);
    }
  }, []);

  // Launch the die from a random edge — moderate force with spin
  const rollDie = useCallback(() => {
    const body = dieBodyRef.current;
    if (!body) return;

    const { halfW, halfH } = dimsRef.current;
    const margin = 1.0;

    // Pick random edge
    const edge = Math.floor(Math.random() * 4);
    let startX, startZ, velX, velZ;

    switch (edge) {
      case 0: // left → right
        startX = -halfW + margin;
        startZ = (Math.random() - 0.5) * halfH * 0.6;
        velX = 5 + Math.random() * 7;
        velZ = (Math.random() - 0.5) * 6;
        break;
      case 1: // right → left
        startX = halfW - margin;
        startZ = (Math.random() - 0.5) * halfH * 0.6;
        velX = -(5 + Math.random() * 7);
        velZ = (Math.random() - 0.5) * 6;
        break;
      case 2: // top → bottom
        startX = (Math.random() - 0.5) * halfW * 0.6;
        startZ = -halfH + margin;
        velX = (Math.random() - 0.5) * 6;
        velZ = 5 + Math.random() * 7;
        break;
      case 3: // bottom → top
        startX = (Math.random() - 0.5) * halfW * 0.6;
        startZ = halfH - margin;
        velX = (Math.random() - 0.5) * 6;
        velZ = -(5 + Math.random() * 7);
        break;
    }

    body.position.set(startX, 2 + Math.random(), startZ);
    body.velocity.set(velX, -(2 + Math.random() * 2), velZ);
    body.angularVelocity.set(
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 15
    );
    body.quaternion.setFromEuler(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );
    body.wakeUp();
  }, []);

  return { worldRef, dieBodyRef, step, rollDie, rebuildWalls };
}
