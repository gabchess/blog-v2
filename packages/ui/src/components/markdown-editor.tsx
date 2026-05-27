import * as React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import {
  TextBoldIcon,
  TextItalicIcon,
  Heading02Icon,
  Heading03Icon,
  ListViewIcon,
  LeftToRightListBulletIcon,
  QuoteDownIcon,
  SourceCodeIcon,
  Link01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

import { cn } from '@workspace/ui/lib/utils';
import { Button } from '@workspace/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover';

interface MarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
  /**
   * URL validator wired into both `Link.configure({ isAllowedUri })` and the
   * link popover so paste/autolink/manual-insert all share one gate. Default
   * is a baseline http(s) + no-userinfo check.
   *
   * Must be referentially stable. Tiptap's `useEditor` does not have it in
   * a deps array, so the validator is captured once on first mount. Pass a
   * module-scoped function (or `useCallback` with stable deps), not an inline
   * arrow.
   */
  validateUrl?: (url: string) => boolean;
}

function defaultValidateUrl(url: string) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
}

interface BtnProps {
  icon: typeof TextBoldIcon;
  onClick: () => void;
  active?: boolean;
  label: string;
}

function Btn({ icon, onClick, active, label }: BtnProps) {
  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active ?? false}
      title={label}
      className={cn(
        'text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 place-items-center rounded transition-colors',
        active && 'bg-muted text-foreground',
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
    </button>
  );
}

function MarkdownEditor({
  value,
  onChange,
  placeholder,
  minHeight = 160,
  className,
  validateUrl = defaultValidateUrl,
}: MarkdownEditorProps) {
  // Hold onChange in a ref so the editor (created once) always sees the
  // latest closure without re-creating (which would lose selection/focus).
  // validateUrl is captured directly: the prop is documented as stable so
  // it's safe to read once on mount.
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        protocols: ['http', 'https'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        isAllowedUri: validateUrl,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? '',
        emptyEditorClass: 'is-editor-empty',
      }),
      Markdown.configure({
        html: false,
        linkify: true,
        breaks: true,
        transformPastedText: true,
      }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: 'tiptap-editable markdown-body focus:outline-none px-3 py-2.5',
        style: `min-height: ${minHeight}px`,
      },
    },
    onUpdate({ editor }) {
      // tiptap-markdown adds storage.markdown.getMarkdown()
      // @ts-expect-error tiptap-markdown augments storage at runtime
      const md: string = editor.storage.markdown.getMarkdown();
      onChangeRef.current(md);
    },
  });

  // Sync external value into the editor. Compare against the editor's *actual*
  // current markdown rather than a ref tracking the last emitted value: the
  // editor is seeded once at creation (often with '' before async data lands),
  // and a ref set before setContent could be poisoned if that first write
  // didn't take, permanently suppressing re-sync. Comparing live content also
  // makes the typing loopback a no-op (emitted markdown === current), so the
  // selection/cursor is preserved without a separate guard.
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // @ts-expect-error tiptap-markdown augments storage at runtime
    const current: string = editor.storage.markdown.getMarkdown();
    if (value === current) return;
    editor.commands.setContent(value || '', { emitUpdate: false });
  }, [editor, value]);

  if (!editor) {
    return (
      <div
        className={cn('border-input bg-input/20 dark:bg-input/30 rounded-md border', className)}
        style={{ minHeight: minHeight + 40 }}
      />
    );
  }

  return (
    <div
      className={cn(
        'border-input bg-input/20 focus-within:border-ring focus-within:ring-ring/30 dark:bg-input/30 flex flex-col rounded-md border transition-colors focus-within:ring-2',
        className,
      )}
    >
      <div className="border-border/60 flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
        <Btn
          icon={TextBoldIcon}
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          label="Bold"
        />
        <Btn
          icon={TextItalicIcon}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          label="Italic"
        />
        <span className="bg-border mx-0.5 h-4 w-px" />
        <Btn
          icon={Heading02Icon}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          label="Heading 2"
        />
        <Btn
          icon={Heading03Icon}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          label="Heading 3"
        />
        <span className="bg-border mx-0.5 h-4 w-px" />
        <Btn
          icon={LeftToRightListBulletIcon}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          label="Bulleted list"
        />
        <Btn
          icon={ListViewIcon}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          label="Numbered list"
        />
        <span className="bg-border mx-0.5 h-4 w-px" />
        <Btn
          icon={QuoteDownIcon}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          label="Quote"
        />
        <Btn
          icon={SourceCodeIcon}
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive('code')}
          label="Inline code"
        />
        <LinkPopover editor={editor} validate={validateUrl} />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

interface LinkPopoverProps {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  validate: (url: string) => boolean;
}

function LinkPopover({ editor, validate }: LinkPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState('');
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setTouched(false);
      return;
    }
    const previous = editor.getAttributes('link').href as string | undefined;
    setUrl(previous ?? '');
  }, [open, editor]);

  const isActive = editor.isActive('link');
  const isValid = url === '' || validate(url);
  const showError = touched && !isValid;

  const commit = () => {
    setTouched(true);
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setOpen(false);
      return;
    }
    if (!validate(url)) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    setOpen(false);
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          aria-label="Link"
          aria-pressed={isActive}
          title="Link"
          className={cn(
            'text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 place-items-center rounded transition-colors',
            isActive && 'bg-muted text-foreground',
          )}
        >
          <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2">
        <label className="text-foreground text-[11px] font-medium" htmlFor="md-editor-link-url">
          Link URL
        </label>
        <input
          id="md-editor-link-url"
          type="url"
          autoFocus
          inputMode="url"
          value={url}
          aria-invalid={showError ? true : undefined}
          aria-describedby={showError ? 'md-editor-link-error' : undefined}
          onChange={e => {
            setUrl(e.target.value);
            if (touched) setTouched(false);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="https://"
          className="border-input bg-input/20 focus:border-ring focus:ring-ring/30 dark:bg-input/30 h-7 rounded-md border px-2 text-xs outline-none focus:ring-2"
        />
        {showError && (
          <p id="md-editor-link-error" className="text-destructive text-[11px]">
            Enter a valid http(s) URL.
          </p>
        )}
        <div className="flex items-center justify-end gap-1.5">
          {isActive && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={remove}
            >
              Remove
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-7 text-[11px]"
            onClick={commit}
            disabled={url !== '' && !isValid}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { MarkdownEditor };
