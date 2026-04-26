'use strict';

const multer = require('multer');

const ALLOWED_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILES_PER_REQUEST = 8;

// ── Magic-byte signatures ─────────────────────────────────────────────────────
// file.mimetype is the client-declared Content-Type header, not the actual bytes.
// An attacker can upload a PHP or HTML file with Content-Type: image/jpeg and
// bypass a MIME-only check. These functions inspect the actual buffer content.
const MAGIC_CHECKERS = {
  // JPEG: FF D8 FF
  'image/jpeg': (buf) =>
    buf.length >= 3 &&
    buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF,

  'image/jpg': (buf) =>
    buf.length >= 3 &&
    buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF,

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  'image/png': (buf) => {
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    return buf.length >= sig.length && sig.every((b, i) => buf[i] === b);
  },

  // WebP: RIFF (bytes 0-3) followed by any 4-byte file size, then WEBP (bytes 8-11)
  'image/webp': (buf) =>
    buf.length >= 12 &&
    buf[0]  === 0x52 && buf[1]  === 0x49 && buf[2]  === 0x46 && buf[3]  === 0x46 &&
    buf[8]  === 0x57 && buf[9]  === 0x45 && buf[10] === 0x42 && buf[11] === 0x50,
};

// ── Multer instance ───────────────────────────────────────────────────────────
// memoryStorage keeps file data in req.files[*].buffer so we can inspect magic
// bytes before writing anything to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,     // 5 MB per file
    files: MAX_FILES_PER_REQUEST,
  },
  fileFilter: (_req, file, cb) => {
    // First gate: client-declared MIME type.
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, and WebP images are allowed'));
    }
    cb(null, true);
  },
});

// ── Magic-bytes checker ───────────────────────────────────────────────────────
// Returns an error string if the buffer does not match the declared MIME type,
// or null if the file is valid.
function verifyMagicBytes(file) {
  const checker = MAGIC_CHECKERS[file.mimetype];
  if (!checker) {
    return `Unsupported file type: ${file.mimetype}`;
  }
  if (!checker(file.buffer)) {
    return `File content does not match declared type "${file.mimetype}". Upload rejected.`;
  }
  return null;
}

// ── Composed middleware ───────────────────────────────────────────────────────
// 1. Multer reads the multipart body, enforces size/count limits, checks MIME.
// 2. Magic-bytes check inspects actual file bytes in the populated buffers.
// 3. Calls next() only when every file passes both checks.
function uploadMiddleware(req, res, next) {
  upload.array('images')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'Image file too large. Maximum size is 5 MB.' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            error: `Too many files. Maximum ${MAX_FILES_PER_REQUEST} files per upload.`,
          });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            error: "Unexpected field. Use the 'images' field name for uploads.",
          });
        }
      }
      return res.status(400).json({ error: err.message });
    }

    // Second gate: verify actual file bytes match the declared MIME type.
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const magicError = verifyMagicBytes(file);
        if (magicError) {
          return res.status(400).json({ error: magicError });
        }
      }
    }

    next();
  });
}

module.exports = { uploadMiddleware, MAX_FILES_PER_REQUEST };
