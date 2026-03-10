// ========================================
// StockandCrypto - Notes Page Logic
// Supabase Integration
// ========================================

let currentUser = null;
let autoSaveTimer = null;
let currentNoteId = null;

document.addEventListener('DOMContentLoaded', function() {
  initializeNotesPage();
});

async function initializeNotesPage() {
  try {
    // Initialize Supabase
    await SupabaseClient.init();
    
    // Check auth state
    const { data: { user } } = await SupabaseClient.auth.getCurrentUser();
    currentUser = user;
    
    if (!currentUser) {
      showAuthRequired();
      return;
    }
    
    // Load notes
    await loadNotes();
    
    // Setup editor
    initializeNoteEditor();
    initializeAutoSave();
    
    // Update user info
    updateUserInfo();
    
  } catch (error) {
    console.error('Init error:', error);
    showToast('Failed to initialize. Please refresh.', 'error');
  }
}

function showAuthRequired() {
  const main = document.querySelector('main');
  main.innerHTML = `
    <div class="container" style="padding-top: 100px; text-align: center;">
      <div class="card" style="max-width: 400px; margin: 0 auto;">
        <div class="card-body">
          <h2 style="margin-bottom: 1rem;">🔐 Sign in Required</h2>
          <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
            Please sign in to access your notes and join the community chat.
          </p>
          <a href="login.html" class="btn btn-primary" style="width: 100%; margin-bottom: 0.5rem;">
            Sign In
          </a>
          <a href="register.html" class="btn btn-secondary" style="width: 100%;">
            Create Account
          </a>
        </div>
      </div>
    </div>
  `;
}

async function loadNotes(filter = {}) {
  try {
    const notes = await SupabaseClient.notes.get({
      ...filter,
      limit: 50
    });
    updateNotesList(notes);
    updateStats(notes);
  } catch (error) {
    console.error('Load notes error:', error);
    showToast('Failed to load notes', 'error');
  }
}

function updateNotesList(notes) {
  const tbody = document.querySelector('.data-table tbody');
  if (!tbody) return;
  
  if (!notes || notes.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">
          No notes yet. Create your first note!
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = notes.map(note => `
    <tr data-note-id="${note.id}">
      <td>
        <strong>${escapeHtml(note.title)}</strong>
        ${note.updated_at !== note.created_at ? '<span class="status-badge info" style="font-size: 0.65rem; margin-left: 0.5rem;">edited</span>' : ''}
      </td>
      <td>${escapeHtml(note.market)}</td>
      <td>
        ${(note.tags || []).map(tag => `<span class="status-badge info" style="font-size: 0.7rem;">${escapeHtml(tag)}</span>`).join(' ')}
      </td>
      <td style="color: var(--text-muted);">${formatDate(note.created_at)}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editNote('${note.id}')">Edit</button>
        <button class="btn btn-secondary btn-sm" onclick="deleteNoteConfirm('${note.id}')" style="margin-left: 0.25rem;">Delete</button>
      </td>
    </tr>
  `).join('');
}

function updateStats(notes) {
  const totalEl = document.querySelector('.card-body span[style*="font-weight: 600"]');
  if (!totalEl || !notes) return;
  
  // This is a simplified update - you could make it more sophisticated
  const totalNotes = notes.length;
  const thisWeek = notes.filter(n => {
    const created = new Date(n.created_at);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return created > weekAgo;
  }).length;
  
  const cryptoNotes = notes.filter(n => n.market === 'Crypto').length;
  const equityNotes = notes.filter(n => n.market === 'CN A-Shares' || n.market === 'US Equities').length;
  
  // Update stats in sidebar
  const statsElements = document.querySelectorAll('.card-body');
  if (statsElements[0]) {
    const stats = statsElements[0].querySelectorAll('div[style*="margin-bottom"]');
    if (stats[0]) stats[0].querySelector('span[style*="font-weight"]').textContent = totalNotes;
    if (stats[1]) stats[1].querySelector('span[style*="font-weight"]').textContent = '+' + thisWeek;
    if (stats[2]) stats[2].querySelector('span[style*="font-weight"]').textContent = cryptoNotes;
    if (stats[3]) stats[3].querySelector('span[style*="font-weight"]').textContent = equityNotes;
  }
}

function initializeNoteEditor() {
  const saveDraftBtn = document.querySelector('.card-header .btn-secondary');
  const publishBtn = document.querySelector('.card-header .btn-primary');
  
  if (saveDraftBtn) {
    saveDraftBtn.addEventListener('click', saveNote);
  }
  if (publishBtn) {
    publishBtn.addEventListener('click', saveNote);
  }
}

async function saveNote() {
  const noteData = getNoteData();
  
  if (!noteData.title.trim()) {
    showToast('Please enter a title', 'error');
    return;
  }
  
  try {
    let savedNote;
    if (currentNoteId) {
      // Update existing
      savedNote = await SupabaseClient.notes.update(currentNoteId, noteData);
      showToast('Note updated!', 'success');
    } else {
      // Create new
      savedNote = await SupabaseClient.notes.create(noteData);
      currentNoteId = savedNote.id;
      showToast('Note saved!', 'success');
    }
    
    // Reload list
    await loadNotes();
    
  } catch (error) {
    console.error('Save error:', error);
    showToast('Failed to save note', 'error');
  }
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
    content: contentTextarea ? contentTextarea.value : ''
  };
}

