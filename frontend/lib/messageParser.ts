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

/**
 * Builds MessageBlock[] from plain text and formatting ranges.
 * Like buildJSONFromRanges but returns the array directly (for getBlocks()).
 */
export function buildBlocksFromRanges(text: string, ranges: FormattingRange[]): MessageBlock[] {
  if (!text) return [];
  if (ranges.length === 0) return [{ type: 'message', content: text }];

  const result: MessageBlock[] = [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);

  let lastIndex = 0;
  for (const range of sorted) {
    // Clamp to text bounds
    const start = Math.max(range.start, 0);
    const end = Math.min(range.end, text.length);
    if (start >= end) continue;

    if (start > lastIndex) {
      result.push({ type: 'message', content: text.substring(lastIndex, start) });
    }
    result.push({ type: 'narration', content: text.substring(start, end) });
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    result.push({ type: 'message', content: text.substring(lastIndex) });
  }

  return result;
}

/**
 * Merges overlapping or adjacent narration ranges into a minimal set.
 */
export function mergeRanges(ranges: FormattingRange[]): FormattingRange[] {
  if (ranges.length <= 1) return ranges;

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: FormattingRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.start <= last.end) {
      // Overlapping or adjacent — extend
      last.end = Math.max(last.end, curr.end);
    } else {
      merged.push({ ...curr });
    }
  }

  return merged;
}

/**
 * Checks whether a cursor position is inside any narration range.
 */
export function isInsideRange(position: number, ranges: FormattingRange[]): boolean {
  return ranges.some((r) => position > r.start && position <= r.end);
}

/**
 * Toggles narration for a selection span [start, end).
 * If the span is fully inside existing narration, removes it (punches a hole).
 * Otherwise, adds it and merges.
 */
export function toggleRangeAt(
  ranges: FormattingRange[],
  start: number,
  end: number
): { ranges: FormattingRange[]; added: boolean } {
  if (start === end) return { ranges, added: false };

  // Check if the entire selection is already fully narrated
  const fullyNarrated = isSelectionFullyNarrated(ranges, start, end);

  if (fullyNarrated) {
    // Remove narration from [start, end) — punch a hole in any covering ranges
    const result: FormattingRange[] = [];
    for (const r of ranges) {
      if (r.end <= start || r.start >= end) {
        // No overlap — keep as-is
        result.push({ ...r });
      } else {
        // Overlaps — split around the removed region
        if (r.start < start) {
          result.push({ start: r.start, end: start, type: 'narration' });
        }
        if (r.end > end) {
          result.push({ start: end, end: r.end, type: 'narration' });
        }
      }
    }
    return { ranges: result, added: false };
  } else {
    // Add narration for [start, end) and merge
    const newRanges = [...ranges, { start, end, type: 'narration' as const }];
    return { ranges: mergeRanges(newRanges), added: true };
  }
}

/**
 * Checks if a selection [start, end) is fully covered by narration ranges.
 */
function isSelectionFullyNarrated(ranges: FormattingRange[], start: number, end: number): boolean {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let covered = start;
  for (const r of sorted) {
    if (r.start > covered) return false; // gap
    if (r.start <= covered && r.end > covered) {
      covered = r.end;
    }
    if (covered >= end) return true;
  }
  return covered >= end;
}

/**
 * Parses TipTap/tentap-editor HTML output into MessageBlock[].
 *
 * Converts <em> tags to narration blocks and everything else to message blocks.
 * Handles nested paragraph tags by stripping them and treating content as inline.
 *
 * Example:
 *   "<p>hello <em>narrated</em> world</p>" →
 *   [{ type: 'message', content: 'hello ' },
 *    { type: 'narration', content: 'narrated' },
 *    { type: 'message', content: ' world' }]
 */
export function parseHTMLToBlocks(html: string): MessageBlock[] {
  if (!html) return [];

  // Convert br tags to newlines to preserve hard breaks
  let content = html.replace(/<br\s*\/?>/gi, '\n');

  // Strip paragraph wrapper tags — TipTap wraps everything in <p>
  content = content
    .replace(/<p>/g, '')
    .replace(/<\/p>/g, '')
    .trim();

  if (!content) return [];

  const blocks: MessageBlock[] = [];
  // Match <em>...</em> and <i>...</i> tags (TipTap uses <em> for italic)
  const regex = /<(?:em|i)>([\s\S]*?)<\/(?:em|i)>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Text before the italic tag
    if (match.index > lastIndex) {
      const text = stripHTMLTags(content.substring(lastIndex, match.index));
      if (text) blocks.push({ type: 'message', content: text });
    }
    // The italic content
    const italicText = stripHTMLTags(match[1]);
    if (italicText) blocks.push({ type: 'narration', content: italicText });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after the last italic tag
  if (lastIndex < content.length) {
    const text = stripHTMLTags(content.substring(lastIndex));
    if (text) blocks.push({ type: 'message', content: text });
  }

  return blocks;
}

/** Strip any remaining HTML tags from a string, keeping only text content. */
function stripHTMLTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}
