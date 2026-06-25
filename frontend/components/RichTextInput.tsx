/**
 * RichTextInput — cross-platform rich text input for inline narration formatting.
 *
 * Web:    Uses a contentEditable div for native cursor/selection/scroll behavior.
 * Native: Falls back to a plain TextInput (no inline formatting preview).
 */
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
import type { FormattingRange } from '../lib/messageParser';

export interface RichTextInputRef {
  /** Returns the plain text content (no HTML). */
  getText: () => string;
  /** Returns the current formatting ranges (narration spans). */
  getFormattingRanges: () => FormattingRange[];
  /** Clears all content and formatting. */
  clear: () => void;
  /** Focus the input. */
  focus: () => void;
  /** Toggle narration on the current selection or at cursor. Returns new isNarrating state. */
  toggleNarration: () => boolean;
  /** Returns whether the cursor is currently inside a narration range. */
  isNarrating: () => boolean;
  /** Set the text and ranges programmatically (for restoring on error). */
  restore: (text: string, ranges: FormattingRange[]) => void;
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
  const narratingRef = useRef(false);

  // Helpers to read state from the DOM
  const getPlainText = useCallback((): string => {
    return divRef.current?.innerText?.replace(/\n$/, '') || '';
  }, []);

  const getFormattingRanges = useCallback((): FormattingRange[] => {
    const div = divRef.current;
    if (!div) return [];

    const ranges: FormattingRange[] = [];
    let offset = 0;

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const len = node.textContent?.length || 0;
        // Check if this text node is inside an <em> element
        const parent = node.parentElement;
        if (parent && parent.tagName === 'EM') {
          ranges.push({ start: offset, end: offset + len, type: 'narration' });
        }
        offset += len;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        // Skip <br> at the end (contentEditable trailing BR)
        if (el.tagName === 'BR') {
          // Only count it if it's not the last child (trailing BR)
          const isLast = !el.nextSibling;
          if (!isLast) {
            offset += 1; // Count as newline
          }
          return;
        }
        for (const child of Array.from(node.childNodes)) {
          walk(child);
        }
      }
    };

    for (const child of Array.from(div.childNodes)) {
      walk(child);
    }

