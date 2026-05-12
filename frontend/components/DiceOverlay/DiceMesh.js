import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { Asset } from 'expo-asset';
import { useTexture } from '@react-three/drei';
import { createDieGeometry, DICE_TYPES } from './diceConfig';
import { TEXTURE_SETS } from './diceTextures';

/**
 * DiceMesh (NATIVE) — renders any platonic solid die with static PNG textures.
 *
 * Uses drei's useTexture for native-compatible asset loading (expo-gl).
 * Loads ALL face textures for the die type once upfront, then rearranges
 * the material order based on faceMapping. This avoids re-suspending
 * (and the resulting blink) when faceMapping changes mid-animation.
 */
export default function DiceMesh({ meshRef, dieType, faceMapping }) {
  const config = DICE_TYPES[dieType];

  const geometry = useMemo(() => createDieGeometry(dieType), [dieType]);

  // Resolve ALL texture URIs for this die type (1..N) once.
  // These never change for a given dieType, so useTexture only loads once.
  const textureSet = TEXTURE_SETS[dieType];
  const allUris = useMemo(
    () => Array.from({ length: config.sides }, (_, i) =>
      Asset.fromModule(textureSet[i + 1]).uri,
    ),
    [dieType],
  );

  // Load all textures once — only suspends on first mount per dieType
  const allTextures = useTexture(allUris);

  // Configure texture settings once after load
  const flipY = dieType === 'd6';
  const textureList = useMemo(() => {
    const list = Array.isArray(allTextures) ? allTextures : [allTextures];
    list.forEach(tex => {
      tex.flipY = flipY;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    });
    return list;
  }, [allTextures, flipY]);

  // Rearrange materials based on faceMapping (no new texture loads!)
  const materials = useMemo(() => {
    const values = faceMapping || Array.from({ length: config.sides }, (_, i) => i + 1);
    return values.map(
      v => new THREE.MeshStandardMaterial({
        map: textureList[v - 1],  // v is 1-indexed, array is 0-indexed
        roughness: 0.4,
        metalness: 0.15,
      }),
    );
  }, [faceMapping, textureList, config.sides]);

  useEffect(() => {
    return () => { materials.forEach(m => m.dispose()); };
  }, [materials]);

  return <mesh ref={meshRef} geometry={geometry} material={materials} castShadow receiveShadow />;
}
