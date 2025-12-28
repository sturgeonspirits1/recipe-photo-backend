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

// HARDCODED FOLDER ID (RECOMMENDED)
// Get this from your Drive folder URL: drive.google.com/drive/folders/YOUR_FOLDER_ID
// This is more reliable than searching by name
const PHOTOS_FOLDER_ID = process.env.PHOTOS_FOLDER_ID || null; // Set this in Render env variables!

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
    
    console.log(`Searching for folder: ${folderName}${parentId ? ' in parent: ' + parentId : ''}`);
    console.log(`Query: ${query}`);
    
    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, capabilities)',
      spaces: 'drive'
    });

    if (response.data.files.length > 0) {
      const folder = response.data.files[0];
      console.log(`Found existing folder: ${folderName} (ID: ${folder.id})`);
      
      // Check if we can write to this folder
      if (folder.capabilities && folder.capabilities.canAddChildren === false) {
        throw new Error(`Service account cannot write to folder "${folderName}". Check folder permissions - service account needs "Editor" access.`);
      }
      
      return folder.id;
    }

    // Folder doesn't exist - try to create it
    console.log(`Folder "${folderName}" not found, attempting to create...`);
    
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : []
    };

    const folder = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id'
    });

    console.log(`Created folder: ${folderName} (ID: ${folder.data.id})`);

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
    console.error(`Error with folder ${folderName}:`, error.message);
    
    // Provide helpful error messages
    if (error.message.includes('insufficient permissions')) {
      throw new Error(`Permission denied: Service account cannot access or create folder "${folderName}". Make sure the folder is shared with the service account as "Editor".`);
    }
    
    if (error.message.includes('storage quota')) {
      throw new Error(`Storage quota error: Service accounts don't have their own storage. Share the "${folderName}" folder with the service account (sturgeon-recipes-app@sturgeon-recipes.iam.gserviceaccount.com) as "Editor".`);
    }
    
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

    // Use hardcoded folder ID if available (recommended approach)
    let photosFolderId;
    
    if (PHOTOS_FOLDER_ID) {
      console.log('Using hardcoded folder ID:', PHOTOS_FOLDER_ID);
      photosFolderId = PHOTOS_FOLDER_ID;
      
      // Verify we can access this folder
      try {
        const folderCheck = await drive.files.get({
          fileId: PHOTOS_FOLDER_ID,
          fields: 'id, name, capabilities'
        });
        
        if (folderCheck.data.capabilities && folderCheck.data.capabilities.canAddChildren === false) {
          throw new Error('Service account cannot write to this folder. Make sure folder is shared with service account as "Editor".');
        }
        
        console.log(`Verified access to folder: ${folderCheck.data.name}`);
      } catch (error) {
        console.error('Cannot access folder ID:', PHOTOS_FOLDER_ID);
        throw new Error(`Cannot access folder. Make sure folder is shared with service account (${credentials.client_email}) as "Editor". Error: ${error.message}`);
      }
    } else {
      // Fallback to searching by name (less reliable)
      console.log('No hardcoded folder ID, searching by name...');
      const parentFolderId = await getOrCreateFolder(PARENT_FOLDER_NAME);
      photosFolderId = await getOrCreateFolder(SUBFOLDER_NAME, parentFolderId);
    }

    // Upload file to Drive
    const fileMetadata = {
      name: req.file.originalname,
      parents: [photosFolderId]
    };

    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(req.file.path)
    };

    console.log('Uploading to folder ID:', photosFolderId);

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
