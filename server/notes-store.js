const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function nowIso() {
    return new Date().toISOString();
}

function createShareId() {
    return crypto.randomBytes(10).toString('hex');
}

function clampLimit(value, fallback = 50) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return fallback;
    }
    return Math.min(Math.floor(numeric), 500);
}

function normalizeBoolean(value, fallback = false) {
    if (value === undefined || value === null) {
        return fallback;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    const normalized = String(value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function normalizeTags(tags) {
    if (Array.isArray(tags)) {
        return tags
            .map((tag) => String(tag || '').trim())
            .filter(Boolean)
            .slice(0, 30);
    }

    if (typeof tags === 'string') {
        return tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, 30);
    }

    return [];
}

function parseTags(rawValue) {
    if (!rawValue) {
        return [];
    }

    if (Array.isArray(rawValue)) {
        return rawValue;
    }

    try {
        const parsed = JSON.parse(rawValue);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function normalizeTextContent(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/`r`n/g, '\n')
        .replace(/`n/g, '\n')
        .replace(/\\n/g, '\n');
}

function stripMarkdown(value) {
    return normalizeTextContent(value)
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[.*?\]\(.*?\)/g, ' ')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/[#>*_~\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildExcerpt(content, limit = 220) {
    const plain = stripMarkdown(content);
    if (plain.length <= limit) {
        return plain;
    }
    return `${plain.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function estimateReadMinutes(content) {
    const words = stripMarkdown(content).split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
}

function mapNoteRow(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        content: normalizeTextContent(row.content),
        market: row.market,
        tags: parseTags(row.tags),
        is_pinned: Boolean(row.is_pinned),
        is_favorite: Boolean(row.is_favorite),
        is_public: Boolean(row.is_public),
        share_id: row.share_id,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

function mapIdeaRow(row, viewerUserId = null) {
    if (!row) {
        return null;
    }

    const tags = parseTags(row.tags);
    const isOwner = viewerUserId !== null && Number(row.user_id) === Number(viewerUserId);
    const visibility = row.is_public ? 'public' : 'private';

    return {
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        content: normalizeTextContent(row.content),
        excerpt: buildExcerpt(row.content),
        market: row.market,
        tags,
        is_pinned: Boolean(row.is_pinned),
        is_favorite: Boolean(row.is_favorite),
        is_public: Boolean(row.is_public),
        share_id: row.share_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        visibility,
        is_owner: isOwner,
        author: {
            id: row.user_id,
            display_name: row.author_display_name || 'Community Member',
            email: row.author_email || null
        },
        engagement: {
            reactions: 0,
            comments: 0,
            shares: row.is_public ? 1 : 0
        },
        stats: {
            read_minutes: estimateReadMinutes(row.content),
            word_count: stripMarkdown(row.content).split(/\s+/).filter(Boolean).length
        }
    };
}

function createNotesStore(options = {}) {
    const baseDir = options.baseDir || process.cwd();
    const dataDir = path.join(baseDir, 'data');
    const dbPath = path.join(dataDir, 'stockandcrypto.db');
    fs.mkdirSync(dataDir, { recursive: true });

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            market TEXT NOT NULL DEFAULT 'General',
            tags TEXT NOT NULL DEFAULT '[]',
            is_pinned INTEGER NOT NULL DEFAULT 0,
            is_favorite INTEGER NOT NULL DEFAULT 0,
            is_public INTEGER NOT NULL DEFAULT 0,
            share_id TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS note_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            market TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
        CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);
        CREATE INDEX IF NOT EXISTS idx_note_versions_note_id ON note_versions(note_id);
    `);

    const getNoteByIdStmt = db.prepare(`
        SELECT *
        FROM notes
        WHERE id = ? AND user_id = ?
        LIMIT 1
    `);

    const getPublicNoteByShareIdStmt = db.prepare(`
        SELECT *
        FROM notes
        WHERE share_id = ? AND is_public = 1
        LIMIT 1
    `);

    const insertNoteStmt = db.prepare(`
        INSERT INTO notes (
            user_id,
            title,
            content,
            market,
            tags,
            is_pinned,
            is_favorite,
            is_public,
            share_id,
            created_at,
            updated_at
        ) VALUES (
            @user_id,
            @title,
            @content,
            @market,
            @tags,
            @is_pinned,
            @is_favorite,
            @is_public,
            @share_id,
            @created_at,
            @updated_at
        )
    `);

    const insertVersionStmt = db.prepare(`
        INSERT INTO note_versions (
            note_id,
            title,
            content,
            market,
            tags,
            created_at
        ) VALUES (
            @note_id,
            @title,
            @content,
            @market,
            @tags,
            @created_at
        )
    `);

    const deleteNoteStmt = db.prepare(`
        DELETE FROM notes
        WHERE id = ? AND user_id = ?
    `);

    function listNotes(userId, options = {}) {
        const clauses = ['user_id = ?'];
        const values = [userId];

        if (options.market) {
            clauses.push('market = ?');
            values.push(String(options.market));
        }

        if (options.tag) {
            clauses.push('tags LIKE ?');
            values.push(`%${String(options.tag).trim()}%`);
        }

        if (options.search) {
            clauses.push('(title LIKE ? OR content LIKE ?)');
            const term = `%${String(options.search).trim()}%`;
            values.push(term, term);
        }

        if (options.pinned !== undefined) {
            clauses.push('is_pinned = ?');
            values.push(normalizeBoolean(options.pinned) ? 1 : 0);
        }

        if (options.favorite !== undefined) {
            clauses.push('is_favorite = ?');
            values.push(normalizeBoolean(options.favorite) ? 1 : 0);
        }

        const orderByMap = {
            created_at: 'created_at',
            updated_at: 'updated_at',
            title: 'title COLLATE NOCASE',
            market: 'market COLLATE NOCASE'
        };

        const requestedSort = String(options.sortBy || options.orderBy || 'updated_at');
        const orderBy = orderByMap[requestedSort] || orderByMap.updated_at;
        const direction = String(options.sortOrder || (options.ascending ? 'asc' : 'desc')).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        const limit = clampLimit(options.limit, 50);
        const offset = Math.max(Number(options.offset) || 0, 0);

        const sql = `
            SELECT *
            FROM notes
            WHERE ${clauses.join(' AND ')}
            ORDER BY ${orderBy} ${direction}
            LIMIT ? OFFSET ?
        `;

        const rows = db.prepare(sql).all(...values, limit, offset);
        return rows.map(mapNoteRow);
    }

    function getNoteForUser(userId, noteId) {
        return mapNoteRow(getNoteByIdStmt.get(noteId, userId));
    }

    function getNoteByShareId(shareId) {
        return mapNoteRow(getPublicNoteByShareIdStmt.get(String(shareId || '').trim()));
    }

    function listIdeas(viewerUserId = null, options = {}) {
        const clauses = [];
        const values = [];

        if (viewerUserId !== null && viewerUserId !== undefined) {
            clauses.push('(notes.is_public = 1 OR notes.user_id = ?)');
            values.push(viewerUserId);
        } else {
            clauses.push('notes.is_public = 1');
        }

        if (options.market) {
            clauses.push('notes.market = ?');
            values.push(String(options.market));
        }

        if (options.tag) {
            clauses.push('notes.tags LIKE ?');
            values.push(`%${String(options.tag).trim()}%`);
        }

        if (options.search) {
            clauses.push('(notes.title LIKE ? OR notes.content LIKE ?)');
            const term = `%${String(options.search).trim()}%`;
            values.push(term, term);
        }

        if (options.visibility === 'public') {
            clauses.push('notes.is_public = 1');
        }

        if (options.visibility === 'private' && viewerUserId !== null && viewerUserId !== undefined) {
            clauses.push('notes.user_id = ?');
            clauses.push('notes.is_public = 0');
            values.push(viewerUserId);
        }

        const orderByMap = {
            created_at: 'notes.created_at',
            updated_at: 'notes.updated_at',
            title: 'notes.title COLLATE NOCASE',
            market: 'notes.market COLLATE NOCASE'
        };

        const requestedSort = String(options.sortBy || options.orderBy || 'updated_at');
        const orderBy = orderByMap[requestedSort] || orderByMap.updated_at;
        const direction = String(options.sortOrder || (options.ascending ? 'asc' : 'desc')).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        const limit = clampLimit(options.limit, 24);
        const offset = Math.max(Number(options.offset) || 0, 0);

        const sql = `
            SELECT
                notes.*,
                users.display_name AS author_display_name,
                users.email AS author_email
            FROM notes
            JOIN users ON users.id = notes.user_id
            WHERE ${clauses.join(' AND ')}
            ORDER BY ${orderBy} ${direction}
            LIMIT ? OFFSET ?
        `;

        const rows = db.prepare(sql).all(...values, limit, offset);
        return rows.map((row) => mapIdeaRow(row, viewerUserId));
    }

    function getNoteForViewer(viewerUserId, noteId) {
        const params = [noteId];
        let viewerClause = 'notes.is_public = 1';

        if (viewerUserId !== null && viewerUserId !== undefined) {
            viewerClause = '(notes.is_public = 1 OR notes.user_id = ?)';
            params.push(viewerUserId);
        }

        const row = db.prepare(`
            SELECT
                notes.*,
                users.display_name AS author_display_name,
                users.email AS author_email
            FROM notes
            JOIN users ON users.id = notes.user_id
            WHERE notes.id = ? AND ${viewerClause}
            LIMIT 1
        `).get(...params);

        return mapIdeaRow(row, viewerUserId);
    }

    function getSharedIdea(shareId) {
        const row = db.prepare(`
            SELECT
                notes.*,
                users.display_name AS author_display_name,
                users.email AS author_email
            FROM notes
            JOIN users ON users.id = notes.user_id
            WHERE notes.share_id = ? AND notes.is_public = 1
            LIMIT 1
        `).get(String(shareId || '').trim());

        return mapIdeaRow(row, null);
    }

    function getRelatedIdeas(viewerUserId, note, limit = 4) {
        if (!note) {
            return [];
        }

        const params = [note.id];
        let visibilityClause = 'notes.is_public = 1';
        if (viewerUserId !== null && viewerUserId !== undefined) {
            visibilityClause = '(notes.is_public = 1 OR notes.user_id = ?)';
            params.push(viewerUserId);
        }

        let marketClause = '';
        if (note.market) {
            marketClause = 'AND notes.market = ?';
            params.push(note.market);
        }

        params.push(clampLimit(limit, 4));

        const rows = db.prepare(`
            SELECT
                notes.*,
                users.display_name AS author_display_name,
                users.email AS author_email
            FROM notes
            JOIN users ON users.id = notes.user_id
            WHERE notes.id != ?
              AND ${visibilityClause}
              ${marketClause}
            ORDER BY notes.updated_at DESC
            LIMIT ?
        `).all(...params);

        return rows.map((row) => mapIdeaRow(row, viewerUserId));
    }

    function createNote(userId, note) {
        const timestamp = nowIso();
        const payload = {
            user_id: userId,
            title: String(note.title || 'Untitled').trim() || 'Untitled',
            content: normalizeTextContent(note.content),
            market: String(note.market || 'General'),
            tags: JSON.stringify(normalizeTags(note.tags)),
            is_pinned: normalizeBoolean(note.is_pinned) ? 1 : 0,
            is_favorite: normalizeBoolean(note.is_favorite) ? 1 : 0,
            is_public: normalizeBoolean(note.is_public) ? 1 : 0,
            share_id: createShareId(),
            created_at: timestamp,
            updated_at: timestamp
        };

        const result = insertNoteStmt.run(payload);
        return getNoteForUser(userId, result.lastInsertRowid);
    }

    function updateNote(userId, noteId, updates = {}) {
        const current = getNoteByIdStmt.get(noteId, userId);
        if (!current) {
            return null;
        }

        insertVersionStmt.run({
            note_id: current.id,
            title: current.title,
            content: current.content,
            market: current.market,
            tags: current.tags || '[]',
            created_at: nowIso()
        });

        const next = {
            title: updates.title !== undefined ? String(updates.title || '').trim() || 'Untitled' : current.title,
            content: updates.content !== undefined ? normalizeTextContent(updates.content) : current.content,
            market: updates.market !== undefined ? String(updates.market || 'General') : current.market,
            tags: updates.tags !== undefined ? JSON.stringify(normalizeTags(updates.tags)) : current.tags,
            is_pinned: updates.is_pinned !== undefined ? (normalizeBoolean(updates.is_pinned) ? 1 : 0) : current.is_pinned,
            is_favorite: updates.is_favorite !== undefined ? (normalizeBoolean(updates.is_favorite) ? 1 : 0) : current.is_favorite,
            is_public: updates.is_public !== undefined ? (normalizeBoolean(updates.is_public) ? 1 : 0) : current.is_public,
            updated_at: nowIso(),
            id: current.id,
            user_id: userId
        };

        db.prepare(`
            UPDATE notes
            SET
                title = @title,
                content = @content,
                market = @market,
                tags = @tags,
                is_pinned = @is_pinned,
                is_favorite = @is_favorite,
                is_public = @is_public,
                updated_at = @updated_at
            WHERE id = @id AND user_id = @user_id
        `).run(next);

        return getNoteForUser(userId, current.id);
    }

    function deleteNote(userId, noteId) {
        return deleteNoteStmt.run(noteId, userId).changes > 0;
    }

    function getNoteVersions(userId, noteId, limit = 10) {
        const note = getNoteByIdStmt.get(noteId, userId);
        if (!note) {
            return null;
        }

        const rows = db.prepare(`
            SELECT *
            FROM note_versions
            WHERE note_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        `).all(noteId, clampLimit(limit, 10));

        return rows.map((row) => ({
            id: row.id,
            note_id: row.note_id,
            title: row.title,
            content: row.content,
            market: row.market,
            tags: parseTags(row.tags),
            created_at: row.created_at
        }));
    }

    return {
        dbPath,
        listNotes,
        listIdeas,
        getNoteForUser,
        getNoteForViewer,
        getNoteByShareId,
        getSharedIdea,
        getRelatedIdeas,
        createNote,
        updateNote,
        deleteNote,
        getNoteVersions
    };
}

module.exports = {
    createNotesStore
};

