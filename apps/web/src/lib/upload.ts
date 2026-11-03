import { API_BASE_URL } from './config';

/** What POST /doctors/me/documents/upload-url returns (see StoragePort.createPresignedUpload). */
export interface PresignedUploadTarget {
  key: string;
  url: string;
  method: 'POST';
  fields: Record<string, string>;
  contentType: string;
  maxBytes: number;
  expiresAt: string;
}

export class UploadError extends Error {
  constructor(readonly status: number) {
    super(`direct upload failed (${status})`);
    this.name = 'UploadError';
  }
}

/** An absolute URL (S3) is used as-is; a relative one (local dev) is on the API. */
export function resolveUploadUrl(url: string, apiBase: string = API_BASE_URL): string {
  return /^https?:\/\//.test(url) ? url : `${apiBase}${url}`;
}

/**
 * The multipart body S3's POST policy expects: every signed field first, in
 * order, then the file LAST under the name "file". The file is re-wrapped
 * with the signed Content-Type so the browser cannot send a different one.
 */
export function buildUploadForm(target: PresignedUploadTarget, file: Blob, fileName: string): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(target.fields)) form.append(name, value);
  form.append('file', new Blob([file], { type: target.contentType }), fileName);
  return form;
}

/**
 * POST the file straight to storage. Deliberately NO custom headers and NO
 * cookies: the bucket's CORS rule allows a plain POST from the portal origin,
 * and the presigned policy (or the local token) is the only authorization.
 */
export async function uploadToPresignedTarget(
  target: PresignedUploadTarget,
  file: Blob,
  fileName: string,
): Promise<void> {
  const response = await fetch(resolveUploadUrl(target.url), {
    method: 'POST',
    body: buildUploadForm(target, file, fileName),
  });
  if (!response.ok) throw new UploadError(response.status);
}
