/**
 * Static texture registry for all dice faces.
 * Maps each die type to its pre-rendered PNG textures.
 *
 * In Expo/Metro, require() for images returns a resolved asset URI on web
 * and an asset ID on native. We use expo-asset to normalize this.
 */

// ─── Square textures (d6) ───
const SQUARE = {
  1: require('../assets/dice/square/1.png'),
  2: require('../assets/dice/square/2.png'),
  3: require('../assets/dice/square/3.png'),
  4: require('../assets/dice/square/4.png'),
  5: require('../assets/dice/square/5.png'),
  6: require('../assets/dice/square/6.png'),
};

// ─── Triangle textures (d4, d8, d20) ───
const TRIANGLE = {
  1:  require('../assets/dice/triangle/1.png'),
  2:  require('../assets/dice/triangle/2.png'),
  3:  require('../assets/dice/triangle/3.png'),
  4:  require('../assets/dice/triangle/4.png'),
  5:  require('../assets/dice/triangle/5.png'),
  6:  require('../assets/dice/triangle/6.png'),
  7:  require('../assets/dice/triangle/7.png'),
  8:  require('../assets/dice/triangle/8.png'),
  9:  require('../assets/dice/triangle/9.png'),
  10: require('../assets/dice/triangle/10.png'),
  11: require('../assets/dice/triangle/11.png'),
  12: require('../assets/dice/triangle/12.png'),
  13: require('../assets/dice/triangle/13.png'),
  14: require('../assets/dice/triangle/14.png'),
  15: require('../assets/dice/triangle/15.png'),
  16: require('../assets/dice/triangle/16.png'),
  17: require('../assets/dice/triangle/17.png'),
  18: require('../assets/dice/triangle/18.png'),
  19: require('../assets/dice/triangle/19.png'),
  20: require('../assets/dice/triangle/20.png'),
};

// ─── Pentagon textures (d12) ───
const PENTAGON = {
  1:  require('../assets/dice/pentagon/1.png'),
  2:  require('../assets/dice/pentagon/2.png'),
  3:  require('../assets/dice/pentagon/3.png'),
  4:  require('../assets/dice/pentagon/4.png'),
  5:  require('../assets/dice/pentagon/5.png'),
  6:  require('../assets/dice/pentagon/6.png'),
  7:  require('../assets/dice/pentagon/7.png'),
  8:  require('../assets/dice/pentagon/8.png'),
  9:  require('../assets/dice/pentagon/9.png'),
  10: require('../assets/dice/pentagon/10.png'),
  11: require('../assets/dice/pentagon/11.png'),
  12: require('../assets/dice/pentagon/12.png'),
};

// ─── Die type → texture set mapping ───
const TEXTURE_SETS = {
  d4:  TRIANGLE,
  d6:  SQUARE,
  d8:  TRIANGLE,
  d12: PENTAGON,
  d20: TRIANGLE,
};

export { TEXTURE_SETS, SQUARE, TRIANGLE, PENTAGON };
