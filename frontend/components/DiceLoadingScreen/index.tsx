import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as CANNON from 'cannon-es';
import DiceMesh from '../DiceOverlay/DiceMesh';
import { createDiePhysicsShape, DICE_TYPES } from '../DiceOverlay/diceConfig';
import { Colors, Fonts } from '../../theme';

type DieType = 'd4' | 'd6' | 'd8' | 'd12' | 'd20';

const DIE_TYPES_LIST: DieType[] = ['d4', 'd6', 'd8', 'd12', 'd20'];
const SETTLE_THRESHOLD = 0.08;
const SETTLE_FRAMES_REQUIRED = 30;

const LOADING_MESSAGES = [
  'Rolling for initiative…',
  'Lighting the hearth…',
  'Sharpening blades…',
  'Summoning your heroes…',
  'Consulting the oracle…',
  'Polishing armor…',
  'Brewing potions…',
  'Opening the tavern door…',
];

function getRandomDie(): DieType {
  return DIE_TYPES_LIST[Math.floor(Math.random() * DIE_TYPES_LIST.length)];
}

function getRandomMessage(): string {
  return LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
}

/**
 * Generate a random throw from a random screen edge.
 * Extracted from preSimulate.js's generateThrow — duplicated here
 * to keep DiceLoadingScreen self-contained without modifying existing code.
 */
function generateThrow(halfW: number, halfH: number) {
  const margin = 1.0;
  const edge = Math.floor(Math.random() * 4);
  let startX: number, startZ: number, velX: number, velZ: number;

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
    position: [startX, 2 + Math.random(), startZ] as [number, number, number],
    velocity: [velX, -(2 + Math.random() * 2), velZ] as [number, number, number],
    angularVelocity: [
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 15,
    ] as [number, number, number],
    euler: [
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    ] as [number, number, number],
  };
}

// ─── Live Physics Scene ───

interface LiveDiceSceneProps {
  dieType: DieType;
  onSettled: () => void;
}

/**
 * LiveDiceScene — runs CANNON physics per-frame instead of pre-simulating.
 * No deterministic results, no face mapping — just real physics.
 */
function LiveDiceScene({ dieType, onSettled }: LiveDiceSceneProps) {
  const { viewport } = useThree();
  const meshRef = useRef(null);

  const worldHalfW = viewport.width / 2;
  const worldHalfH = viewport.height / 2;

  // Create the physics world and die body once on mount
  const physicsRef = useRef<{
    world: CANNON.World;
    die: CANNON.Body;
    settled: boolean;
    settleCount: number;
  } | null>(null);

  // Identity face mapping — no rigging, whatever lands is fine
  const identityMapping = useMemo(() => {
    const sides = DICE_TYPES[dieType].sides;
    return Array.from({ length: sides }, (_, i) => i + 1);
  }, [dieType]);

  useEffect(() => {
    if (worldHalfW <= 0 || worldHalfH <= 0) return;

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -40, 0) });
    world.broadphase = new CANNON.NaiveBroadphase();
    (world.solver as any).iterations = 20;

    // Floor
    const floorMat = new CANNON.Material({ friction: 0.6, restitution: 0.25 });
    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: floorMat });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floor);

    // Walls
    const wW = worldHalfW - 0.5;
    const wH = worldHalfH - 0.5;
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

    // Die
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

    // Throw from random edge
    const t = generateThrow(wW, wH);
    die.position.set(...t.position);
    die.velocity.set(...t.velocity);
    die.angularVelocity.set(...t.angularVelocity);
    die.quaternion.setFromEuler(...t.euler);
    die.wakeUp();

    physicsRef.current = { world, die, settled: false, settleCount: 0 };

    return () => {
      physicsRef.current = null;
    };
  }, [worldHalfW, worldHalfH, dieType]);

  useFrame(() => {
    const physics = physicsRef.current;
    if (!physics || !meshRef.current) return;
    if (physics.settled) return;

    const { world, die } = physics;

    // Step physics
    world.step(1 / 60);

    // Apply to mesh
    const mesh = meshRef.current as any;
    mesh.position.set(die.position.x, die.position.y, die.position.z);
    mesh.quaternion.set(die.quaternion.x, die.quaternion.y, die.quaternion.z, die.quaternion.w);

    // Check if settled
    if (
      die.velocity.length() < SETTLE_THRESHOLD &&
      die.angularVelocity.length() < SETTLE_THRESHOLD
    ) {
      physics.settleCount++;
      if (physics.settleCount >= SETTLE_FRAMES_REQUIRED) {
        physics.settled = true;
        onSettled();
      }
    } else {
      physics.settleCount = 0;
    }
  });

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 15, 4]} intensity={1.8} castShadow />
      <pointLight position={[-4, 10, -3]} intensity={0.4} color="#ffd700" />

      {/* Invisible floor for physics alignment */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow visible={false}>
        <planeGeometry args={[50, 50]} />
        <shadowMaterial opacity={0} />
      </mesh>

      <DiceMesh meshRef={meshRef} dieType={dieType} faceMapping={identityMapping} />
    </>
  );
}

// ─── Main Loading Screen ───

/**
 * DiceLoadingScreen — replaces the plain ActivityIndicator with a
 * sequential dice rolling animation. A random die rolls, settles,
 * holds for 0.5s, then a new random die rolls. Repeats until unmounted.
 */
export default function DiceLoadingScreen({ message: fixedMessage }: { message?: string } = {}) {
  const [dieType, setDieType] = useState<DieType>(getRandomDie);
  const [rollKey, setRollKey] = useState(0);
  const [displayMessage, setDisplayMessage] = useState(fixedMessage ?? getRandomMessage);

  // Pulsing dot animation for the loading text
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  // Timer ref for cleanup on unmount
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleSettled = useCallback(() => {
    // Wait 0.5s, then roll a new random die
    timerRef.current = setTimeout(() => {
      setDieType(getRandomDie());
      setRollKey((k) => k + 1);
      if (!fixedMessage) setDisplayMessage(getRandomMessage());
    }, 500);
  }, [fixedMessage]);

  return (
    <View style={styles.container} testID="dice-loading-screen">
      {/* Dice Canvas */}
      <View style={styles.canvasContainer}>
        <Canvas
          key={`loading-${dieType}-${rollKey}`}
          orthographic
          camera={{
            position: [0, 20, 0.001],
            zoom: 55,
            near: 0.1,
            far: 100,
            up: [0, 0, -1],
          }}
          style={styles.canvas}
          gl={{ alpha: true }}
          events={() => ({ enabled: false, priority: 0, compute: () => {} })}
        >
          <LiveDiceScene dieType={dieType} onSettled={handleSettled} />
        </Canvas>
      </View>

      {/* Loading Text */}
      <Animated.Text style={[styles.loadingText, { opacity: pulseAnim }]}>
        {displayMessage}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  canvasContainer: {
    width: 280,
    height: 280,
  },
  canvas: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingText: {
    marginTop: 24,
    fontSize: 16,
    fontFamily: Fonts.scribe,
    color: Colors.primaryFixed,
    letterSpacing: 0.5,
  },
});
