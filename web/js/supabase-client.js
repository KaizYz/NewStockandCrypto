/**
 * Supabase Client for StockandCrypto
 * Unified Authentication, Notes, Chat (Realtime)
 * 
 * FIX: Proper async initialization and export
 */
(function() {
    'use strict';

    // Configuration
    const SUPABASE_URL = 'https://odvelrdzdbnbfjuqrbtl.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_sC7xCGB5GqtQwxV-zT35yQ_4vfRSF4p';

    // Internal state
    let supabase = null;
    let isInitialized = false;
    let initPromise = null;

    // ==================== INITIALIZATION ====================
    
    /**
     * Wait for Supabase SDK to load
     */
    function waitForSupabaseSDK(timeout = 10000) {
        return new Promise((resolve, reject) => {
            if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
                resolve(window.supabase);
                return;
            }

            const startTime = Date.now();
            const interval = setInterval(() => {
                if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
                    clearInterval(interval);
                    resolve(window.supabase);
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(interval);
                    reject(new Error('Supabase SDK load timeout. Please check your internet connection.'));
                }
            }, 100);
        });
    }

    /**
     * Initialize Supabase client
     * Call this before using any other methods
     */
    async function initSupabase() {
        if (isInitialized && supabase) {
            return supabase;
        }

        if (initPromise) {
            return initPromise;
        }

        initPromise = (async () => {
            try {
                const supabaseLib = await waitForSupabaseSDK();
                supabase = supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                    auth: {
                        autoRefreshToken: true,
                        persistSession: true,
                        detectSessionInUrl: true,
                        storage: window.localStorage
                    }
                });

                // Test connection
                const { error } = await supabase.from('notes').select('count', { count: 'exact', head: true }).limit(0);
                if (error && !error.message.includes('policy')) {
                    console.warn('Supabase connection test:', error.message);
                }

                isInitialized = true;
                if (window.SupabaseClient) {
                    window.SupabaseClient.supabase = supabase;
                }
                console.log('Supabase initialized successfully');
                
                // Dispatch ready event
                window.dispatchEvent(new CustomEvent('supabase:ready', { detail: { supabase } }));
                
                return supabase;
            } catch (error) {
                console.error('Supabase init failed:', error);
                initPromise = null;
                throw error;
            }
        })();

        return initPromise;
    }

    // ==================== AUTH ====================

    const auth = {
        /**
         * Sign up a new user
         */
        async signUp(email, password, username) {
            await initSupabase();
            
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: { username: username || email.split('@')[0] }
                }
            });

            if (error) throw error;

            // Create profile if user exists
            if (data.user) {
                // Profile is auto-created by trigger, but we can update it
                await supabase.from('profiles')
                    .upsert({ 
                        id: data.user.id, 
                        username: username || email.split('@')[0],
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'id' });
            }

            return data;
        },

        /**
         * Sign in with email and password
         */
        async signIn(email, password) {
            await initSupabase();
            
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;
            return data;
        },

        /**
         * Sign out
         */
        async signOut() {
            await initSupabase();
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
        },

        /**
         * Get current authenticated user
         */
        async getCurrentUser() {
            await initSupabase();
            const { data: { user } } = await supabase.auth.getUser();
            return user;
        },

        /**
         * Get current session
         */
        async getSession() {
            await initSupabase();
            const { data: { session } } = await supabase.auth.getSession();
            return session;
        },

        /**
         * Subscribe to auth state changes
         */
        onAuthStateChange(callback) {
            if (!supabase) {
                console.warn('Supabase not initialized yet');
                return { data: { subscription: { unsubscribe: () => {} } } };
            }
            return supabase.auth.onAuthStateChange(callback);
        },

        /**
         * Check if user is authenticated
         */
        async isAuthenticated() {
            const user = await this.getCurrentUser();
            return !!user;
        },

        /**
         * Get user profile
         */
        async getProfile(userId) {
            await initSupabase();
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (error && error.code !== 'PGRST116') throw error;
            return data;
        },

        /**
         * Update user profile
         */
        async updateProfile(userId, updates) {
            await initSupabase();
            const { data, error } = await supabase
                .from('profiles')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', userId)
                .select()
                .single();

            if (error) throw error;
            return data;
        }
    };

    async function getLegacyUser() {
        const response = await fetch(`${window.location.origin}/api/auth/me?optional=1`, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        });

        if (!response.ok) {
            return null;
        }

        const payload = await response.json().catch(() => ({}));
        return payload.user || null;
    }


    async function legacyApiRequest(endpoint, options = {}) {
        const response = await fetch(`${window.location.origin}/api${endpoint}`, {
            method: options.method || 'GET',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...(options.headers || {})
            },
            body: options.body ? JSON.stringify(options.body) : undefined
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || payload.error || `Legacy API HTTP ${response.status}`);
        }
        return payload;
    }

    async function getSupabaseUserIfAvailable() {
        try {
            await initSupabase();
            return await auth.getCurrentUser();
        } catch (error) {
            return null;
        }
    }

    async function getProfileMode() {
        const state = window.Auth?.getState?.() || {};
        if (state.user) {
            return 'supabase';
        }
        if (state.legacyUser) {
            return 'legacy';
        }

        const user = await getSupabaseUserIfAvailable();
        if (user) {
            return 'supabase';
        }

        const legacyUser = await getLegacyUser();
        return legacyUser ? 'legacy' : null;
    }

    async function getFileUploadMode(type = 'file') {
        if (type === 'note-image') {
            return getNotesMode();
        }

        const state = window.Auth?.getState?.() || {};
        if (state.user) {
            return 'supabase';
        }
        if (state.legacyUser) {
            return 'legacy';
        }

        const user = await getSupabaseUserIfAvailable();
        if (user) {
            return 'supabase';
        }

        const legacyUser = await getLegacyUser();
        return legacyUser ? 'legacy' : null;
    }

    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const value = String(reader.result || '');
                const base64 = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
                resolve(base64);
            };
            reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
            reader.readAsDataURL(file);
        });
    }

    async function uploadLegacyFile(endpoint, file) {
        const dataBase64 = await fileToBase64(file);
        return legacyApiRequest(endpoint, {
            method: 'POST',
            body: {
                fileName: file.name,
                mimeType: file.type,
                dataBase64
            }
        });
    }

    function normalizeSupabaseProfile(profile) {
        if (!profile) {
            return null;
        }
        const preferences = profile.preferences || {};
        return {
            ...profile,
            website: profile.website ?? preferences.website ?? '',
            location: profile.location ?? preferences.location ?? ''
        };
    }

    async function getSupabaseProfile(userId) {
        await initSupabase();
        const currentUser = await auth.getCurrentUser();
        const targetUserId = userId || currentUser?.id;
        if (!targetUserId) {
            throw new Error('Not authenticated');
        }

        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', targetUserId)
            .single();

        if (error && error.code !== 'PGRST116') throw error;
        return normalizeSupabaseProfile(data);
    }

    async function updateSupabaseProfile(updates = {}) {
        await initSupabase();
        const user = await auth.getCurrentUser();
        if (!user) throw new Error('Not authenticated');

        const currentProfile = await getSupabaseProfile(user.id).catch(() => null);
        const nextPreferences = {
            ...(currentProfile?.preferences || {})
        };

        if (updates.website !== undefined) {
            nextPreferences.website = String(updates.website || '').trim();
        }
        if (updates.location !== undefined) {
            nextPreferences.location = String(updates.location || '').trim();
        }

        const payload = {
            id: user.id,
            updated_at: new Date().toISOString(),
            preferences: nextPreferences
        };

        if (updates.username !== undefined) {
            payload.username = String(updates.username || '').trim() || user.email?.split('@')[0] || 'User';
        }
        if (updates.bio !== undefined) {
            payload.bio = String(updates.bio || '').trim();
        }
        if (updates.avatar_url !== undefined) {
            payload.avatar_url = updates.avatar_url || null;
        }

        const { data, error } = await supabase
            .from('profiles')
            .upsert(payload, { onConflict: 'id' })
            .select('*')
            .single();

        if (error) throw error;
        return normalizeSupabaseProfile(data);
    }

    async function uploadSupabaseAvatar(file) {
        await initSupabase();
        const user = await auth.getCurrentUser();
        if (!user) throw new Error('Not authenticated');

        const fileExt = String(file.name || '').split('.').pop();
        const fileName = `${user.id}/avatar.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(fileName, file, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
            .from('avatars')
            .getPublicUrl(fileName);

        await updateSupabaseProfile({ avatar_url: publicUrl });
        return publicUrl;
    }

    async function uploadSupabaseAttachment(file, type = 'image') {
        await initSupabase();
        const user = await auth.getCurrentUser();
        if (!user) throw new Error('Not authenticated');

        const fileExt = String(file.name || '').split('.').pop();
        const fileName = `${user.id}/${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('attachments')
            .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
            .from('attachments')
            .getPublicUrl(fileName);

        return {
            url: publicUrl,
            type,
            name: file.name
        };
    }

    async function getNotesMode() {
        const legacyUser = await getLegacyUser();
        if (legacyUser) {
            return 'legacy';
        }

        await initSupabase();
        const user = await auth.getCurrentUser();
        return user ? 'supabase' : null;
    }

    async function legacyNotesRequest(endpoint, options = {}) {
        return legacyApiRequest(endpoint, options);
    }

    async function getChatMode() {
        const legacyUser = await getLegacyUser();
        await initSupabase();
        const user = await auth.getCurrentUser();
        if (user) {
            return 'supabase';
        }
        return legacyUser ? 'legacy' : null;
    }

    async function legacyChatRequest(endpoint, options = {}) {
        const response = await fetch(`${window.location.origin}/api/chat${endpoint}`, {
            method: options.method || 'GET',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...(options.headers || {})
            },
            body: options.body ? JSON.stringify(options.body) : undefined
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || payload.error || `Legacy chat HTTP ${response.status}`);
        }
        return payload;
    }

    // ==================== NOTES ====================

    const notes = {
        /**
         * Get notes for current user
         */
        async get(options = {}) {
            const mode = await getNotesMode();
            if (mode === 'legacy') {
                const query = new URLSearchParams();
                if (options.notebook_id !== undefined && options.notebook_id !== null && options.notebook_id !== '') {
                    query.set('notebook_id', String(options.notebook_id));
                }
                if (options.market) query.set('market', options.market);
                if (options.tag) query.set('tag', options.tag);
                if (options.search) query.set('search', options.search);
                if (options.is_pinned !== undefined) query.set('pinned', String(options.is_pinned));
                if (options.is_favorite !== undefined) query.set('favorite', String(options.is_favorite));
                if (options.recent !== undefined) query.set('recent', String(options.recent));
                if (options.orderBy || options.sortBy) query.set('sortBy', options.orderBy || options.sortBy);
                if (options.sortOrder) query.set('sortOrder', options.sortOrder);
                if (options.ascending !== undefined) query.set('ascending', String(options.ascending));
                if (options.limit) query.set('limit', String(options.limit));
                if (options.offset) query.set('offset', String(options.offset));
                const suffix = query.toString() ? `?${query.toString()}` : '';
                const payload = await legacyNotesRequest(`/notes${suffix}`);
                return payload.notes || [];
            }

            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            let query = supabase
                .from('notes')
                .select('*')
                .eq('user_id', user.id);

            // Apply filters
            if (options.market) {
                query = query.eq('market', options.market);
            }
            if (options.tag) {
                query = query.contains('tags', [options.tag]);
            }
            if (options.search) {
                query = query.or(`title.ilike.%${options.search}%,content.ilike.%${options.search}%`);
            }
            if (options.is_pinned !== undefined) {
                query = query.eq('is_pinned', options.is_pinned);
            }
            if (options.is_favorite !== undefined) {
                query = query.eq('is_favorite', options.is_favorite);
            }

            // Sorting
            const orderBy = options.orderBy || 'created_at';
            const ascending = options.ascending ?? false;
            query = query.order(orderBy, { ascending });

            // Pagination
            if (options.limit) {
                query = query.limit(options.limit);
            }
            if (options.offset) {
                query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
            }

            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        },

        /**
         * Get single note by ID
         */
        async getOne(noteId) {
            const mode = await getNotesMode();
            if (mode === 'legacy') {
                const payload = await legacyNotesRequest(`/notes/${encodeURIComponent(noteId)}`);
                return payload.note || null;
            }

            await initSupabase();
            const { data, error } = await supabase
                .from('notes')
                .select('*')
                .eq('id', noteId)
                .single();

            if (error) throw error;
            return data;
        },

        /**
         * Get note by share ID (public)
         */
        async getByShareId(shareId) {
            const mode = await getNotesMode();
            if (mode === 'legacy') {
                const payload = await legacyNotesRequest(`/notes/share/${encodeURIComponent(shareId)}`);
                return payload.note || null;
            }

            await initSupabase();
            const { data, error } = await supabase
                .from('notes')
                .select('*')
                .eq('share_id', shareId)
                .eq('is_public', true)
                .single();

            if (error) throw error;
            return data;
        },

        /**
         * Create a new note
         */
        async create(note) {
            const mode = await getNotesMode();
            if (mode === 'legacy') {
                const payload = await legacyNotesRequest('/notes', {
                    method: 'POST',
                    body: note
                });
                return payload.note || null;
            }

            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            const { data, error } = await supabase
                .from('notes')
                .insert({
                    user_id: user.id,
                    notebook_id: note.notebook_id ?? null,
                    title: note.title || 'Untitled',
                    content: note.content || '',
                    market: note.market || 'General',
                    tags: note.tags || [],
                    is_pinned: note.is_pinned || false,
                    is_favorite: note.is_favorite || false
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        /**
         * Update an existing note
         */
        async update(noteId, updates) {
            const mode = await getNotesMode();
            if (mode === 'legacy') {
                const payload = await legacyNotesRequest(`/notes/${encodeURIComponent(noteId)}`, {
                    method: 'PUT',
                    body: updates
                });
                return payload.note || null;
            }

            await initSupabase();
            
            const { data, error } = await supabase
                .from('notes')
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', noteId)
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        /**
         * Delete a note
         */
        async delete(noteId) {
            const mode = await getNotesMode();
            if (mode === 'legacy') {
                await legacyNotesRequest(`/notes/${encodeURIComponent(noteId)}`, {
                    method: 'DELETE'
                });
                return;
            }

            await initSupabase();
            const { error } = await supabase
                .from('notes')
                .delete()
                .eq('id', noteId);

            if (error) throw error;
        },

        /**
         * Toggle pin status
         */
        async togglePin(noteId) {
            const note = await this.getOne(noteId);
            return this.update(noteId, { is_pinned: !note.is_pinned });
        },

        /**
         * Toggle favorite status
         */
        async toggleFavorite(noteId) {
            const note = await this.getOne(noteId);
            return this.update(noteId, { is_favorite: !note.is_favorite });
        },

        /**
         * Get note versions (history)
         */
        async getVersions(noteId, limit = 10) {
            const mode = await getNotesMode();
            if (mode === 'legacy') {
                const payload = await legacyNotesRequest(`/notes/${encodeURIComponent(noteId)}/versions?limit=${encodeURIComponent(limit)}`);
                return payload.versions || [];
            }

            await initSupabase();
            const { data, error } = await supabase
                .from('note_versions')
                .select('*')
                .eq('note_id', noteId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return data || [];
        },

        /**
         * Get popular tags for current user
         */
        async getPopularTags(limit = 10) {
            const rows = await this.get({ limit: 1000 });
            const tagCounts = {};
            (rows || []).forEach((note) => {
                (note.tags || []).forEach((tag) => {
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                });
            });

            return Object.entries(tagCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, limit)
                .map(([tag, count]) => ({ tag, count }));
        },

        /**
         * Get statistics
         */
        async getStats() {
            const mode = await getNotesMode();
            if (!mode) return { total: 0, week: 0, crypto: 0, equity: 0 };
            const notes = await this.get({ limit: 1000 });
            const now = new Date();
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            return {
                total: notes.length,
                week: notes.filter(n => new Date(n.created_at) > weekAgo).length,
                crypto: notes.filter(n => n.market === 'Crypto').length,
                equity: notes.filter(n => ['CN A-Shares', 'US Equities'].includes(n.market)).length
            };
        }
    };

    const notebooks = {
        async list() {
            const payload = await legacyNotesRequest('/notebooks');
            return payload.notebooks || [];
        },

        async getOne(notebookId) {
            const payload = await legacyNotesRequest(`/notebooks/${encodeURIComponent(notebookId)}`);
            return payload.notebook || null;
        },

        async create(notebook) {
            const payload = await legacyNotesRequest('/notebooks', {
                method: 'POST',
                body: notebook
            });
            return payload.notebook || null;
        },

        async update(notebookId, updates) {
            const payload = await legacyNotesRequest(`/notebooks/${encodeURIComponent(notebookId)}`, {
                method: 'PATCH',
                body: updates
            });
            return payload.notebook || null;
        },

        async delete(notebookId) {
            return legacyNotesRequest(`/notebooks/${encodeURIComponent(notebookId)}`, {
                method: 'DELETE'
            });
        }
    };

    const communityNotes = {
        async listIdeas(options = {}) {
            const query = new URLSearchParams();
            if (options.market) query.set('market', options.market);
            if (options.tag) query.set('tag', options.tag);
            if (options.search) query.set('search', options.search);
            if (options.visibility) query.set('visibility', options.visibility);
            if (options.sortBy) query.set('sortBy', options.sortBy);
            if (options.sortOrder) query.set('sortOrder', options.sortOrder);
            if (options.limit) query.set('limit', String(options.limit));
            if (options.offset) query.set('offset', String(options.offset));
            const suffix = query.toString() ? `?${query.toString()}` : '';

            const response = await fetch(`${window.location.origin}/api/community/ideas${suffix}`, {
                method: 'GET',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.message || payload.error || `Community ideas HTTP ${response.status}`);
            }
            return payload;
        },

        async getNote(noteId) {
            const response = await fetch(`${window.location.origin}/api/community/notes/${encodeURIComponent(noteId)}`, {
                method: 'GET',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.message || payload.error || `Community note HTTP ${response.status}`);
            }
            return payload;
        },

        async getSharedNote(shareId) {
            const response = await fetch(`${window.location.origin}/api/community/notes/share/${encodeURIComponent(shareId)}`, {
                method: 'GET',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.message || payload.error || `Community share HTTP ${response.status}`);
            }
            return payload;
        }
    };

    const profile = {
        async get(userId) {
            const mode = await getProfileMode();
            if (mode === 'legacy') {
                const payload = await legacyApiRequest('/profile');
                return payload.profile || null;
            }
            return getSupabaseProfile(userId);
        },

        async update(updates = {}) {
            const mode = await getProfileMode();
            if (mode === 'legacy') {
                const payload = await legacyApiRequest('/profile', {
                    method: 'PATCH',
                    body: updates
                });
                return payload.profile || null;
            }
            return updateSupabaseProfile(updates);
        },

        async uploadAvatar(file) {
            const mode = await getProfileMode();
            if (mode === 'legacy') {
                const payload = await uploadLegacyFile('/profile/avatar', file);
                return payload.avatarUrl || null;
            }
            return uploadSupabaseAvatar(file);
        }
    };

    const files = {
        async upload(file, type = 'image') {
            const mode = await getFileUploadMode(type);
            if (mode === 'legacy') {
                if (type !== 'note-image') {
                    throw new Error('File uploads are not available in the local chat fallback yet.');
                }
                const payload = await uploadLegacyFile('/uploads/note-images', file);
                const uploaded = payload.file || null;
                if (!uploaded) {
                    throw new Error('Upload failed.');
                }
                return {
                    url: uploaded.url,
                    type,
                    name: uploaded.name || file.name,
                    mimeType: uploaded.mimeType,
                    size: uploaded.size
                };
            }
            return uploadSupabaseAttachment(file, type);
        }
    };

    // ==================== CHAT ====================

    const chat = {
        async getBoards() {
            const mode = await getChatMode();
            if (mode !== 'supabase') {
                const payload = await legacyChatRequest('/boards');
                return payload.boards || [];
            }

            await initSupabase();
            const { data, error } = await supabase
                .from('chat_boards')
                .select('*')
                .order('created_at', { ascending: true });
            if (error) throw error;
            return data || [];
        },

        async getMyBoards() {
            const mode = await getChatMode();
            if (mode !== 'supabase') {
                return this.getBoards();
            }

            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) return [];

            const { data, error } = await supabase
                .from('chat_members')
                .select('board_id, role, joined_at, chat_boards(*)')
                .eq('user_id', user.id);

            if (error) throw error;
            return data || [];
        },

        async join(boardId) {
            const mode = await getChatMode();
            if (mode === 'legacy') {
                const payload = await legacyChatRequest(`/boards/${encodeURIComponent(boardId)}/join`, {
                    method: 'POST',
                    body: {}
                });
                return payload.board || null;
            }

            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            const { data, error } = await supabase
                .from('chat_members')
                .insert({ board_id: boardId, user_id: user.id, role: 'member' })
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        async leave(boardId) {
            const mode = await getChatMode();
            if (mode === 'legacy') {
                return null;
            }

            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            const { error } = await supabase
                .from('chat_members')
                .delete()
                .eq('board_id', boardId)
                .eq('user_id', user.id);

            if (error) throw error;
        },

        async getMessages(boardId, limit = 100) {
            const mode = await getChatMode();
            if (mode !== 'supabase') {
                const payload = await legacyChatRequest(`/boards/${encodeURIComponent(boardId)}/messages?limit=${encodeURIComponent(limit)}`);
                return payload.messages || [];
            }

            await initSupabase();
            let result = await supabase
                .from('chat_messages')
                .select(`
                    *,
                    profiles:user_id (username, avatar_url)
                `)
                .eq('board_id', boardId)
                .eq('is_deleted', false)
                .order('created_at', { ascending: true })
                .limit(limit);

            if (result.error && (String(result.error.message || '').includes('profiles') || String(result.error.message || '').includes('relationship'))) {
                result = await supabase
                    .from('chat_messages')
                    .select('*')
                    .eq('board_id', boardId)
                    .eq('is_deleted', false)
                    .order('created_at', { ascending: true })
                    .limit(limit);
            }

            if (result.error) throw result.error;
            return result.data || [];
        },

        async send(boardId, content, options = {}) {
            const mode = await getChatMode();
            if (mode === 'legacy') {
                const payload = await legacyChatRequest(`/boards/${encodeURIComponent(boardId)}/messages`, {
                    method: 'POST',
                    body: {
                        content,
                        reply_to: options.replyTo || null,
                        attachment_url: options.attachmentUrl || null,
                        attachment_type: options.attachmentType || null,
                        attachment_name: options.attachmentName || null
                    }
                });
                return payload.message || null;
            }

            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            const { data, error } = await supabase
                .from('chat_messages')
                .insert({
                    board_id: boardId,
                    user_id: user.id,
                    content: content,
                    reply_to: options.replyTo || null,
                    mentions: options.mentions || []
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        async editMessage(messageId, content) {
            const mode = await getChatMode();
            if (mode === 'legacy') {
                const payload = await legacyChatRequest(`/messages/${encodeURIComponent(messageId)}`, {
                    method: 'PUT',
                    body: { content }
                });
                return payload.message || null;
            }

            await initSupabase();
            const { data, error } = await supabase
                .from('chat_messages')
                .update({
                    content,
                    is_edited: true,
                    edited_at: new Date().toISOString()
                })
                .eq('id', messageId)
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        async deleteMessage(messageId) {
            const mode = await getChatMode();
            if (mode === 'legacy') {
                await legacyChatRequest(`/messages/${encodeURIComponent(messageId)}`, {
                    method: 'DELETE'
                });
                return;
            }

            await initSupabase();
            const { error } = await supabase
                .from('chat_messages')
                .update({
                    is_deleted: true,
                    deleted_at: new Date().toISOString()
                })
                .eq('id', messageId);

            if (error) throw error;
        },

        async getReactions(messageId) {
            const mode = await getChatMode();
            if (mode !== 'supabase') {
                const payload = await legacyChatRequest(`/messages/${encodeURIComponent(messageId)}/reactions`);
                return payload.reactions || [];
            }

            await initSupabase();
            const { data, error } = await supabase
                .from('message_reactions')
                .select('*')
                .eq('message_id', messageId)
                .order('created_at', { ascending: true });

            if (error) throw error;
            return data || [];
        },

        async addReaction(messageId, emoji) {
            const mode = await getChatMode();
            if (mode === 'legacy') {
                const payload = await legacyChatRequest(`/messages/${encodeURIComponent(messageId)}/reactions`, {
                    method: 'POST',
                    body: { emoji }
                });
                return payload.reactions || [];
            }

            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            const { data, error } = await supabase
                .from('message_reactions')
                .insert({ message_id: messageId, user_id: user.id, emoji })
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        async removeReaction(messageId, emoji) {
            const mode = await getChatMode();
            if (mode === 'legacy') {
                const payload = await legacyChatRequest(`/messages/${encodeURIComponent(messageId)}/reactions?emoji=${encodeURIComponent(emoji)}`, {
                    method: 'DELETE'
                });
                return payload.reactions || [];
            }

            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            const { error } = await supabase
                .from('message_reactions')
                .delete()
                .eq('message_id', messageId)
                .eq('user_id', user.id)
                .eq('emoji', emoji);

            if (error) throw error;
        },

        subscribe(boardId, onMessage) {
            const state = window.Auth?.getState?.() || {};
            if (!state.user && state.legacyUser) {
                let lastMessageId = null;
                return {
                    type: 'legacy-poll',
                    timer: window.setInterval(async () => {
                        try {
                            const messages = await chat.getMessages(boardId, 100);
                            const latest = messages[messages.length - 1];
                            if (latest && latest.id !== lastMessageId) {
                                lastMessageId = latest.id;
                                onMessage(latest);
                            }
                        } catch (error) {
                            console.warn('Legacy chat polling failed:', error.message);
                        }
                    }, 5000)
                };
            }

            if (!supabase) {
                return null;
            }

            const channel = supabase
                .channel(`board:${boardId}`)
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: `board_id=eq.${boardId}`
                }, (payload) => {
                    onMessage(payload.new);
                })
                .subscribe();

            return channel;
        },

        subscribeReactions(boardId, onChange) {
            const state = window.Auth?.getState?.() || {};
            if (!state.user && state.legacyUser) {
                return { type: 'legacy-reactions', timer: null, onChange };
            }

            if (!supabase) {
                return null;
            }

            const channel = supabase
                .channel(`board-reactions:${boardId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'message_reactions'
                }, onChange)
                .subscribe();
            return channel;
        },

        unsubscribe(channel) {
            if (!channel) return;
            if (channel.type && channel.timer) {
                window.clearInterval(channel.timer);
                return;
            }
            if (supabase) {
                supabase.removeChannel(channel);
            }
        },

        async getOnlineCount(boardId) {
            const users = await presence.getOnline(boardId);
            return users.length;
        },

        async edit(messageId, content) {
            return this.editMessage(messageId, content);
        },

        async delete(messageId) {
            return this.deleteMessage(messageId);
        }
    };

    const channels = {
        async getPublic() {
            return chat.getBoards();
        },

        async create(payload) {
            const mode = await getChatMode();
            if (mode === 'legacy') {
                const response = await legacyChatRequest('/boards', {
                    method: 'POST',
                    body: payload
                });
                return response.board || null;
            }

            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) throw new Error('Not authenticated');
            const { data, error } = await supabase
                .from('chat_boards')
                .insert({
                    name: payload.name,
                    topic: payload.topic || '',
                    is_public: payload.isPublic !== false,
                    created_by: user.id
                })
                .select()
                .single();
            if (error) throw error;
            return data;
        }
    };

    // ==================== LIKES ====================

    const likes = {
        async toggle(noteId) {
            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            const { data: existing } = await supabase
                .from('likes')
                .select('id')
                .eq('user_id', user.id)
                .eq('note_id', noteId)
                .single();

            if (existing) {
                await supabase.from('likes').delete().eq('id', existing.id);
                return { liked: false };
            } else {
                await supabase.from('likes').insert({ user_id: user.id, note_id: noteId });
                return { liked: true };
            }
        },

        async getCount(noteId) {
            await initSupabase();
            const { count, error } = await supabase
                .from('likes')
                .select('*', { count: 'exact', head: true })
                .eq('note_id', noteId);

            if (error) throw error;
            return count || 0;
        }
    };

    // ==================== PRESENCE ====================

    const presence = {
        async setOnline(channelId = null, page = null) {
            const mode = await getChatMode();
            if (mode === 'legacy') {
                await legacyChatRequest('/presence', {
                    method: 'POST',
                    body: {
                        status: 'online',
                        boardId: channelId,
                        page
                    }
                });
                return;
            }

            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) return;

            await supabase
                .from('user_presence')
                .upsert({
                    user_id: user.id,
                    status: 'online',
                    last_seen: new Date().toISOString(),
                    current_channel: channelId,
                    current_page: page,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id' });
        },

        async setOffline() {
            const mode = await getChatMode();
            if (mode === 'legacy') {
                await legacyChatRequest('/presence', {
                    method: 'POST',
                    body: { status: 'offline', boardId: null }
                });
                return;
            }

            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) return;

            await supabase
                .from('user_presence')
                .update({
                    status: 'offline',
                    last_seen: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', user.id);
        },

        async setTyping(channelId, isTyping) {
            const mode = await getChatMode();
            if (mode === 'legacy') {
                return;
            }

            await initSupabase();
            const user = await auth.getCurrentUser();
            if (!user) return;

            if (isTyping) {
                await supabase
                    .from('typing_indicators')
                    .upsert({
                        channel_id: channelId,
                        user_id: user.id,
                        is_typing: true,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'channel_id,user_id' });
            } else {
                await supabase
                    .from('typing_indicators')
                    .delete()
                    .eq('channel_id', channelId)
                    .eq('user_id', user.id);
            }
        },

        async getOnline(channelId = null) {
            const mode = await getChatMode();
            if (mode !== 'supabase') {
                const suffix = channelId ? `?boardId=${encodeURIComponent(channelId)}` : '';
                const payload = await legacyChatRequest(`/presence${suffix}`);
                return payload.users || [];
            }

            await initSupabase();
            let query = supabase
                .from('user_presence')
                .select('user_id, status, current_channel, profiles:user_id(username, avatar_url)')
                .eq('status', 'online');

            if (channelId) {
                query = query.eq('current_channel', channelId);
            }

            const { data, error } = await query;
            if (error) {
                return [];
            }
            return data || [];
        },

        async update(status, channelId = null, page = null) {
            if (status === 'offline') {
                return this.setOffline();
            }
            return this.setOnline(channelId, page);
        },

        subscribe(boardId, callback) {
            const state = window.Auth?.getState?.() || {};
            if (!state.user && state.legacyUser) {
                return {
                    type: 'legacy-presence',
                    timer: window.setInterval(() => callback({ boardId }), 10000)
                };
            }

            if (!supabase) {
                return null;
            }

            const channel = supabase
                .channel(`presence:${boardId || 'global'}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'user_presence'
                }, callback)
                .subscribe();
            return channel;
        }
    };

    // ==================== EXPORT ====================

    // Auto-initialize on load
    window.SupabaseClient = {
        init: initSupabase,
        supabase,
        getSupabase: () => supabase,
        isReady: () => isInitialized,
        
        auth,
        notes,
        notebooks,
        communityNotes,
        profile,
        chat,
        channels,
        likes,
        presence,
        files
    };

    // Start initialization immediately
    initSupabase().catch(err => {
        console.error('Auto-init failed:', err);
    });

    console.log('SupabaseClient module loaded');
})();
