import { useRef, useCallback } from 'react';
import * as CANNON from 'cannon-es';
import { FACE_DEFS } from './DiceMesh';

const SETTLE_THRESHOLD = 0.08;
const SETTLE_FRAMES = 45; // ~0.75s at 60fps

/**
 * Hook that detects when the die has settled and reads which face is up.
 *
 * Returns:
 * - checkSettle: call each frame while rolling. Returns the face value when settled, or null.
 * - resetSettle: call when starting a new roll.
 */
export default function useDieResult() {
  const counterRef = useRef(0);

  const resetSettle = useCallback(() => {
    counterRef.current = 0;
  }, []);

  const checkSettle = useCallback((dieBody) => {
    if (!dieBody) return null;

    const vLen = dieBody.velocity.length();
    const aLen = dieBody.angularVelocity.length();

    if (vLen < SETTLE_THRESHOLD && aLen < SETTLE_THRESHOLD) {
      counterRef.current++;
      if (counterRef.current >= SETTLE_FRAMES) {
        // Determine top face
        const worldUp = new CANNON.Vec3(0, 1, 0);
        let bestDot = -Infinity;
        let bestValue = 1;

        for (const fd of FACE_DEFS) {
          const wn = dieBody.quaternion.vmult(
            new CANNON.Vec3(fd.normal[0], fd.normal[1], fd.normal[2])
          );
          const dot = wn.dot(worldUp);
          if (dot > bestDot) {
            bestDot = dot;
            bestValue = fd.value;
          }
        }
        return bestValue;
      }
    } else {
      counterRef.current = 0;
    }

    return null;
  }, []);

  return { checkSettle, resetSettle };
}
