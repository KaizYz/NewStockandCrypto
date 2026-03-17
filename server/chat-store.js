const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function nowIso() {
    return new Date().toISOString();
}

function clampLimit(value, fallback = 100, max = 500) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return fallback;
    }
    return Math.min(Math.floor(numeric), max);
}

function normalizeBoardName(value, fallback = 'New Lounge') {
    const next = String(value || '').trim();
    return next || fallback;
}

function normalizeBoardTopic(value) {
    return String(value || '').trim();
}

function normalizeMessageContent(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/`r`n/g, '\n')
        .replace(/`n/g, '\n')
        .replace(/\\n/g, '\n')
        .trim();
}

function mapReactionRow(row) {
    return {
        id: row.id,
        message_id: row.message_id,
        user_id: row.user_id,
        emoji: row.emoji,
        created_at: row.created_at,
        user_profiles: {
            username: row.username || 'Community Member'
        }
    };
}

function mapMessageRow(row) {
    const reply = row.reply_message_id ? {
        id: row.reply_message_id,
        content: row.reply_content || '',
        users: {
            username: row.reply_username || 'Community Member'
        }
    } : null;

    return {
        id: row.id,
        board_id: row.board_id,
        user_id: row.user_id,
        content: row.content,
        reply_to: reply,
        attachment_url: row.attachment_url || null,
        attachment_type: row.attachment_type || null,
        attachment_name: row.attachment_name || null,
        is_edited: Boolean(row.is_edited),
        is_deleted: Boolean(row.is_deleted),
        created_at: row.created_at,
        edited_at: row.edited_at || null,
        users: {
            username: row.username || 'Community Member'
        }
    };
}

function mapBoardRow(row) {
    return {
        id: row.id,
        name: row.name,
        topic: row.topic,
        is_public: Boolean(row.is_public),
        created_at: row.created_at,
        members: Number(row.member_count || 0)
    };
}

function createChatStore(options = {}) {
    const baseDir = options.baseDir || process.cwd();
    const dataDir = path.join(baseDir, 'data');
    const dbPath = path.join(dataDir, 'stockandcrypto.db');
    fs.mkdirSync(dataDir, { recursive: true });

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_boards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            topic TEXT NOT NULL DEFAULT '',
            is_public INTEGER NOT NULL DEFAULT 1,
            created_by_user_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS chat_members (
            board_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            joined_at TEXT NOT NULL,
            PRIMARY KEY (board_id, user_id),
            FOREIGN KEY (board_id) REFERENCES chat_boards(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            board_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            reply_to INTEGER,
            attachment_url TEXT,
            attachment_type TEXT,
            attachment_name TEXT,
            is_edited INTEGER NOT NULL DEFAULT 0,
            edited_at TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (board_id) REFERENCES chat_boards(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (reply_to) REFERENCES chat_messages(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS message_reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            emoji TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(message_id, user_id, emoji),
            FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chat_presence (
            user_id INTEGER PRIMARY KEY,
            board_id INTEGER,
            status TEXT NOT NULL DEFAULT 'offline',
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (board_id) REFERENCES chat_boards(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_chat_messages_board_id ON chat_messages(board_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions(message_id);
        CREATE INDEX IF NOT EXISTS idx_chat_presence_board_id ON chat_presence(board_id, updated_at);
    `);

    const seedBoards = [
        { name: 'Crypto Trading', topic: 'crypto', is_public: 1 },
        { name: 'Stock Trading', topic: 'stock', is_public: 1 },
        { name: 'Forex Trading', topic: 'forex', is_public: 1 }
    ];

    const boardCount = db.prepare('SELECT COUNT(*) AS count FROM chat_boards').get();
    if (!Number(boardCount?.count || 0)) {
        const insertSeedBoard = db.prepare(`
            INSERT INTO chat_boards (name, topic, is_public, created_by_user_id, created_at, updated_at)
            VALUES (@name, @topic, @is_public, NULL, @created_at, @updated_at)
        `);
        const timestamp = nowIso();
        for (const board of seedBoards) {
            insertSeedBoard.run({
                ...board,
                created_at: timestamp,
                updated_at: timestamp
            });
        }
    }

    const statements = {
        getBoard: db.prepare(`
            SELECT id, name, topic, is_public, created_at, updated_at
            FROM chat_boards
            WHERE id = ?
            LIMIT 1
        `),
        listBoards: db.prepare(`
            SELECT
                chat_boards.id,
                chat_boards.name,
                chat_boards.topic,
                chat_boards.is_public,
                chat_boards.created_at,
                chat_boards.updated_at,
                COUNT(chat_members.user_id) AS member_count
            FROM chat_boards
            LEFT JOIN chat_members ON chat_members.board_id = chat_boards.id
            WHERE chat_boards.is_public = 1
            GROUP BY chat_boards.id
            ORDER BY chat_boards.created_at ASC
        `),
        createBoard: db.prepare(`
            INSERT INTO chat_boards (name, topic, is_public, created_by_user_id, created_at, updated_at)
            VALUES (@name, @topic, @is_public, @created_by_user_id, @created_at, @updated_at)
        `),
        joinBoard: db.prepare(`
            INSERT INTO chat_members (board_id, user_id, role, joined_at)
            VALUES (@board_id, @user_id, @role, @joined_at)
            ON CONFLICT(board_id, user_id) DO UPDATE SET role = excluded.role
        `),
        insertMessage: db.prepare(`
            INSERT INTO chat_messages (
                board_id, user_id, content, reply_to, attachment_url, attachment_type, attachment_name,
                is_edited, edited_at, is_deleted, deleted_at, created_at, updated_at
            ) VALUES (
                @board_id, @user_id, @content, @reply_to, @attachment_url, @attachment_type, @attachment_name,
                0, NULL, 0, NULL, @created_at, @updated_at
            )
        `),
        getMessageForOwner: db.prepare(`
            SELECT id, board_id, user_id
            FROM chat_messages
            WHERE id = ? AND user_id = ?
            LIMIT 1
        `),
        updateMessage: db.prepare(`
            UPDATE chat_messages
            SET content = @content, is_edited = 1, edited_at = @edited_at, updated_at = @updated_at
            WHERE id = @id AND user_id = @user_id
        `),
        deleteMessage: db.prepare(`
            UPDATE chat_messages
            SET is_deleted = 1, deleted_at = @deleted_at, updated_at = @updated_at
            WHERE id = @id AND user_id = @user_id
        `),
        listMessages: db.prepare(`
            SELECT
                messages.id,
                messages.board_id,
                messages.user_id,
                messages.content,
                messages.reply_to,
                messages.attachment_url,
                messages.attachment_type,
                messages.attachment_name,
                messages.is_edited,
                messages.is_deleted,
                messages.created_at,
                messages.edited_at,
                users.display_name AS username,
                reply.id AS reply_message_id,
                reply.content AS reply_content,
                reply_users.display_name AS reply_username
            FROM chat_messages AS messages
            JOIN users ON users.id = messages.user_id
            LEFT JOIN chat_messages AS reply ON reply.id = messages.reply_to
            LEFT JOIN users AS reply_users ON reply_users.id = reply.user_id
            WHERE messages.board_id = ? AND messages.is_deleted = 0
            ORDER BY messages.created_at ASC
            LIMIT ?
        `),
        listReactions: db.prepare(`
            SELECT
                message_reactions.id,
                message_reactions.message_id,
                message_reactions.user_id,
                message_reactions.emoji,
                message_reactions.created_at,
                users.display_name AS username
            FROM message_reactions
            JOIN users ON users.id = message_reactions.user_id
            WHERE message_reactions.message_id = ?
            ORDER BY message_reactions.created_at ASC
        `),
        addReaction: db.prepare(`
            INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
            VALUES (@message_id, @user_id, @emoji, @created_at)
            ON CONFLICT(message_id, user_id, emoji) DO NOTHING
        `),
        removeReaction: db.prepare(`
            DELETE FROM message_reactions
            WHERE message_id = ? AND user_id = ? AND emoji = ?
        `),
        setPresence: db.prepare(`
            INSERT INTO chat_presence (user_id, board_id, status, updated_at)
            VALUES (@user_id, @board_id, @status, @updated_at)
            ON CONFLICT(user_id) DO UPDATE SET
                board_id = excluded.board_id,
                status = excluded.status,
                updated_at = excluded.updated_at
        `),
        listOnlineUsers: db.prepare(`
            SELECT
                chat_presence.user_id,
                chat_presence.board_id,
                chat_presence.status,
                chat_presence.updated_at,
                users.display_name AS username
            FROM chat_presence
            JOIN users ON users.id = chat_presence.user_id
            WHERE chat_presence.status = 'online'
              AND chat_presence.updated_at >= ?
              AND (? IS NULL OR chat_presence.board_id = ?)
            ORDER BY chat_presence.updated_at DESC
        `)
    };

    function ensureBoardExists(boardId) {
        return statements.getBoard.get(Number(boardId));
    }

    function listBoards() {
        return statements.listBoards.all().map(mapBoardRow);
    }

    function createBoard(userId, payload = {}) {
        const timestamp = nowIso();
        const result = statements.createBoard.run({
            name: normalizeBoardName(payload.name),
            topic: normalizeBoardTopic(payload.topic),
            is_public: payload.is_public === false ? 0 : 1,
            created_by_user_id: userId,
            created_at: timestamp,
            updated_at: timestamp
        });

        statements.joinBoard.run({
            board_id: result.lastInsertRowid,
            user_id: userId,
            role: 'owner',
            joined_at: timestamp
        });

        return mapBoardRow({
            ...ensureBoardExists(result.lastInsertRowid),
            member_count: 1
        });
    }

    function joinBoard(userId, boardId) {
        const board = ensureBoardExists(boardId);
        if (!board) {
            return null;
        }

        statements.joinBoard.run({
            board_id: board.id,
            user_id: userId,
            role: 'member',
            joined_at: nowIso()
        });
        return mapBoardRow({
            ...board,
            member_count: 0
        });
    }

    function listMessages(boardId, limit = 100) {
        return statements.listMessages
            .all(Number(boardId), clampLimit(limit, 100, 300))
            .map(mapMessageRow);
    }

    function sendMessage(userId, boardId, payload = {}) {
        const board = ensureBoardExists(boardId);
        if (!board) {
            return null;
        }

        const content = normalizeMessageContent(payload.content);
        if (!content && !payload.attachment_url) {
            throw new Error('Message content is required.');
        }

        const timestamp = nowIso();
        statements.joinBoard.run({
            board_id: board.id,
            user_id: userId,
            role: 'member',
            joined_at: timestamp
        });
        const result = statements.insertMessage.run({
            board_id: board.id,
            user_id: userId,
            content,
            reply_to: payload.reply_to ? Number(payload.reply_to) : null,
            attachment_url: payload.attachment_url || null,
            attachment_type: payload.attachment_type || null,
            attachment_name: payload.attachment_name || null,
            created_at: timestamp,
            updated_at: timestamp
        });

        return listMessages(board.id, 300).find((message) => message.id === result.lastInsertRowid) || null;
    }

    function editMessage(userId, messageId, content) {
        const owned = statements.getMessageForOwner.get(Number(messageId), userId);
        if (!owned) {
            return null;
        }

        const normalized = normalizeMessageContent(content);
        if (!normalized) {
            throw new Error('Message content is required.');
        }

        const timestamp = nowIso();
        statements.updateMessage.run({
            id: owned.id,
            user_id: userId,
            content: normalized,
            edited_at: timestamp,
            updated_at: timestamp
        });
        return listMessages(owned.board_id, 300).find((message) => message.id === owned.id) || null;
    }

    function deleteMessage(userId, messageId) {
        const owned = statements.getMessageForOwner.get(Number(messageId), userId);
        if (!owned) {
            return false;
        }

        const timestamp = nowIso();
        return statements.deleteMessage.run({
            id: owned.id,
            user_id: userId,
            deleted_at: timestamp,
            updated_at: timestamp
        }).changes > 0;
    }

    function listReactions(messageId) {
        return statements.listReactions.all(Number(messageId)).map(mapReactionRow);
    }

    function addReaction(userId, messageId, emoji) {
        statements.addReaction.run({
            message_id: Number(messageId),
            user_id: userId,
            emoji: String(emoji || '').trim() || 'Like',
            created_at: nowIso()
        });
        return listReactions(messageId);
    }

    function removeReaction(userId, messageId, emoji) {
        statements.removeReaction.run(Number(messageId), userId, String(emoji || '').trim());
        return listReactions(messageId);
    }

    function updatePresence(userId, status = 'online', boardId = null) {
        statements.setPresence.run({
            user_id: userId,
            board_id: boardId ? Number(boardId) : null,
            status: String(status || 'online').trim() || 'online',
            updated_at: nowIso()
        });
    }

    function listOnlineUsers(boardId = null) {
        const cutoff = new Date(Date.now() - (2 * 60 * 1000)).toISOString();
        return statements.listOnlineUsers
            .all(cutoff, boardId ? Number(boardId) : null, boardId ? Number(boardId) : null)
            .map((row) => ({
                user_id: row.user_id,
                status: row.status,
                updated_at: row.updated_at,
                user_profiles: {
                    username: row.username || 'Community Member'
                }
            }));
    }

    return {
        dbPath,
        listBoards,
        createBoard,
        joinBoard,
        listMessages,
        sendMessage,
        editMessage,
        deleteMessage,
        listReactions,
        addReaction,
        removeReaction,
        updatePresence,
        listOnlineUsers
    };
}

module.exports = {
    createChatStore
};
