// src/blob.js
import { put } from '@vercel/blob';

export async function uploadImage(file) {
  // file is expected to be a File object or Blob
  const { url } = await put(`questions/${Date.now()}-${file.name}`, file, {
    access: 'public',
  });
  return url;
}

export async function uploadFile(file, folder = 'questions') {
  const { url } = await put(`${folder}/${Date.now()}-${file.name}`, file, {
    access: 'public',
  });
  return url;
}
