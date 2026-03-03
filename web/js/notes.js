// ========================================
// StockandCrypto - Notes Page Logic
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    initializeNotesPage();
});

async function initializeNotesPage() {
    await loadNotes();
    initializeNoteEditor();
    initializeAutoSave();
}

async function loadNotes() {
    try {
        const notes = await api.getNotes(50);
        updateNotesList(notes);
    } catch (error) {
        console.log('Using simulated notes');
    }
}

function updateNotesList(notes) {
    // Would update the notes table in real implementation
}

function initializeNoteEditor() {
    const saveDraftBtn = document.querySelector('.card-header .btn-secondary');
    const publishBtn = document.querySelector('.card-header .btn-primary');
    
    if (saveDraftBtn) {
        saveDraftBtn.addEventListener('click', saveDraft);
    }
    
    if (publishBtn) {
        publishBtn.addEventListener('click', publishNote);
    }
}

function saveDraft() {
    const noteData = getNoteData();
    noteData.status = 'draft';
    console.log('Saving draft:', noteData);
    // Would save to API in real implementation
    showToast('Draft saved', 'success');
}

function publishNote() {
    const noteData = getNoteData();
    noteData.status = 'published';
    console.log('Publishing note:', noteData);
    // Would save to API in real implementation
    showToast('Note published', 'success');
}

function getNoteData() {
    const titleInput = document.querySelector('input[placeholder="Note title..."]');
    const marketSelect = document.querySelector('.form-select');
    const tagsInput = document.querySelector('input[placeholder="Tags (comma separated)..."]');
    const contentTextarea = document.querySelector('textarea.form-textarea');
    
    return {
        title: titleInput ? titleInput.value : '',
        market: marketSelect ? marketSelect.value : 'General',
        tags: tagsInput ? tagsInput.value.split(',').map(t => t.trim()).filter(t => t) : [],
        content: contentTextarea ? contentTextarea.value : '',
        timestamp: new Date().toISOString()
    };
}

function initializeAutoSave() {
    const textarea = document.querySelector('textarea.form-textarea');
    
    if (textarea) {
        textarea.addEventListener('input', utils.debounce(() => {
            autoSaveNote();
        }, 5000));
    }
}

function autoSaveNote() {
    console.log('Auto-saving note...');
    // Would auto-save to localStorage or API
}

function showToast(message, type = 'info') {
    // Simple toast implementation
    console.log(`[${type.toUpperCase()}] ${message}`);
}
