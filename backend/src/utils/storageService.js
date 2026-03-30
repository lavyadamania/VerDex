// ============================================================
// Storage Service — Local Disk (Cloud-Ready Abstraction)
// ============================================================
// This module abstracts file storage operations so that
// switching to cloud storage (S3, Cloudinary, GCS) only
// requires swapping this one file.
//
// Current: Local disk storage
// Future:  Set STORAGE_PROVIDER=cloudinary|s3 in .env
// ============================================================
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Base upload directory
const UPLOAD_BASE = path.resolve(__dirname, '../../uploads');

// Ensure base directory exists
if (!fs.existsSync(UPLOAD_BASE)) {
  fs.mkdirSync(UPLOAD_BASE, { recursive: true });
}

/**
 * Get the storage provider name.
 * Future: read from env to switch between local/cloudinary/s3
 */
function getProvider() {
  return process.env.STORAGE_PROVIDER || 'local';
}

/**
 * Save a file (already written by multer) and return a storage reference.
 * For local: returns the relative path from uploads dir.
 * For cloud: would upload to cloud and return the URL.
 *
 * @param {Object} file - Multer file object
 * @param {string} caseId - Case ID for folder organization
 * @returns {Object} { storagePath, storageUrl, provider }
 */
function getFileReference(file, caseId) {
  const provider = getProvider();

  if (provider === 'local') {
    // Convert absolute path to relative path from uploads dir
    const relativePath = path.relative(UPLOAD_BASE, file.path).replace(/\\/g, '/');
    return {
      storagePath: relativePath,                               // e.g., "caseId/document-123456.pdf"
      storageUrl: `/uploads/${relativePath}`,                  // URL served by Express static
      provider: 'local',
      fullPath: file.path,                                     // Absolute path for local operations
    };
  }

  // ── Future Cloud Providers ──
  // if (provider === 'cloudinary') {
  //   const result = await cloudinary.uploader.upload(file.path, {
  //     folder: `court-transparency/${caseId}`,
  //     resource_type: 'auto',
  //   });
  //   // Delete local temp file after cloud upload
  //   fs.unlinkSync(file.path);
  //   return {
  //     storagePath: result.public_id,
  //     storageUrl: result.secure_url,
  //     provider: 'cloudinary',
  //   };
  // }

  // if (provider === 's3') {
  //   const s3Key = `court-transparency/${caseId}/${file.filename}`;
  //   await s3.upload({ Bucket: process.env.S3_BUCKET, Key: s3Key, Body: fs.createReadStream(file.path) }).promise();
  //   fs.unlinkSync(file.path);
  //   return {
  //     storagePath: s3Key,
  //     storageUrl: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${s3Key}`,
  //     provider: 's3',
  //   };
  // }

  // Fallback to local
  const relativePath = path.relative(UPLOAD_BASE, file.path).replace(/\\/g, '/');
  return {
    storagePath: relativePath,
    storageUrl: `/uploads/${relativePath}`,
    provider: 'local',
    fullPath: file.path,
  };
}

/**
 * Get the absolute file path for serving/downloading.
 * For local: resolves from uploads dir.
 * For cloud: returns the URL directly.
 *
 * @param {string} storagePath - Relative path or cloud key
 * @returns {string} Absolute file path or URL
 */
function resolveFilePath(storagePath) {
  const provider = getProvider();

  if (provider === 'local') {
    return path.resolve(UPLOAD_BASE, storagePath);
  }

  // Cloud providers would return URLs
  return storagePath;
}

/**
 * Delete a file from storage.
 *
 * @param {string} storagePath - Relative path or cloud key
 * @returns {boolean} Whether deletion succeeded
 */
function deleteFile(storagePath) {
  const provider = getProvider();

  if (provider === 'local') {
    const fullPath = path.resolve(UPLOAD_BASE, storagePath);
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        logger.info(`🗑️ File deleted: ${storagePath}`);
        return true;
      }
      logger.warn(`File not found for deletion: ${storagePath}`);
      return false;
    } catch (err) {
      logger.error({ err }, `Failed to delete file: ${storagePath}`);
      return false;
    }
  }

  // Cloud: would call cloud delete API
  return false;
}

/**
 * Check if a file exists.
 *
 * @param {string} storagePath
 * @returns {boolean}
 */
function fileExists(storagePath) {
  const provider = getProvider();

  if (provider === 'local') {
    return fs.existsSync(path.resolve(UPLOAD_BASE, storagePath));
  }

  return false;
}

/**
 * Get file stats (size, etc.)
 *
 * @param {string} storagePath
 * @returns {Object|null}
 */
function getFileStats(storagePath) {
  const provider = getProvider();

  if (provider === 'local') {
    const fullPath = path.resolve(UPLOAD_BASE, storagePath);
    try {
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        return {
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
        };
      }
    } catch (err) {
      return null;
    }
  }

  return null;
}

module.exports = {
  getProvider,
  getFileReference,
  resolveFilePath,
  deleteFile,
  fileExists,
  getFileStats,
  UPLOAD_BASE,
};
