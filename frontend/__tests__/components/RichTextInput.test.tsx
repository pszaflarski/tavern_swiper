import React, { createRef } from 'react';
import { render } from '@testing-library/react-native';
import RichTextInput, { RichTextInputRef } from '../../components/RichTextInput';

// Mutable mock functions and state shared with the jest.mock factory
const mockGetText = jest.fn();
const mockGetHTML = jest.fn();
const mockFocus = jest.fn();
const mockToggleItalic = jest.fn();
const mockSetContent = jest.fn();

let mockBridgeState = {
  isReady: true,
  isItalicActive: false,
  empty: true,
};

jest.mock('@10play/tentap-editor', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    RichText: (props: any) => React.createElement(View, props),
    useEditorBridge: () => ({
      focus: (...args: any[]) => mockFocus(...args),
      toggleItalic: (...args: any[]) => mockToggleItalic(...args),
      setContent: (...args: any[]) => mockSetContent(...args),
      injectCSS: jest.fn(),
      getText: (...args: any[]) => mockGetText(...args),
      getHTML: (...args: any[]) => mockGetHTML(...args),
    }),
    useBridgeState: () => mockBridgeState,
    CoreBridge: {},
    ItalicBridge: {},
    PlaceholderBridge: {
      configureExtension: () => ({}),
    },
    BridgeExtension: class {
      constructor() {}
      clone() { return this; }
      configureExtension() { return this; }
      configureCSS() { return this; }
      extendExtension() { return this; }
    },
  };
});

