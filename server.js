const express = require('express');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

// CORS configuration - allow all origins
app.use(cors());

// Parse JSON
app.use(express.json());

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Upload photo endpoint
app.post('/api/upload-photo', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    console.log('Uploading file to Cloudinary:', req.file.originalname);

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'sturgeon-recipes',
      public_id: `recipe-${Date.now()}`,
      resource_type: 'image',
      overwrite: false
    });

    // Clean up temporary file
    fs.unlinkSync(req.file.path);

    console.log('Upload successful:', result.secure_url);

    res.json({
      success: true,
      url: result.secure_url,
      fileId: result.public_id
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
    await cloudinary.uploader.destroy(req.params.fileId);

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
    message: 'Cloudinary photo upload server is running',
    timestamp: new Date().toISOString(),
    storage: 'Cloudinary'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Sturgeon Spirits Photo Upload API (Cloudinary)',
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
  console.log(`☁️  Using Cloudinary for photo storage`);
  console.log(`💚 Backend ready!`);
});
