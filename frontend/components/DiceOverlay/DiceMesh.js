import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { Asset } from 'expo-asset';
import { createDieGeometry, DICE_TYPES } from './diceConfig';
import { TEXTURE_SETS } from './diceTextures';

/**
 * Load a static PNG texture from an Expo asset require().
 */
function loadStaticTexture(requireSource, flipY = true) {
  const asset = Asset.fromModule(requireSource);
  const loader = new THREE.TextureLoader();
  const tex = loader.load(asset.uri);
  tex.flipY = flipY;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * DiceMesh — renders any platonic solid die with static PNG face textures.
 */
export default function DiceMesh({ meshRef, dieType, faceMapping }) {
  const config = DICE_TYPES[dieType];
  const mappingKey = faceMapping ? faceMapping.join(',') : 'default';

  const geometry = useMemo(() => createDieGeometry(dieType), [dieType]);

  const materials = useMemo(() => {
    const values = faceMapping || Array.from({ length: config.sides }, (_, i) => i + 1);
    const textureSet = TEXTURE_SETS[dieType];
    const flipY = dieType === 'd6';

    return values.map(v => {
      const source = textureSet[v];
      const tex = loadStaticTexture(source, flipY);
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.15 });
    });
  }, [dieType, mappingKey]);

  useEffect(() => {
    return () => { materials.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); };
  }, [materials]);

  return <mesh ref={meshRef} geometry={geometry} material={materials} castShadow receiveShadow />;
}