describe('RichTextInput Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetText.mockReset();
    mockGetHTML.mockReset();
    mockFocus.mockReset();
    mockToggleItalic.mockReset();
    mockSetContent.mockReset();

    mockGetText.mockResolvedValue('');
    mockGetHTML.mockResolvedValue('');

    mockBridgeState = {
      isReady: true,
      isItalicActive: false,
      empty: true,
    };
  });

  it('renders correctly', () => {
    const { getByTestId } = render(<RichTextInput testID="rich-text-input" />);
    expect(getByTestId('rich-text-input')).toBeTruthy();
  });

  describe('getText async API', () => {
    it('returns text content from editor', async () => {
      mockGetText.mockResolvedValue('Hello, world!');
      const ref = createRef<RichTextInputRef>();
      render(<RichTextInput ref={ref} />);

      const text = await ref.current?.getText();
      expect(text).toBe('Hello, world!');
      expect(mockGetText).toHaveBeenCalledTimes(1);
    });

    it('returns empty string if editor.getText fails', async () => {
      mockGetText.mockRejectedValue(new Error('Bridge error'));
      const ref = createRef<RichTextInputRef>();
      render(<RichTextInput ref={ref} />);

      const text = await ref.current?.getText();
      expect(text).toBe('');
    });
  });

  describe('getBlocks async parsing to JSON blocks', () => {
    it('parses dialogue text (no HTML tags) correctly', async () => {
      mockGetHTML.mockResolvedValue('<p>Hello traveler</p>');
      const ref = createRef<RichTextInputRef>();
      render(<RichTextInput ref={ref} />);

      const blocks = await ref.current?.getBlocks();
      expect(blocks).toEqual([
        { type: 'message', content: 'Hello traveler' }
      ]);
    });

    it('parses pure italic narration correctly', async () => {
      mockGetHTML.mockResolvedValue('<p><em>sighs deeply</em></p>');
      const ref = createRef<RichTextInputRef>();
      render(<RichTextInput ref={ref} />);

      const blocks = await ref.current?.getBlocks();
      expect(blocks).toEqual([
        { type: 'narration', content: 'sighs deeply' }
      ]);
    });

    it('parses mixed dialogue and narration correctly', async () => {
      mockGetHTML.mockResolvedValue('<p>Hello traveler <em>waves hand</em> Nice to meet you</p>');
      const ref = createRef<RichTextInputRef>();
      render(<RichTextInput ref={ref} />);

      const blocks = await ref.current?.getBlocks();
      expect(blocks).toEqual([
        { type: 'message', content: 'Hello traveler ' },
        { type: 'narration', content: 'waves hand' },
        { type: 'message', content: ' Nice to meet you' }
      ]);
    });

    it('parses text containing line breaks (br tags) correctly', async () => {
      mockGetHTML.mockResolvedValue('<p>Hello<br>traveler <em>sighs<br />deeply</em></p>');
      const ref = createRef<RichTextInputRef>();
      render(<RichTextInput ref={ref} />);

      const blocks = await ref.current?.getBlocks();
      expect(blocks).toEqual([
        { type: 'message', content: 'Hello\ntraveler ' },
        { type: 'narration', content: 'sighs\ndeeply' }
      ]);
    });
  });

  describe('editor actions', () => {
    it('calls focus on editor instance', () => {
      const ref = createRef<RichTextInputRef>();
      render(<RichTextInput ref={ref} />);

      ref.current?.focus();
      expect(mockFocus).toHaveBeenCalledTimes(1);
    });

    it('calls clear, triggers setContent and onNarrationChange', () => {
      const ref = createRef<RichTextInputRef>();
      const onNarrationChange = jest.fn();
      render(<RichTextInput ref={ref} onNarrationChange={onNarrationChange} />);

      ref.current?.clear();
      expect(mockSetContent).toHaveBeenCalledWith('');
      expect(onNarrationChange).toHaveBeenCalledWith(false);
    });

    it('toggles narration mode and returns updated value', () => {
      const ref = createRef<RichTextInputRef>();
      const onNarrationChange = jest.fn();
      render(<RichTextInput ref={ref} onNarrationChange={onNarrationChange} />);

      const nextItalicState = ref.current?.toggleNarration();
      expect(mockToggleItalic).toHaveBeenCalledTimes(1);
      expect(nextItalicState).toBe(true);
      expect(onNarrationChange).toHaveBeenCalledWith(true);
    });

    it('correctly reads narrating active status', () => {
      mockBridgeState.isItalicActive = true;
      const ref = createRef<RichTextInputRef>();
      render(<RichTextInput ref={ref} />);

      expect(ref.current?.isNarrating()).toBe(true);
    });

    it('has static height of 100', () => {
      const { getByTestId } = render(<RichTextInput testID="rich-text-input" />);
      const container = getByTestId('rich-text-input');
      const { StyleSheet } = require('react-native');
      const flatStyle = StyleSheet.flatten(container.props.style);
      expect(flatStyle.height).toBe(100);
    });

    it('sets up keydown event listener on the iframe contentWindow when OS is web', () => {
      const { Platform } = require('react-native');
      const originalOS = Platform.OS;
      Platform.OS = 'web';

      jest.useFakeTimers();

      const mockAddEventListener = jest.fn();
      const mockIframe = {
        contentWindow: {
          addEventListener: mockAddEventListener,
          removeEventListener: jest.fn(),
        },
      };

      const mockQuerySelector = jest.fn().mockReturnValue(mockIframe);
      const mockContainer = {
        querySelector: mockQuerySelector,
      };

      const ref = React.createRef<RichTextInputRef>();
      const onSubmit = jest.fn();
      render(<RichTextInput ref={ref} testID="rich-text-input" onSubmit={onSubmit} />);

      // Inject the mocked container directly into the exposed test ref
      if (ref.current?._containerRef) {
        ref.current._containerRef.current = mockContainer;
      }

      // Fast-forward to trigger interval setup
      jest.advanceTimersByTime(200);

      expect(mockQuerySelector).toHaveBeenCalledWith('iframe');
      expect(mockAddEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);

      const keydownHandler = mockAddEventListener.mock.calls[0][1];

      // Enter without Shift -> should trigger onSubmit and prevent default
      const mockEvent = {
        key: 'Enter',
        shiftKey: false,
        preventDefault: jest.fn(),
      };
      keydownHandler(mockEvent);
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(onSubmit).toHaveBeenCalled();

      // Enter with Shift -> should NOT trigger onSubmit or prevent default
      onSubmit.mockClear();
      const mockEventShift = {
        key: 'Enter',
        shiftKey: true,
        preventDefault: jest.fn(),
      };
      keydownHandler(mockEventShift);
      expect(mockEventShift.preventDefault).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();

      Platform.OS = originalOS;
      jest.useRealTimers();
    });
  });
});
