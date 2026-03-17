// ========================================
// StockandCrypto - Enhanced Community Chat
// Features: Edit/Delete, Reply, Reactions, 
// @Mentions, Typing, Search, Files
// ========================================

let currentUser = null;
let currentBoard = null;
let messageSubscription = null;
let reactionSubscription = null;
let presenceSubscription = null;
let typingTimeout = null;
let currentAuthState = null;
let legacyBoardPollTimer = null;

// Reaction labels
const REACTION_EMOJIS = ['Like', 'Love', 'Laugh', 'Wow', 'Sad', 'Celebrate', 'Rocket', 'Gem'];

document.addEventListener('DOMContentLoaded', function() {
    initializeEnhancedChat();
});

async function initializeEnhancedChat() {
    try {
        // Wait for SupabaseClient
        await waitForSupabaseClient();
        
        // Initialize Supabase
        await window.SupabaseClient.init();
        
        // Check auth
        currentAuthState = window.Auth?.ready
            ? await window.Auth.ready()
            : null;
        currentUser = currentAuthState?.user || currentAuthState?.legacyUser || await window.SupabaseClient.auth.getCurrentUser();
        updateAuthUI();
        
        // Load boards
        await loadBoards();
        await loadFeaturedIdeas();
        
        // Setup event listeners
        setupEnhancedEventListeners();
        
        // Request notification permission
        requestNotificationPermission();
        
    } catch (error) {
        console.error('Init error:', error);
        showToast('Failed to initialize chat', 'error');
    }
}

async function loadFeaturedIdeas() {
    const container = document.getElementById('ideasRail');
    if (!container || !window.SupabaseClient?.communityNotes) {
        return;
    }

    container.innerHTML = '<div class="muted-copy">Loading community ideas...</div>';

    try {
        const payload = await window.SupabaseClient.communityNotes.listIdeas({
            visibility: 'public',
            sortBy: 'updated_at',
            sortOrder: 'desc',
            limit: 6
        });
        const ideas = Array.isArray(payload?.ideas) ? payload.ideas : [];
        if (!ideas.length) {
            container.innerHTML = '<div class="muted-copy">No public ideas have been published yet.</div>';
            return;
        }

        container.innerHTML = ideas.map((idea) => `
            <a class="idea-rail-item" href="${idea.share_id ? `note-view.html?share=${idea.share_id}` : `note-detail.html?id=${idea.id}`}">
                <span class="status-badge ${getMarketBadgeTone(idea.market)}">${escapeHtml(idea.market || 'General')}</span>
                <h4>${escapeHtml(idea.title || 'Untitled idea')}</h4>
                <p>${escapeHtml(idea.excerpt || 'Open the article to read the full market thesis.')}</p>
            </a>
        `).join('');
    } catch (error) {
        console.error('Load featured ideas error:', error);
        container.innerHTML = '<div class="muted-copy">Featured ideas unavailable right now.</div>';
    }
}

function waitForSupabaseClient(timeout = 10000) {
    return new Promise((resolve, reject) => {
        if (typeof window.SupabaseClient !== 'undefined') {
            resolve();
            return;
        }
        const startTime = Date.now();
        const interval = setInterval(() => {
            if (typeof window.SupabaseClient !== 'undefined') {
                clearInterval(interval);
                resolve();
            } else if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                reject(new Error('SupabaseClient load timeout'));
            }
        }, 100);
    });
}

function updateAuthUI() {
    // Header auth UI is managed centrally by web/js/auth.js.
}

async function loadBoards() {
    try {
        const boards = await window.SupabaseClient.chat.getBoards();
        const customChannels = window.SupabaseClient.channels?.getPublic
            ? await window.SupabaseClient.channels.getPublic()
            : [];

        const uniqueBoards = new Map();
        [...(boards || []), ...(customChannels || [])].forEach((board) => {
            if (!board?.id) return;
            uniqueBoards.set(String(board.id), {
                ...uniqueBoards.get(String(board.id)),
                ...board
            });
        });

        const allBoards = Array.from(uniqueBoards.values());
        renderBoards(allBoards);
        
        // Load online users
        await loadOnlineUsers();
    } catch (error) {
        console.error('Load boards error:', error);
        renderDefaultBoards();
    }
}

