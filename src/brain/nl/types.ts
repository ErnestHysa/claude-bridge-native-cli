/**
 * Types for Natural Language Processing system
 */

// ===========================================
// Intent Types
// ===========================================

/**
 * Main intent categories for user queries
 */
export type IntentType =
  // File operations
  | 'search_files'      // Find files by pattern (Glob)
  | 'search_content'    // Search within files (Grep)
  | 'read_file'         // Read file contents (Read)
  | 'edit_file'         // Edit existing file (Edit)
  | 'create_file'       // Create new file (Write)
  | 'delete_file'       // Delete file
  // Execution
  | 'run_command'       // Execute bash command
  | 'run_tests'         // Run test suite
  // Analysis
  | 'analyze_code'      // Analyze code quality/structure
  | 'explain_code'      // Explain how code works
  | 'refactor_code'     // Refactor code
  // Project operations
  | 'git_operation'     // Git commands
  | 'build_project'     // Build/compile
  | 'install_deps'      // Install dependencies
  // Memory
  | 'remember'          // Store information
  | 'recall'            // Retrieve from memory
  // Meta
  | 'show_status'       // Show current status
  | 'show_help'         // Show help
  | 'confirm_action'    // Confirm previous action
  | 'cancel_action'     // Cancel current action
  | 'ambiguous'         // Could not determine intent
  | 'unknown';          // No intent detected

/**
 * CLI tools that can be invoked
 */
export type CliTool = 'glob' | 'grep' | 'read' | 'edit' | 'write' | 'bash' | 'custom';

/**
 * Tool parameter extracted from natural language
 */
export interface ToolParameter {
  name: string;
  value: string | string[] | boolean | number;
  confidence: number;
  source: 'explicit' | 'inferred' | 'context';
}

/**
 * Structured intent representation
 */
export interface Intent {
  type: IntentType;
  tool: CliTool;
  parameters: ToolParameter[];
  confidence: number;        // 0-1 score
  alternatives: Intent[];    // Other possible intents if confidence is low
  requiresConfirmation: boolean;
  context?: {
    workingDirectory?: string;
    openFiles?: string[];
    relatedFiles?: string[];
  };
}

/**
 * Intent classification result
 */
export interface IntentClassification {
  intent: Intent;
  rawQuery: string;
  detectedLanguage: string;
  timestamp: number;
  processingTimeMs: number;
}

// ===========================================
// Pattern Matching Types
// ===========================================

/**
 * Pattern rule for intent detection
 */
export interface IntentPattern {
  intent: IntentType;
  tool: CliTool;
  patterns: IntentPatternDefinition[];
  priority: number;
  requiredParams?: string[];
}

/**
 * Individual pattern for matching
 */
export interface IntentPatternDefinition {
  regex: RegExp;
  examples: string[];
  extractors?: ParamExtractor[];
}

/**
 * Parameter extractor from regex matches
 */
export interface ParamExtractor {
  paramName: string;
  captureGroup: number;
  transform?: (value: string) => string | string[] | boolean | number;
}

// ===========================================
// Context Types
// ===========================================

/**
 * Conversation context for disambiguation
 */
export interface ConversationContext {
  chatId: number;
  workingDirectory: string;
  openFiles: Set<string>;
  recentCommands: CommandEntry[];
  explicitContext: string[];
  lastIntent?: Intent;
  projectType?: string;
  preferences: ContextPreferences;
}

/**
 * Command history entry
 */
export interface CommandEntry {
  command: string;
  intent: Intent;
  result?: string;
  timestamp: number;
  duration?: number;
  success: boolean;
}

/**
 * Context preferences
 */
export interface ContextPreferences {
  autoConfirmReads: boolean;
  autoConfirmSafeEdits: boolean;
  preferredLanguage: string;
  defaultFilePattern: string;
}

// ===========================================
// Question/Response Types
// ===========================================

/**
 * Question from agent to user (AskUserQuestion tool bridge)
 */
