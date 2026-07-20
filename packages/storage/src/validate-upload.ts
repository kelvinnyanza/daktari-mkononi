/**
 * Upload validation for user-supplied documents: extension allowlist, size
 * cap, and magic-byte sniffing — the declared MIME/extension is never trusted
 * on its own; the bytes must agree.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export type AllowedUploadKind = 'pdf' | 'jpg' | 'png' | 'webp';

export type UploadRejectionCode =
  | 'FILE_TOO_LARGE'
  | 'EMPTY_FILE'
  | 'UNSUPPORTED_TYPE'
  | 'DOUBLE_EXTENSION'
  | 'CONTENT_MISMATCH';

export class UploadValidationError extends Error {
  constructor(
    readonly code: UploadRejectionCode,
    detail: string,
  ) {
    super(detail);
    this.name = 'UploadValidationError';
  }
}

interface KindSpec {
  extensions: string[];
  mimeTypes: string[];
  matches: (data: Buffer) => boolean;
}

const KINDS: Record<AllowedUploadKind, KindSpec> = {
  pdf: {
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
    matches: (data) => data.subarray(0, 5).toString('latin1') === '%PDF-',
  },
  jpg: {
    extensions: ['jpg', 'jpeg'],
    mimeTypes: ['image/jpeg'],
    matches: (data) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  },
  png: {
    extensions: ['png'],
    mimeTypes: ['image/png'],
    matches: (data) =>
      data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  webp: {
    extensions: ['webp'],
    mimeTypes: ['image/webp'],
    matches: (data) =>
      data.subarray(0, 4).toString('latin1') === 'RIFF' &&
      data.subarray(8, 12).toString('latin1') === 'WEBP',
  },
};

export interface ValidatedUpload {
  kind: AllowedUploadKind;
  /** Canonical extension for the stored key (jpeg → jpg). */
  extension: string;
  /** Canonical MIME type to store/serve, regardless of what the client sent. */
  contentType: string;
}

/**
 * Validate an upload or throw UploadValidationError.
 *
 * - allowlist: pdf, jpg/jpeg, png, webp
 * - max 10 MB, non-empty
 * - double extensions rejected (report.pdf.exe, scan.php.jpg)
 * - magic bytes must match the extension — a renamed .exe never passes
 */
export function validateUpload(input: {
  fileName: string;
  mimeType: string;
  data: Buffer;
}): ValidatedUpload {
  if (input.data.length === 0) {
    throw new UploadValidationError('EMPTY_FILE', 'file is empty');
  }
  if (input.data.length > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError('FILE_TOO_LARGE', 'file exceeds the 10 MB limit');
  }

  const baseName = input.fileName.split(/[\\/]/).pop() ?? '';
  const parts = baseName.toLowerCase().split('.');
  if (parts.length < 2 || parts[0] === '') {
    throw new UploadValidationError('UNSUPPORTED_TYPE', 'file has no extension');
  }
  if (parts.length > 2) {
    throw new UploadValidationError(
      'DOUBLE_EXTENSION',
      `double extensions are not allowed: ${baseName}`,
    );
  }
  const extension = parts[1]!;

  const kindEntry = (Object.entries(KINDS) as Array<[AllowedUploadKind, KindSpec]>).find(
    ([, spec]) => spec.extensions.includes(extension),
  );
  if (kindEntry === undefined) {
    throw new UploadValidationError(
      'UNSUPPORTED_TYPE',
      `extension .${extension} is not allowed (pdf, jpg, png, webp only)`,
    );
  }
  const [kind, spec] = kindEntry;

  if (!spec.mimeTypes.includes(input.mimeType.toLowerCase())) {
    throw new UploadValidationError(
      'CONTENT_MISMATCH',
      `declared type ${input.mimeType} does not match .${extension}`,
    );
  }
  if (!spec.matches(input.data)) {
    throw new UploadValidationError(
      'CONTENT_MISMATCH',
      `file content does not look like ${kind} (magic bytes mismatch)`,
    );
  }

  return { kind, extension: spec.extensions[0]!, contentType: spec.mimeTypes[0]! };
}
