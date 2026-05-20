import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { Asset } from 'expo-asset';
import { createDieGeometry, DICE_TYPES } from './diceConfig';
import { TEXTURE_SETS } from './diceTextures';

/**
 * DiceMesh (WEB) — uses THREE.TextureLoader directly.
 *
 * Loads ALL face textures for the die type once upfront, then rearranges
 * the material order based on faceMapping. This matches the native version's
 * strategy of never reloading textures when faceMapping changes.
 */
function loadStaticTexture(requireSource, flipY = true) {
  const asset = Asset.fromModule(requireSource);
  const loader = new THREE.TextureLoader();
  const tex = loader.load(asset.uri);
  tex.flipY = flipY;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function DiceMesh({ meshRef, dieType, faceMapping }) {
  const config = DICE_TYPES[dieType];

  const geometry = useMemo(() => createDieGeometry(dieType), [dieType]);

  // Load ALL textures for this die type once (1..N)
  const textureSet = TEXTURE_SETS[dieType];
  const flipY = dieType === 'd6';
  const allTextures = useMemo(
    () => Array.from({ length: config.sides }, (_, i) =>
      loadStaticTexture(textureSet[i + 1], flipY),
    ),
    [dieType],
  );

  // Rearrange materials based on faceMapping (no texture reloads)
  const materials = useMemo(() => {
    const values = faceMapping || Array.from({ length: config.sides }, (_, i) => i + 1);
    return values.map(
      v => new THREE.MeshStandardMaterial({
        map: allTextures[v - 1],
        roughness: 0.4,
        metalness: 0.15,
      }),
    );
  }, [faceMapping, allTextures, config.sides]);

  useEffect(() => {
    return () => { materials.forEach(m => m.dispose()); };
  }, [materials]);

  // Dispose textures on unmount
  useEffect(() => {
    return () => { allTextures.forEach(t => t.dispose()); };
  }, [allTextures]);

  return <mesh ref={meshRef} geometry={geometry} material={materials} castShadow receiveShadow position={[0, -100, 0]} />;
}
