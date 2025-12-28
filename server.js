const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

// CORS configuration - allow all origins
app.use(cors());

// Parse JSON
app.use(express.json());

// Load service account credentials from environment variable
let credentials;
try {
  credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
} catch (error) {
  console.error('Error parsing GOOGLE_CREDENTIALS:', error);
  process.exit(1);
}

// Google Drive folder configuration
const PARENT_FOLDER_NAME = 'sturgeon spirits all';
const SUBFOLDER_NAME = 'Sturgeon Recipes Photos';

// Initialize Google Drive API
const auth = new google.auth.GoogleAuth({
  credentials: credentials,
  scopes: ['https://www.googleapis.com/auth/drive']
});

const drive = google.drive({ version: 'v3', auth });

// Find or create folder structure
async function getOrCreateFolder(folderName, parentId = null) {
  try {
    // Search for existing folder
    const query = parentId 
      ? `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      : `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    
    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (response.data.files.length > 0) {
      console.log(`Found existing folder: ${folderName}`);
      return response.data.files[0].id;
    }

    // Create folder if it doesn't exist
    console.log(`Creating folder: ${folderName}`);
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : []
    };

    const folder = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id'
    });

    // Make folder accessible
    await drive.permissions.create({
      fileId: folder.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });

    return folder.data.id;
  } catch (error) {
    console.error(`Error with folder ${folderName}:`, error);
    throw error;
  }
}

// Upload photo endpoint
app.post('/api/upload-photo', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    console.log('Uploading file:', req.file.originalname);

    // Get or create folder structure
    const parentFolderId = await getOrCreateFolder(PARENT_FOLDER_NAME);
    const photosFolderId = await getOrCreateFolder(SUBFOLDER_NAME, parentFolderId);

    // Upload file to Drive
    const fileMetadata = {
      name: req.file.originalname,
      parents: [photosFolderId]
    };

    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(req.file.path)
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink'
    });

    // Make file publicly accessible
    await drive.permissions.create({
      fileId: file.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });

    // Get direct image URL
    const imageUrl = `https://drive.google.com/uc?id=${file.data.id}`;

    // Clean up temporary file
    fs.unlinkSync(req.file.path);

    console.log('Upload successful:', imageUrl);

    res.json({
      success: true,
      url: imageUrl,
      fileId: file.data.id
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up temp file on error
    if (req.file && req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete photo endpoint
app.delete('/api/delete-photo/:fileId', async (req, res) => {
  try {
    await drive.files.delete({
      fileId: req.params.fileId
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Photo upload server is running',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Sturgeon Spirits Photo Upload API',
    endpoints: {
      health: '/api/health',
      upload: 'POST /api/upload-photo',
      delete: 'DELETE /api/delete-photo/:fileId'
    }
  });
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Photo upload server running on port ${PORT}`);
  console.log(`📸 Uploading to: ${PARENT_FOLDER_NAME}/${SUBFOLDER_NAME}`);
  console.log(`💚 Backend ready!`);
});
