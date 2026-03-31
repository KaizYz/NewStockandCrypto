// ========================================
// StockandCrypto - User Profile Logic
// Profile management, avatar uploads, activity, and messages
// ========================================

let currentUser = null;
let userProfile = null;
let isLegacyOnlySession = false;


document.addEventListener('DOMContentLoaded', async function() {
    try {
        await waitForSupabaseClient();
        await initializeProfile();
    } catch (error) {
        console.error('Failed to initialize profile:', error);
        window.location.href = 'login.html';
    }
});

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

async function initializeProfile() {
    await window.SupabaseClient.init();

    const authState = window.Auth?.ready
        ? await window.Auth.ready()
        : (window.Auth?.getState?.() || {});

    currentUser = authState?.user || authState?.legacyUser || await window.SupabaseClient.auth.getCurrentUser();
    isLegacyOnlySession = Boolean(authState?.legacyUser && !authState?.user);

    if (!currentUser) {
        const redirectTarget = window.location.pathname.split('/').pop() || 'profile.html';
        const reason = authState?.legacyMismatch ? 'legacy-session' : 'signin-required';
        window.location.href = `login.html?reason=${encodeURIComponent(reason)}&redirect=${encodeURIComponent(redirectTarget)}`;
        return;
    }

    await loadProfile();
    await Promise.all([
        loadStats(),
        loadActivity(),
        loadDirectMessages()
    ]);
    setupEventListeners();
}

function getUserEmail(user = currentUser) {
    return String(user?.email || '').trim();
}

function getUserDisplayName(user = currentUser) {
    const metadata = user?.user_metadata || {};
    return String(
        userProfile?.username
        || user?.displayName
        || metadata.full_name
        || metadata.username
        || metadata.name
        || getUserEmail(user).split('@')[0]
        || 'User'
    ).trim() || 'User';
}

function getUserCreatedAt(user = currentUser) {
    return user?.created_at || user?.createdAt || null;
}

