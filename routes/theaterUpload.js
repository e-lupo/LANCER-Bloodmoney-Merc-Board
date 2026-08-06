const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const helpers = require('../helpers');
const dataStore = require('../models/dataStore');
const { requireAdminAuth } = require('../middleware/auth');

const router = express.Router();

const FILE_UPLOAD = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: new Set(['image/png', 'image/jpeg', 'image/bmp'])
};

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.bmp']);

// Temp upload dir (reused for both background and texture uploads)
const tmpUploadDir = path.join(dataStore.getDataDir(), 'uploads_tmp');
fs.mkdirSync(tmpUploadDir, { recursive: true });
fs.mkdirSync(dataStore.getTheaterAssetsDir(), { recursive: true });
fs.mkdirSync(dataStore.getPlanetTexturesDir(), { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tmpUploadDir),
  filename: (req, file, cb) => {
    const normalized = String(file.originalname || '').replace(/\\/g, '/');
    const ext = path.posix.extname(normalized).toLowerCase();
    cb(null, `${helpers.generateId()}${ext || ''}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!FILE_UPLOAD.ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new Error('Only PNG, JPEG, and BMP images are allowed'));
    }
    cb(null, true);
  },
  limits: { files: 1, fileSize: FILE_UPLOAD.MAX_SIZE }
});

// Returns true if the filename is a safe image basename (no traversal)
function isSafeImageFilename(filename) {
  if (typeof filename !== 'string') return false;
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return false;
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXT.has(ext);
}

// Shared handler: move a validated temp upload into the target directory
function makeUploadHandler(getTargetDir, responseKey) {
  return (req, res) => {
    upload.single('myFile')(req, res, async (err) => {
      if (err) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ success: false, message: err.message || 'Upload failed' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      const ext = path.extname(req.file.originalname || '').toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        try { await fs.promises.unlink(req.file.path); } catch { /* ignore */ }
        return res.status(400).json({ success: false, message: 'Invalid file extension' });
      }

      const filename = `${helpers.generateId()}${ext}`;
      const outputPath = path.join(getTargetDir(), filename);

      try {
        await fs.promises.rename(req.file.path, outputPath);
        return res.json({ success: true, [responseKey]: filename });
      } catch (moveErr) {
        console.error('Theater asset move failed:', moveErr);
        try { await fs.promises.unlink(req.file.path); } catch { /* ignore */ }
        return res.status(500).json({ success: false, message: 'Failed to store uploaded file' });
      }
    });
  };
}

// Shared handler: delete an asset by filename if not in use
function makeDeleteHandler(getTargetDir, inUseCheck) {
  return async (req, res) => {
    const filename = req.params.filename;
    if (!isSafeImageFilename(filename)) {
      return res.status(400).json({ success: false, message: 'Invalid filename' });
    }

    if (inUseCheck(filename)) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete: asset is currently in use by a theater'
      });
    }

    const filePath = path.join(getTargetDir(), filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }

    try {
      await fs.promises.unlink(filePath);
      res.json({ success: true, message: 'Asset deleted successfully' });
    } catch (error) {
      console.error('Error deleting theater asset:', error);
      res.status(500).json({ success: false, message: 'Failed to delete asset' });
    }
  };
}

// Upload theater background (flat map)
router.post(
  '/upload/theater-background',
  requireAdminAuth,
  makeUploadHandler(() => dataStore.getTheaterAssetsDir(), 'backgroundImage')
);

// Upload planet texture (Iteration 2 asset storage; endpoint reserved and functional)
router.post(
  '/upload/planet-texture',
  requireAdminAuth,
  makeUploadHandler(() => dataStore.getPlanetTexturesDir(), 'textureImage')
);

// Delete theater background
router.delete(
  '/api/theater-assets/:filename',
  requireAdminAuth,
  makeDeleteHandler(
    () => dataStore.getTheaterAssetsDir(),
    (filename) => dataStore.readTheaters().some(t => t.backgroundImage === filename)
  )
);

// Delete planet texture
router.delete(
  '/api/planet-textures/:filename',
  requireAdminAuth,
  makeDeleteHandler(
    () => dataStore.getPlanetTexturesDir(),
    (filename) => dataStore.readTheaters().some(t => t.textureImage === filename)
  )
);

module.exports = router;