function renderDefaultBoards() {
    const defaultBoards = [
        { id: 'crypto-main', name: 'Crypto General', topic: 'All things cryptocurrency', members: 0 },
        { id: 'btc', name: 'Bitcoin', topic: 'BTC price analysis and discussion', members: 0 },
        { id: 'eth', name: 'Ethereum', topic: 'ETH and DeFi ecosystem', members: 0 },
        { id: 'cn-equity', name: 'A-Shares', topic: 'Chinese stock market', members: 0 },
        { id: 'us-equity', name: 'US Stocks', topic: 'US equity markets', members: 0 },
        { id: 'trading', name: 'Trading Strategies', topic: 'Share your strategies', members: 0 }
    ];
    renderBoards(defaultBoards);
}

function renderBoards(boards) {
    const container = document.getElementById('boardsList');
    if (!container) return;

    if (!boards || boards.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 1rem; color: var(--text-muted);">No channels available</div>';
        return;
    }

    container.innerHTML = boards.map(board => `
        <div class="board-item" data-board-id="${board.id}" onclick="selectBoard('${board.id}', '${escapeHtml(board.name)}', '${escapeHtml(board.topic || '')}')">
            <div class="board-item-name">${escapeHtml(board.name)}</div>
            <div class="board-item-topic">${escapeHtml(board.topic || 'General discussion')}</div>
            <div class="board-item-members">${board.members || 0} members</div>
        </div>
    `).join('');
    
    // Add create channel button
    container.innerHTML += `
        <button class="btn btn-secondary btn-sm" style="width: 100%; margin-top: 1rem;" onclick="showCreateChannelModal()">
            + Create Channel
        </button>
    `;
}

async function loadOnlineUsers(channelId = null) {
    try {
        if (!window.SupabaseClient.presence?.getOnline) {
            renderOnlineUsers([]);
            return;
        }
        const users = await window.SupabaseClient.presence.getOnline(channelId);
        renderOnlineUsers(users);
    } catch (error) {
        console.error('Load online users error:', error);
        renderOnlineUsers([]);
    }
}

function renderOnlineUsers(users) {
    const container = document.getElementById('onlineUsersList');
    const countEl = document.getElementById('onlineCount');
    const countNumEl = document.getElementById('onlineCountNum');
    
    if (countNumEl) {
        countNumEl.textContent = String(users.length);
    } else if (countEl) {
        countEl.textContent = String(users.length);
    }
    
    if (container) {
        container.innerHTML = users.map(user => `
            <div class="online-user-item">
                <div class="online-dot"></div>
                <span>${escapeHtml(user.user_profiles?.username || user.profile?.username || 'Anonymous')}</span>
            </div>
        `).join('');
    }
}

function getMarketBadgeTone(market) {
    if (market === 'Crypto') return 'success';
    if (market === 'CN A-Shares') return 'warning';
    if (market === 'US Equities') return 'info';
    return 'secondary';
}

