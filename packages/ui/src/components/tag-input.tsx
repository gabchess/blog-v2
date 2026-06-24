import * as React from 'react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

import { cn } from '@workspace/ui/lib/utils';

type DedupeMode = 'case-insensitive' | 'case-sensitive' | false;

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  transform?: (raw: string) => string;
  className?: string;
  disabled?: boolean;
  /**
   * How to deduplicate incoming tokens against existing values.
   * - `'case-insensitive'` (default): collapses "Foo" against "foo". Right
   *   for hashtags, categories, anything where casing is incidental.
   * - `'case-sensitive'`: collapses exact matches only.
   * - `false`: never dedupe, required for fields like Members where two
   *   people can legitimately share a name. Callers using this mode should
   *   provide stable identity for re-keying (e.g. by storing `{id, name}`
   *   in their data model and projecting names into TagInput).
   */
  dedupe?: DedupeMode;
}

const defaultTransform = (raw: string) => raw.trim();

function TagInput({
  value,
  onChange,
  placeholder = 'Type and press Enter…',
  transform = defaultTransform,
  className,
  disabled,
  dedupe = 'case-insensitive',
}: TagInputProps) {
  const [draft, setDraft] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const addTokens = (raw: string) => {
    const tokens = raw
      .split(/[,\n\t]+/)
      .map(transform)
      .filter(Boolean);
    if (tokens.length === 0) return;
    if (dedupe === false) {
      onChange([...value, ...tokens]);
      return;
    }
    const norm = (s: string) => (dedupe === 'case-insensitive' ? s.toLowerCase() : s);
    const seen = new Set(value.map(norm));
    const next = [...value];
    for (const t of tokens) {
      const key = norm(t);
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(t);
    }
    if (next.length !== value.length) onChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const current = e.currentTarget.value;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (current.trim()) {
        addTokens(current);
        setDraft('');
      }
      return;
    }
    if (e.key === 'Backspace' && current === '' && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (/[,\n\t]/.test(text)) {
      e.preventDefault();
      addTokens(text);
      setDraft('');
    }
  };

  const handleBlur = () => {
    if (draft.trim()) {
      addTokens(draft);
      setDraft('');
    }
  };

  const remove = (index: number) => {
    const next = value.filter((_, i) => i !== index);
    onChange(next);
    inputRef.current?.focus();
  };

  // With dedupe on, the tag string itself is unique and stable. With dedupe
  // off, duplicates are legal; fall back to a positional key. Callers that
  // need stable identity in dedupe={false} mode should map their data into
  // unique-per-row strings before passing to value.
  const keyFor = (tag: string, i: number) => (dedupe === false ? `${i}:${tag}` : tag);

  return (
    <div
      className={cn(
        'border-input bg-input/20 focus-within:border-ring focus-within:ring-ring/30 dark:bg-input/30 flex w-full min-w-0 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 text-sm transition-colors focus-within:ring-2',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag, i) => (
        <span
          key={keyFor(tag, i)}
          className="border-border bg-background text-foreground inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] font-medium"
        >
          {tag}
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              remove(i);
            }}
            className="text-muted-foreground hover:bg-muted hover:text-foreground -mr-0.5 grid size-3.5 place-items-center rounded-full"
            aria-label={`Remove ${tag}`}
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-2.5" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={handleBlur}
        placeholder={value.length === 0 ? placeholder : ''}
        disabled={disabled}
        className="placeholder:text-muted-foreground h-5 min-w-[100px] flex-1 bg-transparent px-0.5 text-xs outline-none"
      />
    </div>
  );
}

export { TagInput };
