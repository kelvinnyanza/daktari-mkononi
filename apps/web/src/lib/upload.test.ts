import { describe, expect, it } from 'vitest';
import { buildUploadForm, resolveUploadUrl, type PresignedUploadTarget } from './upload';

const target: PresignedUploadTarget = {
  key: 'doctor-docs/d1/id-0123456789abcdef.pdf',
  url: 'https://daktari-docs.s3.af-south-1.amazonaws.com/',
  method: 'POST',
  fields: { key: 'doctor-docs/d1/id-0123456789abcdef.pdf', 'Content-Type': 'application/pdf', Policy: 'p' },
  contentType: 'application/pdf',
  maxBytes: 10,
  expiresAt: '2026-11-03T10:05:00Z',
};

describe('direct upload helpers', () => {
  it('absolute (S3) URLs are kept; relative (local) ones go to the API', () => {
    expect(resolveUploadUrl(target.url, 'http://api')).toBe(target.url);
    expect(resolveUploadUrl('/api/v1/files/upload/tok', 'http://localhost:4000')).toBe(
      'http://localhost:4000/api/v1/files/upload/tok',
    );
  });

  it('signed fields come first, in order, and the file is the LAST part with the signed type', () => {
    const form = buildUploadForm(target, new Blob(['%PDF-'], { type: 'text/plain' }), 'id.pdf');
    const names = [...form.keys()];
    expect(names).toEqual(['key', 'Content-Type', 'Policy', 'file']);
    const file = form.get('file') as File;
    expect(file.type).toBe('application/pdf');
    expect(file.name).toBe('id.pdf');
  });
});