async function selectBoard(boardId, boardName, boardTopic) {
    // Update UI
    document.querySelectorAll('.board-item').forEach(el => el.classList.remove('active'));
    const selectedEl = document.querySelector(`[data-board-id="${boardId}"]`);
    if (selectedEl) selectedEl.classList.add('active');

    document.getElementById('currentBoardName').textContent = boardName;
    document.getElementById('currentBoardTopic').textContent = boardTopic || 'General discussion';

    currentBoard = { id: boardId, name: boardName, topic: boardTopic };

    if (!currentUser) {
        showAuthRequired(currentAuthState);
        return;
    }

    try {
        await window.SupabaseClient.chat.join(boardId);
    } catch (error) {
        console.warn('Join lounge skipped:', error);
    }

    // Show input area
    document.getElementById('inputArea').style.display = 'flex';
    document.getElementById('joinBtn').style.display = 'none';

    // Update presence
    await window.SupabaseClient.presence.update('online', boardId);

    // Unsubscribe from previous subscriptions
    if (messageSubscription) window.SupabaseClient.chat.unsubscribe(messageSubscription);
    if (reactionSubscription) window.SupabaseClient.chat.unsubscribe(reactionSubscription);
    if (presenceSubscription) window.SupabaseClient.chat.unsubscribe(presenceSubscription);
    if (legacyBoardPollTimer) {
        window.clearInterval(legacyBoardPollTimer);
        legacyBoardPollTimer = null;
    }

    // Load messages
    await loadMessages(boardId);

    if (isLegacyCommunitySession()) {
        legacyBoardPollTimer = window.setInterval(async () => {
            if (!currentBoard || String(currentBoard.id) !== String(boardId)) return;
            await loadMessages(boardId);
            await loadOnlineUsers(boardId);
        }, 5000);
    } else {
        // Subscribe to new messages
        messageSubscription = window.SupabaseClient.chat.subscribe(boardId, (message) => {
            appendMessage(message);
        });

        // Subscribe to reactions
        reactionSubscription = window.SupabaseClient.chat.subscribeReactions(boardId, (payload) => {
            handleReactionChange(payload);
        });

        // Subscribe to presence
        presenceSubscription = window.SupabaseClient.presence.subscribe(boardId, (payload) => {
            handlePresenceChange(payload);
        });
    }

    // Load online users for this channel
    await loadOnlineUsers(boardId);
}

function showAuthRequired(authState = null) {
    const legacyMismatch = Boolean(authState?.legacyMismatch);
    const title = legacyMismatch ? 'Session Refresh Required' : 'Sign in to Chat';
    const description = legacyMismatch
        ? 'Your site session is from an older login flow. Please sign in again to access Notes and Chat.'
        : 'You need to be signed in to participate in discussions.';
    const signInHref = legacyMismatch
        ? `login.html?reason=legacy-session&redirect=${encodeURIComponent('chat.html')}`
        : `login.html?redirect=${encodeURIComponent('chat.html')}`;

    const container = document.getElementById('messagesContainer');
    container.innerHTML = `
        <div class="empty-chat">
            <h3>${title}</h3>
            <p style="margin-bottom: 1rem;">${description}</p>
            <a href="${signInHref}" class="btn btn-primary">${legacyMismatch ? 'Refresh Sign In' : 'Sign In'}</a>
        </div>
    `;
    document.getElementById('inputArea').style.display = 'none';
    document.getElementById('joinBtn').style.display = 'inline-flex';
}

async function loadMessages(boardId) {
    try {
        const messages = await window.SupabaseClient.chat.getMessages(boardId, 100);
        renderMessages(messages || []);
    } catch (error) {
        console.error('Load messages error:', error);
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '<div class="empty-chat"><h3>Start the conversation</h3><p>Be the first to send a message!</p></div>';
    }
}

function renderMessages(messages) {
    const container = document.getElementById('messagesContainer');
    
    if (!messages || messages.length === 0) {
        container.innerHTML = '<div class="empty-chat"><h3>Start the conversation</h3><p>Be the first to send a message!</p></div>';
        return;
    }

    container.innerHTML = messages.map(msg => formatMessage(msg)).join('');
    container.scrollTop = container.scrollHeight;
}

