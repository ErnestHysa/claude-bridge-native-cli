/**
 * Natural Language Intent Classifier
 *
 * Maps natural language input to CLI tool intents with parameter extraction
 */

import type {
  Intent,
  IntentType,
  IntentPattern,
  IntentPatternDefinition,
  IntentClassification,
  ConversationContext,
  ToolParameter,
} from './types.js';
import { Logger } from '../../utils.js';

const logger = new Logger('info');

/**
 * Intent pattern definitions
 * Each pattern maps user language to CLI tools
 */
const INTENT_PATTERNS: IntentPattern[] = [
  // ===========================================
  // SEARCH FILES (Glob)
  // ===========================================
  {
    intent: 'search_files',
    tool: 'glob',
    priority: 10,
    patterns: [
      {
        regex: /\b(find|search|list|show)\s+(all\s+)?(?:the\s+)?(\w+)\s+files?\b/i,
        examples: [
          'find all TypeScript files',
          'show all JS files',
          'list the test files',
          'search for ts files',
        ],
        extractors: [
          { paramName: 'fileType', captureGroup: 3, transform: (v: string) => v.toLowerCase() },
        ],
      },
      {
        regex: /\bfind\s+files?\s+(?:with|ending|matching)\s+['"`.]([*.\w]+)['"`.]?/i,
        examples: [
          'find files with .ts extension',
          'find files matching *.test.ts',
        ],
        extractors: [
          { paramName: 'pattern', captureGroup: 1 },
        ],
      },
      {
        regex: /\bwhere\s+(?:are|can\s+I\s+find)\s+(?:the\s+)?(\w+)\s+files?\?*/i,
        examples: [
          'where are the config files?',
          'where can I find the test files?',
        ],
        extractors: [
          { paramName: 'fileType', captureGroup: 1, transform: (v: string) => v.toLowerCase() },
        ],
      },
      {
        regex: /\blist\s+(?:all\s+)?(?:files|directories|folders)\s*(?:in|under|at)?\s*['"`.]?([/\w\s]+)?['"`.]?/i,
        examples: [
          'list all files',
          'list files in src',
          'list directories',
        ],
        extractors: [
          { paramName: 'path', captureGroup: 1 },
        ],
      },
    ],
  },

  // ===========================================
  // SEARCH CONTENT (Grep)
  // ===========================================
  {
    intent: 'search_content',
    tool: 'grep',
    priority: 10,
    patterns: [
      {
        regex: /\b(search|find|look\s+for|grep)\s+(?:for\s+)?(?:the\s+)?(?:function|variable|class|method|word|text|string)\s+['"`.]?([^'"`\s]+)['"`.]?/i,
        examples: [
          'search for function handleError',
          'find the variable named counter',
          'look for the word error',
        ],
        extractors: [
          { paramName: 'searchTerm', captureGroup: 2 },
        ],
      },
      {
        regex: /\b(search|find|grep)\s+(?:for\s+)?['"`.]?([^'"`\s]+)['"`.]?\s+(?:in|within|inside)\s+(?:the\s+)?(?:code|files?|project)?\b/i,
        examples: [
          'search for "TODO" in the code',
          'find "import" in files',
          'grep for error handling',
        ],
        extractors: [
          { paramName: 'searchTerm', captureGroup: 2 },
        ],
      },
      {
        regex: /\bwhere\s+(?:is|are)\s+(?:the\s+)?(?:function|class|variable|method)\s+['"`.]?(\w+)['"`.]?\s+(?:defined|declared|used)/i,
        examples: [
          'where is the function main defined?',
          'where are the tests for handleError?',
        ],
        extractors: [
          { paramName: 'searchTerm', captureGroup: 1 },
          { paramName: 'type', captureGroup: 0, transform: () => 'definition' },
        ],
      },
      {
        regex: /\bshow\s+me\s+(?:all\s+)?(?:occurrences|uses|references)\s+(?:of\s+)?['"`.]?(\w+)['"`.]?/i,
        examples: [
          'show me all occurrences of logger',
          'show references to User',
        ],
        extractors: [
          { paramName: 'searchTerm', captureGroup: 1 },
          { paramName: 'type', captureGroup: 0, transform: () => 'references' },
        ],
      },
    ],
  },

  // ===========================================
  // READ FILE
  // ===========================================
  {
    intent: 'read_file',
    tool: 'read',
    priority: 10,
    patterns: [
      {
        regex: /\b(show|read|display|open|view|cat)\s+(?:the\s+)?(?:file\s+)?['"`.]?([/\w.\-]+)['"`.]?/i,
        examples: [
          'show utils.ts',
          'read the file package.json',
          'display config.ts',
          'open src/index.ts',
        ],
        extractors: [
          { paramName: 'filePath', captureGroup: 2 },
        ],
      },
      {
        regex: /\bwhat(?:'s|\s+is)\s+(?:in\s+)?(?:the\s+)?(?:file\s+)?['"`.]?([/\w.\-]+)['"`.]?\?*/i,
        examples: [
          "what's in utils.ts",
          'what is the content of package.json',
        ],
        extractors: [
          { paramName: 'filePath', captureGroup: 1 },
        ],
      },
      {
        regex: /\b(show|read|view)\s+(?:me\s+)?(?:the\s+)?contents?\s+(?:of\s+)?['"`.]?([/\w.\-]+)['"`.]?/i,
        examples: [
          'show me the contents of app.ts',
          'read contents of README.md',
        ],
        extractors: [
          { paramName: 'filePath', captureGroup: 2 },
        ],
      },
      {
        regex: /\bview\s+(?:the\s+)?(?:file\s+)?(?:at|in)\s+['"`.]?([/\w.\-]+)['"`.]?/i,
        examples: [
          'view the file at src/components/Button.tsx',
        ],
        extractors: [
          { paramName: 'filePath', captureGroup: 1 },
        ],
      },
    ],
  },

  // ===========================================
  // EDIT FILE
  // ===========================================
  {
    intent: 'edit_file',
    tool: 'edit',
    priority: 10,
    patterns: [
      {
        regex: /\b(edit|modify|change|update|fix)\s+(?:the\s+)?(?:file\s+)?['"`.]?([/\w.\-]+)['"`.]?/i,
        examples: [
          'edit utils.ts',
          'modify the file config.ts',
          'change app.ts',
          'update index.ts',
        ],
        extractors: [
          { paramName: 'filePath', captureGroup: 2 },
        ],
      },
      {
        regex: /\b(add|insert)\s+(.+?)\s+(?:to|in|into)\s+(?:the\s+)?(?:file\s+)?['"`.]?([/\w.\-]+)['"`.]?/i,
        examples: [
          'add error handling to utils.ts',
          'insert a function in main.ts',
        ],
        extractors: [
          { paramName: 'change', captureGroup: 2 },
          { paramName: 'filePath', captureGroup: 3 },
        ],
      },
      {
        regex: /\b(remove|delete)\s+(.+?)\s+(?:from|in)\s+(?:the\s+)?(?:file\s+)?['"`.]?([/\w.\-]+)['"`.]?/i,
        examples: [
          'remove the console.log from utils.ts',
          'delete line 42 from app.ts',
        ],
        extractors: [
          { paramName: 'change', captureGroup: 2 },
          { paramName: 'filePath', captureGroup: 3 },
        ],
      },
      {
        regex: /\bfix\s+(?:the\s+)?(?:bug\s+)?(?:in\s+)?['"`.]?([/\w.\-]+)['"`.]?/i,
        examples: [
          'fix utils.ts',
          'fix the bug in app.ts',
        ],
        extractors: [
          { paramName: 'filePath', captureGroup: 1 },
          { paramName: 'change', captureGroup: 0, transform: () => 'fix bug' },
        ],
      },
      {
        regex: /\brefactor\s+(?:the\s+)?(?:file\s+)?['"`.]?([/\w.\-]+)['"`.]?/i,
        examples: [
          'refactor utils.ts',
          'refactor the file app.ts',
        ],
        extractors: [
          { paramName: 'filePath', captureGroup: 1 },
          { paramName: 'change', captureGroup: 0, transform: () => 'refactor' },
        ],
      },
    ],
  },

  // ===========================================
  // CREATE FILE
  // ===========================================
  {
    intent: 'create_file',
    tool: 'write',
    priority: 10,
    patterns: [
      {
        regex: /\b(create|make|new|generate)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?(?:called\s+)?(?:named\s+)?['"`.]?([/\w.\-]+)['"`.]?/i,
        examples: [
          'create a new file called test.ts',
          'make utils.ts',
          'generate a file named helper.js',
          'new file config.json',
        ],
        extractors: [
          { paramName: 'filePath', captureGroup: 2 },
        ],
      },
      {
        regex: /\bcreate\s+(?:a\s+)?(\w+(?:\s+\w+)?)\s+(?:file|component|class|module)\s+(?:called|named)\s+['"`.]?([/\w.\-]+)['"`.]?/i,
        examples: [
          'create a React component called Button.tsx',
          'create a TypeScript file named types.ts',
        ],
        extractors: [
          { paramName: 'fileType', captureGroup: 1 },
          { paramName: 'filePath', captureGroup: 2 },
        ],
      },
    ],
  },

  // ===========================================
  // DELETE FILE
  // ===========================================
  {
    intent: 'delete_file',
    tool: 'custom',
    priority: 10,
    patterns: [
      {
        regex: /\b(delete|remove|rm)\s+(?:the\s+)?(?:file\s+)?['"`.]?([/\w.\-]+)['"`.]?/i,
        examples: [
          'delete old-file.ts',
          'remove the file unused.js',
          'rm config.bak',
        ],
        extractors: [
          { paramName: 'filePath', captureGroup: 2 },
        ],
      },
    ],
  },

  // ===========================================
  // RUN COMMAND
  // ===========================================
  {
    intent: 'run_command',
    tool: 'bash',
    priority: 10,
    patterns: [
      {
        regex: /\brun\s+(?:the\s+)?(?:command\s+)?['"`.]?(.+?)['"`.]?(?:\s+(?:in|on)\s+(?:the\s+)?(?:terminal|console))?\b/i,
        examples: [
          'run the command npm install',
          'run "npm test"',
          'run git status',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 1 },
        ],
      },
      {
        regex: /\bexecute\s+(?:the\s+)?(?:command\s+)?['"`.]?(.+?)['"`.]?\b/i,
        examples: [
          'execute npm build',
          'execute the command ls -la',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 1 },
        ],
      },
      {
        regex: /\b(?:npm|yarn|pnpm|pip|cargo|go)\s+(?:run\s+)?(\w+(?:\s+.+?)?)$/i,
        examples: [
          'npm test',
          'yarn build',
          'npm run dev',
          'pip install requests',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 0 },
        ],
      },
    ],
  },

  // ===========================================
  // RUN TESTS
  // ===========================================
  {
    intent: 'run_tests',
    tool: 'bash',
    priority: 10,
    patterns: [
      {
        regex: /\b(?:run|execute)\s+(?:the\s+)?(?:tests?|test\s+suite|spec)\b/i,
        examples: [
          'run the tests',
          'run test suite',
          'execute tests',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 0, transform: () => 'npm test' },
        ],
      },
      {
        regex: /\b(?:run|execute)\s+(.+?)\s+tests?\b/i,
        examples: [
          'run unit tests',
          'execute integration tests',
        ],
        extractors: [
          { paramName: 'testType', captureGroup: 1 },
          { paramName: 'command', captureGroup: 0, transform: (m: string) => `npm test -- ${m}` },
        ],
      },
    ],
  },

  // ===========================================
  // ANALYZE CODE
  // ===========================================
  {
    intent: 'analyze_code',
    tool: 'custom',
    priority: 10,
    patterns: [
      {
        regex: /\banalyz(?:e|ing)\s+(?:the\s+)?(?:code\s+?(?:in\s+)?)?['"`.]?([/\w.\-]*)['"`.]?/i,
        examples: [
          'analyze the code',
          'analyze src/utils.ts',
          'analyzing the project',
        ],
        extractors: [
          { paramName: 'target', captureGroup: 1 },
        ],
      },
      {
        regex: /\bcheck\s+(?:for\s+)?(?:bugs?|issues?|problems?|vulnerabilities?)\s+(?:in\s+)?(?:the\s+)?(?:code\s+)?(?:of\s+)?['"`.]?([/\w.\-]*)['"`.]?/i,
        examples: [
          'check for bugs',
          'check for issues in utils.ts',
        ],
        extractors: [
          { paramName: 'target', captureGroup: 1 },
          { paramName: 'analysisType', captureGroup: 0, transform: () => 'bugs' },
        ],
      },
    ],
  },

  // ===========================================
  // EXPLAIN CODE
  // ===========================================
  {
    intent: 'explain_code',
    tool: 'custom',
    priority: 10,
    patterns: [
      {
        regex: /\b(?:explain|describe|tell\s+me\s+about)\s+(?:the\s+)?(?:code\s+?(?:in\s+)?)?['"`.]?([/\w.\-]*)['"`.]?/i,
        examples: [
          'explain the code',
          'explain how this works',
          'describe utils.ts',
          'tell me about the function in app.ts',
        ],
        extractors: [
          { paramName: 'target', captureGroup: 1 },
        ],
      },
      {
        regex:/\bhow\s+(?:does|do(?:es)?)\s+(?:this|the|it)\s+(?:work|function|operate)/i,
        examples: [
          'how does this work',
          'how does the code function',
        ],
        extractors: [],
      },
    ],
  },

  // ===========================================
  // REFACTOR CODE
  // ===========================================
  {
    intent: 'refactor_code',
    tool: 'custom',
    priority: 10,
    patterns: [
      {
        regex: /\brefactor\s+(?:the\s+)?(?:code\s+?(?:in\s+)?)?['"`.]?([/\w.\-]*)['"`.]?/i,
        examples: [
          'refactor the code',
          'refactor utils.ts',
        ],
        extractors: [
          { paramName: 'target', captureGroup: 1 },
        ],
      },
      {
        regex: /\bimprove\s+(?:the\s+)?(?:code\s+?(?:in\s+)?)?['"`.]?([/\w.\-]*)['"`.]?/i,
        examples: [
          'improve the code',
          'improve app.ts',
        ],
        extractors: [
          { paramName: 'target', captureGroup: 1 },
        ],
      },
    ],
  },

  // ===========================================
  // GIT OPERATIONS
  // ===========================================
  {
    intent: 'git_operation',
    tool: 'bash',
    priority: 10,
    patterns: [
      {
        regex: /\b(?:git\s+)?commit\s+(?:the\s+)?(?:changes?|files?)/i,
        examples: [
          'commit the changes',
          'git commit',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 0, transform: () => 'git commit' },
        ],
      },
      {
        regex: /\b(?:git\s+)?push/i,
        examples: [
          'push to remote',
          'git push',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 0, transform: () => 'git push' },
        ],
      },
      {
        regex: /\b(?:git\s+)?pull/i,
        examples: [
          'pull from remote',
          'git pull',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 0, transform: () => 'git pull' },
        ],
      },
      {
        regex: /\b(?:git\s+)?status/i,
        examples: [
          'show git status',
          'git status',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 0, transform: () => 'git status' },
        ],
      },
      {
        regex: /\bcreate\s+(?:a\s+)?(?:new\s+)?branch/i,
        examples: [
          'create a new branch',
          'make a new branch',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 0, transform: () => 'git checkout -b' },
        ],
      },
      {
        regex: /\bcreate\s+(?:a\s+)?pr?\s+(?:pull\s+request)?/i,
        examples: [
          'create a PR',
          'make a pull request',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 0, transform: () => 'gh pr create' },
        ],
      },
    ],
  },

  // ===========================================
  // BUILD PROJECT
  // ===========================================
  {
    intent: 'build_project',
    tool: 'bash',
    priority: 10,
    patterns: [
      {
        regex: /\b(?:build|compile)\s+(?:the\s+)?(?:project|app|code)/i,
        examples: [
          'build the project',
          'compile the code',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 0, transform: () => 'npm run build' },
        ],
      },
    ],
  },

  // ===========================================
  // INSTALL DEPENDENCIES
  // ===========================================
  {
    intent: 'install_deps',
    tool: 'bash',
    priority: 10,
    patterns: [
      {
        regex: /\binstall\s+(?:the\s+)?(?:dependencies?|deps?|packages?)/i,
        examples: [
          'install dependencies',
          'install the packages',
          'npm install',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 0, transform: () => 'npm install' },
        ],
      },
      {
        regex: /\b(?:npm|yarn|pnpm)\s+install/i,
        examples: [
          'npm install',
          'yarn install',
          'pnpm install',
        ],
        extractors: [
          { paramName: 'command', captureGroup: 0 },
        ],
      },
    ],
  },

  // ===========================================
  // REMEMBER
  // ===========================================
  {
    intent: 'remember',
    tool: 'custom',
    priority: 10,
    patterns: [
      {
        regex: /\bremember\s+(?:that\s+)?(.+)/i,
        examples: [
          'remember that I prefer tabs over spaces',
          'remember I use TypeScript',
        ],
        extractors: [
          { paramName: 'fact', captureGroup: 1 },
        ],
      },
      {
        regex:/\b(?:note|save)\s+(?:this|that):\s*(.+)/i,
        examples: [
          'note this: I use Prettier',
          'save that: project path is /home/user/project',
        ],
        extractors: [
          { paramName: 'fact', captureGroup: 1 },
        ],
      },
    ],
  },

  // ===========================================
  // RECALL
  // ===========================================
  {
    intent: 'recall',
    tool: 'custom',
    priority: 10,
    patterns: [
      {
        regex: /\b(?:recall|what\s+(?:do\s+you\s+)?remember(?:\s+about)?)\s+(.+)/i,
        examples: [
          'recall my preferences',
          'what do you remember about the project',
        ],
        extractors: [
          { paramName: 'query', captureGroup: 1 },
        ],
      },
      {
        regex: /\b(?:show|tell\s+me)\s+(?:what\s+you\s+)?remember/i,
        examples: [
          'show what you remember',
          'tell me what you remember',
        ],
        extractors: [],
      },
    ],
  },

  // ===========================================
  // SHOW STATUS
  // ===========================================
  {
    intent: 'show_status',
    tool: 'custom',
    priority: 10,
    patterns: [
      {
        regex: /\b(?:show|what\s+is\s+)?(?:the\s+)?(?:current\s+)?status\b/i,
        examples: [
          'show status',
          'what is the status',
          'status',
        ],
        extractors: [],
      },
      {
        regex:/\b(?:where\s+am\s+i|what\s+am\s+i\s+doing|what(?:'s|\s+is)\s+going\s+on)/i,
        examples: [
          'where am I',
          'what am I doing',
          'what is going on',
        ],
        extractors: [],
      },
    ],
  },

  // ===========================================
  // SHOW HELP
  // ===========================================
  {
    intent: 'show_help',
    tool: 'custom',
    priority: 10,
    patterns: [
      {
        regex: /\b(?:help|what\s+can\s+you\s+do|how\s+do\s+i\s+use\s+this)(?:\s+me)?\?*/i,
        examples: [
          'help',
          'what can you do',
          'how do I use this',
        ],
        extractors: [],
      },
    ],
  },

  // ===========================================
  // CONFIRM ACTION
  // ===========================================
  {
    intent: 'confirm_action',
    tool: 'custom',
    priority: 10,
    patterns: [
      {
        regex: /^(?:yes|y|sure|ok|okay|please\s+do|go\s+ahead|proceed|continue)/i,
        examples: [
          'yes',
          'sure',
          'ok do it',
          'go ahead',
          'please proceed',
        ],
        extractors: [],
      },
      {
        regex: /^\+1$/i,
        examples: ['+1'],
        extractors: [],
      },
    ],
  },

  // ===========================================
  // CANCEL ACTION
  // ===========================================
  {
    intent: 'cancel_action',
    tool: 'custom',
    priority: 10,
    patterns: [
      {
        regex: /^(?:no|n|cancel|stop|never\s+mind|forget\s+it|don'?t|do\s+not)/i,
        examples: [
          'no',
          'cancel',
          'stop',
          'never mind',
          "don't do it",
        ],
        extractors: [],
      },
      {
        regex: /^\-1$/i,
        examples: ['-1'],
        extractors: [],
      },
    ],
  },
];

/**
 * File type extensions mapping
 */
const FILE_TYPE_EXTENSIONS: Record<string, string[]> = {
  typescript: ['*.ts', '*.tsx'],
  javascript: ['*.js', '*.jsx', '*.mjs'],
  test: ['*.test.ts', '*.test.tsx', '*.test.js', '*.spec.ts', '*.spec.js'],
  config: ['*.config.*', '*.rc', '*config.*'],
  markdown: ['*.md'],
  json: ['*.json'],
  css: ['*.css', '*.scss', '*.sass', '*.less'],
  html: ['*.html', '*.htm'],
  python: ['*.py'],
  rust: ['*.rs'],
  go: ['*.go'],
  java: ['*.java'],
};

/**
 * Intent Classifier class
 */
export class IntentClassifier {
  private patterns: IntentPattern[];
  private context?: ConversationContext;

  constructor(context?: ConversationContext) {
    this.patterns = INTENT_PATTERNS.sort((a, b) => b.priority - a.priority);
    this.context = context;
  }

  /**
   * Classify a natural language query into an intent
   */
  classify(query: string, context?: ConversationContext): IntentClassification {
    const startTime = Date.now();
    const trimmedQuery = query.trim();

    logger.debug(`Classifying query: "${trimmedQuery}"`);

    // Try to match against all patterns
    const matches = this.matchPatterns(trimmedQuery);

    // Select best match based on confidence and context
    const intent = this.selectBestIntent(matches, trimmedQuery, context || this.context);

    const processingTime = Date.now() - startTime;

    logger.debug(`Classified as ${intent.type} with confidence ${intent.confidence} (${processingTime}ms)`);

    return {
      intent,
      rawQuery: trimmedQuery,
      detectedLanguage: 'en',
      timestamp: Date.now(),
      processingTimeMs: processingTime,
    };
  }

  /**
   * Match query against all patterns
   */
  private matchPatterns(query: string): Array<{ pattern: IntentPattern; match: RegExpExecArray | null; confidence: number }> {
    const matches: Array<{ pattern: IntentPattern; match: RegExpExecArray | null; confidence: number }> = [];

    for (const pattern of this.patterns) {
      for (const subPattern of pattern.patterns) {
        const match = subPattern.regex.exec(query);
        if (match) {
          // Calculate confidence based on match specificity
          const confidence = this.calculateConfidence(match, subPattern, query);
          matches.push({ pattern, match, confidence });
        }
      }
    }

    // Sort by confidence descending
    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Calculate confidence score for a match
   */
  private calculateConfidence(
    match: RegExpExecArray | null,
    _subPattern: IntentPatternDefinition,
    query: string
  ): number {
    if (!match) return 0;

    let confidence = 0.5; // Base confidence

    // More specific match = higher confidence
    const matchLength = match[0]?.length || 0;
    const queryLength = query.length;
    const coverage = matchLength / queryLength;
    confidence += coverage * 0.2;

    // More capture groups = more specific = higher confidence
    const captureCount = match.length - 1;
    confidence += Math.min(captureCount * 0.1, 0.2);

    // Exact or near-exact match
    if (coverage > 0.9) confidence += 0.2;

    return Math.min(confidence, 1.0);
  }

  /**
   * Select the best intent from matches
   */
  private selectBestIntent(
    matches: Array<{ pattern: IntentPattern; match: RegExpExecArray | null; confidence: number }>,
    query: string,
    context?: ConversationContext
  ): Intent {
    if (matches.length === 0) {
      return this.createUnknownIntent(query);
    }

    const bestMatch = matches[0];
    const { pattern, match, confidence } = bestMatch;

    // Extract parameters from the match
    const parameters = this.extractParameters(pattern, match, confidence);

    // Generate alternatives if confidence is low
    const alternatives: Intent[] = [];
    if (confidence < 0.7) {
      for (let i = 1; i < Math.min(matches.length, 3); i++) {
        alternatives.push(this.createIntentFromMatch(matches[i], query));
      }
    }

    // Enrich with context if available
    const contextInfo = context ? this.getContextInfo(context) : undefined;

    return {
      type: pattern.intent,
      tool: pattern.tool,
      parameters,
      confidence,
      alternatives,
      requiresConfirmation: confidence < 0.7,
      context: contextInfo,
    };
  }

  /**
   * Extract parameters from regex match
   */
  private extractParameters(
    pattern: IntentPattern,
    match: RegExpExecArray | null,
    confidence: number
  ): ToolParameter[] {
    const parameters: ToolParameter[] = [];

    if (!match) return parameters;

    // Find the first sub-pattern that matched and extract from it
    for (const subPattern of pattern.patterns) {
      if (subPattern.regex.test(match[0]) && subPattern.extractors) {
        for (const extractor of subPattern.extractors) {
          const rawValue = match[extractor.captureGroup];
          if (rawValue !== undefined) {
            const value = extractor.transform ? extractor.transform(rawValue) : rawValue;
            parameters.push({
              name: extractor.paramName,
              value,
              confidence,
              source: 'explicit',
            });
          }
        }
        break;
      }
    }

    // Add inferred parameters based on intent type
    this.addInferredParameters(pattern.intent, parameters, match);

    return parameters;
  }

  /**
   * Add parameters that can be inferred from context
   */
  private addInferredParameters(_intentType: IntentType, parameters: ToolParameter[], _match: RegExpExecArray | null): void {
    // Infer file pattern from file type parameter
    const fileTypeParam = parameters.find(p => p.name === 'fileType');
    if (fileTypeParam && typeof fileTypeParam.value === 'string') {
      const extensions = FILE_TYPE_EXTENSIONS[fileTypeParam.value.toLowerCase()];
      if (extensions) {
        parameters.push({
          name: 'pattern',
          value: extensions[0],
          confidence: 0.8,
          source: 'inferred',
        });
      }
    }

    // Infer working directory from context if available
    if (this.context?.workingDirectory) {
      const hasPath = parameters.some(p => p.name === 'path' || p.name === 'filePath');
      if (!hasPath) {
        parameters.push({
          name: 'workingDirectory',
          value: this.context.workingDirectory,
          confidence: 0.9,
          source: 'context',
        });
      }
    }
  }

  /**
   * Create intent from a match
   */
  private createIntentFromMatch(
    matchData: { pattern: IntentPattern; match: RegExpExecArray | null; confidence: number },
    _query: string
  ): Intent {
    const { pattern, match, confidence } = matchData;

    return {
      type: pattern.intent,
      tool: pattern.tool,
      parameters: this.extractParameters(pattern, match, confidence),
      confidence: confidence * 0.9, // Slightly lower for alternatives
      alternatives: [],
      requiresConfirmation: true,
    };
  }

  /**
   * Create unknown intent
   */
  private createUnknownIntent(_query: string): Intent {
    return {
      type: 'unknown',
      tool: 'custom',
      parameters: [],
      confidence: 0,
      alternatives: [],
      requiresConfirmation: true,
    };
  }

  /**
   * Get context information
   */
  private getContextInfo(context: ConversationContext) {
    return {
      workingDirectory: context.workingDirectory,
      openFiles: Array.from(context.openFiles),
      relatedFiles: context.recentCommands.slice(0, 3).map(c => {
        const pathParam = c.intent.parameters.find(p => p.name === 'filePath');
        return pathParam?.value as string | undefined;
      }).filter(Boolean) as string[],
    };
  }

  /**
   * Update context
   */
  updateContext(context: ConversationContext): void {
    this.context = context;
  }

  /**
   * Get all supported intent types
   */
  getSupportedIntents(): IntentType[] {
    const uniqueIntents = new Set(INTENT_PATTERNS.map(p => p.intent));
    return Array.from(uniqueIntents);
  }

  /**
   * Get examples for an intent type
   */
  getExamples(intentType: IntentType): string[] {
    const examples: string[] = [];
    for (const pattern of INTENT_PATTERNS) {
      if (pattern.intent === intentType) {
        for (const subPattern of pattern.patterns) {
          examples.push(...subPattern.examples);
        }
      }
    }
    return examples;
  }
}

/**
 * Default singleton instance
 */
let defaultClassifier: IntentClassifier | null = null;

export function getIntentClassifier(context?: ConversationContext): IntentClassifier {
  if (!defaultClassifier) {
    defaultClassifier = new IntentClassifier(context);
  } else if (context) {
    defaultClassifier.updateContext(context);
  }
  return defaultClassifier;
}
