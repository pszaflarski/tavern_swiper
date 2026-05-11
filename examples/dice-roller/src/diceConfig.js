import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const PHI = (1 + Math.sqrt(5)) / 2;
const DIE_RADIUS = 0.6;

// ─── Helpers ───
function extractConvexData(geo) {
  const pos = geo.attributes.position;
  const vertMap = new Map();
  const verts = [];
  const idxMap = [];
  for (let i = 0; i < pos.count; i++) {
    const x = Math.round(pos.getX(i) * 1e5) / 1e5;
    const y = Math.round(pos.getY(i) * 1e5) / 1e5;
    const z = Math.round(pos.getZ(i) * 1e5) / 1e5;
    const key = `${x},${y},${z}`;
    if (!vertMap.has(key)) { vertMap.set(key, verts.length); verts.push(new CANNON.Vec3(x, y, z)); }
    idxMap.push(vertMap.get(key));
  }
  const faces = [];
  for (let i = 0; i < idxMap.length; i += 3) faces.push([idxMap[i], idxMap[i+1], idxMap[i+2]]);
  return { vertices: verts, faces };
}

function computeLogicalFaceNormals(geo, trisPerFace) {
  const pos = geo.attributes.position;
  const normals = [];
  const numFaces = pos.count / 3 / trisPerFace;
  for (let f = 0; f < numFaces; f++) {
    const bi = f * trisPerFace * 3;
    const a = new THREE.Vector3(pos.getX(bi), pos.getY(bi), pos.getZ(bi));
    const b = new THREE.Vector3(pos.getX(bi+1), pos.getY(bi+1), pos.getZ(bi+1));
    const c = new THREE.Vector3(pos.getX(bi+2), pos.getY(bi+2), pos.getZ(bi+2));
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(b, a),
      new THREE.Vector3().subVectors(c, a)
    ).normalize();
    normals.push([n.x, n.y, n.z]);
  }
  return normals;
}

// ─── UV override: make numbers fit on faces ───
function setTriangleUVs(geo, numFaces) {
  // Each triangular face: equilateral triangle centered in UV space
  const uv = geo.attributes.uv;
  for (let f = 0; f < numFaces; f++) {
    const bi = f * 3;
    uv.setXY(bi,     0.5,  0.12); // top
    uv.setXY(bi + 1, 0.08, 0.88); // bottom-left
    uv.setXY(bi + 2, 0.92, 0.88); // bottom-right
  }
  uv.needsUpdate = true;
}

function setPentagonUVs(geo) {
  // Compute UVs by projecting each pentagon's 3D vertices onto the face plane.
  // This produces distortion-free mapping that matches actual face proportions.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;

  for (let face = 0; face < 12; face++) {
    const bi = face * 9; // 9 vertices per pentagon (3 tris × 3 verts)

    // Collect vertex positions
    const verts = [];
    for (let i = 0; i < 9; i++) {
      verts.push(new THREE.Vector3(pos.getX(bi+i), pos.getY(bi+i), pos.getZ(bi+i)));
    }

    // Face normal from first triangle
    const e1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
    const e2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
    const normal = new THREE.Vector3().crossVectors(e1, e2).normalize();

    // Centroid
    const centroid = new THREE.Vector3();
    for (const v of verts) centroid.add(v);
    centroid.divideScalar(9);

    // Local 2D axes on the face plane
    const tangent = new THREE.Vector3().subVectors(verts[0], centroid).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    // Project to 2D (negate U to fix winding/mirroring)
    const coords2D = verts.map(v => {
      const d = new THREE.Vector3().subVectors(v, centroid);
      return [-d.dot(tangent), d.dot(bitangent)];
    });

    // Normalize to [0.06, 0.94] with centered aspect
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [u, v] of coords2D) {
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const range = Math.max(maxU - minU, maxV - minV);
    const pad = 0.06;

    for (let i = 0; i < 9; i++) {
      const [u, v] = coords2D[i];
      const nu = pad + (1 - 2*pad) * (u - minU - (maxU - minU - range)/2) / range;
      const nv = pad + (1 - 2*pad) * (v - minV - (maxV - minV - range)/2) / range;
      uv.setXY(bi + i, nu, nv);
    }
  }
  uv.needsUpdate = true;
}