function formatMessage(msg) {
    const isOwn = currentUser && msg.user_id === currentUser.id;
    const username = msg.users?.username || msg.profiles?.username || 'Anonymous';
    const avatar = username.charAt(0).toUpperCase();
    const time = new Date(msg.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    
    // Check for edited
    const editedBadge = msg.is_edited ? '<span class="edited-badge">(edited)</span>' : '';
    
    // Check for reply
    const replyHtml = msg.reply_to ? `
        <div class="message-reply-preview" onclick="scrollToMessage('${msg.reply_to.id}')">
            <strong>${escapeHtml(msg.reply_to.users?.username || msg.reply_to.profiles?.username || 'Anonymous')}</strong>
            <span>${escapeHtml(truncate(msg.reply_to.content, 50))}</span>
        </div>
    ` : '';
    
    // Check for attachment
    const attachmentHtml = msg.attachment_url ? formatAttachment(msg) : '';
    
    // Format mentions
    let content = msg.content || '';
    content = formatMentions(content);
    
    // Check if deleted
    if (msg.is_deleted) {
        return `
            <div class="message deleted" data-id="${msg.id}">
                <div class="message-content">
                    <em style="color: var(--text-muted);">This message was deleted</em>
                </div>
            </div>
        `;
    }

    return `
        <div class="message ${isOwn ? 'own' : ''}" data-id="${msg.id}">
            <div class="message-avatar">${avatar}</div>
            <div class="message-content">
                ${replyHtml}
                <div class="message-header">
                    <span class="message-username">${escapeHtml(username)}</span>
                    <span class="message-time">${time}</span>
                    ${editedBadge}
                </div>
                <div class="message-text">${content}</div>
                ${attachmentHtml}
                <div class="message-reactions" id="reactions-${msg.id}"></div>
            </div>
            <div class="message-actions">
                <button class="action-btn" onclick="showReplyUI('${msg.id}')" title="Reply">Reply</button>
                ${isOwn ? `
                    <button class="action-btn" onclick="editMessage('${msg.id}')" title="Edit">Edit</button>
                    <button class="action-btn" onclick="deleteMessage('${msg.id}')" title="Delete">Delete</button>
                ` : ''}
                <button class="action-btn" onclick="showReactionPicker('${msg.id}')" title="React">React</button>
            </div>
        </div>
    `;
}

function formatAttachment(msg) {
    if (msg.attachment_type === 'image') {
        return `<div class="message-attachment"><img src="${msg.attachment_url}" alt="Attachment" onclick="openImageModal('${msg.attachment_url}')"></div>`;
    }
    return `<div class="message-attachment"><a href="${msg.attachment_url}" target="_blank">Attachment: ${msg.attachment_name || 'File'}</a></div>`;
}

function formatMentions(content) {
    return content.replace(/@([a-zA-Z0-9_-]+)/g, '<span class="mention">@$1</span>');
}

function truncate(text, length) {
    if (!text) return '';
    return text.length > length ? text.substring(0, length) + '...' : text;
}

function appendMessage(message) {
    const container = document.getElementById('messagesContainer');
    const emptyState = container.querySelector('.empty-chat');
    if (emptyState) emptyState.remove();

    const msgHtml = formatMessage(message);
    container.insertAdjacentHTML('beforeend', msgHtml);
    container.scrollTop = container.scrollHeight;

    // Play notification sound if not own message
    if (message.user_id !== currentUser?.id) {
        playMessageSound();
        
        // Show browser notification
        showBrowserNotification(message);
    }
}

function handleReactionChange(payload) {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    const messageId = newRecord?.message_id || oldRecord?.message_id;
    
    if (messageId) {
        loadMessageReactions(messageId);
    }
}

async function loadMessageReactions(messageId) {
    const reactions = await window.SupabaseClient.chat.getReactions(messageId);
    renderReactions(messageId, reactions);
}

function renderReactions(messageId, reactions) {
    const container = document.getElementById(`reactions-${messageId}`);
    if (!container) return;

    // Group by emoji
    const grouped = {};
    reactions.forEach(r => {
        if (!grouped[r.emoji]) grouped[r.emoji] = [];
        grouped[r.emoji].push(r);
    });

    container.innerHTML = Object.entries(grouped).map(([emoji, users]) => {
        const hasReacted = users.some(u => u.user_id === currentUser?.id);
        return `
            <button class="reaction-badge ${hasReacted ? 'own' : ''}" onclick="toggleReaction('${messageId}', '${emoji}')">
                ${emoji} ${users.length}
            </button>
        `;
    }).join('');
}

function handlePresenceChange(payload) {
    loadOnlineUsers(currentBoard?.id);
}

function isLegacyCommunitySession() {
    return Boolean(currentAuthState?.legacyUser && !currentAuthState?.user);
}

// ==================== MESSAGE ACTIONS ====================

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();
    if (!content || !currentBoard || !currentUser) return;

    input.value = '';

    try {
        await window.SupabaseClient.chat.send(currentBoard.id, content, {
            replyTo: window.replyToMessageId || null
        });
        
        // Clear reply state
        cancelReply();
        
        // Stop typing indicator
        window.SupabaseClient.presence.setTyping(currentBoard.id, false);

        if (isLegacyCommunitySession()) {
            await loadMessages(currentBoard.id);
        }
    } catch (error) {
        console.error('Send error:', error);
        showToast('Failed to send message', 'error');
        input.value = content;
    }
}

