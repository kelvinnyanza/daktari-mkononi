/** Thrown when GCM authentication fails on decrypt — the ciphertext, tag, or key is wrong. */
export class TamperedDataError extends Error {
  constructor(message = 'Decryption failed: data is tampered or the key is wrong') {
    super(message);
    this.name = 'TamperedDataError';
  }
}

/** Thrown when an encrypted payload cannot be parsed (bad JSON, unknown version, bad hex). */
export class InvalidPayloadError extends Error {
  constructor(message = 'Invalid encrypted payload format') {
    super(message);
    this.name = 'InvalidPayloadError';
  }
}

/** Thrown when an encryption key has the wrong length for AES-256. */
export class InvalidKeyError extends Error {
  constructor(message = 'Encryption key must be exactly 32 bytes') {
    super(message);
    this.name = 'InvalidKeyError';
  }
}
