/**
 * Natural Language Processing module
 *
 * Exports all NL functionality for intent classification,
 * context management, and response formatting.
 */

// Types
export * from './types.js';

// Intent Classifier
export { IntentClassifier, getIntentClassifier } from './intent-classifier.js';

// Context Manager
export { ContextManager, getContextManager, resetContextManager } from './context-manager.js';

// Question Bridge
export { QuestionBridge, getQuestionBridge } from './question-bridge.js';

// Response Formatter
export { ResponseFormatter, getResponseFormatter } from './response-formatter.js';

// Summarizer
export { Summarizer, getSummarizer } from './summarizer.js';

// Memory Persistor
export { MemoryPersistor, getMemoryPersistor, resetMemoryPersistor } from './memory-persistor.js';