function showReplyUI(messageId) {
    const message = document.querySelector(`[data-id="${messageId}"]`);
    if (!message) return;

    const username = message.querySelector('.message-username')?.textContent || 'User';
    const content = message.querySelector('.message-text')?.textContent || '';
    
    window.replyToMessageId = messageId;
    
    // Show reply preview
    const replyPreview = document.getElementById('replyPreview');
    if (replyPreview) {
        replyPreview.style.display = 'flex';
        replyPreview.innerHTML = `
            <div class="reply-preview-content">
                <strong>Replying to ${escapeHtml(username)}</strong>
                <span>${escapeHtml(truncate(content, 50))}</span>
            </div>
            <button class="btn btn-sm btn-secondary" onclick="cancelReply()">Close</button>
        `;
    }
}

function cancelReply() {
    window.replyToMessageId = null;
    const replyPreview = document.getElementById('replyPreview');
    if (replyPreview) {
        replyPreview.style.display = 'none';
    }
}

function editMessage(messageId) {
    const messageEl = document.querySelector(`[data-id="${messageId}"]`);
    const textEl = messageEl?.querySelector('.message-text');
    if (!textEl) return;

    const originalContent = textEl.textContent;
    
    // Replace with editable input
    textEl.innerHTML = `
        <textarea class="edit-input">${escapeHtml(originalContent)}</textarea>
        <div class="edit-actions">
            <button class="btn btn-sm btn-primary" onclick="saveEdit('${messageId}')">Save</button>
            <button class="btn btn-sm btn-secondary" onclick="cancelEdit('${messageId}', '${escapeHtml(originalContent)}')">Cancel</button>
        </div>
    `;
}

async function saveEdit(messageId) {
    const textarea = document.querySelector(`[data-id="${messageId}"] .edit-input`);
    const newContent = textarea?.value?.trim();
    
    if (!newContent) return;

    try {
        await window.SupabaseClient.chat.edit(messageId, newContent);
        showToast('Message updated', 'success');
        
        // Reload messages
        await loadMessages(currentBoard.id);
    } catch (error) {
        console.error('Edit error:', error);
        showToast('Failed to edit message', 'error');
    }
}

function cancelEdit(messageId, originalContent) {
    const textEl = document.querySelector(`[data-id="${messageId}"] .message-text`);
    if (textEl) {
        textEl.innerHTML = originalContent;
    }
}

async function deleteMessage(messageId) {
    if (!confirm('Delete this message?')) return;

    try {
        await window.SupabaseClient.chat.delete(messageId);
        showToast('Message deleted', 'success');
        
        // Reload messages
        await loadMessages(currentBoard.id);
    } catch (error) {
        console.error('Delete error:', error);
        showToast('Failed to delete message', 'error');
    }
}

// ==================== REACTIONS ====================

function showReactionPicker(messageId) {
    // Remove existing picker
    const existingPicker = document.querySelector('.reaction-picker');
    if (existingPicker) existingPicker.remove();

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    picker.innerHTML = REACTION_EMOJIS.map(emoji => 
        `<button onclick="toggleReaction('${messageId}', '${emoji}')">${emoji}</button>`
    ).join('');

    const messageEl = document.querySelector(`[data-id="${messageId}"]`);
    messageEl.appendChild(picker);

    // ? on click outside
    setTimeout(() => {
        document.addEventListener('click', closeReactionPicker);
    }, 10);
}

function closeReactionPicker(e) {
    if (!e?.target?.closest?.('.reaction-picker')) {
        document.querySelector('.reaction-picker')?.remove();
        document.removeEventListener('click', closeReactionPicker);
    }
}

