import React, { useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import DiceMesh from './DiceMesh';
import { preSimulate, computeFaceMapping } from './preSimulate';
import { DICE_TYPES } from './diceConfig';

/**
 * DiceScene — auto-triggers a roll on mount (no external trigger needed).
 * Since the Canvas only mounts when visible=true, this fires automatically.
 */
function DiceScene({ dieType, desiredValue, onResult }) {
  const { viewport } = useThree();
  const meshRef = useRef();

  const framesRef = useRef(null);
  const frameIndexRef = useRef(0);
  const playingRef = useRef(false);
  const doneRef = useRef(false);
  const resultValueRef = useRef(null);

  const [faceMapping, setFaceMapping] = useState(null);

  const worldHalfW = viewport.width / 2;
  const worldHalfH = viewport.height / 2;

  // Auto-trigger simulation on mount / when viewport is ready
  useEffect(() => {
    if (worldHalfW <= 0 || worldHalfH <= 0) return;
    if (doneRef.current) return; // Only run once per mount

    const sides = DICE_TYPES[dieType].sides;
    const value = desiredValue ?? (Math.floor(Math.random() * sides) + 1);

    const { frames, resultIndex } = preSimulate(dieType, worldHalfW, worldHalfH);
    const mapping = computeFaceMapping(dieType, resultIndex, value);

    setFaceMapping(mapping);
    framesRef.current = frames;
    frameIndexRef.current = 0;
    playingRef.current = true;
    doneRef.current = true;
    resultValueRef.current = value;
  }, [worldHalfW, worldHalfH, dieType, desiredValue]);

  useFrame(() => {
    if (!playingRef.current || !framesRef.current || !meshRef.current) return;
    const frames = framesRef.current;
    const idx = frameIndexRef.current;
    if (idx >= frames.length) {
      playingRef.current = false;
      onResult(resultValueRef.current);
      return;
    }
    const f = frames[idx];
    meshRef.current.position.set(f.px, f.py, f.pz);
    meshRef.current.quaternion.set(f.qx, f.qy, f.qz, f.qw);
    frameIndexRef.current++;
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

      <DiceMesh meshRef={meshRef} dieType={dieType} faceMapping={faceMapping} />
    </>
  );
}

/**
 * DiceOverlay — transparent fullscreen overlay that renders a dice roll
 * on top of the message list.
 *
 * The Canvas (and DiceScene) only mount when visible=true.
 * DiceScene auto-triggers the simulation on mount, so no cross-reconciler
 * ref timing issues.
 */
export default function DiceOverlay({ visible, dieType, rollKey, desiredValue, onResult, onDismiss }) {
  const handleResult = useCallback((value) => {
    if (onResult) onResult(value);
  }, [onResult]);

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Canvas
        key={`${dieType}-${rollKey}`}
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
        <DiceScene
          dieType={dieType}
          desiredValue={desiredValue}
          onResult={handleResult}
        />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    pointerEvents: 'none',
  },
  canvas: {
    flex: 1,
    backgroundColor: 'transparent',
    pointerEvents: 'none',
  },
});
