/**
 * Vector Store - Semantic memory search using embeddings
 *
 * Stores and searches text embeddings for semantic memory retrieval.
 * Uses cosine similarity to find related memories.
 */

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getBrain } from '../brain-manager.js';

interface EmbeddingRecord {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
  createdAt: number;
}

interface SearchResult {
  id: string;
  text: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

/**
 * Simple embedding generator using term frequency
 * In production, this would call an embedding API like OpenAI's
 */
export class EmbeddingGenerator {
  /**
   * Generate a simple embedding from text using TF-IDF-like approach
   * This is a placeholder - in production use OpenAI embeddings or similar
   */
  generateEmbedding(text: string): number[] {
    // Normalize text
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, ' ').trim();

    // Create character n-gram based embedding (more robust than word-based)
    const ngrams = this.extractNgrams(normalized, 3);

    // Create fixed-size embedding (384 dimensions to match typical embedding models)
    const dimensions = 384;
    const embedding = new Array(dimensions).fill(0);

    // Simple hash-based embedding
    for (const ngram of ngrams) {
      const hash = this.hashCode(ngram);
      for (let i = 0; i < 8; i++) {
        const idx = Math.abs((hash + i) % dimensions);
        embedding[idx] += 1 / Math.sqrt(ngrams.length);
      }
    }

    // Normalize the embedding
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  /**
   * Extract character n-grams from text
   */
  private extractNgrams(text: string, n: number): string[] {
    const ngrams: string[] = [];
    for (let i = 0; i <= text.length - n; i++) {
      ngrams.push(text.slice(i, i + n));
    }
    return ngrams;
  }

  /**
   * Simple hash function for n-grams
   */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

/**
 * Vector Store - manages embeddings and similarity search
 */
export class VectorStore {
  private brain = getBrain();
  private embeddingsDir: string;
  private indexFile: string;
  private cache: Map<string, EmbeddingRecord> = new Map();
  private generator = new EmbeddingGenerator();

  constructor() {
    this.embeddingsDir = join(this.brain.getMemoryDir(), 'embeddings');
    this.indexFile = join(this.embeddingsDir, 'index.json');
  }

  /**
   * Initialize the vector store
   */
  async initialize(): Promise<void> {
    if (!existsSync(this.embeddingsDir)) {
      await mkdir(this.embeddingsDir, { recursive: true });
    }
    await this.loadIndex();
  }

  /**
   * Store an embedding for semantic search
   */
  async storeEmbedding(
    id: string,
    text: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    // Generate embedding
    const embedding = this.generator.generateEmbedding(text);

    const record: EmbeddingRecord = {
      id,
      text: text.substring(0, 1000), // Limit text size
      embedding,
      metadata,
      createdAt: Date.now(),
    };

    // Store in cache and disk
    this.cache.set(id, record);
    await this.saveRecord(record);
    await this.updateIndex();
  }

  /**
   * Semantic search through stored memories
   */
  async semanticSearch(
    query: string,
    limit = 5,
    threshold = 0.3
  ): Promise<SearchResult[]> {
    // Generate query embedding
    const queryEmbedding = this.generator.generateEmbedding(query);

    // Calculate similarities
    const results: Array<{ id: string; text: string; similarity: number; metadata?: Record<string, unknown> }> = [];

    for (const record of this.cache.values()) {
      const similarity = this.cosineSimilarity(queryEmbedding, record.embedding);
      if (similarity >= threshold) {
        results.push({
          id: record.id,
          text: record.text,
          similarity,
          metadata: record.metadata,
        });
      }
    }

    // Sort by similarity and return top results
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  /**
   * Delete an embedding
   */
  async deleteEmbedding(id: string): Promise<boolean> {
    if (!this.cache.has(id)) {
      return false;
    }

    this.cache.delete(id);

    // Delete file
    const filePath = join(this.embeddingsDir, `${id}.json`);
    if (existsSync(filePath)) {
      await unlink(filePath);
    }

    await this.updateIndex();
    return true;
  }

  /**
   * Get all embeddings count
   */
  count(): number {
    return this.cache.size;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  /**
   * Load the embedding index
   */
  private async loadIndex(): Promise<void> {
    if (!existsSync(this.indexFile)) {
      return;
    }

    try {
      const content = await readFile(this.indexFile, 'utf-8');
      const index = JSON.parse(content) as string[];

      // Load all embedding records
      for (const id of index) {
        const filePath = join(this.embeddingsDir, `${id}.json`);
        if (existsSync(filePath)) {
          try {
            const content = await readFile(filePath, 'utf-8');
            const record = JSON.parse(content) as EmbeddingRecord;
            this.cache.set(id, record);
          } catch {
            // Skip corrupted files
          }
        }
      }
    } catch {
      // Index corrupted, start fresh
    }
  }

  /**
   * Save a single embedding record
   */
  private async saveRecord(record: EmbeddingRecord): Promise<void> {
    const filePath = join(this.embeddingsDir, `${record.id}.json`);
    await writeFile(filePath, JSON.stringify(record, null, 2));
  }

  /**
   * Update the index file
   */
  private async updateIndex(): Promise<void> {
    const ids = Array.from(this.cache.keys());
    await writeFile(this.indexFile, JSON.stringify(ids, null, 2));
  }

  /**
   * Clear old embeddings (older than days)
   */
  async cleanupOldEmbeddings(daysOld = 90): Promise<number> {
    const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    let cleaned = 0;

    for (const [id, record] of this.cache.entries()) {
      if (record.createdAt < cutoff) {
        await this.deleteEmbedding(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Search by metadata
   */
  async searchByMetadata(
    key: string,
    value: unknown
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const record of this.cache.values()) {
      if (record.metadata && record.metadata[key] === value) {
        results.push({
          id: record.id,
          text: record.text,
          similarity: 1, // Exact match
          metadata: record.metadata,
        });
      }
    }

    return results;
  }
}

// Global singleton
let globalVectorStore: VectorStore | null = null;

export function getVectorStore(): VectorStore {
  if (!globalVectorStore) {
    globalVectorStore = new VectorStore();
  }
  return globalVectorStore;
}

export function resetVectorStore(): void {
  globalVectorStore = null;
}
