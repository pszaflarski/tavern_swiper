import { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import DiceMesh from '../src/DiceMesh';
import { DICE_TYPES } from '../src/diceConfig';
import { preSimulate, computeFaceMapping } from '../src/preSimulate';

const DIE_ORDER = ['d4', 'd6', 'd8', 'd12', 'd20'];

// ─── 3D Scene ───
function DiceScene({ triggerRef, onResult, dieType }) {
  const { viewport } = useThree();
  const meshRef = useRef();

  const framesRef = useRef(null);
  const frameIndexRef = useRef(0);
  const playingRef = useRef(false);
  const resultRef = useRef(null);

  const [faceMapping, setFaceMapping] = useState(null);

  const worldHalfW = viewport.width / 2;
  const worldHalfH = viewport.height / 2;

  useEffect(() => {
    triggerRef.current = (desiredValue) => {
      const { frames, resultIndex } = preSimulate(dieType, worldHalfW, worldHalfH);
      const mapping = computeFaceMapping(dieType, resultIndex, desiredValue);
      setFaceMapping(mapping);
      framesRef.current = frames;
      frameIndexRef.current = 0;
      playingRef.current = true;
      resultRef.current = desiredValue;
    };
  }, [worldHalfW, worldHalfH, dieType]);

  useFrame(() => {
    if (!playingRef.current || !framesRef.current || !meshRef.current) return;
    const frames = framesRef.current;
    const idx = frameIndexRef.current;
    if (idx >= frames.length) {
      playingRef.current = false;
      onResult(resultRef.current);
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

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[worldHalfW * 2 + 4, worldHalfH * 2 + 4]} />
        <meshStandardMaterial color="#0f1525" roughness={0.9} metalness={0.05} />
      </mesh>
      <gridHelper
        args={[Math.max(worldHalfW, worldHalfH) * 2 + 4, 40, '#151d30', '#151d30']}
        position={[0, 0.002, 0]}
      />

      {/* Edge glow */}
      {[worldHalfH - 0.5, -(worldHalfH - 0.5)].map((z, i) => (
        <mesh key={`hz-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, z]}>
          <planeGeometry args={[(worldHalfW - 0.5) * 2, 0.08]} />
          <meshBasicMaterial color="#f59e0b" transparent opacity={0.15} />
        </mesh>
      ))}
      {[worldHalfW - 0.5, -(worldHalfW - 0.5)].map((x, i) => (
        <mesh key={`vt-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.01, 0]}>
          <planeGeometry args={[0.08, (worldHalfH - 0.5) * 2]} />
          <meshBasicMaterial color="#f59e0b" transparent opacity={0.15} />
        </mesh>
      ))}

      <DiceMesh meshRef={meshRef} dieType={dieType} faceMapping={faceMapping} />
    </>
  );
}

// ─── Main Page ───
export default function Index() {
  const [dieType, setDieType] = useState('d6');
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState(null);
  const [selectedValue, setSelectedValue] = useState(null);
  const [history, setHistory] = useState([]);
  const triggerRef = useRef(null);

  const sides = DICE_TYPES[dieType].sides;

  // Reset selected value when changing die type
  useEffect(() => {
    setSelectedValue(null);
    setResult(null);
  }, [dieType]);

  const handleRoll = useCallback(() => {
    if (rolling) return;
    setRolling(true);
    setResult(null);
    const desiredValue = selectedValue || (Math.floor(Math.random() * sides) + 1);
    if (triggerRef.current) triggerRef.current(desiredValue);
  }, [rolling, selectedValue, sides]);

  const handleResult = useCallback((value) => {
    setRolling(false);
    setResult(value);
    setHistory((prev) => {
      const next = [...prev, { type: dieType, value }];
      if (next.length > 10) next.shift();
      return next;
    });
  }, [dieType]);

  return (
    <View style={styles.container}>
      <Canvas
        orthographic
        camera={{ position: [0, 20, 0.001], zoom: 55, near: 0.1, far: 100, up: [0, 0, -1] }}
        style={styles.canvas}
      >
        <color attach="background" args={['#0a0e1a']} />
        <DiceScene triggerRef={triggerRef} onResult={handleResult} dieType={dieType} />
      </Canvas>

      {/* Result overlay */}
      {result !== null && !rolling && (
        <View style={styles.resultOverlay} pointerEvents="none">
          <Text style={styles.resultValue}>{result}</Text>
        </View>
      )}

      {/* Bottom panel */}
      <View style={styles.panel}>
        {/* Die type selector */}
        <Text style={styles.sectionLabel}>DICE</Text>
        <View style={styles.typeRow}>
          {DIE_ORDER.map((t) => (
            <TouchableOpacity
              key={t}
              style={[
                styles.typeChip,
                dieType === t && { backgroundColor: DICE_TYPES[t].color, borderColor: DICE_TYPES[t].color },
              ]}
              onPress={() => !rolling && setDieType(t)}
            >
              <Text style={[styles.typeChipText, dieType === t && styles.typeChipTextActive]}>
                {DICE_TYPES[t].label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Number picker */}
        <Text style={styles.sectionLabel}>LAND ON</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pickerScroll}
        >
          <TouchableOpacity
            style={[styles.pickerChip, selectedValue === null && styles.pickerChipActive]}
            onPress={() => setSelectedValue(null)}
          >
            <Text style={[styles.pickerChipText, selectedValue === null && styles.pickerChipTextActive]}>
              🎲
            </Text>
          </TouchableOpacity>
          {Array.from({ length: sides }, (_, i) => i + 1).map((n) => (
            <TouchableOpacity
              key={n}
              style={[styles.pickerChip, selectedValue === n && styles.pickerChipActive]}
              onPress={() => setSelectedValue(n)}
            >
              <Text style={[styles.pickerChipText, selectedValue === n && styles.pickerChipTextActive]}>
                {n}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* History */}
        {history.length > 0 && (
          <View style={styles.historyRow}>
            <Text style={styles.sectionLabel}>HISTORY</Text>
            {history.map((h, i) => (
              <View
                key={i}
                style={[
                  styles.historyPip,
                  i === history.length - 1 && styles.historyPipLatest,
                ]}
              >
                <Text style={[styles.historyPipText, i === history.length - 1 && styles.historyPipTextLatest]}>
                  {h.value}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Roll button */}
        <TouchableOpacity
          style={[styles.rollBtn, rolling && styles.rollBtnDisabled]}
          onPress={handleRoll}
          disabled={rolling}
          activeOpacity={0.8}
        >
          <Text style={styles.rollBtnText}>
            {rolling
              ? '🎲 Rolling…'
              : selectedValue
                ? `🎲 ROLL ${DICE_TYPES[dieType].label} → ${selectedValue}`
                : `🎲 ROLL ${DICE_TYPES[dieType].label}`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0e1a' },
  canvas: { flex: 1 },
  resultOverlay: {
    position: 'absolute', top: 24, left: 0, right: 0,
    alignItems: 'center', zIndex: 20,
  },
  resultValue: {
    fontSize: 80, fontWeight: '900', color: '#f59e0b',
    textShadowColor: 'rgba(245,158,11,0.6)',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingBottom: 24, paddingTop: 16,
    alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(15,23,42,0.94)',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  sectionLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 1.5,
    color: '#64748b', alignSelf: 'flex-start',
  },
  typeRow: { flexDirection: 'row', gap: 6, width: '100%', justifyContent: 'center' },
  typeChip: {
    flex: 1, height: 36, borderRadius: 8, backgroundColor: '#1e293b',
    borderWidth: 1.5, borderColor: '#334155',
    alignItems: 'center', justifyContent: 'center',
  },
  typeChipText: { fontSize: 13, fontWeight: '900', color: '#94a3b8' },
  typeChipTextActive: { color: '#fff' },
  pickerScroll: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  pickerChip: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: '#1e293b',
    borderWidth: 1.5, borderColor: '#334155',
    alignItems: 'center', justifyContent: 'center',
  },
  pickerChipActive: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  pickerChipText: { fontSize: 14, fontWeight: '900', color: '#94a3b8' },
  pickerChipTextActive: { color: '#0f172a' },
  historyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    flexWrap: 'wrap', justifyContent: 'center',
  },
  historyPip: {
    width: 28, height: 28, borderRadius: 6, backgroundColor: 'rgba(30,41,59,0.8)',
    borderWidth: 1.5, borderColor: '#334155',
    alignItems: 'center', justifyContent: 'center',
  },
  historyPipLatest: { borderColor: '#f59e0b' },
  historyPipText: { fontSize: 12, fontWeight: '900', color: '#cbd5e1' },
  historyPipTextLatest: { color: '#f59e0b' },
  rollBtn: {
    width: '100%', maxWidth: 400, height: 52, borderRadius: 14,
    backgroundColor: '#f59e0b', alignItems: 'center', justifyContent: 'center',
  },
  rollBtnDisabled: { opacity: 0.6 },
  rollBtnText: { fontSize: 18, fontWeight: '900', color: '#0f172a', letterSpacing: 2 },
});
