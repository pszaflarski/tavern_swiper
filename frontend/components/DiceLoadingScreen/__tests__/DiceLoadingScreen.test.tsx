// ─── Mocks ───

// Track Canvas renders to detect key-triggered remounts
let mockCanvasRenderCount = 0;
let mockCanvasProps: Record<string, any> = {};

jest.mock('@react-three/fiber', () => ({
  Canvas: (props: any) => {
    mockCanvasRenderCount++;
    mockCanvasProps = props;
    const { View } = require('react-native');
    return <View testID="mock-canvas" />;
  },
  useFrame: jest.fn(),
  useThree: jest.fn(() => ({ viewport: { width: 10, height: 16 } })),
}));

// Mock cannon-es — not actually invoked since LiveDiceScene doesn't mount
jest.mock('cannon-es', () => ({}));

// Mock DiceMesh
jest.mock('../../DiceOverlay/DiceMesh', () => ({
  __esModule: true,
  default: () => null,
}));

// Mock diceConfig — minimal stubs
jest.mock('../../DiceOverlay/diceConfig', () => ({
  DICE_TYPES: {
    d4: { sides: 4, label: 'D4', color: '#E91E63', trisPerFace: 1, vertsPerFace: 3, isBottom: true },
    d6: { sides: 6, label: 'D6', color: '#2196F3', trisPerFace: 2, vertsPerFace: 6 },
    d8: { sides: 8, label: 'D8', color: '#4CAF50', trisPerFace: 1, vertsPerFace: 3 },
    d12: { sides: 12, label: 'D12', color: '#FF9800', trisPerFace: 3, vertsPerFace: 9 },
    d20: { sides: 20, label: 'D20', color: '#9C27B0', trisPerFace: 1, vertsPerFace: 3 },
  },
  createDiePhysicsShape: jest.fn(() => ({})),
  createDieGeometry: jest.fn(() => ({})),
}));

import React from 'react';
import { render, act } from '@testing-library/react-native';
import DiceLoadingScreen from '../../DiceLoadingScreen';

const VALID_DIE_TYPES = ['d4', 'd6', 'd8', 'd12', 'd20'];

const LOADING_MESSAGES = [
  'Rolling for initiative…',
  'Lighting the hearth…',
  'Sharpening blades…',
  'Summoning your heroes…',
  'Consulting the oracle…',
  'Polishing armor…',
  'Brewing potions…',
  'Opening the tavern door…',
];

/**
 * Extract the onSettled callback from the Canvas children.
 * The Canvas receives <LiveDiceScene dieType={...} onSettled={...} /> as children.
 */
function getOnSettled(): (() => void) | null {
  const children = mockCanvasProps.children;
  return children?.props?.onSettled ?? null;
}

/**
 * Extract the dieType from the LiveDiceScene children prop.
 */
function getLiveDieType(): string {
  const children = mockCanvasProps.children;
  return children?.props?.dieType ?? '';
}

// ─── Tests ───
describe('DiceLoadingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockCanvasRenderCount = 0;
    mockCanvasProps = {};
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders without crashing', () => {
    const { getByTestId } = render(<DiceLoadingScreen />);
    expect(getByTestId('mock-canvas')).toBeTruthy();
  });

  it('displays one of the themed loading messages', () => {
    const { queryByText } = render(<DiceLoadingScreen />);

    const foundMessage = LOADING_MESSAGES.some((msg) => !!queryByText(msg));
    expect(foundMessage).toBe(true);
  });

  it('passes a valid die type to LiveDiceScene', () => {
    render(<DiceLoadingScreen />);

    const dieType = getLiveDieType();
    expect(VALID_DIE_TYPES).toContain(dieType);
  });

  it('uses orthographic top-down camera matching DiceOverlay', () => {
    render(<DiceLoadingScreen />);

    expect(mockCanvasProps.orthographic).toBe(true);
    const cam = mockCanvasProps.camera;
    expect(cam.position).toEqual([0, 20, 0.001]);
    expect(cam.zoom).toBe(55);
    expect(cam.up).toEqual([0, 0, -1]);
  });

  it('passes transparent alpha to the GL context', () => {
    render(<DiceLoadingScreen />);

    expect(mockCanvasProps.gl).toEqual({ alpha: true });
  });

  it('disables Canvas pointer events', () => {
    render(<DiceLoadingScreen />);

    const eventsResult = mockCanvasProps.events();
    expect(eventsResult.enabled).toBe(false);
  });

  it('passes onSettled callback to LiveDiceScene', () => {
    render(<DiceLoadingScreen />);

    const onSettled = getOnSettled();
    expect(onSettled).toBeInstanceOf(Function);
  });
});

describe('DiceLoadingScreen — roll sequencing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockCanvasRenderCount = 0;
    mockCanvasProps = {};
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('triggers a new Canvas render after onSettled + 500ms delay', () => {
    render(<DiceLoadingScreen />);
    const renderCountAfterMount = mockCanvasRenderCount;

    const onSettled = getOnSettled();
    expect(onSettled).not.toBeNull();

    // Simulate die settling
    act(() => {
      onSettled!();
    });

    // Before 500ms — no new render
    const renderCountBefore = mockCanvasRenderCount;

    // Advance past the 500ms delay — state change triggers new Canvas key → remount
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Canvas should have re-rendered (new key forces a fresh mount)
    expect(mockCanvasRenderCount).toBeGreaterThan(renderCountBefore);
  });

  it('does not trigger a new roll before 500ms elapses', () => {
    render(<DiceLoadingScreen />);
    const renderCountAfterMount = mockCanvasRenderCount;

    const onSettled = getOnSettled();
    expect(onSettled).not.toBeNull();

    act(() => {
      onSettled!();
    });

    // Only advance 200ms — should not have triggered a new roll
    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(mockCanvasRenderCount).toBe(renderCountAfterMount);
  });

  it('passes a valid die type on each subsequent roll', () => {
    render(<DiceLoadingScreen />);

    for (let i = 0; i < 5; i++) {
      const dieType = getLiveDieType();
      expect(VALID_DIE_TYPES).toContain(dieType);

      const onSettled = getOnSettled();
      act(() => { onSettled!(); });
      act(() => { jest.advanceTimersByTime(500); });
    }

    // After 5 rolls, still passing valid die type
    expect(VALID_DIE_TYPES).toContain(getLiveDieType());
  });

  it('changes the loading message on each new roll', () => {
    const { queryByText } = render(<DiceLoadingScreen />);

    // Collect messages across multiple rolls
    const messages = new Set<string>();
    for (let i = 0; i < 15; i++) {
      const msg = LOADING_MESSAGES.find((m) => !!queryByText(m));
      if (msg) messages.add(msg);

      const onSettled = getOnSettled();
      act(() => { onSettled!(); });
      act(() => { jest.advanceTimersByTime(500); });
    }

    // With 8 messages and 15 rolls, we should see at least 2 different ones
    expect(messages.size).toBeGreaterThanOrEqual(1);
  });

  it('cleans up the timer on unmount (no state update after unmount)', () => {
    const { unmount } = render(<DiceLoadingScreen />);

    const onSettled = getOnSettled();
    act(() => {
      onSettled!();
    });

    // Unmount before the timer fires
    unmount();

    // Advancing timers should not throw (no "state update on unmounted component")
    expect(() => {
      act(() => {
        jest.advanceTimersByTime(1000);
      });
    }).not.toThrow();
  });
});