function renderProfileAvatar(username, avatarUrl) {
    const profileAvatar = document.getElementById('profileAvatar');
    const avatarLetter = document.getElementById('avatarLetter');
    const firstLetter = String(username || 'U').charAt(0).toUpperCase() || 'U';

    if (!profileAvatar || !avatarLetter) {
        return;
    }

    if (avatarUrl) {
        profileAvatar.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="Avatar">`;
        return;
    }

    profileAvatar.innerHTML = '<span id="avatarLetter"></span>';
    const nextAvatarLetter = document.getElementById('avatarLetter');
    if (nextAvatarLetter) {
        nextAvatarLetter.textContent = firstLetter;
    }
}

async function loadProfile() {
    try {
        userProfile = await window.SupabaseClient.profile.get(currentUser.id);

        if (!userProfile && !isLegacyOnlySession) {
            userProfile = await window.SupabaseClient.profile.update({
                username: getUserDisplayName(currentUser)
            });
        }

        displayProfile();
        dispatchProfileUpdated();
    } catch (error) {
        console.error('Load profile error:', error);
        displayProfile();
        dispatchProfileUpdated();
    }
}

function displayProfile() {
    const username = userProfile?.username || getUserDisplayName(currentUser);
    const email = getUserEmail(currentUser) || 'No email available';
    const bio = userProfile?.bio || 'No bio yet...';
    const avatarUrl = userProfile?.avatar_url || null;

    document.getElementById('displayUsername').textContent = username;
    document.getElementById('displayEmail').textContent = email;
    document.getElementById('displayBio').textContent = bio;
    renderProfileAvatar(username, avatarUrl);

    document.getElementById('editUsername').value = userProfile?.username || username;
    document.getElementById('editBio').value = userProfile?.bio || '';
    document.getElementById('editWebsite').value = userProfile?.website || '';
    document.getElementById('editLocation').value = userProfile?.location || '';
}

function dispatchProfileUpdated() {
    window.dispatchEvent(new CustomEvent('profile:updated', {
        detail: {
            profile: userProfile || null
        }
    }));
}

async function loadStats() {
    try {
        const notes = await window.SupabaseClient.notes.get({ limit: 1000 });
        document.getElementById('notesCount').textContent = notes?.length || 0;

        let messagesCount = 0;
        if (!isLegacyOnlySession && window.SupabaseClient.supabase && currentUser?.id) {
            const { count, error } = await window.SupabaseClient.supabase
                .from('chat_messages')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', currentUser.id);
            if (!error) {
                messagesCount = count || 0;
            }
        }
        document.getElementById('messagesCount').textContent = messagesCount;

        const createdAt = getUserCreatedAt(currentUser);
        if (createdAt) {
            const created = new Date(createdAt);
            document.getElementById('memberSince').textContent = created.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short'
            });
        } else {
            document.getElementById('memberSince').textContent = '--';
        }
    } catch (error) {
        console.error('Load stats error:', error);
    }
}

async function loadActivity() {
    const container = document.getElementById('activityList');
    if (!container) {
        return;
    }

    try {
        const notes = await window.SupabaseClient.notes.get({ limit: 6 });
        if (!notes?.length) {
            container.innerHTML = `
                <div style="text-align:center; color: var(--text-muted); padding: 2rem;">
                    No recent activity yet.
                </div>
            `;
            return;
        }

        container.innerHTML = notes
            .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
            .slice(0, 6)
            .map((note) => `
                <div class="dm-item" onclick="window.location.href='note-detail.html?id=${encodeURIComponent(note.id)}'">
                    <div class="dm-avatar">📝</div>
                    <div class="dm-preview">
                        <div class="dm-preview-header">
                            <span class="dm-username">${escapeHtml(note.title || 'Untitled note')}</span>
                            <span class="dm-time">${formatTime(note.updated_at || note.created_at)}</span>
                        </div>
                        <div class="dm-message">${escapeHtml(buildExcerpt(note.content || ''))}</div>
                    </div>
                </div>
            `)
            .join('');
    } catch (error) {
        console.error('Load activity error:', error);
        container.innerHTML = `
            <div style="text-align:center; color: var(--text-muted); padding: 2rem;">
                Failed to load recent activity.
            </div>
        `;
    }
}

async function loadDirectMessages() {
    const container = document.getElementById('dmList');
    if (!container) {
        return;
    }

    if (isLegacyOnlySession || !window.SupabaseClient.supabase || !currentUser?.id) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 2rem;">
                <p>Direct messages are not available for local-only accounts yet.</p>
                <p style="font-size: 0.85rem;">Your profile, notes, and avatar still work normally.</p>
            </div>
        `;
        return;
    }

    try {
        const { data: sentMessages, error: sentError } = await window.SupabaseClient.supabase
            .from('direct_messages')
            .select('receiver_id, users:receiver_id(username, avatar_url), content, created_at, read_at')
            .eq('sender_id', currentUser.id)
            .order('created_at', { ascending: false });
        if (sentError) throw sentError;

        const { data: receivedMessages, error: receivedError } = await window.SupabaseClient.supabase
            .from('direct_messages')
            .select('sender_id, users:sender_id(username, avatar_url), content, created_at, read_at')
            .eq('receiver_id', currentUser.id)
            .order('created_at', { ascending: false });
        if (receivedError) throw receivedError;

        const conversations = new Map();

        (sentMessages || []).forEach((msg) => {
            if (!conversations.has(msg.receiver_id)) {
                conversations.set(msg.receiver_id, {
                    userId: msg.receiver_id,
                    username: msg.users?.username || 'User',
                    avatarUrl: msg.users?.avatar_url || '',
                    lastMessage: msg.content,
                    lastTime: msg.created_at,
                    unread: 0
                });
            }
        });

        (receivedMessages || []).forEach((msg) => {
            const existing = conversations.get(msg.sender_id);
            if (existing) {
                if (new Date(msg.created_at) > new Date(existing.lastTime)) {
                    existing.lastMessage = msg.content;
                    existing.lastTime = msg.created_at;
                }
                if (!msg.read_at) {
                    existing.unread += 1;
                }
            } else {
                conversations.set(msg.sender_id, {
                    userId: msg.sender_id,
                    username: msg.users?.username || 'User',
                    avatarUrl: msg.users?.avatar_url || '',
                    lastMessage: msg.content,
                    lastTime: msg.created_at,
                    unread: msg.read_at ? 0 : 1
                });
            }
        });

        if (!conversations.size) {
            container.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); padding: 2rem;">
                    <p>No conversations yet</p>
                    <p style="font-size: 0.85rem;">Start a conversation from the chat page.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = Array.from(conversations.values())
            .sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime))
            .map((conv) => `
                <div class="dm-item" onclick="openDM('${conv.userId}')">
                    <div class="dm-avatar">
                        ${conv.avatarUrl
                            ? `<img src="${escapeHtml(conv.avatarUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`
                            : escapeHtml(conv.username.charAt(0).toUpperCase())}
                    </div>
                    <div class="dm-preview">
                        <div class="dm-preview-header">
                            <span class="dm-username">${escapeHtml(conv.username)}</span>
                            <span class="dm-time">${formatTime(conv.lastTime)}</span>
                        </div>
                        <div class="dm-message">${escapeHtml(conv.lastMessage)}</div>
                    </div>
                    ${conv.unread > 0 ? `<span class="dm-unread">${conv.unread}</span>` : ''}
                </div>
            `)
            .join('');
    } catch (error) {
        console.error('Load DMs error:', error);
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 2rem;">
                Failed to load conversations.
            </div>
        `;
    }
}

