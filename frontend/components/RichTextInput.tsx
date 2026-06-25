/**
 * RichTextInput — cross-platform rich text input for inline narration formatting.
 *
 * Uses @10play/tentap-editor (TipTap/ProseMirror) inside a WebView for
 * consistent italic/narration behavior across web, Android, and iOS.
 * Only italic formatting is enabled — bold, lists, etc. are disabled.
 */
import type { MessageBlock } from '../lib/messageParser';
import { parseHTMLToBlocks } from '../lib/messageParser';
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
} from 'react';
import { StyleSheet, View } from 'react-native';
import {
  RichText,
  useEditorBridge,
  useBridgeState,
  CoreBridge,
  ItalicBridge,
  PlaceholderBridge,
  BridgeExtension,
} from '@10play/tentap-editor';
import { Colors, Fonts, Spacing, Radius } from '../theme';

export interface RichTextInputRef {
  /** Returns the plain text content (no HTML). Async — queries the editor bridge. */
  getText: () => Promise<string>;
  /** Returns structured message blocks with narration/message types. Async — queries the editor bridge. */
  getBlocks: () => Promise<MessageBlock[]>;
  /** Clears all content and formatting. */
  clear: () => void;
  /** Focus the input. */
  focus: () => void;
  /** Toggle narration on the current selection or at cursor. Returns new isNarrating state. */
  toggleNarration: () => boolean;
  /** Returns whether the cursor is currently inside a narration range. */
  isNarrating: () => boolean;
  /** Set the text programmatically (for restoring on error). */
  restore: (text: string) => void;
}

export interface RichTextInputProps {
  placeholder?: string;
  maxLength?: number;
  onChangeText?: (text: string) => void;
  onSubmit?: () => void;
  onNarrationChange?: (isNarrating: boolean) => void;
  testID?: string;
}

// CSS injected into the TipTap WebView to match the app's dark theme
const EDITOR_CSS = `
  html, body {
    margin: 0;
    padding: 0;
    background-color: ${Colors.surfaceContainer};
  }
  .ProseMirror {
    font-family: 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 15px;
    line-height: 20px;
    color: ${Colors.onPrimary}; /* Same color as regular talking messages (pure white) */
    padding: ${Spacing[2]}px ${Spacing[4]}px;
    min-height: 100px;
    max-height: 100px;
    overflow-y: auto;
    outline: none;
    caret-color: ${Colors.primary};
    word-break: break-word;
    background-color: ${Colors.surfaceContainer};
  }
  .ProseMirror p {
    margin: 0;
  }
  .ProseMirror em {
    font-style: italic;
    color: ${Colors.tertiaryFixed}; /* Gold color matching user narration messages */
  }
  .tiptap p.is-editor-empty:first-child::before,
  .ProseMirror p.is-editor-empty:first-child::before {
    color: ${Colors.outline};
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
  }
  /* Hide the WebView's default scrollbar on web */
  .ProseMirror::-webkit-scrollbar {
    display: none;
  }
`;

const CustomStylesExtension = new BridgeExtension({
  forceName: 'custom-styles-extension',
  extendCSS: EDITOR_CSS,
});

function RichTextInputInner(
  props: RichTextInputProps,
  ref: React.Ref<RichTextInputRef>
) {
  const { placeholder, maxLength, onChangeText, onSubmit, onNarrationChange, testID } = props;

  const editor = useEditorBridge({
    autofocus: false,
    avoidIosKeyboard: true,
    bridgeExtensions: [
      CoreBridge,
      ItalicBridge,
      PlaceholderBridge.configureExtension({
        placeholder: placeholder || 'Compose a missive...',
      }),
      CustomStylesExtension,
    ],
  });

  const editorState = useBridgeState(editor);

  // Use the push-based editorState.empty to notify parent of content changes.
  // This is reliable because bridge state subscriptions work (proven by isItalicActive).
  // We avoid async getText() queries on every keystroke — those fail silently on Web.
  const prevEmptyRef = useRef(true);
  useEffect(() => {
    const isEmpty = (editorState as any).empty ?? true;
    if (isEmpty !== prevEmptyRef.current) {
      prevEmptyRef.current = isEmpty;
      // Send a non-empty sentinel when the editor has content, empty string when empty.
      // The parent uses this to enable/disable the send button.
      onChangeText?.(isEmpty ? '' : ' ');
    }
  }, [(editorState as any).empty, onChangeText]);

  // Notify parent when italic state changes
  const prevItalicRef = useRef(false);
  useEffect(() => {
    const isItalic = editorState.isItalicActive;
    if (isItalic !== prevItalicRef.current) {
      prevItalicRef.current = isItalic;
      onNarrationChange?.(isItalic);
    }
  }, [editorState.isItalicActive, onNarrationChange]);

  useImperativeHandle(ref, () => ({
    getText: async () => {
      try { return await editor.getText(); } catch { return ''; }
    },
    getBlocks: async () => {
      try {
        const html = await editor.getHTML();
        return parseHTMLToBlocks(html);
      } catch { return []; }
    },
    clear: () => {
      editor.setContent('');
      onChangeText?.('');
      onNarrationChange?.(false);
    },
    focus: () => editor.focus(),
    toggleNarration: () => {
      editor.toggleItalic();
      const willBeItalic = !editorState.isItalicActive;
      onNarrationChange?.(willBeItalic);
      return willBeItalic;
    },
    isNarrating: () => editorState.isItalicActive,
    restore: (text: string) => {
      editor.setContent(`<p>${text}</p>`);
      onChangeText?.(text);
    },
  }), [editor, editorState.isItalicActive, onNarrationChange, onChangeText]);

  return (
    <View style={styles.container} testID={testID}>
      <RichText
        editor={editor}
        style={styles.richText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surfaceContainer,
    borderRadius: Radius.sm,
    height: 100,
    overflow: 'hidden',
  },
  richText: {
    flex: 1,
    backgroundColor: Colors.surfaceContainer,
  },
});

const RichTextInput = forwardRef<RichTextInputRef, RichTextInputProps>(RichTextInputInner);

RichTextInput.displayName = 'RichTextInput';

export default RichTextInput;
