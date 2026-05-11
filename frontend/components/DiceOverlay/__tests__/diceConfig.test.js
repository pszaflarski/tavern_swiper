import { computeFaceMapping, DICE_TYPES } from '../diceConfig';

describe('computeFaceMapping', () => {
  it('correctly maps faces for a D6', () => {
    // For a d6, opposite faces sum to 7. The mapping is [top, bottom, right, left, front, back]
    // The opposite mapping is: 0<->1, 2<->3, 4<->5.
    // If we want the top face (index 0) to be 5, then the bottom face (index 1) MUST be 2.
    const desiredValue = 5;
    const resultFaceIndex = 0; // Top face
    const mapping = computeFaceMapping('d6', resultFaceIndex, desiredValue);

    expect(mapping[resultFaceIndex]).toBe(desiredValue);
    expect(mapping[1]).toBe(2); // 7 - 5 = 2

    // Check that all values 1-6 are present exactly once
    const sortedValues = [...mapping].sort();
    expect(sortedValues).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('correctly maps faces for a D6 with a different result face', () => {
    // If result face is 2 (right), and we want 3. Then opposite face 3 (left) must be 4.
    const desiredValue = 3;
    const resultFaceIndex = 2;
    const mapping = computeFaceMapping('d6', resultFaceIndex, desiredValue);

    expect(mapping[resultFaceIndex]).toBe(desiredValue);
    expect(mapping[3]).toBe(4); // 7 - 3 = 4

    // Check that all values 1-6 are present exactly once
    const sortedValues = [...mapping].sort();
    expect(sortedValues).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('correctly maps faces for a D4', () => {
    const desiredValue = 4;
    const resultFaceIndex = 0; // Bottom face for d4
    const mapping = computeFaceMapping('d4', resultFaceIndex, desiredValue);

    expect(mapping[resultFaceIndex]).toBe(desiredValue);

    // Check that all values 1-4 are present exactly once
    const sortedValues = [...mapping].sort();
    expect(sortedValues).toEqual([1, 2, 3, 4]);
  });

  it('correctly maps faces for a D20', () => {
    const desiredValue = 20;
    const resultFaceIndex = 5; // Arbitrary face
    const mapping = computeFaceMapping('d20', resultFaceIndex, desiredValue);

    expect(mapping[resultFaceIndex]).toBe(desiredValue);

    // Check that all values 1-20 are present exactly once
    const sortedValues = [...mapping].sort((a, b) => a - b);
    const expected = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(sortedValues).toEqual(expected);
  });
});
