import { Page } from 'playwright';
import * as crypto from 'crypto';

export interface StreamConfig {
  targetFps?: number;
  idleFps?: number;
  changeThreshold?: number; // 哈希或像素差异阈值
}

export interface FrameSink {
  isAvailable(): boolean;
  sendFrame(frame: Buffer): boolean;
}

export class ScreencastStreamer {
  private isStreaming = false;
  private timer: NodeJS.Timeout | null = null;
  private frameSeq = 0;
  private lastImageHash = '';

  constructor(
    private page: Page,
    private sink: FrameSink,
    private taskId: string,
    private config: StreamConfig = {}
  ) {}

  public start(): void {
    if (this.isStreaming) return;
    this.isStreaming = true;
    this.scheduleNextFrame(100);
  }

  public stop(): void {
    this.isStreaming = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextFrame(delayMs: number): void {
    if (!this.isStreaming) return;
    this.timer = setTimeout(() => this.captureAndSend(), delayMs);
  }

  private async captureAndSend(): Promise<void> {
    if (!this.isStreaming || !this.sink.isAvailable()) {
      this.scheduleNextFrame(1000);
      return;
    }

    const tStart = Date.now();
    try {
      // 获取 1280x720 图像 JPEG/WebP
      const buffer = await this.page.screenshot({
        type: 'jpeg',
        quality: 60,
      });

      const hash = crypto.createHash('md5').update(buffer).digest('hex');
      const isChanged = hash !== this.lastImageHash;
      this.lastImageHash = hash;

      const targetFps = this.config.targetFps || 5;
      const idleFps = this.config.idleFps || 1;
      const intervalMs = isChanged ? 1000 / targetFps : 1000 / idleFps;

      if (isChanged) {
        this.frameSeq++;
        const binaryHeader = this.encodeBinaryHeader(
          this.taskId,
          this.frameSeq,
          tStart,
          1280,
          720,
          buffer.length
        );
        const packet = Buffer.concat([binaryHeader, buffer]);
        this.sink.sendFrame(packet);
      }

      const elapsed = Date.now() - tStart;
      const nextDelay = Math.max(0, intervalMs - elapsed);
      this.scheduleNextFrame(nextDelay);
    } catch {
      this.scheduleNextFrame(1000);
    }
  }

  private encodeBinaryHeader(
    taskId: string,
    seq: number,
    timestampMs: number,
    width: number,
    height: number,
    imageLen: number
  ): Buffer {
    const magic = Buffer.from('SMFR', 'utf-8');
    const taskIdBytes = Buffer.from(taskId, 'utf-8');

    // 格式：[4B Magic][1B Version][1B Flags][4B Seq][8B Timestamp][2B W][2B H][4B TaskIdLen][TaskId][4B ImageLen]
    const header = Buffer.alloc(30 + taskIdBytes.length);
    let offset = 0;

    magic.copy(header, offset); offset += 4;
    header.writeUInt8(1, offset++); // Version
    header.writeUInt8(0, offset++); // Flags
    header.writeUInt32BE(seq, offset); offset += 4;
    header.writeBigInt64BE(BigInt(timestampMs), offset); offset += 8;
    header.writeUInt16BE(width, offset); offset += 2;
    header.writeUInt16BE(height, offset); offset += 2;
    header.writeUInt32BE(taskIdBytes.length, offset); offset += 4;
    taskIdBytes.copy(header, offset); offset += taskIdBytes.length;
    header.writeUInt32BE(imageLen, offset); offset += 4;

    return header;
  }
}
