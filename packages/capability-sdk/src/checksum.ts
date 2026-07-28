import * as crypto from 'crypto';

export class ChecksumValidator {
  public static computeSha256(content: string | Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  public static verifySha256(content: string | Buffer, expectedHash: string): boolean {
    const actual = this.computeSha256(content);
    return actual.toLowerCase() === expectedHash.toLowerCase();
  }
}
