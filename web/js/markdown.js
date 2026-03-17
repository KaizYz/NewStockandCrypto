// ========================================
// StockandCrypto - Markdown Rendering
// Stable local renderer without CDN dependencies
// ========================================

(function() {
    'use strict';

    function normalizeMarkdownSource(value) {
        return String(value || '')
            .replace(/\r\n?/g, '\n')
            .replace(/`r`n/g, '\n')
            .replace(/`n/g, '\n')
            .replace(/\\n/g, '\n')
            .trim();
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function inlineMarkdown(value) {
        let html = escapeHtml(value || '');

        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
            const safeHref = escapeHtml(href).replace(/javascript:/gi, '');
            return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        });
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^\*])\*([^*]+)\*/g, '$1<em>$2</em>');
        return html;
    }

    function renderBlocks(source) {
        if (!source) {
            return '';
        }

        const lines = source.split('\n');
        const blocks = [];
        let paragraph = [];
        let listItems = [];
        let listType = null;
        let quoteLines = [];
        let codeLines = [];
        let codeLanguage = '';
        let inCodeBlock = false;

        function flushParagraph() {
            if (!paragraph.length) return;
            const content = paragraph.join('\n');
            blocks.push(`<p>${inlineMarkdown(content).replace(/\n/g, '<br>')}</p>`);
            paragraph = [];
        }

        function flushList() {
            if (!listItems.length) return;
            const tag = listType === 'ol' ? 'ol' : 'ul';
            const items = listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('');
            blocks.push(`<${tag}>${items}</${tag}>`);
            listItems = [];
            listType = null;
        }

        function flushQuote() {
            if (!quoteLines.length) return;
            blocks.push(`<blockquote>${inlineMarkdown(quoteLines.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
            quoteLines = [];
        }

        function flushCode() {
            if (!codeLines.length && !inCodeBlock) return;
            const className = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : '';
            blocks.push(`<pre><code${className}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            codeLines = [];
            codeLanguage = '';
        }

        function flushAll() {
            flushParagraph();
            flushList();
            flushQuote();
        }

        for (const line of lines) {
            const fenceMatch = line.match(/^```([\w-]+)?\s*$/);
            if (fenceMatch) {
                if (inCodeBlock) {
                    flushCode();
                    inCodeBlock = false;
                } else {
                    flushAll();
                    inCodeBlock = true;
                    codeLanguage = fenceMatch[1] || '';
                    codeLines = [];
                }
                continue;
            }

            if (inCodeBlock) {
                codeLines.push(line);
                continue;
            }

            if (!line.trim()) {
                flushAll();
                continue;
            }

            const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
            if (headingMatch) {
                flushAll();
                const level = headingMatch[1].length;
                blocks.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
                continue;
            }

            if (/^---+$/.test(line.trim())) {
                flushAll();
                blocks.push('<hr>');
                continue;
            }

            if (/^>\s?/.test(line)) {
                flushParagraph();
                flushList();
                quoteLines.push(line.replace(/^>\s?/, ''));
                continue;
            }

            const unorderedMatch = line.match(/^[-*]\s+(.*)$/);
            if (unorderedMatch) {
                flushParagraph();
                flushQuote();
                if (listType && listType !== 'ul') flushList();
                listType = 'ul';
                listItems.push(unorderedMatch[1]);
                continue;
            }

            const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
            if (orderedMatch) {
                flushParagraph();
                flushQuote();
                if (listType && listType !== 'ol') flushList();
                listType = 'ol';
                listItems.push(orderedMatch[1]);
                continue;
            }

            flushList();
            flushQuote();
            paragraph.push(line);
        }

        if (inCodeBlock) {
            flushCode();
        }
        flushAll();

        return blocks.join('');
    }

    function sanitizeHtml(html) {
        const template = document.createElement('template');
        template.innerHTML = html;

        template.content.querySelectorAll('script,style,iframe,object,embed').forEach((node) => node.remove());
        template.content.querySelectorAll('*').forEach((node) => {
            [...node.attributes].forEach((attribute) => {
                const name = attribute.name.toLowerCase();
                const value = String(attribute.value || '');
                if (name.startsWith('on')) {
                    node.removeAttribute(attribute.name);
                }
                if ((name === 'href' || name === 'src') && value.toLowerCase().includes('javascript:')) {
                    node.removeAttribute(attribute.name);
                }
            });
        });

        return template.innerHTML;
    }

    async function ensureLibrariesLoaded() {
        return true;
    }

    async function renderMarkdown(text) {
        const source = normalizeMarkdownSource(text);
        return renderBlocks(source);
    }

    function renderMarkdownSafe(text) {
        return renderMarkdown(text).then((html) => sanitizeHtml(html));
    }

    function createMarkdownEditor(container, options = {}) {
        const {
            previewHeight = '300px',
            onPreview = null,
            debounceMs = 300
        } = options;

        const wrapper = document.createElement('div');
        wrapper.className = 'markdown-editor';

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'markdown-input-wrapper';

        const input = document.createElement('textarea');
        input.className = 'form-textarea markdown-input';
        input.placeholder = 'Write in Markdown... Supports **bold**, *italic*, `code`, [links](url), and more.';
        input.rows = 12;
        input.style.fontFamily = 'var(--font-mono)';

        const toolbar = document.createElement('div');
        toolbar.className = 'markdown-toolbar';
        toolbar.innerHTML = `
            <button type="button" data-action="bold" title="Bold (Ctrl+B)"><strong>B</strong></button>
            <button type="button" data-action="italic" title="Italic (Ctrl+I)"><em>I</em></button>
            <button type="button" data-action="code" title="Inline Code"><code>&lt;/&gt;</code></button>
            <button type="button" data-action="link" title="Link">Link</button>
            <button type="button" data-action="heading" title="Heading">H</button>
            <button type="button" data-action="list" title="List">-</button>
            <button type="button" data-action="quote" title="Quote">"</button>
            <button type="button" data-action="hr" title="Divider">--</button>
            <button type="button" data-action="image" title="Image">Image</button>
            <button type="button" data-action="table" title="Table">Table</button>
        `;

        const previewWrapper = document.createElement('div');
        previewWrapper.className = 'markdown-preview-wrapper';
        previewWrapper.style.display = 'none';

        const previewToggle = document.createElement('button');
        previewToggle.type = 'button';
        previewToggle.className = 'btn btn-secondary btn-sm';
        previewToggle.innerHTML = 'Preview';
        previewToggle.style.marginLeft = 'auto';

        const preview = document.createElement('div');
        preview.className = 'markdown-preview';
        preview.style.minHeight = previewHeight;
        preview.style.padding = '1rem';
        preview.style.background = 'rgba(255, 255, 255, 0.02)';
        preview.style.borderRadius = 'var(--radius-md)';
        preview.style.overflowY = 'auto';

        const style = document.createElement('style');
        style.textContent = `
            .markdown-toolbar {
                display: flex;
                gap: 0.25rem;
                padding: 0.5rem 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                margin-bottom: 0.5rem;
            }
            .markdown-toolbar button {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: var(--radius-sm);
                padding: 0.25rem 0.5rem;
                color: var(--text-secondary);
                cursor: pointer;
                font-size: 0.8rem;
                transition: all 0.2s;
            }
            .markdown-toolbar button:hover {
                background: rgba(0, 229, 255, 0.1);
                border-color: var(--accent-primary);
                color: var(--text-primary);
            }
            .markdown-preview h1 { font-size: 1.75rem; margin: 1rem 0 0.5rem; }
            .markdown-preview h2 { font-size: 1.5rem; margin: 1rem 0 0.5rem; }
            .markdown-preview h3 { font-size: 1.25rem; margin: 0.75rem 0 0.5rem; }
            .markdown-preview p { margin: 0.5rem 0; line-height: 1.6; }
            .markdown-preview ul, .markdown-preview ol { margin: 0.5rem 0; padding-left: 1.5rem; }
            .markdown-preview li { margin: 0.25rem 0; }
            .markdown-preview code {
                background: rgba(0, 0, 0, 0.3);
                padding: 0.15rem 0.4rem;
                border-radius: 4px;
                font-family: var(--font-mono);
                font-size: 0.85em;
            }
            .markdown-preview pre {
                background: rgba(0, 0, 0, 0.4);
                padding: 1rem;
                border-radius: var(--radius-md);
                overflow-x: auto;
                margin: 0.75rem 0;
            }
            .markdown-preview pre code { background: none; padding: 0; }
            .markdown-preview blockquote {
                border-left: 3px solid var(--accent-primary);
                padding-left: 1rem;
                margin: 0.75rem 0;
                color: var(--text-muted);
                font-style: italic;
            }
            .markdown-preview a { color: var(--accent-primary); text-decoration: underline; }
            .markdown-preview table {
                width: 100%;
                border-collapse: collapse;
                margin: 0.75rem 0;
            }
            .markdown-preview th, .markdown-preview td {
                border: 1px solid rgba(255, 255, 255, 0.1);
                padding: 0.5rem;
                text-align: left;
            }
            .markdown-preview th { background: rgba(0, 229, 255, 0.1); }
            .markdown-preview img { max-width: 100%; border-radius: var(--radius-md); }
            .markdown-preview hr {
                border: none;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                margin: 1rem 0;
            }
        `;
        document.head.appendChild(style);

        toolbar.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const action = btn.dataset.action;
            const actions = {
                bold: { prefix: '**', suffix: '**', placeholder: 'bold text' },
                italic: { prefix: '*', suffix: '*', placeholder: 'italic text' },
                code: { prefix: '`', suffix: '`', placeholder: 'code' },
                link: { prefix: '[', suffix: '](url)', placeholder: 'link text' },
                heading: { prefix: '## ', suffix: '', placeholder: 'Heading' },
                list: { prefix: '- ', suffix: '', placeholder: 'list item' },
                quote: { prefix: '> ', suffix: '', placeholder: 'quote' },
                hr: { prefix: '\n---\n', suffix: '', placeholder: '' },
                image: { prefix: '![', suffix: '](image-url)', placeholder: 'alt text' },
                table: { prefix: '| Header | Header |\n|--------|--------|\n| Cell   | Cell   |', suffix: '', placeholder: '' }
            };

            const selectedAction = actions[action];
            if (!selectedAction) return;

            const start = input.selectionStart;
            const end = input.selectionEnd;
            const selected = input.value.substring(start, end) || selectedAction.placeholder;
            input.value = input.value.substring(0, start) + selectedAction.prefix + selected + selectedAction.suffix + input.value.substring(end);
            input.focus();
            input.setSelectionRange(start + selectedAction.prefix.length, start + selectedAction.prefix.length + selected.length);
            updatePreview();
        });

        previewToggle.addEventListener('click', () => {
            const isHidden = previewWrapper.style.display === 'none';
            previewWrapper.style.display = isHidden ? 'block' : 'none';
            previewToggle.innerHTML = isHidden ? 'Edit' : 'Preview';
            if (isHidden) updatePreview();
        });

        let debounceTimer;
        async function updatePreview() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                const html = await renderMarkdownSafe(input.value);
                preview.innerHTML = html;
                if (onPreview) onPreview(html);
            }, debounceMs);
        }

        input.addEventListener('input', updatePreview);
        input.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'b') {
                    e.preventDefault();
                    toolbar.querySelector('[data-action="bold"]').click();
                } else if (e.key === 'i') {
                    e.preventDefault();
                    toolbar.querySelector('[data-action="italic"]').click();
                }
            }
        });

        const headerRow = document.createElement('div');
        headerRow.style.display = 'flex';
        headerRow.style.alignItems = 'center';
        headerRow.style.gap = '0.5rem';
        headerRow.appendChild(toolbar);
        headerRow.appendChild(previewToggle);

        inputWrapper.appendChild(headerRow);
        inputWrapper.appendChild(input);
        inputWrapper.appendChild(previewWrapper);
        previewWrapper.appendChild(preview);
        wrapper.appendChild(inputWrapper);

        if (container) {
            container.appendChild(wrapper);
        }

        return {
            wrapper,
            input,
            preview,
            getValue: () => input.value,
            setValue: (text) => {
                input.value = text;
                updatePreview();
            },
            getHTML: () => preview.innerHTML,
            focus: () => input.focus()
        };
    }

    window.MarkdownRenderer = {
        render: renderMarkdown,
        renderSafe: renderMarkdownSafe,
        createEditor: createMarkdownEditor,
        ensureLoaded: ensureLibrariesLoaded
    };

    console.log('MarkdownRenderer module loaded');
})();
