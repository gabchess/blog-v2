import * as React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';

import { cn } from '@workspace/ui/lib/utils';

interface MarkdownViewProps {
  markdown: string;
  className?: string;
  /**
   * URL gate applied to rendered links via `Link.configure({ isAllowedUri })`.
   * Mirror MarkdownEditor: must be referentially stable. Defaults to a
   * baseline http(s) + no-userinfo check.
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

/**
 * Read-only render of markdown stored by `MarkdownEditor`. Same Tiptap
 * extensions as the editor so parsing is 1:1 with what the author saw.
 *
 * Server-side sanitization (`sanitizeProjectTextFields`) is the trust
 * boundary; this component is render-only and safe to mount on persisted
 * values. `Markdown.configure({ html: false })` plus `Link.isAllowedUri`
 * are defense-in-depth: even if an unsanitized value reaches here,
 * `<script>` tags in the source render as literal text.
 */
function MarkdownView({
  markdown,
  className,
  validateUrl = defaultValidateUrl,
}: MarkdownViewProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: true,
        protocols: ['http', 'https'],
        HTMLAttributes: {
          rel: 'noopener noreferrer nofollow ugc',
          target: '_blank',
          class: 'text-primary underline underline-offset-2 hover:text-primary/80',
        },
        isAllowedUri: validateUrl,
      }),
      Markdown.configure({
        html: false,
        linkify: true,
        breaks: true,
      }),
    ],
    editable: false,
    content: markdown || '',
  });

  React.useEffect(() => {
    if (!editor) return;
    // @ts-expect-error tiptap-markdown augments storage at runtime
    const current: string = editor.storage.markdown.getMarkdown();
    if (current === markdown) return;
    editor.commands.setContent(markdown || '', { emitUpdate: false });
  }, [editor, markdown]);

  if (!markdown) {
    return null;
  }

  return (
    <div className={cn('markdown-body text-sm leading-relaxed', className)}>
      <EditorContent editor={editor} />
    </div>
  );
}

export { MarkdownView };
