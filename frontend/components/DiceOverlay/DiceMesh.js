import { useMemo, useEffect, useState, useRef } from 'react';
import { Image as RNImage } from 'react-native';
import * as THREE from 'three';
import { Asset } from 'expo-asset';
import { createDieGeometry, DICE_TYPES } from './diceConfig';
import { TEXTURE_SETS } from './diceTextures';

// Match R3F native's file-system import pattern (Expo 54 compat)
let fs;
try { fs = require('expo-file-system/legacy'); }
catch { fs = require('expo-file-system'); }

/**
 * Load a texture from a require() asset ID using the same technique as
 * R3F native's patched TextureLoader (expo-asset + RN Image.getSize + expo-gl).
 *
 * We can't rely on the R3F polyfill because Metro bundles multiple copies
 * of Three.js ("THREE.WARNING: Multiple instances of Three.js being imported"),
 * so only R3F's internal copy gets patched — not ours.
 */
async function loadNativeTexture(requireId, flipY) {
  // 1. Download the bundled asset to local storage (same as R3F's getAsset)
  const asset = await Asset.fromModule(requireId).downloadAsync();
  let uri = asset.localUri || asset.uri;

  // 2. Unpack assets in Android Release Mode — localUri may be a raw path
  //    without a scheme (no 'file://'). Image.getSize can't read those,
  //    so copy to the cache directory first. (Matches R3F's getAsset logic.)
  if (!uri.includes(':')) {
    const file = `${fs.cacheDirectory}ExponentAsset-${asset.hash}.${asset.type}`;
    await fs.copyAsync({ from: uri, to: file });
    uri = file;
  }

  // 3. Get image dimensions via RN's Image.getSize
  const { width, height } = await new Promise((resolve, reject) =>
    RNImage.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject),
  );

  // 4. Build a texture that expo-gl's texImage2D understands
  const texture = new THREE.Texture();
  texture.image = {
    data: { localUri: uri },  // Special format for EXGLImageUtils::loadImage
    width,
    height,
  };
  texture.flipY = flipY;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.isDataTexture = true;  // Forces non-DOM upload path in expo-gl

  return texture;
}

/**
 * DiceMesh (NATIVE) — renders any platonic solid die with static PNG textures.
 *
 * Uses expo-asset + RN Image.getSize + expo-gl for texture loading.
 * No @react-three/drei, no THREE.TextureLoader, no DOM dependencies.
 */
export default function DiceMesh({ meshRef, dieType, faceMapping }) {
  const config = DICE_TYPES[dieType];
  const textureSet = TEXTURE_SETS[dieType];

  const geometry = useMemo(() => createDieGeometry(dieType), [dieType]);

  const [allTextures, setAllTextures] = useState(null);

  // Load ALL face textures for this die type once
  useEffect(() => {
    let cancelled = false;
    const flipY = dieType === 'd6';
    const sides = config.sides;

    Promise.all(
      Array.from({ length: sides }, (_, i) =>
        loadNativeTexture(textureSet[i + 1], flipY).catch(err => {
          console.warn('DiceMesh: texture load error for face', i + 1, err);
          const fb = new THREE.DataTexture(
            new Uint8Array([200, 200, 200, 255]), 1, 1, THREE.RGBAFormat,
          );
          fb.needsUpdate = true;
          return fb;
        }),
      ),
    ).then(textures => {
      if (!cancelled) setAllTextures(textures);
    });

    return () => { cancelled = true; };
  }, [dieType, config.sides, textureSet]);

  // Rearrange materials based on faceMapping (no new texture loads)
  const materials = useMemo(() => {
    if (!allTextures) return null;
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
    return () => { if (materials) materials.forEach(m => m.dispose()); };
  }, [materials]);

  if (!materials) return null;

  return <mesh ref={meshRef} geometry={geometry} material={materials} castShadow receiveShadow position={[0, -100, 0]} />;
}
