/**
 * Google Drive API Client for Chrome Extension
 * Uploads course materials directly to user's Google Drive.
 */

export class GoogleDriveUploader {
  constructor() {
    this.token = null;
  }

  async getAuthToken(interactive = true) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError || !token) {
          reject(chrome.runtime.lastError || new Error('Failed to obtain Google auth token'));
        } else {
          this.token = token;
          resolve(token);
        }
      });
    });
  }

  async createFolder(name, parentId = null) {
    if (!this.token) await this.getAuthToken();
    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder'
    };
    if (parentId) metadata.parents = [parentId];

    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    });

    if (!res.ok) throw new Error(`Drive folder creation error: ${res.statusText}`);
    return await res.json(); // { id, name }
  }

  async uploadFile(name, blob, parentId = null) {
    if (!this.token) await this.getAuthToken();

    const metadata = { name };
    if (parentId) metadata.parents = [parentId];

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;

    const metadataBlob = new Blob([
      `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}${delimiter}Content-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`
    ]);

    const multipartBlob = new Blob([metadataBlob, blob, new Blob([closeDelim])]);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartBlob
    });

    if (!res.ok) throw new Error(`Drive file upload error: ${res.statusText}`);
    return await res.json();
  }
}