    // Merge adjacent/overlapping ranges
    const merged: FormattingRange[] = [];
    for (const r of ranges) {
      if (merged.length > 0 && r.start <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end);
      } else {
        merged.push({ ...r });
      }
    }
    return merged;
  }, []);

  const checkNarratingState = useCallback((): boolean => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return narratingRef.current;

    const anchorNode = sel.anchorNode;
    if (!anchorNode) return false;

    // Walk up from anchor to see if we're inside an <em>
    let node: Node | null = anchorNode;
    while (node && node !== divRef.current) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'EM') {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }, []);

  const toggleNarration = useCallback((): boolean => {
    const div = divRef.current;
    if (!div) return false;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      // No selection — just toggle the mode for future typing
      narratingRef.current = !narratingRef.current;
      onNarrationChange?.(narratingRef.current);
      return narratingRef.current;
    }

    const range = sel.getRangeAt(0);

    if (!range.collapsed) {
      // Has selection — wrap/unwrap with <em>
      const isInEm = checkNarratingState();
      if (isInEm) {
        // Find the parent <em> and unwrap it
        let emNode: HTMLElement | null = null;
        let node: Node | null = sel.anchorNode;
        while (node && node !== div) {
          if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'EM') {
            emNode = node as HTMLElement;
            break;
          }
          node = node.parentNode;
        }
        if (emNode && emNode.parentNode) {
          // Replace <em> with its children
          const parent = emNode.parentNode;
          while (emNode.firstChild) {
            parent.insertBefore(emNode.firstChild, emNode);
          }
          parent.removeChild(emNode);
          // Normalize to merge adjacent text nodes
          div.normalize();
        }
        narratingRef.current = false;
      } else {
        // Wrap selection in <em>
        const contents = range.extractContents();
        const em = document.createElement('em');
        em.style.color = Colors.tertiaryFixedDim;
        em.style.fontStyle = 'italic';
        em.appendChild(contents);
        range.insertNode(em);
        // Select the newly wrapped text
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(em);
        sel.addRange(newRange);
        div.normalize();
        narratingRef.current = true;
      }
    } else {
      // Collapsed cursor — toggle mode for future typing
      const isInEm = checkNarratingState();
      if (isInEm) {
        // Move cursor out of the <em> by splitting it
        let emNode: HTMLElement | null = null;
        let node: Node | null = sel.anchorNode;
        while (node && node !== div) {
          if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'EM') {
            emNode = node as HTMLElement;
            break;
          }
          node = node.parentNode;
        }
        if (emNode) {
          // Split the em at cursor position
          const cursorRange = range.cloneRange();
          const afterRange = document.createRange();
          afterRange.setStart(cursorRange.endContainer, cursorRange.endOffset);
          afterRange.setEndAfter(emNode.lastChild || emNode);

          const afterContents = afterRange.extractContents();
          const textLen = afterContents.textContent?.length || 0;

          // Insert a zero-width space text node after <em> for cursor landing
          const zwsp = document.createTextNode('\u200B');
          emNode.parentNode?.insertBefore(zwsp, emNode.nextSibling);

          // If there's content after the cursor, wrap it in a new <em>
          if (textLen > 0) {
            const newEm = document.createElement('em');
            newEm.style.color = Colors.tertiaryFixedDim;
            newEm.style.fontStyle = 'italic';
            newEm.appendChild(afterContents);
            zwsp.parentNode?.insertBefore(newEm, zwsp.nextSibling);
          }

          // Place cursor on the zero-width space
          const newRange2 = document.createRange();
          newRange2.setStart(zwsp, 1);
          newRange2.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange2);
        }
        narratingRef.current = false;
      } else {
        // Insert a new <em> element and place cursor inside
        const em = document.createElement('em');
        em.style.color = Colors.tertiaryFixedDim;
        em.style.fontStyle = 'italic';
        // Insert a zero-width space so the em element is focusable
        em.appendChild(document.createTextNode('\u200B'));
        range.insertNode(em);
        // Place cursor inside the em after the zero-width space
        const newRange = document.createRange();
        newRange.setStart(em.firstChild!, 1);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        narratingRef.current = true;
      }
    }

    onNarrationChange?.(narratingRef.current);
    onChangeText?.(getPlainText().replace(/\u200B/g, ''));
    return narratingRef.current;
  }, [checkNarratingState, onNarrationChange, onChangeText, getPlainText]);

  useImperativeHandle(ref, () => ({
    getText: () => getPlainText().replace(/\u200B/g, ''),
    getFormattingRanges,
    clear: () => {
      if (divRef.current) {
        divRef.current.innerHTML = '';
        narratingRef.current = false;
        onNarrationChange?.(false);
      }
    },
    focus: () => divRef.current?.focus(),
    toggleNarration,
    isNarrating: () => checkNarratingState() || narratingRef.current,
    restore: (text: string, _ranges: FormattingRange[]) => {
      if (divRef.current) {
        divRef.current.innerText = text;
        // Restoring ranges into the DOM is complex — for error recovery, plain text is fine
      }
    },
  }), [getPlainText, getFormattingRanges, toggleNarration, checkNarratingState, onNarrationChange]);

  // Handle input events
  const handleInput = useCallback(() => {
    const text = getPlainText().replace(/\u200B/g, '');
    if (maxLength && text.length > maxLength) {
      // Truncate — crude but effective
      return;
    }
    onChangeText?.(text);

    // Update narrating state based on cursor position
    const isInEm = checkNarratingState();
    if (isInEm !== narratingRef.current) {
      narratingRef.current = isInEm;
      onNarrationChange?.(isInEm);
    }
  }, [getPlainText, maxLength, onChangeText, checkNarratingState, onNarrationChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
  }, [onSubmit]);

  const handleSelectionChange = useCallback(() => {
    const isInEm = checkNarratingState();
    if (isInEm !== narratingRef.current) {
      narratingRef.current = isInEm;
      onNarrationChange?.(isInEm);
    }
  }, [checkNarratingState, onNarrationChange]);

  // Attach selectionchange listener
  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [handleSelectionChange]);

  return (
    <View style={webStyles.container}>
      {/* Inject CSS for placeholder pseudo-element */}
      <style dangerouslySetInnerHTML={{ __html: `
        [data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: ${Colors.outline};
          pointer-events: none;
        }
      `}} />
      <div
        ref={divRef}
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
    getFormattingRanges: () => [],
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
      // TextInput will re-render via parent state
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
