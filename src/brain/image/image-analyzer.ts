/**
 * Image Analyzer - basic metadata extraction for Telegram images
 */

import type { PhotoSize } from 'node-telegram-bot-api';
import { basename } from 'node:path';

export interface ImageAnalysis {
  filename: string;
  path: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  receivedAt: number;
}

export function analyzeTelegramImage(filePath: string, photo?: PhotoSize): ImageAnalysis {
  return {
    filename: basename(filePath),
    path: filePath,
    width: photo?.width,
    height: photo?.height,
    sizeBytes: photo?.file_size,
    receivedAt: Date.now(),
  };
}
