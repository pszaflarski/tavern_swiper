/**
 * Utility functions for parsing mixed narration and talk messages.
 */

export interface FormattingRange {
  start: number;
  end: number;
  type: 'narration';
}

export interface MessageBlock {
  type: 'message' | 'narration';
  content: string;
}

/**
 * Shifts formatting range indices after a text change to keep them in sync with typing.
 */
export function shiftRanges(
  ranges: FormattingRange[],
  oldText: string,
  newText: string,
  selectionStart: number,
  selectionEnd: number,
  isNarrating: boolean
): FormattingRange[] {
  const diff = newText.length - oldText.length;
  if (diff === 0) return ranges;

  const editIndex = selectionStart;
  const newRanges: FormattingRange[] = [];

  for (const range of ranges) {
    let { start, end } = range;

    if (diff > 0) {
      const insertedLen = diff;
      
      // Shift start
      if (start > editIndex) {
        start += insertedLen;
      } else if (start === editIndex) {
        if (!isNarrating) {
          start += insertedLen;
        }
      }

      // Shift end
      if (end > editIndex) {
        end += insertedLen;
      } else if (end === editIndex) {
        if (isNarrating) {
          end += insertedLen;
        }
      }
    } else {
      const deletedLen = -diff;
      // Shrink or adjust range boundaries affected by deletion
      if (start >= editIndex + deletedLen) {
        start -= deletedLen;
      } else if (start > editIndex) {
        start = editIndex;
      }

      if (end >= editIndex + deletedLen) {
        end -= deletedLen;
      } else if (end > editIndex) {
        end = editIndex;
      }
    }

    // Preserve range if it still has width
    if (start < end) {
      newRanges.push({ start, end, type: 'narration' });
    }
  }

  return newRanges;
}

/**
 * Builds the structured JSON message content string from plain text and formatting ranges.
 */
export function buildJSONFromRanges(text: string, ranges: FormattingRange[]): string {
  const result: MessageBlock[] = [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  
  let lastIndex = 0;
  for (const range of sorted) {
    if (range.start > lastIndex) {
      result.push({
        type: 'message',
        content: text.substring(lastIndex, range.start),
      });
    }
    result.push({
      type: 'narration',
      content: text.substring(range.start, range.end),
    });
    lastIndex = range.end;
  }
  
  if (lastIndex < text.length) {
    result.push({
      type: 'message',
      content: text.substring(lastIndex),
    });
  }
  
  return JSON.stringify(result);
}

/**
 * Converts a text containing <narrate>...</narrate> tags into a JSON array string.
 */
export function parseTextToJSON(text: string): string {
  const result: MessageBlock[] = [];
  const regex = /(<narrate>[\s\S]*?<\/narrate>)/g;
  const parts = text.split(regex);

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith('<narrate>') && part.endsWith('</narrate>')) {
      const cleanContent = part.slice(9, -10); // strip tags
      if (cleanContent) {
        result.push({ type: 'narration', content: cleanContent });
      }
    } else {
      result.push({ type: 'message', content: part });
    }
  }

  return JSON.stringify(result);
}

/**
 * Parses a message content string (which might be a JSON array string)
 * into a list of message blocks. Falls back to a single 'message' block.
 */
export function parseMessageContent(content: string): MessageBlock[] {
  if (!content) return [];
  
  if (content.startsWith('[') && content.endsWith(']')) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed as MessageBlock[];
      }
    } catch (e) {
      // Fail silently and fall back to plain text
    }
  }

  // Fallback: parse inline <narrate> tags if they exist in raw text
  if (content.includes('<narrate>')) {
    const result: MessageBlock[] = [];
    const regex = /(<narrate>[\s\S]*?<\/narrate>)/g;
    const parts = content.split(regex);

    for (const part of parts) {
      if (!part) continue;

      if (part.startsWith('<narrate>') && part.endsWith('</narrate>')) {
        const cleanContent = part.slice(9, -10);
        result.push({ type: 'narration', content: cleanContent });
      } else {
        result.push({ type: 'message', content: part });
      }
    }
    return result;
  }

  // Fallback: parse raw string into a single message block
  return [{ type: 'message', content }];
}

/**
 * Extracts a clean plain-text preview of a message, converting narration blocks
 * to standard asterisk-enclosed text.
 */
export function getMessagePreview(content: string): string {
  if (!content) return '';
  const blocks = parseMessageContent(content);
  return blocks
    .map((b) => (b.type === 'narration' ? `*${b.content}*` : b.content))
    .join('');
}
