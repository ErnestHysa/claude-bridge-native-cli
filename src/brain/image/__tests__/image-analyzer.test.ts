import { describe, expect, it } from 'vitest';
import { analyzeTelegramImage } from '../image-analyzer.js';

describe('analyzeTelegramImage', () => {
  it('extracts metadata from telegram photo', () => {
    const analysis = analyzeTelegramImage('/tmp/path/screenshot.png', {
      file_id: 'abc',
      file_unique_id: 'u1',
      width: 1920,
      height: 1080,
      file_size: 12345,
    });

    expect(analysis.filename).toBe('screenshot.png');
    expect(analysis.width).toBe(1920);
    expect(analysis.height).toBe(1080);
    expect(analysis.sizeBytes).toBe(12345);
    expect(typeof analysis.receivedAt).toBe('number');
  });
});
