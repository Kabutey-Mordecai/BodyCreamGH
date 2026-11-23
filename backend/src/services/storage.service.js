const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_URL
  );
}

// Self-initialize local upload directories when operating in local fallback mode
if (!isR2Configured()) {
  fs.mkdirSync(path.join(UPLOADS_ROOT, 'products'), { recursive: true });
  fs.mkdirSync(path.join(UPLOADS_ROOT, 'media'), { recursive: true });
}

let s3Client = null;
let s3AccountId = null;

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!s3Client || s3AccountId !== accountId) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    s3AccountId = accountId;
  }
  return s3Client;
}

/**
 * Upload a buffer to Cloudflare R2 (when configured) or local disk fallback.
 * @param {Object} params
 * @param {string} params.folder - Subfolder under uploads/ or R2 key prefix (e.g. 'products', 'media')
 * @param {string} params.filename - Target filename
 * @param {Buffer} params.buffer - File contents
 * @param {string} [params.contentType] - MIME type
 * @returns {Promise<{ url: string, storage: 'r2' | 'local' }>}
 */
async function uploadFile({ folder, filename, buffer, contentType }) {
  const cleanFolder = String(folder || '').replace(/^\/+|\/+$/g, '');
  const key = cleanFolder ? `${cleanFolder}/${filename}` : filename;

  if (isR2Configured()) {
    const client = getR2Client();
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
    const baseUrl = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
    return {
      url: `${baseUrl}/${key}`,
      storage: 'r2',
    };
  }

  const targetDir = cleanFolder ? path.join(UPLOADS_ROOT, cleanFolder) : UPLOADS_ROOT;
  await fs.promises.mkdir(targetDir, { recursive: true });
  await fs.promises.writeFile(path.join(targetDir, filename), buffer);

  return {
    url: `/uploads/${key}`,
    storage: 'local',
  };
}

module.exports = {
  uploadFile,
  isR2Configured,
};
