# 📸 Sturgeon Spirits Recipe Photo Upload Backend

Backend API for uploading recipe photos to Google Drive.

## Features

- Upload photos to Google Drive
- Automatic folder organization
- Public URL generation
- Delete photos from Drive

## Deployment

Deployed on Render.com

## Environment Variables

Required:
- `GOOGLE_CREDENTIALS` - Service account credentials (JSON)

## Endpoints

- `GET /` - API info
- `GET /api/health` - Health check
- `POST /api/upload-photo` - Upload photo (multipart/form-data)
- `DELETE /api/delete-photo/:fileId` - Delete photo

## Upload Format

```javascript
const formData = new FormData();
formData.append('photo', file);

fetch('https://your-backend-url/api/upload-photo', {
  method: 'POST',
  body: formData
});
```

## Response

```json
{
  "success": true,
  "url": "https://drive.google.com/uc?id=...",
  "fileId": "..."
}
```
