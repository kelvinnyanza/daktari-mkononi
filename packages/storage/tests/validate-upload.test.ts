import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, UploadValidationError, validateUpload } from '../src/validate-upload.js';

const PDF = Buffer.from('%PDF-1.7\n%fake little document');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(32),
]);
/** Windows executable: MZ header — the classic renamed-malware payload. */
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(128)]);

function expectRejection(input: Parameters<typeof validateUpload>[0], code: string): void {
  try {
    validateUpload(input);
    throw new Error(`expected rejection ${code}, but validation passed`);
  } catch (error) {
    expect(error).toBeInstanceOf(UploadValidationError);
    expect((error as UploadValidationError).code).toBe(code);
  }
}

describe('validateUpload', () => {
  it('accepts each allowlisted type and canonicalizes extension/MIME', () => {
    expect(validateUpload({ fileName: 'cert.pdf', mimeType: 'application/pdf', data: PDF })).toEqual({
      kind: 'pdf',
      extension: 'pdf',
      contentType: 'application/pdf',
    });
    expect(validateUpload({ fileName: 'photo.JPEG', mimeType: 'image/jpeg', data: JPG })).toEqual({
      kind: 'jpg',
      extension: 'jpg',
      contentType: 'image/jpeg',
    });
    expect(validateUpload({ fileName: 'scan.png', mimeType: 'image/png', data: PNG }).kind).toBe('png');
    expect(validateUpload({ fileName: 'id.webp', mimeType: 'image/webp', data: WEBP }).kind).toBe('webp');
  });

  it('rejects a fake extension by magic bytes: an .exe renamed to .pdf', () => {
    expectRejection({ fileName: 'totally-a-cert.pdf', mimeType: 'application/pdf', data: EXE }, 'CONTENT_MISMATCH');
  });

  it('rejects content/extension cross-play: PNG bytes with a .jpg name', () => {
    expectRejection({ fileName: 'photo.jpg', mimeType: 'image/jpeg', data: PNG }, 'CONTENT_MISMATCH');
  });

  it('rejects a declared MIME that disagrees with the extension', () => {
    expectRejection({ fileName: 'cert.pdf', mimeType: 'image/png', data: PDF }, 'CONTENT_MISMATCH');
  });

  it('rejects oversize files (10 MB cap) and empty files', () => {
    const oversize = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    expectRejection({ fileName: 'big.pdf', mimeType: 'application/pdf', data: oversize }, 'FILE_TOO_LARGE');
    expectRejection({ fileName: 'empty.pdf', mimeType: 'application/pdf', data: Buffer.alloc(0) }, 'EMPTY_FILE');
  });

  it('rejects double extensions', () => {
    expectRejection({ fileName: 'report.pdf.exe', mimeType: 'application/pdf', data: PDF }, 'DOUBLE_EXTENSION');
    expectRejection({ fileName: 'scan.php.jpg', mimeType: 'image/jpeg', data: JPG }, 'DOUBLE_EXTENSION');
  });

  it('rejects disallowed extensions and missing extensions', () => {
    expectRejection({ fileName: 'macro.docx', mimeType: 'application/pdf', data: PDF }, 'UNSUPPORTED_TYPE');
    expectRejection({ fileName: 'noext', mimeType: 'application/pdf', data: PDF }, 'UNSUPPORTED_TYPE');
  });

  it('ignores directory components when checking the name', () => {
    const result = validateUpload({
      fileName: 'C:\\Users\\daktari\\Desktop\\cert.pdf',
      mimeType: 'application/pdf',
      data: PDF,
    });
    expect(result.kind).toBe('pdf');
  });
});
