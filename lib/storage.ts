// LOCATION: docwire-app/lib/storage.ts
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from './supabase';

export type PickedFile = {
  uri: string;
  name: string;
  size: number | null;
  mimeType: string | null;
};

// Opens the native file picker. Returns null on cancel — callers should
// just no-op in that case, not treat it as an error.
export async function pickDocumentFile(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name,
    size: asset.size ?? null,
    mimeType: asset.mimeType ?? null,
  };
}

// Strips anything unsafe in a storage path, and timestamp-prefixes so
// two uploads of the same original filename never collide in the same
// user folder.
function safeObjectName(originalName: string): string {
  const cleaned = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${Date.now()}-${cleaned}`;
}

export type UploadResult = { path: string } | { error: string };

// Uploads into the CURRENT user's own folder (uploaderId), matching the
// documents_storage_insert_own_folder RLS policy exactly — any other
// prefix will be rejected by Postgres, not just by convention here.
// Deliberately does not touch the documents table; callers insert/
// update that row separately, same two-step shape already used
// elsewhere in this app for document creation.
export async function uploadDocumentFile(file: PickedFile, uploaderId: string): Promise<UploadResult> {
  try {
    const response = await fetch(file.uri);
    const blob = await response.blob();
    const path = `${uploaderId}/${safeObjectName(file.name)}`;
    const { error } = await supabase.storage.from('documents').upload(path, blob, {
      contentType: file.mimeType ?? 'application/octet-stream',
      upsert: false,
    });
    if (error) return { error: error.message };
    return { path };
  } catch (e: any) {
    return { error: e?.message ?? 'Could not read the selected file.' };
  }
}

// Cleanup for the case where the file upload succeeds but the
// following documents insert/update fails — without this, a real
// failure leaves an orphaned file sitting in storage forever (it would
// never become visible via the SELECT policy either, since no matching
// documents.file_path row exists to join against).
export async function deleteUploadedFile(path: string): Promise<void> {
  await supabase.storage.from('documents').remove([path]);
}

// Short-lived signed URL for viewing/downloading. Documents are private
// financial records — never served from a public bucket or a permanent
// URL. Default 5 minutes is enough to open/download once; callers
// needing longer (e.g. a "keep this open" viewer) can pass more.
export async function getDocumentSignedUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

// Derives a human-readable filename from a storage path for display.
// Paths are structured as `{uploaderId}/{timestamp}-{sanitizedName}` —
// this strips both segments. Needed because a document's `name` field is
// its logical title, set once and never changed by a reupload (the same
// way a Word doc keeps its title after you edit its content) — but the
// FILE actually attached can change type entirely (a document named
// "...pdf" reuploaded as a corrected .png, say), and without this, the
// UI gives no visible signal that the real underlying file differs from
// what the document's own name implies.
export function displayFileName(filePath: string): string {
  const afterSlash = filePath.split('/').pop() ?? filePath;
  const dashIndex = afterSlash.indexOf('-');
  return dashIndex >= 0 ? afterSlash.slice(dashIndex + 1) : afterSlash;
}