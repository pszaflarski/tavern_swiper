import { useMemo, useEffect, useState } from 'react';
import { Platform, Image as RNImage } from 'react-native';
import * as THREE from 'three';
import { Asset } from 'expo-asset';
import { createDieGeometry, DICE_TYPES } from './diceConfig';
import { TEXTURE_SETS } from './diceTextures';

/**
 * Load a single texture from a local file URI using the R3F-native polyfilled
 * global.Image (which expo-gl provides). Falls back to a solid-color texture
 * if loading fails, so the app never crashes.
 */
function loadTextureFromUri(uri, flipY) {
  return new Promise((resolve) => {
    // R3F native polyfills globalThis.Image for expo-gl texture upload.
    // If the polyfill isn't available, fall back to a blank texture.
    if (typeof globalThis.Image === 'undefined') {
      console.warn('DiceMesh: globalThis.Image not polyfilled, using fallback texture');
      const fallback = new THREE.DataTexture(
        new Uint8Array([200, 200, 200, 255]), 1, 1, THREE.RGBAFormat,
      );
      fallback.needsUpdate = true;
      resolve(fallback);
      return;
    }

    const img = new globalThis.Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.flipY = flipY;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = () => {
      console.warn('DiceMesh: Failed to load texture from', uri);
      const fallback = new THREE.DataTexture(
        new Uint8Array([200, 200, 200, 255]), 1, 1, THREE.RGBAFormat,
      );
      fallback.needsUpdate = true;
      resolve(fallback);
    };
    img.src = uri;
  });
}

/**
 * DiceMesh (NATIVE) — renders any platonic solid die with static PNG textures.
 *
 * Does NOT use @react-three/drei. Instead, resolves assets via expo-asset,
 * then loads textures through the R3F-native polyfilled globalThis.Image.
 * This approach works reliably in both Expo Go and production AAB builds
 * because it bypasses THREE.TextureLoader (which needs document.createElement).
 */
export default function DiceMesh({ meshRef, dieType, faceMapping }) {
  const config = DICE_TYPES[dieType];
  const textureSet = TEXTURE_SETS[dieType];

  const geometry = useMemo(() => createDieGeometry(dieType), [dieType]);

  const [allTextures, setAllTextures] = useState(null);

  // Download assets and load textures manually
  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      const sides = config.sides;
      const flipY = dieType === 'd6';

      // 1. Resolve expo-asset modules and download to local storage
      const assets = Array.from({ length: sides }, (_, i) =>
        Asset.fromModule(textureSet[i + 1]),
      );
      await Promise.all(assets.map(a => a.downloadAsync()));

      if (cancelled) return;

      // 2. Load each texture from the local file URI
      const uris = assets.map(a => a.localUri || a.uri);
      const textures = await Promise.all(
        uris.map(uri => loadTextureFromUri(uri, flipY)),
      );

      if (cancelled) return;
      setAllTextures(textures);
    }

    loadAll().catch(err => console.warn('DiceMesh loadAll failed:', err));
    return () => { cancelled = true; };
  }, [dieType, config.sides, textureSet]);

  // Rearrange materials based on faceMapping
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

  // Dispose materials on change
  useEffect(() => {
    return () => { if (materials) materials.forEach(m => m.dispose()); };
  }, [materials]);

  // Don't render until textures are ready
  if (!materials) return null;

  return <mesh ref={meshRef} geometry={geometry} material={materials} castShadow receiveShadow />;
}