// ─── Die type definitions ───
export const DICE_TYPES = {
  d4:  { sides: 4,  label: 'D4',  color: '#E91E63', trisPerFace: 1, vertsPerFace: 3,  isBottom: true },
  d6:  { sides: 6,  label: 'D6',  color: '#2196F3', trisPerFace: 2, vertsPerFace: 6 },
  d8:  { sides: 8,  label: 'D8',  color: '#4CAF50', trisPerFace: 1, vertsPerFace: 3 },
  d12: { sides: 12, label: 'D12', color: '#FF9800', trisPerFace: 3, vertsPerFace: 9 },
  d20: { sides: 20, label: 'D20', color: '#9C27B0', trisPerFace: 1, vertsPerFace: 3 },
};

export function createDieGeometry(dieType) {
  if (dieType === 'd6') return new THREE.BoxGeometry(DIE_RADIUS * 2, DIE_RADIUS * 2, DIE_RADIUS * 2);

  const GeoClass = { d4: THREE.TetrahedronGeometry, d8: THREE.OctahedronGeometry, d12: THREE.DodecahedronGeometry, d20: THREE.IcosahedronGeometry }[dieType];
  const config = DICE_TYPES[dieType];
  const geo = new GeoClass(DIE_RADIUS, 0);

  // Set up material groups
  geo.clearGroups();
  for (let i = 0; i < config.sides; i++) geo.addGroup(i * config.vertsPerFace, config.vertsPerFace, i);

  // Override UVs so numbers are centered on faces
  if (dieType === 'd12') {
    setPentagonUVs(geo);
  } else {
    setTriangleUVs(geo, config.sides);
  }

  return geo;
}

export function getDieFaceNormals(dieType) {
  if (dieType === 'd6') return [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const GeoClass = { d4: THREE.TetrahedronGeometry, d8: THREE.OctahedronGeometry, d12: THREE.DodecahedronGeometry, d20: THREE.IcosahedronGeometry }[dieType];
  const geo = new GeoClass(DIE_RADIUS, 0);
  const normals = computeLogicalFaceNormals(geo, DICE_TYPES[dieType].trisPerFace);
  geo.dispose();
  return normals;
}

export function createDiePhysicsShape(dieType) {
  if (dieType === 'd6') return new CANNON.Box(new CANNON.Vec3(DIE_RADIUS, DIE_RADIUS, DIE_RADIUS));
  const GeoClass = { d4: THREE.TetrahedronGeometry, d8: THREE.OctahedronGeometry, d12: THREE.DodecahedronGeometry, d20: THREE.IcosahedronGeometry }[dieType];
  const geo = new GeoClass(DIE_RADIUS, 0);
  const { vertices, faces } = extractConvexData(geo);
  geo.dispose();
  return new CANNON.ConvexPolyhedron({ vertices, faces });
}

/**
 * Compute face mapping so desiredValue ends up on the correct face.
 * - d4: desiredValue goes on BOTTOM face (face-down, not visible)
 * - d6: desiredValue goes on TOP face, opposite face = 7 - desired
 * - d8, d12, d20: desiredValue goes on TOP face
 *
 * @param {string} dieType
 * @param {number} resultFaceIndex - the face index that is "result" (bottom for d4, top for others)
 * @param {number} desiredValue
 */
export function computeFaceMapping(dieType, resultFaceIndex, desiredValue) {
  const sides = DICE_TYPES[dieType].sides;
  const mapping = new Array(sides).fill(0);

  // Place desired value on the result face
  mapping[resultFaceIndex] = desiredValue;

  if (dieType === 'd6') {
    // d6: opposite faces sum to 7
    const OPP = { 0:1, 1:0, 2:3, 3:2, 4:5, 5:4 };
    mapping[OPP[resultFaceIndex]] = 7 - desiredValue;
    const used = new Set([desiredValue, 7 - desiredValue]);
    const rem = [1,2,3,4,5,6].filter(v => !used.has(v));
    [0,1,2,3,4,5].filter(i => i !== resultFaceIndex && i !== OPP[resultFaceIndex]).forEach((idx, i) => { mapping[idx] = rem[i]; });
    return mapping;
  }

  // All other dice: shuffle remaining values onto remaining faces
  const rem = Array.from({ length: sides }, (_, i) => i + 1).filter(v => v !== desiredValue);
  for (let i = rem.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i+1)); [rem[i], rem[j]] = [rem[j], rem[i]]; }
  [...Array(sides).keys()].filter(i => i !== resultFaceIndex).forEach((idx, i) => { mapping[idx] = rem[i]; });
  return mapping;
}