function setupEventListeners() {
    document.querySelectorAll('.profile-tab').forEach((tab) => {
        tab.addEventListener('click', (e) => {
            switchTab(e.currentTarget.dataset.tab);
        });
    });

    document.getElementById('editProfileBtn')?.addEventListener('click', () => {
        document.getElementById('viewMode').classList.add('hidden');
        document.getElementById('editMode').classList.add('active');
        document.getElementById('avatarUploadWrapper').style.display = 'block';
    });

    document.getElementById('cancelEditBtn')?.addEventListener('click', () => {
        document.getElementById('viewMode').classList.remove('hidden');
        document.getElementById('editMode').classList.remove('active');
        document.getElementById('avatarUploadWrapper').style.display = 'none';
    });

    document.getElementById('saveProfileBtn')?.addEventListener('click', saveProfile);
    document.getElementById('avatarInput')?.addEventListener('change', handleAvatarUpload);

    document.getElementById('onlineStatus')?.addEventListener('change', async (e) => {
        try {
            await window.SupabaseClient.presence.update(e.target.value);
            showToast('Status updated', 'success');
        } catch (error) {
            console.error('Status update error:', error);
        }
    });

    document.getElementById('browserNotifications')?.addEventListener('change', (e) => {
        if (e.target.checked) {
            requestNotificationPermission();
        }
    });

    document.getElementById('deleteAccountBtn')?.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) {
            return;
        }
        if (!confirm('This will permanently delete all your data. Are you absolutely sure?')) {
            return;
        }
        try {
            showToast('Account deletion requested', 'info');
            await window.SupabaseClient.auth.signOut();
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Delete account error:', error);
        }
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.profile-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    document.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.toggle('active', content.id === `${tabName}Tab`);
    });
}

async function saveProfile() {
    const username = document.getElementById('editUsername').value.trim();
    const bio = document.getElementById('editBio').value.trim();
    const website = document.getElementById('editWebsite').value.trim();
    const location = document.getElementById('editLocation').value.trim();

    if (!username) {
        showToast('Username is required', 'error');
        return;
    }

    try {
        userProfile = await window.SupabaseClient.profile.update({
            username,
            bio,
            website,
            location
        });

        await loadProfile();
        dispatchProfileUpdated();
        showToast('Profile updated!', 'success');

        document.getElementById('viewMode').classList.remove('hidden');
        document.getElementById('editMode').classList.remove('active');
        document.getElementById('avatarUploadWrapper').style.display = 'none';
    } catch (error) {
        console.error('Save profile error:', error);
        showToast('Failed to save profile', 'error');
    }
}

async function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        showToast('Please upload a PNG, JPG, GIF, or WEBP image.', 'error');
        e.target.value = '';
        return;
    }

    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
        showToast('Image must be under 2MB.', 'error');
        e.target.value = '';
        return;
    }

    try {
        showToast('Uploading...', 'info');
        const avatarUrl = await window.SupabaseClient.profile.uploadAvatar(file);
        userProfile = {
            ...(userProfile || {}),
            avatar_url: avatarUrl
        };
        renderProfileAvatar(getUserDisplayName(currentUser), avatarUrl);
        dispatchProfileUpdated();
        showToast('Avatar updated!', 'success');
    } catch (error) {
        console.error('Avatar upload error:', error);
        showToast('Failed to upload avatar', 'error');
    } finally {
        e.target.value = '';
    }
}

function buildExcerpt(text, limit = 90) {
    const plain = String(text || '').replace(/\s+/g, ' ').trim();
    if (plain.length <= limit) {
        return plain || 'No content yet.';
    }
    return `${plain.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function openDM(userId) {
    window.location.href = `dm.html?user=${userId}`;
}

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        showToast('Notifications not supported', 'error');
        return;
    }

    Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
            showToast('Notifications enabled!', 'success');
        } else {
            showToast('Notifications blocked', 'error');
            const input = document.getElementById('browserNotifications');
            if (input) {
                input.checked = false;
            }
        }
    });
}

function formatTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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

window.openDM = openDM;
console.log('✅ Profile module loaded');
