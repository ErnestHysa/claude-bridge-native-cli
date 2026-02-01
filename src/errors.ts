/**
 * Custom error classes for Claude Bridge Native CLI
 */

/**
 * Base bridge error
 */
export class BridgeError extends Error {
  code: string;
  context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.context = context;
  }
}

/**
 * Project not found error
 */
export class ProjectNotFoundError extends BridgeError {
  constructor(projectName: string) {
    super(`Project not found: ${projectName}`, "PROJECT_NOT_FOUND", { projectName });
    this.name = "ProjectNotFoundError";
  }
}

/**
 * Claude process error
 */
export class ClaudeProcessError extends BridgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CLAUDE_PROCESS_ERROR", context);
    this.name = "ClaudeProcessError";
  }
}

/**
 * Session error
 */
export class SessionError extends BridgeError {
  constructor(message: string, chatId?: number) {
    super(message, "SESSION_ERROR", { chatId });
    this.name = "SessionError";
  }
}

/**
 * Authorization error
 */
export class AuthorizationError extends BridgeError {
  constructor(userId?: number) {
    super("User not authorized", "AUTHORIZATION_ERROR", { userId });
    this.name = "AuthorizationError";
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends BridgeError {
  constructor(message: string, configKey?: string) {
    super(message, "CONFIGURATION_ERROR", { configKey });
    this.name = "ConfigurationError";
  }
}
