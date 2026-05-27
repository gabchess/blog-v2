// Regression for the "impact statement visible in the preview but blank in
// the editor" bug (PR #204).
//
// Root cause: MarkdownEditor seeds its Tiptap document once at creation
// (typically with '' before the async profile/application query resolves).
// The value-sync effect then has to push the real value in. The pre-fix
// effect gated on a `lastEmittedRef` assigned `value` *before* `setContent`
// ran, unconditionally of whether the write landed. If that first write hit a
// transiently-destroyed / not-yet-ready editor view (which @tiptap/react v3's
// scheduled destroy/recreate genuinely produces, observed in-browser as the
// value-sync effect running against an editor reporting `isDestroyed ===
// true`), the ref was permanently poisoned (`lastEmittedRef === value`) and
// every later render short-circuited, so the field stayed blank forever. The
// read-only preview uses a stateless MarkdownView that re-derives from live
// content, so it always showed the text: hence filled preview, empty
// editor, identical underlying data.
//
// The fix compares `value` against the editor's *live* markdown
// (`getMarkdown()`) instead of a poisonable ref, and skips destroyed editors,
// so a missed/failed write is retried on the next render with the same
// `value`. These tests model that exact sequence with a faithful fake editor.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React's public `act` requires this flag to flush effects synchronously.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// The mock is self-contained (state created inside the factory) and re-
// exported as `__control`, so the test and the mocked module share one
// object without any hoisting/TDZ concerns. `vi` is global (config
// `globals: true`), matching the repo's other vi.mock usages.
vi.mock('@tiptap/react', () => {
  interface FakeEditor {
    _doc: string;
    isDestroyed: boolean;
    storage: { markdown: { getMarkdown: () => string } };
    commands: { setContent: (content: unknown) => boolean };
    chain: () => Record<string, () => unknown>;
    isActive: () => boolean;
    getAttributes: () => Record<string, unknown>;
    on: () => void;
    off: () => void;
    destroy: () => void;
    setOptions: () => void;
  }

  const control: {
    editor: FakeEditor | null;
    missNextSetContent: boolean;
    setContentCalls: number;
    // When set, the next editor instance is created empty regardless of the
    // `content` option: models @tiptap/react v3 recreating the editor with a
    // not-ready view (the "parsed to an empty doc" case in the root cause).
    nextEditorEmpty: boolean;
  } = {
    editor: null,
    missNextSetContent: false,
    setContentCalls: 0,
    nextEditorEmpty: false,
  };

  const makeChain = (): Record<string, () => unknown> => {
    const c: Record<string, () => unknown> = {};
    for (const k of [
      'focus',
      'toggleBold',
      'toggleItalic',
      'toggleHeading',
      'toggleBulletList',
      'toggleOrderedList',
      'toggleBlockquote',
      'toggleCode',
      'extendMarkRange',
      'setLink',
      'unsetLink',
    ]) {
      c[k] = () => c;
    }
    c.run = () => true;
    return c;
  };

  const makeFakeEditor = (initial: string): FakeEditor => {
    const ed: FakeEditor = {
      _doc: initial,
      isDestroyed: false,
      storage: { markdown: { getMarkdown: () => ed._doc } },
      commands: {
        setContent: (content: unknown) => {
          control.setContentCalls += 1;
          if (ed.isDestroyed) return false; // Tiptap no-ops on destroyed
          if (control.missNextSetContent) {
            control.missNextSetContent = false;
            return false; // write did not land (not-ready / destroyed view)
          }
          ed._doc = typeof content === 'string' ? content : String(content ?? '');
          return true;
        },
      },
      chain: makeChain,
      isActive: () => false,
      getAttributes: () => ({}),
      on: () => {},
      off: () => {},
      destroy: () => {},
      setOptions: () => {},
    };
    return ed;
  };

  return {
    __control: control,
    // One stable fake per mounted editor, mirrors the real hook (content is
    // applied once at creation; later prop changes flow only through
    // MarkdownEditor's value-sync effect, the unit under test).
    useEditor: (options: { content?: string }) => {
      if (!control.editor) {
        const seed = control.nextEditorEmpty ? '' : (options?.content ?? '');
        control.nextEditorEmpty = false;
        control.editor = makeFakeEditor(seed);
      }
      return control.editor;
    },
    EditorContent: () => null,
  };
});

import * as tiptapReact from '@tiptap/react';
import { MarkdownEditor } from './markdown-editor';

interface Control {
  editor: { _doc: string; isDestroyed: boolean } | null;
  missNextSetContent: boolean;
  setContentCalls: number;
  nextEditorEmpty: boolean;
}
const control = (tiptapReact as unknown as { __control: Control }).__control;

// Read through a function so TS doesn't narrow `control.editor` to `null`
// from a `control.editor = null` assignment earlier in a test (the mocked
// useEditor repopulates it on the next render, which TS can't see).
const liveDoc = (): string | undefined => control.editor?._doc;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  control.editor = null;
  control.missNextSetContent = false;
  control.setContentCalls = 0;
  control.nextEditorEmpty = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(value: string) {
  act(() => {
    root.render(<MarkdownEditor value={value} onChange={() => {}} />);
  });
}

describe('MarkdownEditor external value sync', () => {
  it('renders a value that arrives after the editor was created', () => {
    render(''); // editor seeded empty (data not yet resolved)
    expect(liveDoc()).toBe('');
    render('Impact statement text'); // async value lands
    expect(liveDoc()).toBe('Impact statement text');
  });

  // The concretely-provable half of the fix. Pre-fix the value-sync effect
  // was `if (!editor) return;`, no isDestroyed guard, so when the effect
  // runs against a transiently-destroyed @tiptap/react v3 instance (which its
  // scheduled destroy/recreate genuinely produces; observed in-browser) it
  // still assigned `lastEmittedRef = value` and called `setContent` on the
  // dead editor. That write no-ops while the ref is now poisoned
  // (`lastEmittedRef === value`), so every later render short-circuits and
  // the field stays blank while the stateless preview shows the text. The
  // fix bails on `editor.isDestroyed`, so the ref is never poisoned and the
  // next live editor still syncs.
  it('never writes to (or syncs against) a destroyed editor', () => {
    render('');
    control.editor!.isDestroyed = true;
    const before = control.setContentCalls;
    render('Impact statement text'); // value changes → effect re-runs
    expect(control.setContentCalls).toBe(before); // bailed on isDestroyed
  });

  // The other half of the fix: comparing against the editor's *live* markdown
  // instead of a `lastEmittedRef`. @tiptap/react v3 genuinely replaces the
  // Editor instance on its scheduled destroy/recreate (refreshEditorInstance
  // → new Editor → MarkdownEditor's `editor` changes → the [editor, value]
  // effect re-runs). If that fresh instance comes up empty (a not-ready view
  // (the "parsed to an empty doc" case) while `value` is unchanged, the
  // pre-fix `value === lastEmittedRef.current` short-circuits and the new
  // editor stays blank forever even though the preview shows the text. The
  // live `getMarkdown()` compare re-syncs the replacement editor. This guards
  // the half that the destroyed-editor test above does not.
  it('re-syncs when the editor instance is replaced by an empty one', () => {
    render('Impact statement text'); // editor A seeded with the value
    expect(liveDoc()).toBe('Impact statement text');

    // @tiptap/react swaps in a fresh, empty Editor instance; `value` is
    // unchanged, so only the `editor` dep changes and the effect re-runs.
    control.editor = null;
    control.nextEditorEmpty = true;
    render('Impact statement text');

    expect(liveDoc()).toBe('Impact statement text');
  });
});
