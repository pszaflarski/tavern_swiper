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
  });
});
