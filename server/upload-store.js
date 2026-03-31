const fs = require('fs');
const path = require('path');

const ALLOWED_IMAGE_TYPES = Object.freeze({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp'
});

const ALLOWED_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

module.exports = {
    ALLOWED_IMAGE_TYPES,
    createUploadStore
};

function sanitizeBaseName(value, fallback = 'file') {
    const normalized = String(value || '')
        .replace(/\.[^.]+$/u, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);

    return normalized || fallback;
}

function parseBase64(dataBase64) {
    const raw = String(dataBase64 || '').trim();
    if (!raw) {
        throw createUploadError(400, 'INVALID_UPLOAD', 'Missing file data.');
    }

    const normalized = raw.includes('base64,')
        ? raw.slice(raw.indexOf('base64,') + 'base64,'.length)
        : raw;

    if (!/^[A-Za-z0-9+/=\s]+$/u.test(normalized)) {
        throw createUploadError(400, 'INVALID_UPLOAD', 'Upload data is not valid base64.');
    }

    const buffer = Buffer.from(normalized, 'base64');
    if (!buffer.length) {
        throw createUploadError(400, 'INVALID_UPLOAD', 'Upload data is empty.');
    }
    return buffer;
}

function createUploadError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function validateImagePayload(payload, maxBytes) {
    const fileName = String(payload?.fileName || '').trim();
    const mimeType = String(payload?.mimeType || '').trim().toLowerCase();
    const extension = path.extname(fileName).replace(/^\./u, '').toLowerCase();

    if (!fileName || !mimeType) {
        throw createUploadError(400, 'INVALID_UPLOAD', 'fileName and mimeType are required.');
    }
    if (!ALLOWED_IMAGE_TYPES[mimeType]) {
        throw createUploadError(400, 'UNSUPPORTED_FILE_TYPE', 'Only PNG, JPG, GIF, and WEBP images are supported.');
    }
    if (!extension || !ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
        throw createUploadError(400, 'UNSUPPORTED_FILE_TYPE', 'The file extension is not supported.');
    }
    if (mimeType === 'image/jpeg' && !['jpg', 'jpeg'].includes(extension)) {
        throw createUploadError(400, 'UNSUPPORTED_FILE_TYPE', 'JPEG images must use .jpg or .jpeg.');
    }
    if (mimeType !== 'image/jpeg' && ALLOWED_IMAGE_TYPES[mimeType] !== extension) {
        throw createUploadError(400, 'UNSUPPORTED_FILE_TYPE', 'The file extension does not match the image type.');
    }

    const buffer = parseBase64(payload.dataBase64);
    if (buffer.length > maxBytes) {
        throw createUploadError(413, 'PAYLOAD_TOO_LARGE', 'The uploaded image is too large.');
    }

    return {
        buffer,
        mimeType,
        extension: mimeType === 'image/jpeg' ? 'jpg' : ALLOWED_IMAGE_TYPES[mimeType],
        originalName: fileName,
        size: buffer.length
    };
}

function createUploadStore(options = {}) {
    const baseDir = options.baseDir || process.cwd();
    const dataDir = options.dataDir || process.env.APP_DATA_DIR || path.join(baseDir, 'data');
    const uploadsRoot = path.join(dataDir, 'uploads');
    const avatarsRoot = path.join(uploadsRoot, 'avatars');
    const noteImagesRoot = path.join(uploadsRoot, 'note-images');

    fs.mkdirSync(avatarsRoot, { recursive: true });
    fs.mkdirSync(noteImagesRoot, { recursive: true });

    function saveAvatar(userId, payload, optionsOverride = {}) {
        const image = validateImagePayload(payload, optionsOverride.maxBytes || (2 * 1024 * 1024));
        const userDir = path.join(avatarsRoot, String(userId));
        fs.mkdirSync(userDir, { recursive: true });

        for (const file of fs.readdirSync(userDir)) {
            if (/^avatar\./u.test(file)) {
                fs.rmSync(path.join(userDir, file), { force: true });
            }
        }

        const fileName = `avatar.${image.extension}`;
        fs.writeFileSync(path.join(userDir, fileName), image.buffer);

        return {
            url: `/uploads/avatars/${encodeURIComponent(String(userId))}/${fileName}`,
            name: fileName,
            mimeType: image.mimeType,
            size: image.size
        };
    }

    function saveNoteImage(userId, payload, optionsOverride = {}) {
        const image = validateImagePayload(payload, optionsOverride.maxBytes || (5 * 1024 * 1024));
        const userDir = path.join(noteImagesRoot, String(userId));
        fs.mkdirSync(userDir, { recursive: true });

        const safeBaseName = sanitizeBaseName(image.originalName, 'note-image');
        const fileName = `${Date.now()}-${safeBaseName}.${image.extension}`;
        fs.writeFileSync(path.join(userDir, fileName), image.buffer);

        return {
            url: `/uploads/note-images/${encodeURIComponent(String(userId))}/${fileName}`,
            name: image.originalName,
            mimeType: image.mimeType,
            size: image.size
        };
    }

    return {
        uploadsRoot,
        saveAvatar,
        saveNoteImage
    };
}
