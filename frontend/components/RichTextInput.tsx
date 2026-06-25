/**
 * RichTextInput — cross-platform rich text input for inline narration formatting.
 *
 * Web:    Uses a contentEditable div with document.execCommand('italic') for native
 *         cursor/selection/scroll behavior and inline italic formatting.
 * Native: Falls back to a plain TextInput (no inline formatting preview).
 */
import type { MessageBlock } from '../lib/messageParser';
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import {
  Platform,
  TextInput,
  StyleSheet,
  View,
} from 'react-native';
import { Colors, Fonts, Spacing, Radius } from '../theme';

export interface RichTextInputRef {
  /** Returns the plain text content (no HTML). */
  getText: () => string;
  /** Reads the DOM and returns structured message blocks directly from <i>/<em> tags. */
  getBlocks: () => MessageBlock[];
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

// ─── Web implementation ─────────────────────────────────────────────────────

function RichTextInputWeb(
  props: RichTextInputProps,
  ref: React.Ref<RichTextInputRef>
) {
  const { placeholder, maxLength, onChangeText, onSubmit, onNarrationChange, testID } = props;
  const divRef = useRef<HTMLDivElement>(null);
  const inputClass = 'rich-text-input';

  const getPlainText = useCallback((): string => {
    return divRef.current?.innerText?.replace(/\n$/, '') || '';
  }, []);

  const isItalicTag = (el: HTMLElement): boolean => {
    return el.tagName === 'I' || el.tagName === 'EM';
  };

  /** Walk the DOM and produce MessageBlock[] directly from <i>/<em> tags. */
  const getBlocks = useCallback((): MessageBlock[] => {
    const div = divRef.current;
    if (!div) return [];

    const blocks: MessageBlock[] = [];

    const walk = (node: Node, insideItalic: boolean) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (!text) return;
        blocks.push({ type: insideItalic ? 'narration' : 'message', content: text });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.tagName === 'BR') return;
        const nowItalic = insideItalic || isItalicTag(el);
        for (const child of Array.from(node.childNodes)) {
          walk(child, nowItalic);
        }
      }
    };

    for (const child of Array.from(div.childNodes)) {
      walk(child, false);
    }

    // Merge adjacent blocks of the same type
    const merged: MessageBlock[] = [];
    for (const b of blocks) {
      if (merged.length > 0 && merged[merged.length - 1].type === b.type) {
        merged[merged.length - 1].content += b.content;
      } else {
        merged.push({ ...b });
      }
    }
    return merged;
  }, []);

  const checkNarratingState = useCallback((): boolean => {
    try {
      return document.queryCommandState('italic');
    } catch {
      return false;
    }
  }, []);

  // Save the selection range so we can restore it if focus is lost (e.g. button click)
  const savedRangeRef = useRef<Range | null>(null);

  const toggleNarration = useCallback((): boolean => {
    const div = divRef.current;
    if (!div) return false;

    const sel = window.getSelection();

    // If focus was lost (selection outside div), restore the saved range
    if (!sel || sel.rangeCount === 0 || !div.contains(sel.anchorNode)) {
      div.focus();
      if (savedRangeRef.current && sel) {
        sel.removeAllRanges();
        sel.addRange(savedRangeRef.current);
      }
    }

    document.execCommand('italic', false);

    const isNow = checkNarratingState();
    onNarrationChange?.(isNow);
    onChangeText?.(getPlainText());
    return isNow;
  }, [checkNarratingState, onNarrationChange, onChangeText, getPlainText]);

  useImperativeHandle(ref, () => ({
    getText: getPlainText,
    getBlocks,
    clear: () => {
      if (divRef.current) {
        divRef.current.innerHTML = '';
        onNarrationChange?.(false);
      }
    },
    focus: () => divRef.current?.focus(),
    toggleNarration,
    isNarrating: checkNarratingState,
    restore: (text: string) => {
      if (divRef.current) {
        divRef.current.innerText = text;
      }
    },
  }), [getPlainText, getBlocks, toggleNarration, checkNarratingState, onNarrationChange]);

  const handleInput = useCallback(() => {
    const text = getPlainText();
    if (maxLength && text.length > maxLength) return;
    onChangeText?.(text);
    const isItalic = checkNarratingState();
    onNarrationChange?.(isItalic);
  }, [getPlainText, maxLength, onChangeText, checkNarratingState, onNarrationChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
    // Block Ctrl+B — only italic via Narrate button
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
    }
  }, [onSubmit]);

  const handleSelectionChange = useCallback(() => {
    const div = divRef.current;
    if (!div) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    if (!div.contains(sel.anchorNode)) return;

    // Save the range so we can restore it if focus is lost
    savedRangeRef.current = sel.getRangeAt(0).cloneRange();

    const isItalic = checkNarratingState();
    onNarrationChange?.(isItalic);
  }, [checkNarratingState, onNarrationChange]);

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [handleSelectionChange]);

  return (
    <View style={webStyles.container}>
      <style dangerouslySetInnerHTML={{ __html: `
        .${inputClass}[data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: ${Colors.outline};
          pointer-events: none;
        }
        .${inputClass} i, .${inputClass} em {
          color: ${Colors.tertiaryFixedDim};
          font-style: italic;
        }
      `}} />
      <div
        ref={divRef}
        className={inputClass}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput as any}
        onKeyDown={handleKeyDown as any}
        data-testid={testID}
        data-placeholder={placeholder}
        style={{
          flex: 1,
          fontFamily: Fonts.scribe,
          fontSize: 15,
          lineHeight: '20px',
          color: Colors.onSurface,
          padding: `${Spacing[2]}px ${Spacing[4]}px`,
          minHeight: 40,
          maxHeight: 100,
          overflowY: 'auto',
          outline: 'none',
          caretColor: Colors.primary,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        } as any}
      />
    </View>
  );
}

const webStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surfaceContainer,
    borderRadius: Radius.sm,
    minHeight: 40,
    maxHeight: 100,
    overflow: 'hidden',
  },
});

// ─── Native implementation (plain TextInput fallback) ───────────────────────

function RichTextInputNative(
  props: RichTextInputProps,
  ref: React.Ref<RichTextInputRef>
) {
  const { placeholder, maxLength, onChangeText, onSubmit, onNarrationChange, testID } = props;
  const inputRef = useRef<TextInput>(null);
  const textRef = useRef('');
  const narratingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    getText: () => textRef.current,
    getBlocks: () => textRef.current ? [{ type: 'message' as const, content: textRef.current }] : [],
    clear: () => {
      textRef.current = '';
      inputRef.current?.clear();
      narratingRef.current = false;
      onNarrationChange?.(false);
    },
    focus: () => inputRef.current?.focus(),
    toggleNarration: () => {
      narratingRef.current = !narratingRef.current;
      onNarrationChange?.(narratingRef.current);
      return narratingRef.current;
    },
    isNarrating: () => narratingRef.current,
    restore: (text: string) => {
      textRef.current = text;
    },
  }), [onNarrationChange]);

  const handleChangeText = useCallback((text: string) => {
    textRef.current = text;
    onChangeText?.(text);
  }, [onChangeText]);

  return (
    <View style={nativeStyles.container}>
      <TextInput
        ref={inputRef}
        style={[
          nativeStyles.input,
          narratingRef.current && { fontStyle: 'italic' as const, color: Colors.tertiaryFixedDim },
        ]}
        placeholder={placeholder}
        placeholderTextColor={Colors.outline}
        onChangeText={handleChangeText}
        selectionColor={Colors.primary}
        multiline
        maxLength={maxLength}
        testID={testID}
      />
    </View>
  );
}

const nativeStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surfaceContainer,
    borderRadius: Radius.sm,
    minHeight: 40,
    maxHeight: 100,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[2],
    paddingBottom: Spacing[2],
    fontFamily: Fonts.scribe,
    fontSize: 15,
    lineHeight: 20,
    color: Colors.onSurface,
    minHeight: 40,
  },
});

// ─── Platform export ────────────────────────────────────────────────────────

const RichTextInput = forwardRef<RichTextInputRef, RichTextInputProps>(
  Platform.OS === 'web' ? RichTextInputWeb : RichTextInputNative
);

RichTextInput.displayName = 'RichTextInput';

export default RichTextInput;
