'use strict';

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
const REQUIRED_R2_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
];

function getR2PublicBaseUrl() {
  const raw = (process.env.R2_PUBLIC_BASE_URL || process.env.R2_PUBLIC_URL || '').trim();
  return raw ? raw.replace(/\/+$/, '') : '';
}

function getStorageDriver() {
  const raw = String(process.env.STORAGE_DRIVER || '').trim().toLowerCase();
  if (raw) return raw;
  return isR2Configured() ? 'r2' : 'local';
}

function isR2Configured() {
  return Boolean(
    REQUIRED_R2_VARS.every((k) => Boolean((process.env[k] || '').trim())) &&
    getR2PublicBaseUrl()
  );
}

function assertStorageConfig() {
  const driver = getStorageDriver();
  if (driver === 'r2') {
    const missing = REQUIRED_R2_VARS.filter((k) => !(process.env[k] || '').trim());
    if (!getR2PublicBaseUrl()) missing.push('R2_PUBLIC_BASE_URL');
    if (missing.length > 0) {
      throw new Error(
        `[storage] STORAGE_DRIVER=r2 is set but required env var(s) are missing: ${missing.join(', ')}`
      );
    }
  } else if (driver !== 'local') {
    throw new Error(`[storage] Unsupported STORAGE_DRIVER="${driver}". Must be "local" or "r2".`);
  }
}

// Self-initialize on module load: fail fast if STORAGE_DRIVER=r2 with missing vars,
// or ensure local upload directories exist when operating in local mode.
assertStorageConfig();
if (getStorageDriver() === 'local') {
  fs.mkdirSync(path.join(UPLOADS_ROOT, 'products'), { recursive: true });
  fs.mkdirSync(path.join(UPLOADS_ROOT, 'media'), { recursive: true });
}

let s3Client = null;
let s3AccountId = null;

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID.trim();
  if (!s3Client || s3AccountId !== accountId) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim(),
      },
    });
    s3AccountId = accountId;
  }
  return s3Client;
}

function getPublicUrl(key) {
  const cleanKey = String(key || '').replace(/^\/+/, '');
  if (getStorageDriver() === 'r2') {
    return `${getR2PublicBaseUrl()}/${cleanKey}`;
  }
  return `/uploads/${cleanKey}`;
}

async function put({ key, folder, filename, buffer, contentType }) {
  const cleanFolder = String(folder || '').replace(/^\/+|\/+$/g, '');
  const resolvedKey = key
    ? String(key).replace(/^\/+/, '')
    : (cleanFolder ? `${cleanFolder}/${filename}` : filename);

  const driver = getStorageDriver();
  if (driver === 'r2') {
    const client = getR2Client();
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET.trim(),
        Key: resolvedKey,
        Body: buffer,
        ContentType: contentType,
      })
    );
    return { url: getPublicUrl(resolvedKey), key: resolvedKey, storage: 'r2' };
  }

  const targetPath = path.join(UPLOADS_ROOT, resolvedKey);
  const normalizedTarget = path.resolve(targetPath);
  const normalizedRoot   = path.resolve(UPLOADS_ROOT);
  if (!normalizedTarget.startsWith(normalizedRoot + path.sep) && normalizedTarget !== normalizedRoot) {
    const err = new Error('Invalid upload destination path');
    err.status = 400;
    throw err;
  }

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, buffer);
  return { url: getPublicUrl(resolvedKey), key: resolvedKey, storage: 'local' };
}

async function del(keyOrUrl) {
  if (!keyOrUrl || typeof keyOrUrl !== 'string') return false;
  let cleanKey = keyOrUrl.trim();
  const r2Base = getR2PublicBaseUrl();
  if (r2Base && cleanKey.startsWith(`${r2Base}/`)) {
    cleanKey = cleanKey.slice(r2Base.length + 1);
  } else if (cleanKey.startsWith('/uploads/')) {
    cleanKey = cleanKey.slice('/uploads/'.length);
  }
  cleanKey = cleanKey.replace(/^\/+/, '');
  if (!cleanKey || cleanKey.includes('..')) return false;

  if (getStorageDriver() === 'r2') {
    const client = getR2Client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET.trim(),
        Key: cleanKey,
      })
    );
    return true;
  }

  const targetPath = path.join(UPLOADS_ROOT, cleanKey);
  await fs.promises.unlink(targetPath).catch(() => {});
  return true;
}

// Backwards-compatible alias used by admin.controller.js
async function uploadFile(params) {
  return put(params);
}

module.exports = {
  put,
  getPublicUrl,
  delete: del,
  uploadFile,
  isR2Configured,
  getStorageDriver,
  getR2PublicBaseUrl,
  assertStorageConfig,
};
