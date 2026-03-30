const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// We need generic drive auth instead of just drive.file so we can read/create folders anywhere 
// inside the target directory that the service account has access to.
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const KEY_PATH = path.join(__dirname, '..', 'service-account.json');
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_PATH,
  scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

// Cache to prevent looking up the same folder ID twice
const folderCache = {};

/**
 * Finds a folder by name inside a parent folder, or creates it if not found.
 * @param {string} folderName 
 * @param {string} parentId 
 * @returns {Promise<string>} Folder ID
 */
async function getOrCreateFolder(folderName, parentId) {
  const cacheKey = `${parentId}_${folderName}`;
  if (folderCache[cacheKey]) return folderCache[cacheKey];

  try {
    // 1. Search for existing folder
    const query = `name='${folderName.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (res.data.files && res.data.files.length > 0) {
      folderCache[cacheKey] = res.data.files[0].id;
      return res.data.files[0].id;
    }

    // 2. Not found, create it
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    };
    
    const createRes = await drive.files.create({
      resource: fileMetadata,
      fields: 'id',
    });

    folderCache[cacheKey] = createRes.data.id;
    return createRes.data.id;
  } catch (err) {
    console.error(`Folder resolution error [${folderName}]:`, err.message);
    throw err;
  }
}

/**
 * Upload a file to Google Drive under Semester -> Subject -> Category structure.
 * @param {Object} file - The multer file object.
 * @param {number|string} semester - The semester number (1-8).
 * @param {string} subject - The subject string (e.g., 'Introduction to Computing').
 * @param {string} category - The category string (e.g., 'Lecture Slides', 'Mid-Term Papers').
 * @returns {Promise<{url: string, fileId: string}>}
 */
async function uploadToDrive(file, semester, subject, category) {
  try {
    if (!ROOT_FOLDER_ID) {
      throw new Error('GOOGLE_DRIVE_FOLDER_ID is missing from .env');
    }

    // Resolve folder hierarchy
    const semFolderId = await getOrCreateFolder(`Semester ${semester || 1}`, ROOT_FOLDER_ID);
    const subFolderId = await getOrCreateFolder(subject, semFolderId);
    const catFolderId = await getOrCreateFolder(category, subFolderId);

    // Upload the file inside the resolved leaf folder
    const fileMetadata = {
      name: file.originalname,
      parents: [catFolderId],
    };
    
    const media = {
      mimeType: file.mimetype,
      body: fs.createReadStream(file.path),
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });

    // Make file publicly viewable so preview URLs work for students
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    return {
      url: response.data.webViewLink,
      fileId: response.data.id,
    };
  } catch (error) {
    console.error('Drive Upload Error:', error.message);
    throw error;
  } finally {
    // Always clean up the local temp multer file!
    try {
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (_) { /* silent */ }
  }
}

/**
 * Delete a file from Google Drive.
 * @param {string} fileId - The Drive file ID.
 */
async function deleteFromDrive(fileId) {
  if (!fileId) return;
  try {
    await drive.files.delete({ fileId });
  } catch (error) {
    // 404 means file was already deleted — that's fine
    if (error.code !== 404) {
      console.error('Drive Delete Error:', error.message);
      throw error;
    }
  }
}

module.exports = { uploadToDrive, deleteFromDrive };