async function editNote(noteId) {
  try {
    const note = await SupabaseClient.notes.getOne(noteId);
    if (!note) {
      showToast('Note not found', 'error');
      return;
    }
    
    currentNoteId = noteId;
    
    // Populate form
    const titleInput = document.querySelector('input[placeholder="Note title..."]');
    const marketSelect = document.querySelector('.form-select');
    const tagsInput = document.querySelector('input[placeholder="Tags (comma separated)..."]');
    const contentTextarea = document.querySelector('textarea.form-textarea');
    
    if (titleInput) titleInput.value = note.title;
    if (marketSelect) marketSelect.value = note.market;
    if (tagsInput) tagsInput.value = (note.tags || []).join(', ');
    if (contentTextarea) contentTextarea.value = note.content || '';
    
    // Scroll to editor
    document.querySelector('.card').scrollIntoView({ behavior: 'smooth' });
    
    showToast('Editing note', 'info');
    
  } catch (error) {
    console.error('Edit error:', error);
    showToast('Failed to load note', 'error');
  }
}

async function deleteNoteConfirm(noteId) {
  if (!confirm('Are you sure you want to delete this note?')) return;
  
  try {
    await SupabaseClient.notes.delete(noteId);
    showToast('Note deleted', 'success');
    await loadNotes();
  } catch (error) {
    console.error('Delete error:', error);
    showToast('Failed to delete note', 'error');
  }
}

function initializeAutoSave() {
  const textarea = document.querySelector('textarea.form-textarea');
  const titleInput = document.querySelector('input[placeholder="Note title..."]');
  
  const autoSaveHandler = () => {
    // Save to localStorage as backup
    const noteData = getNoteData();
    localStorage.setItem('note_draft', JSON.stringify({
      ...noteData,
      savedAt: new Date().toISOString()
    }));
    console.log('Draft auto-saved to localStorage');
  };
  
  if (textarea) {
    textarea.addEventListener('input', debounce(autoSaveHandler, 3000));
  }
  if (titleInput) {
    titleInput.addEventListener('input', debounce(autoSaveHandler, 3000));
  }
  
  // Restore draft if exists
  restoreDraft();
}

function restoreDraft() {
  const draft = localStorage.getItem('note_draft');
  if (!draft) return;
  
  try {
    const data = JSON.parse(draft);
    const savedAt = new Date(data.savedAt);
    const now = new Date();
    
    // Only restore if draft is less than 24 hours old
    if (now - savedAt < 24 * 60 * 60 * 1000) {
      const titleInput = document.querySelector('input[placeholder="Note title..."]');
      const contentTextarea = document.querySelector('textarea.form-textarea');
      
      if (titleInput && !titleInput.value && data.title) {
        titleInput.value = data.title;
      }
      if (contentTextarea && !contentTextarea.value && data.content) {
        contentTextarea.value = data.content;
      }
    }
  } catch (e) {
    console.log('Could not restore draft');
  }
}

function updateUserInfo() {
  if (!currentUser) return;
  
  // You could update a user profile section here
  console.log('Logged in as:', currentUser.email);
}

// Helper functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function showToast(message, type = 'info') {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 24px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 10000;
    animation: slideIn 0.3s ease;
    background: ${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--error)' : 'var(--primary-accent)'};
  `;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Add CSS animation
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);
