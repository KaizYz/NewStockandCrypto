(function() {
    'use strict';

    const WORKSPACE_MODES = {
        ALL: 'all',
        RECENT: 'recent',
        FAVORITES: 'favorites',
        DISCOVER: 'discover'
    };

    const TEMPLATES = {
        meeting: {
            title: 'Meeting Notes',
            content: ['## Summary', '', '- Purpose:', '- Key decisions:', '- Follow-up owner:', '', '## Discussion', '', '- ', '', '## Next actions', '', '- [ ] '].join('\n'),
            tags: ['meeting'],
            market: 'General'
        },
        research: {
            title: 'Research Note',
            content: ['## Thesis', '', 'Write the main idea here.', '', '## Evidence', '', '- ', '', '## Open questions', '', '- ', '', '## Next step', '', '- [ ] '].join('\n'),
            tags: ['research'],
            market: 'General'
        },
        daily: {
            title: 'Daily Capture',
            content: ['## Today', '', '- Focus:', '- Energy:', '', '## Notes', '', '- ', '', '## Follow-ups', '', '- [ ] '].join('\n'),
            tags: ['daily'],
            market: 'General'
        },
        project: {
            title: 'Project Note',
            content: ['## Goal', '', 'Describe the project outcome.', '', '## Working context', '', '- Scope:', '- Dependencies:', '', '## Tasks', '', '- [ ] ', '', '## References', '', '- '].join('\n'),
            tags: ['project'],
            market: 'General'
        }
    };

    const state = {
        authReady: false,
        currentUser: null,
        legacyUser: null,
        canEditWorkspace: false,
        mode: WORKSPACE_MODES.ALL,
        notes: [],
        discoverNotes: [],
        notebooks: [],
        selectedNotebookId: null,
        selectedTag: '',
        selectedTemplateKey: 'meeting',
        activeNoteId: null,
        activeNote: null,
        search: '',
        market: '',
        scope: 'current',
        sortBy: 'updated_at',
        sortOrder: 'desc',
        editorMode: 'edit',
        isBusy: false,
        dragImportDepth: 0,
        dragImportActive: false
    };

    const elements = {};

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        cacheElements();
        bindEvents();
        hydrateModeFromUrl();
        renderWorkspaceShell();

        try {
            await waitForDependencies();
            await syncAuth();
            await refreshWorkspace();
        } catch (error) {
            console.error('Failed to initialize notes workspace:', error);
            notify('error', 'Unable to load the notes workspace right now.');
            renderListEmpty('Workspace unavailable', 'Try refreshing the page in a moment.');
            renderEditorEmpty('Workspace unavailable', 'The note editor could not load.');
        }
    }

    function cacheElements() {
        [
            'notesPage', 'editorPanel', 'dragImportBanner', 'workspaceNav', 'notebookList', 'tagList',
            'noteList', 'workspaceSearch', 'sortSelect',
            'marketFilter', 'listScopeSelect', 'listEyebrow', 'listTitle', 'listDescription',
            'countAllNotes', 'countRecentNotes', 'countFavoriteNotes', 'countDiscoverNotes',
            'sidebarNewNoteBtn', 'topbarNewNoteBtn', 'jumpToDiscoverBtn', 'newNotebookBtn', 'renameNotebookBtn',
            'templateStrip', 'noteTitle', 'noteNotebook', 'noteTags', 'noteContent', 'notePreview',
            'noteMarket', 'notePublicToggle', 'noteFavoriteToggle', 'notePinToggle', 'shareLinkInput',
            'saveNoteBtn', 'deleteNoteBtn', 'clearDraftBtn', 'duplicateTemplateBtn', 'openDetailBtn',
            'noteImageUploadBtn', 'noteImageInput', 'importMarkdownBtn', 'importMarkdownInput', 'exportMarkdownBtn', 'exportPdfBtn',
            'editorStatus', 'editorTitle', 'editorDescription', 'editorEyebrow', 'editorGate', 'editorWorkspace',
            'markdownToolbar', 'noteMetaDetails'
        ].forEach((id) => {
            elements[id] = document.getElementById(id);
        });
    }

    async function waitForDependencies(timeout = 10000) {
        const started = Date.now();
        while (Date.now() - started < timeout) {
            if (window.Auth && window.SupabaseClient) {
                return;
            }
            await delay(100);
        }
        throw new Error('Notes dependencies load timeout');
    }

    async function syncAuth() {
        await window.SupabaseClient.init();
        const authState = window.Auth?.ready
            ? await window.Auth.ready()
            : (window.Auth?.getState?.() || {});

        state.authReady = true;
        state.currentUser = authState.user || authState.legacyUser || null;
        state.legacyUser = authState.legacyUser || null;
        state.canEditWorkspace = Boolean(authState.legacyUser);
        setDragImportState(false);
        renderAuthGate();
    }

    async function refreshWorkspace() {
        renderAuthGate();

        if (state.canEditWorkspace) {
            const [notebooks, notes] = await Promise.all([
                window.SupabaseClient.notebooks.list(),
                window.SupabaseClient.notes.get({ limit: 500 })
            ]);
            state.notebooks = notebooks || [];
            state.notes = notes || [];
            const hasSelectedNotebook = state.notebooks.some((item) => Number(item.id) === Number(state.selectedNotebookId));
            if ((!state.selectedNotebookId || !hasSelectedNotebook) && state.notebooks[0]) {
                state.selectedNotebookId = getDefaultNotebookId();
            }
        } else {
            state.notebooks = [];
            state.notes = [];
            state.selectedNotebookId = null;
            state.activeNote = null;
            state.activeNoteId = null;
        }

        const discoverPayload = await window.SupabaseClient.communityNotes.listIdeas({
            visibility: 'public',
            limit: 200,
            sortBy: 'updated_at',
            sortOrder: 'desc'
        });
        state.discoverNotes = discoverPayload.ideas || [];

        if (state.mode !== WORKSPACE_MODES.DISCOVER && !state.canEditWorkspace) {
            state.mode = WORKSPACE_MODES.ALL;
            updateUrlState();
        }

        renderWorkspace();
        await restoreSelectionFromUrl();
    }

    function renderWorkspaceShell() {
        renderListMeta();
        renderSidebarNav();
        renderNotebooks();
        renderTags();
        renderNotesList();
        renderEditor();
    }

    function bindEvents() {
        bindDragAndDropImport();

        document.addEventListener('auth:changed', async () => {
            try {
                await syncAuth();
                await refreshWorkspace();
            } catch (error) {
                console.error('Failed to refresh after auth change:', error);
            }
        });

        elements.workspaceNav?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-mode]');
            if (!button) return;
            setMode(button.dataset.mode);
        });

        elements.sidebarNewNoteBtn?.addEventListener('click', () => startNewNote());
        elements.topbarNewNoteBtn?.addEventListener('click', () => startNewNote());
        elements.jumpToDiscoverBtn?.addEventListener('click', () => setMode(WORKSPACE_MODES.DISCOVER));

        elements.workspaceSearch?.addEventListener('input', debounceValue((value) => {
            state.search = value;
            renderWorkspace();
        }, 160));

        elements.sortSelect?.addEventListener('change', (event) => {
            const [sortBy, sortOrder] = String(event.target.value || 'updated_at:desc').split(':');
            state.sortBy = sortBy || 'updated_at';
            state.sortOrder = sortOrder || 'desc';
            renderWorkspace();
        });

        elements.marketFilter?.addEventListener('change', (event) => {
            state.market = String(event.target.value || '');
            renderWorkspace();
        });

        elements.listScopeSelect?.addEventListener('change', (event) => {
            state.scope = String(event.target.value || 'current');
            renderWorkspace();
        });

        elements.templateStrip?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-template]');
            if (!button) return;
            state.selectedTemplateKey = button.dataset.template;
            applyTemplate(button.dataset.template);
        });

        elements.notebookList?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-notebook-id]');
            if (!button) return;
            state.selectedNotebookId = Number(button.dataset.notebookId);
            state.mode = WORKSPACE_MODES.ALL;
            renderWorkspace();
            updateUrlState();
        });

        elements.tagList?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-tag]');
            if (!button) return;
            state.selectedTag = state.selectedTag === button.dataset.tag ? '' : button.dataset.tag;
            renderWorkspace();
        });

        elements.noteList?.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-note-id]');
            if (!button) return;
            await selectNote(Number(button.dataset.noteId), button.dataset.source || 'workspace');
        });

        elements.newNotebookBtn?.addEventListener('click', async () => {
            if (!state.canEditWorkspace) {
                notify('info', 'Sign in to create notebooks.');
                return;
            }
            const name = window.prompt('Notebook name');
            if (!name || !name.trim()) return;
            try {
                await window.SupabaseClient.notebooks.create({ name: name.trim() });
                await refreshWorkspace();
                notify('success', 'Notebook created.');
            } catch (error) {
                console.error('Failed to create notebook:', error);
                notify('error', 'Unable to create notebook.');
            }
        });

        elements.renameNotebookBtn?.addEventListener('click', async () => {
            if (!state.canEditWorkspace || !state.selectedNotebookId) {
                notify('info', 'Select a notebook first.');
                return;
            }
            const notebook = state.notebooks.find((item) => Number(item.id) === Number(state.selectedNotebookId));
            if (!notebook) return;
            const nextName = window.prompt('Rename notebook', notebook.name);
            if (!nextName || !nextName.trim() || nextName.trim() === notebook.name) return;
            try {
                await window.SupabaseClient.notebooks.update(notebook.id, { name: nextName.trim() });
                await refreshWorkspace();
                notify('success', 'Notebook updated.');
            } catch (error) {
                console.error('Failed to rename notebook:', error);
                notify('error', 'Unable to rename notebook.');
            }
        });

        elements.markdownToolbar?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-format]');
            if (!button) return;
            applyMarkdownAction(button.dataset.format);
        });

        elements.saveNoteBtn?.addEventListener('click', async () => {
            await saveActiveNote();
        });

        elements.deleteNoteBtn?.addEventListener('click', async () => {
            if (!state.canEditWorkspace || !state.activeNoteId) return;
            if (!window.confirm('Delete this note permanently?')) return;
            try {
                await window.SupabaseClient.notes.delete(state.activeNoteId);
                notify('success', 'Note deleted.');
                state.activeNoteId = null;
                state.activeNote = null;
                await refreshWorkspace();
                startNewNote(false);
            } catch (error) {
                console.error('Failed to delete note:', error);
                notify('error', 'Unable to delete the note.');
            }
        });

        elements.clearDraftBtn?.addEventListener('click', () => {
            if (state.mode === WORKSPACE_MODES.DISCOVER) {
                state.activeNoteId = null;
                state.activeNote = null;
                renderEditor();
                return;
            }
            startNewNote();
        });

        elements.duplicateTemplateBtn?.addEventListener('click', () => {
            applyTemplate(state.selectedTemplateKey);
        });

        elements.noteImageUploadBtn?.addEventListener('click', () => {
            if (!state.canEditWorkspace) {
                notify('info', 'Sign in to upload images into your notes.');
                return;
            }
            elements.noteImageInput?.click();
        });

        elements.noteImageInput?.addEventListener('change', async (event) => {
            const files = Array.from(event.target.files || []).filter(Boolean);
            if (!files.length) return;
            try {
                await uploadNoteImages(files, 'picker');
            } catch (error) {
                console.error('Failed to upload note images:', error);
                notify('error', error.message || 'Unable to upload the selected image.');
            } finally {
                event.target.value = '';
            }
        });

        elements.importMarkdownBtn?.addEventListener('click', () => {
            if (!state.canEditWorkspace) {
                notify('info', 'Sign in to import markdown files.');
                return;
            }
            elements.importMarkdownInput?.click();
        });

        elements.importMarkdownInput?.addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                await importMarkdownFile(file);
            } catch (error) {
                console.error('Failed to import markdown:', error);
                notify('error', 'Unable to import that markdown file.');
            } finally {
                event.target.value = '';
            }
        });

        elements.exportMarkdownBtn?.addEventListener('click', () => {
            exportMarkdownDraft();
        });

        elements.exportPdfBtn?.addEventListener('click', async () => {
            await exportPdfDraft();
        });

        elements.openDetailBtn?.addEventListener('click', () => {
            if (!state.activeNote) return;
            if (state.mode === WORKSPACE_MODES.DISCOVER && state.activeNote.share_id) {
                window.location.href = `note-view.html?share=${encodeURIComponent(state.activeNote.share_id)}`;
                return;
            }
            window.location.href = `note-detail.html?id=${encodeURIComponent(state.activeNote.id)}`;
        });

        document.querySelectorAll('[data-editor-mode]').forEach((button) => {
            button.addEventListener('click', () => {
                state.editorMode = button.dataset.editorMode;
                renderEditorMode();
            });
        });

        elements.noteContent?.addEventListener('input', debounceValue(() => {
            if (state.editorMode !== 'edit') {
                renderEditorPreview();
            }
            updateEditorStatus();
        }, 120));
    }

    function bindDragAndDropImport() {
        document.addEventListener('dragenter', (event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            state.dragImportDepth += 1;
            if (state.canEditWorkspace) {
                setDragImportState(true);
            }
        });

        document.addEventListener('dragover', (event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = state.canEditWorkspace ? 'copy' : 'none';
            }
            if (state.canEditWorkspace) {
                setDragImportState(true);
            }
        });

        document.addEventListener('dragleave', (event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            state.dragImportDepth = Math.max(0, state.dragImportDepth - 1);
            if (!state.dragImportDepth) {
                setDragImportState(false);
            }
        });

        document.addEventListener('drop', async (event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            const imageFiles = getDroppedImageFiles(event.dataTransfer);
            const markdownFile = getDroppedMarkdownFile(event.dataTransfer);
            setDragImportState(false);

            if (!state.canEditWorkspace) {
                notify('info', 'Sign in to import markdown files or upload images into your workspace.');
                return;
            }

            if (imageFiles.length) {
                try {
                    await uploadNoteImages(imageFiles, 'drop');
                    if (markdownFile) {
                        notify('info', 'Images were uploaded. Markdown files in the same drop were ignored.');
                    }
                } catch (error) {
                    console.error('Failed to upload dropped images:', error);
                    notify('error', error.message || 'Unable to upload dropped images.');
                }
                return;
            }

            if (!markdownFile) {
                notify('info', 'Drop a PNG, JPG, GIF, WEBP, .md, .markdown, or .txt file.');
                return;
            }

            try {
                await importMarkdownFile(markdownFile);
            } catch (error) {
                console.error('Failed to import dropped markdown:', error);
                notify('error', 'Unable to import that markdown file.');
            }
        });

        window.addEventListener('blur', () => {
            setDragImportState(false);
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                setDragImportState(false);
            }
        });
    }

    function setMode(mode) {
        const nextMode = Object.values(WORKSPACE_MODES).includes(mode) ? mode : WORKSPACE_MODES.ALL;
        state.mode = nextMode;
        state.activeNote = null;
        state.activeNoteId = null;
        state.editorMode = nextMode === WORKSPACE_MODES.DISCOVER ? 'read' : 'edit';
        renderWorkspace();
        updateUrlState();
    }

    function renderWorkspace() {
        renderSidebarNav();
        renderNotebooks();
        renderTags();
        renderListMeta();
        renderNotesList();
        renderEditor();
    }

    function renderAuthGate() {
        if (!elements.editorGate || !elements.editorWorkspace) return;
        const showGate = !state.canEditWorkspace && state.mode !== WORKSPACE_MODES.DISCOVER;
        elements.editorGate.style.display = showGate ? 'flex' : 'none';
        elements.editorWorkspace.style.display = showGate ? 'none' : 'flex';
    }

    function renderSidebarNav() {
        document.querySelectorAll('#workspaceNav [data-mode]').forEach((button) => {
            button.classList.toggle('active', button.dataset.mode === state.mode);
        });

        const allNotes = getWorkspaceNotes();
        const recentNotes = allNotes.filter((note) => Boolean(note.last_opened_at));
        const favoriteNotes = allNotes.filter((note) => Boolean(note.is_favorite));

        setText('countAllNotes', String(allNotes.length));
        setText('countRecentNotes', String(recentNotes.length));
        setText('countFavoriteNotes', String(favoriteNotes.length));
        setText('countDiscoverNotes', String((state.discoverNotes || []).length));
    }

    function renderNotebooks() {
        if (!elements.notebookList) return;
        if (!state.canEditWorkspace) {
            elements.notebookList.innerHTML = `
                <div class="auth-shell">
                    <strong>Private notebooks live in your account</strong>
                    <p style="margin:0; color: var(--text-secondary); line-height:1.6;">Sign in to create notebooks, sort private notes, and keep a clean writing workspace.</p>
                </div>
            `;
            return;
        }

        if (!state.notebooks.length) {
            elements.notebookList.innerHTML = `
                <div class="workspace-empty">
                    <strong>No notebooks yet</strong>
                    <span>Create your first notebook to organize your notes.</span>
                </div>
            `;
            return;
        }

        const counts = countNotesPerNotebook(state.notes);
        elements.notebookList.innerHTML = state.notebooks.map((notebook) => `
            <button type="button" class="notebook-button ${Number(notebook.id) === Number(state.selectedNotebookId) && state.mode === WORKSPACE_MODES.ALL ? 'active' : ''}" data-notebook-id="${notebook.id}">
                <span class="notebook-button-main">
                    <span class="dot ${escapeHtml(notebook.color || 'gray')}"></span>
                    <span>${escapeHtml(notebook.name)}</span>
                </span>
                <span class="notebook-count">${counts[notebook.id] || 0}</span>
            </button>
        `).join('');
    }

    function renderTags() {
        if (!elements.tagList) return;
        const counts = buildTagCounts(state.canEditWorkspace ? state.notes : []);
        const tags = Object.entries(counts).sort((left, right) => right[1] - left[1]).slice(0, 10);

        if (!tags.length) {
            elements.tagList.innerHTML = '<div class="workspace-hint">Tags appear after you save and label notes.</div>';
            return;
        }

        elements.tagList.innerHTML = tags.map(([tag, count]) => `
            <button type="button" class="tag-button ${state.selectedTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}">
                <span class="sidebar-button-main">
                    <span class="dot gray"></span>
                    <span>#${escapeHtml(tag)}</span>
                </span>
                <span class="sidebar-count">${count}</span>
            </button>
        `).join('');
    }

    function renderListMeta() {
        const meta = getModeMeta();
        setText('listEyebrow', meta.eyebrow);
        setText('listTitle', meta.title);
        setText('listDescription', meta.description);
    }

    function renderNotesList() {
        if (!elements.noteList) return;
        const notes = getVisibleNotes();

        if (!notes.length) {
            if (!state.canEditWorkspace && state.mode !== WORKSPACE_MODES.DISCOVER) {
                renderListEmpty(
                    'Sign in to open your private workspace',
                    'Discover remains readable without signing in. Your notebooks, private drafts, and saved notes appear here after login.'
                );
                return;
            }

            const emptyCopy = state.mode === WORKSPACE_MODES.DISCOVER
                ? ['No shared notes yet', 'Published notes from the community will show up here once people share them.']
                : ['No notes match this view', 'Try another filter, clear the search, or create a new note from a template.'];
            renderListEmpty(emptyCopy[0], emptyCopy[1]);
            return;
        }

        elements.noteList.innerHTML = notes.map((note) => renderNoteRow(note)).join('');
    }

    function renderListEmpty(title, copy) {
        elements.noteList.innerHTML = `
            <div class="workspace-empty">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(copy)}</span>
            </div>
        `;
    }

    function renderNoteRow(note) {
        const source = state.mode === WORKSPACE_MODES.DISCOVER ? 'discover' : 'workspace';
        const notebookName = note.notebook?.name || findNotebookName(note.notebook_id);
        const updatedLabel = formatRelativeDate(note.last_opened_at || note.updated_at || note.created_at);
        const chips = [
            note.is_public ? '<span class="note-chip published">Published</span>' : '<span class="note-chip private">Private</span>',
            note.is_favorite ? '<span class="note-chip favorite">Favorite</span>' : '',
            notebookName ? `<span class="note-chip">${escapeHtml(notebookName)}</span>` : '',
            note.market && note.market !== 'General' ? `<span class="note-chip">${escapeHtml(note.market)}</span>` : ''
        ].filter(Boolean).join('');
        const tags = (note.tags || []).slice(0, 3).map((tag) => `<span class="note-chip">#${escapeHtml(tag)}</span>`).join('');

        return `
            <article class="note-row ${Number(note.id) === Number(state.activeNoteId) ? 'active' : ''}" data-note-id="${note.id}" data-source="${source}">
                <div class="note-row-top">
                    <div style="min-width:0;">
                        <h3>${escapeHtml(note.title || 'Untitled Note')}</h3>
                        <p>${escapeHtml(note.excerpt || buildExcerpt(note.content || ''))}</p>
                    </div>
                    <span class="workspace-hint">${escapeHtml(updatedLabel)}</span>
                </div>
                <div class="note-meta-line">${chips}</div>
                ${tags ? `<div class="note-meta-line">${tags}</div>` : ''}
                <div class="note-row-bottom" style="margin-top:0.75rem;">
                    <div class="workspace-hint">${note.stats?.read_minutes || estimateReadMinutes(note.content)} min read</div>
                    <div class="workspace-hint">${escapeHtml(source === 'discover' ? (note.author?.display_name || 'Shared note') : 'Workspace note')}</div>
                </div>
            </article>
        `;
    }

    function renderEditor() {
        renderAuthGate();
        if (!state.canEditWorkspace && state.mode !== WORKSPACE_MODES.DISCOVER) {
            return;
        }

        populateNotebookSelect();

        if (state.mode === WORKSPACE_MODES.DISCOVER) {
            renderDiscoverEditor();
            return;
        }

        if (!state.activeNote) {
            renderEditorDraft(buildDraftNote({
                notebook_id: getDefaultNotebookId() || ''
            }), false);
            return;
        }

        renderEditorDraft(state.activeNote, true);
    }

    function renderEditorDraft(note, isExisting) {
        applyEditorValues(note);
        applyEditorChrome({
            eyebrow: isExisting ? 'Workspace note' : 'New draft',
            title: isExisting ? 'Edit note' : 'Create note',
            description: isExisting
                ? 'Keep writing in markdown, move the note between notebooks, or publish it when it is ready.'
                : 'Start with a private note, then organize it with tags and a notebook.',
            isExisting,
            readOnly: false,
            status: ''
        });
    }

    function renderDiscoverEditor() {
        if (!state.activeNote) {
            renderEditorEmpty('Discover shared notes', 'Select a published note from the middle column to read it here.');
            return;
        }

        applyEditorValues(state.activeNote);
        applyEditorChrome({
            eyebrow: 'Discover',
            title: state.activeNote.title || 'Shared note',
            description: state.activeNote.author?.display_name
                ? `Published by ${state.activeNote.author.display_name}`
                : 'Published note',
            isExisting: true,
            readOnly: true,
            status: 'Discover is read-only. Open the detail page if you want a shareable reader view.'
        });
    }

    function renderEditorEmpty(title, copy) {
        applyEditorValues(buildDraftNote());
        applyEditorChrome({
            eyebrow: state.mode === WORKSPACE_MODES.DISCOVER ? 'Discover' : 'Editor',
            title,
            description: copy,
            isExisting: false,
            readOnly: state.mode === WORKSPACE_MODES.DISCOVER,
            status: copy
        });
    }

    function buildDraftNote(overrides = {}) {
        return {
            title: '',
            content: '',
            notebook_id: getDefaultNotebookId() || '',
            tags: [],
            market: 'General',
            is_public: false,
            is_favorite: false,
            is_pinned: false,
            share_id: '',
            ...overrides
        };
    }

    function getDefaultNotebookId() {
        return state.selectedNotebookId
            || state.notebooks.find((item) => item.is_default)?.id
            || state.notebooks[0]?.id
            || null;
    }

    function applyEditorValues(note) {
        const nextNote = buildDraftNote(note);
        setValue('noteTitle', nextNote.title || '');
        setValue('noteContent', nextNote.content || '');
        setValue('noteTags', Array.isArray(nextNote.tags) ? nextNote.tags.join(', ') : (nextNote.tags || ''));
        setValue('noteMarket', nextNote.market || 'General');
        setValue('shareLinkInput', nextNote.is_public && nextNote.share_id ? buildShareLink(nextNote.share_id) : '');
        if (elements.noteNotebook) {
            elements.noteNotebook.value = String(nextNote.notebook_id || getDefaultNotebookId() || '');
        }
        if (elements.notePublicToggle) elements.notePublicToggle.checked = Boolean(nextNote.is_public);
        if (elements.noteFavoriteToggle) elements.noteFavoriteToggle.checked = Boolean(nextNote.is_favorite);
        if (elements.notePinToggle) elements.notePinToggle.checked = Boolean(nextNote.is_pinned);
    }

    function applyEditorChrome(config) {
        const {
            eyebrow,
            title,
            description,
            isExisting,
            readOnly,
            status
        } = config;

        setText('editorEyebrow', eyebrow);
        setText('editorTitle', title);
        setText('editorDescription', description);
        setEditorDisabled(readOnly);

        if (elements.deleteNoteBtn) {
            elements.deleteNoteBtn.style.display = isExisting && !readOnly ? 'inline-flex' : 'none';
        }
        if (elements.openDetailBtn) {
            elements.openDetailBtn.style.display = isExisting ? 'inline-flex' : 'none';
        }

        if (status) {
            setText('editorStatus', status);
        } else {
            updateEditorStatus();
        }
        renderEditorMode();
    }

    function setEditorDisabled(disabled) {
        ['noteTitle', 'noteNotebook', 'noteTags', 'noteContent', 'noteMarket', 'notePublicToggle', 'noteFavoriteToggle', 'notePinToggle', 'saveNoteBtn', 'duplicateTemplateBtn', 'clearDraftBtn', 'noteImageUploadBtn', 'noteImageInput'].forEach((id) => {
            if (elements[id]) {
                elements[id].disabled = disabled;
            }
        });

        document.querySelectorAll('#markdownToolbar button').forEach((button) => {
            button.disabled = disabled;
        });
    }

    function renderEditorMode() {
        document.querySelectorAll('[data-editor-mode]').forEach((button) => {
            button.classList.toggle('active', button.dataset.editorMode === state.editorMode);
        });

        const readOnly = state.mode === WORKSPACE_MODES.DISCOVER;
        if (!readOnly) {
            setEditorDisabled(false);
            if (elements.deleteNoteBtn) {
                elements.deleteNoteBtn.disabled = !state.activeNoteId;
            }
        }

        const previewVisible = state.editorMode !== 'edit';
        if (elements.noteContent) {
            elements.noteContent.style.display = previewVisible ? 'none' : 'block';
        }
        if (elements.notePreview) {
            elements.notePreview.style.display = previewVisible ? 'block' : 'none';
            elements.notePreview.classList.toggle('reading', state.editorMode === 'read');
        }

        if (previewVisible) {
            renderEditorPreview();
        }
    }

    async function renderEditorPreview() {
        if (!elements.notePreview) return;
        const content = elements.noteContent?.value || '';
        if (!content.trim()) {
            elements.notePreview.innerHTML = '<div class="workspace-hint">Preview will appear here.</div>';
            return;
        }
        try {
            const html = window.MarkdownRenderer
                ? await window.MarkdownRenderer.renderSafe(content)
                : escapeHtml(content).replace(/\n/g, '<br>');
            elements.notePreview.innerHTML = html;
        } catch (error) {
            console.error('Failed to render markdown preview:', error);
            elements.notePreview.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
        }
    }

    function startNewNote(focus = true) {
        if (!state.canEditWorkspace) {
            notify('info', 'Sign in to create private notes.');
            return;
        }
        state.mode = WORKSPACE_MODES.ALL;
        state.activeNoteId = null;
        state.activeNote = null;
        state.editorMode = 'edit';
        renderWorkspace();
        updateUrlState();
        if (focus) {
            elements.noteTitle?.focus();
        }
    }

    async function selectNote(noteId, source = 'workspace') {
        try {
            if (source === 'discover') {
                state.activeNoteId = noteId;
                state.activeNote = state.discoverNotes.find((note) => Number(note.id) === Number(noteId)) || null;
                state.editorMode = 'read';
                renderWorkspace();
                return;
            }

            const note = await window.SupabaseClient.notes.getOne(noteId);
            if (!note) {
                throw new Error('Note not found');
            }
            state.activeNoteId = note?.id || null;
            state.activeNote = note || null;
            state.editorMode = 'edit';
            state.notes = state.notes.map((item) => Number(item.id) === Number(note.id) ? note : item);
            renderWorkspace();
            updateUrlState();
        } catch (error) {
            console.error('Failed to select note:', error);
            notify('error', 'Unable to open that note.');
        }
    }

    async function saveActiveNote() {
        if (!state.canEditWorkspace || state.isBusy) {
            return;
        }

        const payload = readEditorPayload();
        if (!payload.title.trim()) {
            notify('error', 'Add a title before saving.');
            elements.noteTitle?.focus();
            return;
        }

        state.isBusy = true;
        setButtonBusy(elements.saveNoteBtn, true, state.activeNoteId ? 'Saving...' : 'Creating...');

        try {
            const result = state.activeNoteId
                ? await window.SupabaseClient.notes.update(state.activeNoteId, payload)
                : await window.SupabaseClient.notes.create(payload);

            state.activeNoteId = result?.id || null;
            state.activeNote = result || null;
            await refreshWorkspace();
            if (state.activeNoteId) {
                await selectNote(state.activeNoteId, 'workspace');
            }
            notify('success', payload.is_public ? 'Note published.' : 'Note saved.');
        } catch (error) {
            console.error('Failed to save note:', error);
            notify('error', 'Unable to save the note.');
        } finally {
            state.isBusy = false;
            setButtonBusy(elements.saveNoteBtn, false, 'Save Note');
        }
    }

    function readEditorPayload() {
        return {
            notebook_id: elements.noteNotebook?.value ? Number(elements.noteNotebook.value) : null,
            title: String(elements.noteTitle?.value || '').trim(),
            content: String(elements.noteContent?.value || ''),
            tags: String(elements.noteTags?.value || '').split(',').map((tag) => tag.trim()).filter(Boolean),
            market: elements.noteMarket?.value || 'General',
            is_public: Boolean(elements.notePublicToggle?.checked),
            is_favorite: Boolean(elements.noteFavoriteToggle?.checked),
            is_pinned: Boolean(elements.notePinToggle?.checked)
        };
    }

    function populateNotebookSelect() {
        if (!elements.noteNotebook) return;
        if (!state.canEditWorkspace) {
            elements.noteNotebook.innerHTML = '<option value="">Private workspace only</option>';
            return;
        }

        elements.noteNotebook.innerHTML = state.notebooks.map((notebook) => `
            <option value="${notebook.id}">${escapeHtml(notebook.name)}</option>
        `).join('');

        if (state.activeNote?.notebook_id) {
            elements.noteNotebook.value = String(state.activeNote.notebook_id);
        } else if (state.selectedNotebookId) {
            elements.noteNotebook.value = String(state.selectedNotebookId);
        }
    }

    function getWorkspaceNotes() {
        return [...(state.notes || [])];
    }

    function getVisibleNotes() {
        const source = state.mode === WORKSPACE_MODES.DISCOVER ? [...state.discoverNotes] : [...state.notes];
        let filtered = source.filter((note) => {
            if (state.mode === WORKSPACE_MODES.RECENT) {
                return Boolean(note.last_opened_at);
            }
            if (state.mode === WORKSPACE_MODES.FAVORITES) {
                return Boolean(note.is_favorite);
            }
            if (state.mode === WORKSPACE_MODES.ALL && state.selectedNotebookId) {
                return Number(note.notebook_id) === Number(state.selectedNotebookId);
            }
            return true;
        });

        if (state.market) {
            filtered = filtered.filter((note) => String(note.market || '') === state.market);
        }
        if (state.scope === 'published') {
            filtered = filtered.filter((note) => Boolean(note.is_public));
        } else if (state.scope === 'private') {
            filtered = filtered.filter((note) => !note.is_public);
        }
        if (state.selectedTag) {
            filtered = filtered.filter((note) => (note.tags || []).includes(state.selectedTag));
        }
        if (state.search.trim()) {
            const term = state.search.trim().toLowerCase();
            filtered = filtered.filter((note) => {
                const haystack = [
                    note.title,
                    note.content,
                    note.excerpt,
                    note.market,
                    ...(note.tags || []),
                    note.notebook?.name,
                    note.author?.display_name
                ].join(' ').toLowerCase();
                return haystack.includes(term);
            });
        }

        filtered.sort((left, right) => compareNotes(left, right, state.sortBy, state.sortOrder));
        return filtered;
    }

    function getModeMeta() {
        const notebookName = findNotebookName(state.selectedNotebookId);
        if (state.mode === WORKSPACE_MODES.RECENT) {
            return {
                eyebrow: 'Recent',
                title: 'Recently opened',
                description: 'Jump back into notes you opened most recently.'
            };
        }
        if (state.mode === WORKSPACE_MODES.FAVORITES) {
            return {
                eyebrow: 'Favorites',
                title: 'Saved as important',
                description: 'Keep your most useful notes and drafts one click away.'
            };
        }
        if (state.mode === WORKSPACE_MODES.DISCOVER) {
            return {
                eyebrow: 'Discover',
                title: 'Shared notes',
                description: 'Browse published notes from the community without losing the private workspace feel.'
            };
        }
        return {
            eyebrow: notebookName ? `Notebook: ${notebookName}` : 'All Notes',
            title: notebookName || 'Your workspace',
            description: notebookName
                ? 'Filter your workspace to a single notebook while keeping the same editor and search flow.'
                : 'Browse personal notes, research memos, and private drafts in one writing workspace.'
        };
    }

    async function restoreSelectionFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const editId = params.get('edit') || params.get('note');
        if (editId && state.canEditWorkspace) {
            await selectNote(Number(editId), 'workspace');
            return;
        }

        if (!state.activeNoteId) {
            const notes = getVisibleNotes();
            if (state.mode === WORKSPACE_MODES.DISCOVER && notes[0]) {
                state.activeNoteId = notes[0].id;
                state.activeNote = notes[0];
                state.editorMode = 'read';
                renderEditor();
                return;
            }
            if (state.canEditWorkspace && notes[0] && state.mode !== WORKSPACE_MODES.DISCOVER) {
                await selectNote(Number(notes[0].id), 'workspace');
                return;
            }
            renderEditor();
        }
    }

    function hydrateModeFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const view = params.get('view');
        const mode = params.get('mode');

        if (view === 'shared') {
            state.mode = WORKSPACE_MODES.DISCOVER;
        } else if (view === 'my') {
            state.mode = WORKSPACE_MODES.ALL;
        } else if (Object.values(WORKSPACE_MODES).includes(mode)) {
            state.mode = mode;
        }
    }

    function updateUrlState() {
        const params = new URLSearchParams(window.location.search);
        if (state.mode === WORKSPACE_MODES.DISCOVER) {
            params.set('view', 'shared');
        } else {
            params.set('view', 'my');
        }
        params.delete('mode');
        if (state.activeNoteId && state.mode !== WORKSPACE_MODES.DISCOVER) {
            params.set('edit', String(state.activeNoteId));
        } else {
            params.delete('edit');
        }
        const nextUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState({}, '', nextUrl);
    }

    function applyTemplate(templateKey) {
        if (!state.canEditWorkspace) {
            notify('info', 'Sign in to create notes from templates.');
            return;
        }
        const template = TEMPLATES[templateKey];
        if (!template) return;
        state.selectedTemplateKey = templateKey;
        state.activeNote = null;
        state.activeNoteId = null;
        state.mode = WORKSPACE_MODES.ALL;
        renderWorkspace();
        setValue('noteTitle', template.title);
        setValue('noteContent', template.content);
        setValue('noteTags', template.tags.join(', '));
        setValue('noteMarket', template.market);
        state.editorMode = 'edit';
        renderEditorMode();
        updateEditorStatus('Template applied. Customize it before saving.');
        elements.noteTitle?.focus();
    }

    function isAcceptedImageFile(file) {
        if (!file) return false;
        const type = String(file.type || '').toLowerCase();
        return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type);
    }

    function getDroppedImageFiles(dataTransfer) {
        const files = Array.from(dataTransfer?.files || []);
        return files.filter((file) => isAcceptedImageFile(file));
    }

    function ensureEditableDraftForInsertion() {
        if (!state.canEditWorkspace) {
            throw new Error('Sign in to edit private notes.');
        }

        if (state.mode === WORKSPACE_MODES.DISCOVER) {
            state.mode = WORKSPACE_MODES.ALL;
            state.activeNoteId = null;
            state.activeNote = null;
            state.editorMode = 'edit';
            renderWorkspace();
            updateUrlState();
            return;
        }

        if (state.editorMode !== 'edit') {
            state.editorMode = 'edit';
            renderEditorMode();
        }
    }

    function buildImageAltText(fileName) {
        return String(fileName || 'image')
            .replace(/\.[^.]+$/i, '')
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || 'image';
    }

    function buildImageMarkdown(fileName, url) {
        return `![${buildImageAltText(fileName)}](${String(url || '').trim()})`;
    }

    function insertMarkdownAtCursor(markdownText) {
        const textarea = elements.noteContent;
        if (!textarea) return;

        const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
        const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : textarea.value.length;
        const before = textarea.value.slice(0, start);
        const after = textarea.value.slice(end);
        const needsLeadingBreak = before && !before.endsWith('\n');
        const needsTrailingBreak = after && !after.startsWith('\n');
        const wrapped = `${needsLeadingBreak ? '\n\n' : ''}${markdownText}${needsTrailingBreak ? '\n\n' : ''}`;

        textarea.setRangeText(wrapped, start, end, 'end');
        textarea.focus();
        renderEditorPreview();
        updateEditorStatus();
    }

    async function uploadNoteImages(files, source = 'picker') {
        const validFiles = Array.from(files || []).filter((file) => isAcceptedImageFile(file));
        if (!validFiles.length) {
            throw new Error('Please choose a PNG, JPG, GIF, or WEBP image.');
        }

        ensureEditableDraftForInsertion();
        setButtonBusy(elements.noteImageUploadBtn, true, 'Uploading...');

        try {
            const markdownLines = [];
            for (const file of validFiles) {
                const uploaded = await window.SupabaseClient.files.upload(file, 'note-image');
                markdownLines.push(buildImageMarkdown(uploaded.name || file.name, uploaded.url));
            }

            insertMarkdownAtCursor(markdownLines.join('\n\n'));
            updateEditorStatus('Image uploaded. Save the note when you are ready.');
            notify('success', `${validFiles.length} image${validFiles.length === 1 ? '' : 's'} uploaded from ${source}.`);
        } finally {
            setButtonBusy(elements.noteImageUploadBtn, false, 'Upload Image');
        }
    }

    async function importMarkdownFile(file) {
        if (!isAcceptedMarkdownFile(file)) {
            throw new Error('Unsupported markdown file type');
        }

        if (!state.canEditWorkspace) {
            notify('info', 'Sign in to import markdown files.');
            return;
        }

        const text = await file.text();
        const inferredTitle = String(file.name || '')
            .replace(/\.(md|markdown|txt)$/i, '')
            .replace(/[-_]+/g, ' ')
            .trim();

        if (state.mode === WORKSPACE_MODES.DISCOVER || !state.activeNoteId) {
            startNewNote(false);
        }

        if (!String(elements.noteTitle?.value || '').trim() && inferredTitle) {
            setValue('noteTitle', inferredTitle);
        }
        setValue('noteContent', text);
        state.editorMode = 'edit';
        renderEditorMode();
        updateEditorStatus('Markdown imported. Review the note and save when ready.');
        elements.noteContent?.focus();
        notify('success', 'Markdown imported.');
    }

    function exportMarkdownDraft() {
        const payload = readEditorPayload();
        if (!payload.content.trim() && !payload.title.trim()) {
            notify('info', 'Add some note content before exporting.');
            return;
        }

        const title = payload.title.trim() || 'untitled-note';
        const blob = new Blob([payload.content || ''], { type: 'text/markdown;charset=utf-8' });
        downloadBlob(blob, `${slugifyFileName(title)}.md`);
        notify('success', 'Markdown export ready.');
    }

    async function exportPdfDraft() {
        const payload = readEditorPayload();
        if (!payload.content.trim() && !payload.title.trim()) {
            notify('info', 'Add some note content before exporting.');
            return;
        }

        const title = payload.title.trim() || 'Untitled Note';
        let rendered = escapeHtml(payload.content || '').replace(/\n/g, '<br>');
        if (window.MarkdownRenderer) {
            try {
                rendered = await window.MarkdownRenderer.renderSafe(payload.content || '');
            } catch (error) {
                console.warn('PDF export markdown render fallback:', error);
            }
        }

        const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=980,height=1280');
        if (!printWindow) {
            notify('error', 'The browser blocked the PDF window. Please allow popups and try again.');
            return;
        }

        const tags = payload.tags.length
            ? `<div class="meta-row"><strong>Tags</strong><span>${escapeHtml(payload.tags.join(', '))}</span></div>`
            : '';
        const notebookName = findNotebookName(payload.notebook_id) || 'My Notes';
        const shareLine = payload.is_public && elements.shareLinkInput?.value
            ? `<div class="meta-row"><strong>Share</strong><span>${escapeHtml(elements.shareLinkInput.value)}</span></div>`
            : '';

        printWindow.document.open();
        printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: Georgia, 'Times New Roman', serif; color: #111827; margin: 0; background: #ffffff; }
.page { max-width: 860px; margin: 0 auto; padding: 48px 40px 64px; }
h1 { font-size: 34px; margin: 0 0 10px; }
.subtitle { color: #4b5563; font-family: Arial, sans-serif; line-height: 1.6; margin-bottom: 24px; }
.meta { display: grid; gap: 8px; padding: 16px 18px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 14px; margin-bottom: 24px; font-family: Arial, sans-serif; font-size: 14px; }
.meta-row { display: flex; gap: 12px; }
.meta-row strong { width: 86px; color: #111827; }
.content { line-height: 1.75; font-size: 16px; }
.content h1, .content h2, .content h3 { font-family: Arial, sans-serif; }
.content pre { background: #111827; color: #f9fafb; padding: 16px; border-radius: 12px; overflow: auto; }
.content code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
.content blockquote { border-left: 4px solid #cbd5e1; padding-left: 16px; color: #475569; margin-left: 0; }
.content table { width: 100%; border-collapse: collapse; margin: 16px 0; }
.content th, .content td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; }
@media print { .page { padding: 24px 20px; } }
</style>
</head>
<body>
<div class="page">
<h1>${escapeHtml(title)}</h1>
<p class="subtitle">Exported from the StockandCrypto Notes workspace. Use the browser print dialog and choose "Save as PDF".</p>
<div class="meta">
<div class="meta-row"><strong>Notebook</strong><span>${escapeHtml(notebookName)}</span></div>
<div class="meta-row"><strong>Metadata</strong><span>${escapeHtml(payload.market || 'General')}</span></div>
${tags}
${shareLine}
</div>
<div class="content">${rendered}</div>
</div>
</body>
</html>`);
        printWindow.document.close();
        printWindow.focus();
        window.setTimeout(() => {
            printWindow.print();
        }, 250);
        notify('success', 'PDF export opened. Choose "Save as PDF" in the print dialog.');
    }

    function applyMarkdownAction(action) {
        const textarea = elements.noteContent;
        if (!textarea || textarea.disabled) return;

        const selectionStart = textarea.selectionStart;
        const selectionEnd = textarea.selectionEnd;
        const selected = textarea.value.slice(selectionStart, selectionEnd);
        const wraps = {
            bold: ['**', '**', 'bold text'],
            italic: ['*', '*', 'italic text'],
            code: ['`', '`', 'code'],
            link: ['[', '](https://example.com)', 'link text'],
            heading: ['## ', '', 'Heading'],
            list: ['- ', '', 'List item'],
            quote: ['> ', '', 'Quote'],
            checklist: ['- [ ] ', '', 'Task']
        };
        const config = wraps[action];
        if (!config) return;
        const [prefix, suffix, placeholder] = config;
        textarea.setRangeText(`${prefix}${selected || placeholder}${suffix}`, selectionStart, selectionEnd, 'end');
        textarea.focus();
        renderEditorPreview();
    }

    function compareNotes(left, right, sortBy, sortOrder) {
        const dir = sortOrder === 'asc' ? 1 : -1;
        const leftValue = getNoteComparable(left, sortBy);
        const rightValue = getNoteComparable(right, sortBy);
        if (leftValue < rightValue) return -1 * dir;
        if (leftValue > rightValue) return 1 * dir;
        return 0;
    }

    function getNoteComparable(note, sortBy) {
        if (sortBy === 'title') {
            return String(note.title || '').toLowerCase();
        }
        if (sortBy === 'created_at') {
            return new Date(note.created_at || 0).getTime();
        }
        if (sortBy === 'last_opened_at') {
            return new Date(note.last_opened_at || note.updated_at || 0).getTime();
        }
        return new Date(note.updated_at || note.created_at || 0).getTime();
    }

    function countNotesPerNotebook(notes) {
        return (notes || []).reduce((accumulator, note) => {
            const notebookId = note.notebook_id;
            if (notebookId === undefined || notebookId === null) return accumulator;
            accumulator[notebookId] = (accumulator[notebookId] || 0) + 1;
            return accumulator;
        }, {});
    }

    function buildTagCounts(notes) {
        return (notes || []).reduce((accumulator, note) => {
            (note.tags || []).forEach((tag) => {
                accumulator[tag] = (accumulator[tag] || 0) + 1;
            });
            return accumulator;
        }, {});
    }

    function findNotebookName(notebookId) {
        if (!notebookId) return '';
        return state.notebooks.find((item) => Number(item.id) === Number(notebookId))?.name || '';
    }

    function formatRelativeDate(value) {
        if (!value) return 'No recent activity';
        const date = new Date(value);
        const diff = Date.now() - date.getTime();
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;
        if (diff < minute) return 'Just now';
        if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
        if (diff < day) return `${Math.max(1, Math.floor(diff / hour))}h ago`;
        if (diff < 7 * day) return `${Math.max(1, Math.floor(diff / day))}d ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function buildShareLink(shareId) {
        return `${window.location.origin}/note-view.html?share=${encodeURIComponent(shareId)}`;
    }

    function buildExcerpt(content, limit = 160) {
        const plain = String(content || '').replace(/[#>*_~`-]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (plain.length <= limit) return plain;
        return `${plain.slice(0, Math.max(0, limit - 3)).trim()}...`;
    }

    function estimateReadMinutes(content) {
        const plain = String(content || '').replace(/\s+/g, ' ').trim();
        const words = plain ? plain.split(' ').length : 0;
        return Math.max(1, Math.ceil(words / 200));
    }

    function slugifyFileName(value) {
        return String(value || 'untitled-note')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'untitled-note';
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 500);
    }

    function isFileDrag(event) {
        const transferTypes = Array.from(event?.dataTransfer?.types || []);
        return transferTypes.includes('Files');
    }

    function isAcceptedMarkdownFile(file) {
        if (!file) return false;
        const name = String(file.name || '');
        const type = String(file.type || '').toLowerCase();
        return /\.(md|markdown|txt)$/i.test(name)
            || type === 'text/markdown'
            || type === 'text/plain'
            || type === 'text/x-markdown';
    }

    function getDroppedMarkdownFile(dataTransfer) {
        const files = Array.from(dataTransfer?.files || []);
        return files.find((file) => isAcceptedMarkdownFile(file)) || null;
    }

    function setDragImportState(active) {
        state.dragImportActive = Boolean(active && state.canEditWorkspace);
        if (!state.dragImportActive) {
            state.dragImportDepth = 0;
        }
        elements.notesPage?.classList.toggle('drag-import-active', state.dragImportActive);
        elements.editorPanel?.classList.toggle('drag-import-target', state.dragImportActive);
        elements.editorWorkspace?.classList.toggle('drag-import-target', state.dragImportActive);
        elements.dragImportBanner?.classList.toggle('active', state.dragImportActive);
        if (elements.dragImportBanner) {
            elements.dragImportBanner.setAttribute('aria-hidden', state.dragImportActive ? 'false' : 'true');
        }
    }

    function updateEditorStatus(forcedMessage = '') {
        if (forcedMessage) {
            setText('editorStatus', forcedMessage);
            return;
        }
        const title = String(elements.noteTitle?.value || '').trim();
        const tags = String(elements.noteTags?.value || '').trim();
        const isPublic = Boolean(elements.notePublicToggle?.checked);
        const status = !title
            ? 'Add a title to keep the note easy to find later.'
            : isPublic
                ? 'This note will stay in your workspace and also appear in Discover once you save.'
                : tags
                    ? 'Saved tags will help you filter and organize this note later.'
                    : 'Private by default. Add tags, move notebooks, or publish only when it is ready.';
        setText('editorStatus', status);
    }

    function setButtonBusy(button, busy, label) {
        if (!button) return;
        button.disabled = busy;
        if (label) {
            button.textContent = label;
        }
    }

    function debounceValue(callback, delayMs) {
        let timer = null;
        return (eventOrValue) => {
            const value = typeof eventOrValue === 'string'
                ? eventOrValue
                : (eventOrValue?.target?.value ?? '');
            window.clearTimeout(timer);
            timer = window.setTimeout(() => callback(value), delayMs);
        };
    }

    function notify(type, message) {
        if (window.showToast?.[type]) {
            window.showToast[type](message, 2600);
            return;
        }
        console.log(`[${type}] ${message}`);
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function setText(id, value) {
        if (elements[id]) {
            elements[id].textContent = value;
        }
    }

    function setValue(id, value) {
        if (elements[id]) {
            elements[id].value = value;
        }
    }

    function delay(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }
})();