async function toggleReaction(messageId, emoji) {
    try {
        // Check if already reacted
        const reactions = await window.SupabaseClient.chat.getReactions(messageId);
        const existing = reactions.find(r => r.user_id === currentUser?.id && r.emoji === emoji);

        if (existing) {
            await window.SupabaseClient.chat.removeReaction(messageId, emoji);
        } else {
            await window.SupabaseClient.chat.addReaction(messageId, emoji);
        }

        loadMessageReactions(messageId);
    } catch (error) {
        console.error('Reaction error:', error);
    }

    closeReactionPicker();
}

// ==================== SEARCH ====================

function toggleSearch() {
    const searchBox = document.getElementById('chatSearchBox');
    if (searchBox) {
        searchBox.style.display = searchBox.style.display === 'none' ? 'block' : 'none';
        if (searchBox.style.display === 'block') {
            searchBox.querySelector('input')?.focus();
        }
    }
}

async function searchMessages(query) {
    if (!query || !currentBoard) return;

    const container = document.getElementById('messagesContainer');
    container.innerHTML = '<div class="loading">Searching...</div>';

    try {
        const { data, error } = await window.SupabaseClient.supabase
            .from('chat_messages')
            .select('*, users(username, avatar_url)')
            .eq('board_id', currentBoard.id)
            .ilike('content', `%${query}%`)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        if (data.length === 0) {
            container.innerHTML = `<div class="empty-chat"><p>No messages found for "${escapeHtml(query)}"</p></div>`;
            return;
        }

        container.innerHTML = `
            <div class="search-results-header">
                Found ${data.length} messages for "${escapeHtml(query)}"
                <button class="btn btn-sm btn-secondary" onclick="clearSearch()">Clear</button>
            </div>
        `;
        container.innerHTML += data.map(msg => formatMessage(msg)).join('');
    } catch (error) {
        console.error('Search error:', error);
        showToast('Search failed', 'error');
    }
}

function clearSearch() {
    document.getElementById('chatSearchBox').style.display = 'none';
    document.getElementById('chatSearchInput').value = '';
    loadMessages(currentBoard.id);
}

// ==================== FILE UPLOADS ====================

function showFileUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf,.doc,.docx,.txt';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
            showToast('File too large (max 10MB)', 'error');
            return;
        }

        try {
            showToast('Uploading...', 'info');
            
            const isImage = file.type.startsWith('image/');
            const attachment = await window.SupabaseClient.files.upload(file, isImage ? 'image' : 'file');

            // Send message with attachment
            const input = document.getElementById('messageInput');
            const content = input.value.trim() || '';
            
            await window.SupabaseClient.chat.send(currentBoard.id, content, {
                attachmentUrl: attachment.url,
                attachmentType: attachment.type,
                attachmentName: attachment.name
            });

            input.value = '';
            showToast('File uploaded!', 'success');
        } catch (error) {
            console.error('Upload error:', error);
            showToast('Upload failed', 'error');
        }
    };
    input.click();
}

// ==================== CREATE CHANNEL ====================

function showCreateChannelModal() {
    if (!currentUser) {
        showToast('Please sign in first', 'error');
        return;
    }

    const modal = document.getElementById('createChannelModal');
    if (modal) modal.style.display = 'flex';
}

async function createChannel() {
    const name = document.getElementById('newChannelName')?.value?.trim();
    const topic = document.getElementById('newChannelTopic')?.value?.trim();
    const isPublic = document.getElementById('newChannelPublic')?.checked !== false;

    if (!name) {
        showToast('Channel name required', 'error');
        return;
    }

    try {
        await window.SupabaseClient.channels.create({
            name,
            topic: topic || '',
            isPublic
        });

        showToast('Channel created!', 'success');
        closeCreateChannelModal();
        loadBoards();
    } catch (error) {
        console.error('Create channel error:', error);
        showToast('Failed to create channel', 'error');
    }
}

function closeCreateChannelModal() {
    const modal = document.getElementById('createChannelModal');
    if (modal) modal.style.display = 'none';
}

// ==================== TYPING INDICATOR ====================