export interface AgentQuestion {
  id: string;
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
  allowsCustom: boolean;
  timeout?: number;
  timestamp: number;
}

/**
 * Question option
 */
export interface QuestionOption {
  label: string;
  description?: string;
  value: string;
}

/**
 * User response to agent question
 */
export interface QuestionResponse {
  questionId: string;
  selectedValues: string[];
  customInput?: string;
  timestamp: number;
}

// ===========================================
// Response Formatting Types
// ===========================================

/**
 * Formatted response for Telegram
 */
export interface FormattedResponse {
  text: string;
  parseMode: 'Markdown' | 'MarkdownV2' | 'HTML' | null;
  disableWebPagePreview?: boolean;
  replyMarkup?: object;
}

/**
 * Response chunk for long messages
 */
export interface ResponseChunk {
  content: string;
  index: number;
  total: number;
}

/**
 * Summarization options
 */
export interface SummarizeOptions {
  maxLines?: number;
  maxMatches?: number;
  preserveStructure?: boolean;
  addTruncationNotice?: boolean;
}

// ===========================================
// Memory Types
// ===========================================

/**
 * Long-term memory entry
 */
export interface LongTermMemory {
  chatId: number;
  summaries: ConversationSummary[];
  patterns: LearnedPattern[];
  preferences: PersistentPreference;
  lastUpdated: number;
}

/**
 * Conversation summary
 */
export interface ConversationSummary {
  id: string;
  startTime: number;
  endTime: number;
  topic: string;
  keyPoints: string[];
  decisions: string[];
  nextSteps?: string[];
}

/**
 * Learned pattern from user behavior
 */
export interface LearnedPattern {
  id: string;
  type: 'command_usage' | 'file_relationship' | 'workflow' | 'preference';
  pattern: string;
  frequency: number;
  lastSeen: number;
  confidence: number;
}

/**
 * Persistent user preference
 */
export interface PersistentPreference {
  preferredTools: Record<string, CliTool>;
  commonPaths: string[];
  aliasMappings: Record<string, string>;
  personalityHints: string[];
}

// ===========================================
// Soul.md Types
// ===========================================

/**
 * Soul.md frontmatter structure
 */
export interface SoulMetadata {
  identity?: string;
  version?: string;
  'last-updated'?: string;
  'created-at'?: string;
  type?: 'agent' | 'user' | 'project';
}

/**
 * Parsed soul.md content
 */
export interface SoulContent {
  metadata: SoulMetadata;
  identity: SoulIdentity;
  personality?: SoulPersonality;
  capabilities?: string[];
  constraints?: SoulConstraints;
  learning?: SoulLearning;
}

/**
 * Agent identity from soul.md
 */
export interface SoulIdentity {
  name: string;
  purpose?: string;
  role?: string;
  emoji?: string;
}

/**
 * Agent personality from soul.md
 */
export interface SoulPersonality {
  style?: 'professional' | 'friendly' | 'technical' | 'custom';
  communication?: {
    tone?: string;
    verbosity?: 'concise' | 'verbose' | 'terse';
    useEmojis?: boolean;
  };
}

/**
 * Agent constraints from soul.md
 */
export interface SoulConstraints {
  timeWindows?: TimeWindow[];
  apiBudget?: ApiBudget;
  maxConcurrentTasks?: number;
  requireApprovalFor?: string[];
  allowedPaths?: string[];
  deniedPaths?: string[];
}

/**
 * Time window constraint
 */
export interface TimeWindow {
  start: string; // HH:MM
  end: string;   // HH:MM
  days?: number[]; // 0-6, Sunday = 0
  timezone?: string;
}

/**
 * API budget constraint
 */
export interface ApiBudget {
  daily?: number;
  monthly?: number;
  perTask?: number;
}

/**
 * Learning configuration from soul.md
 */
export interface SoulLearning {
  remembers?: string[];
  patterns?: string[];
  preferences?: string[];
  evolves?: boolean;
}