function handleTyping() {
    if (!currentBoard || !currentUser) return;

    // Send typing status
    window.SupabaseClient.presence.setTyping(currentBoard.id, true);

    // Clear previous timeout
    clearTimeout(typingTimeout);

    // Stop typing after 3 seconds of inactivity
    typingTimeout = setTimeout(() => {
        window.SupabaseClient.presence.setTyping(currentBoard.id, false);
    }, 3000);
}

function showTypingIndicator(users) {
    const indicator = document.getElementById('typingIndicator');
    if (!indicator) return;

    if (users && users.length > 0) {
        const names = users.slice(0, 3).map(u => u.username || 'Someone').join(', ');
        const suffix = users.length > 3 ? ` and ${users.length - 3} others` : '';
        indicator.textContent = `${names}${suffix} typing...`;
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
}

// ==================== NOTIFICATIONS ====================

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function showBrowserNotification(message) {
    if ('Notification' in window && Notification.permission === 'granted') {
        const username = message.users?.username || 'Anonymous';
        new Notification(`${username} in ${currentBoard?.name || 'Chat'}`, {
            body: message.content?.substring(0, 100),
            icon: '/favicon.ico'
        });
    }
}

function playMessageSound() {
    try {
        const audio = new Audio('/sounds/message.mp3');
        audio.volume = 0.3;
        audio.play();
    } catch (e) {
        // Ignore audio errors
    }
}

// ==================== IMAGE MODAL ====================

function openImageModal(url) {
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('modalImage');
    
    if (modal && img) {
        img.src = url;
        modal.style.display = 'flex';
    }
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) modal.style.display = 'none';
}

// ==================== EVENT LISTENERS ====================

function setupEnhancedEventListeners() {
    // Send button
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }

    // Enter key
    const input = document.getElementById('messageInput');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Typing indicator
        input.addEventListener('input', handleTyping);
    }

    // Search toggle
    const searchToggle = document.getElementById('searchToggle');
    if (searchToggle) {
        searchToggle.addEventListener('click', toggleSearch);
    }

    // Search input
    const searchInput = document.getElementById('chatSearchInput');
    if (searchInput) {
        let searchDebounce;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                searchMessages(e.target.value.trim());
            }, 300);
        });
    }

    const joinBtn = document.getElementById('joinBtn');
    if (joinBtn) {
        joinBtn.addEventListener('click', async () => {
            if (!currentUser || !currentBoard) {
                showAuthRequired(currentAuthState);
                return;
            }
            await selectBoard(currentBoard.id, currentBoard.name, currentBoard.topic);
        });
    }

    // File upload
    const uploadBtn = document.getElementById('uploadBtn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', showFileUpload);
    }

    // Presence update on visibility change
    document.addEventListener('visibilitychange', () => {
        if (currentUser) {
            window.SupabaseClient.presence.update(
                document.hidden ? 'away' : 'online',
                currentBoard?.id
            );
        }
    });

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (currentUser) {
            window.SupabaseClient.presence.update('offline');
        }
        if (legacyBoardPollTimer) {
            window.clearInterval(legacyBoardPollTimer);
        }
    });
}

// ==================== HELPERS ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 24px;
        background: ${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--error)' : 'var(--primary-accent)'};
        color: white;
        border-radius: 8px;
        z-index: 10000;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function scrollToMessage(messageId) {
    const el = document.querySelector(`[data-id="${messageId}"]`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight');
        setTimeout(() => el.classList.remove('highlight'), 2000);
    }
}

// Make functions globally available
window.selectBoard = selectBoard;
window.showReplyUI = showReplyUI;
window.cancelReply = cancelReply;
window.editMessage = editMessage;
window.saveEdit = saveEdit;
window.cancelEdit = cancelEdit;
window.deleteMessage = deleteMessage;
window.showReactionPicker = showReactionPicker;
window.toggleReaction = toggleReaction;
window.toggleSearch = toggleSearch;
window.searchMessages = searchMessages;
window.clearSearch = clearSearch;
window.showFileUpload = showFileUpload;
window.showCreateChannelModal = showCreateChannelModal;
window.createChannel = createChannel;
window.closeCreateChannelModal = closeCreateChannelModal;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.scrollToMessage = scrollToMessage;

console.log('Enhanced Chat module loaded');
