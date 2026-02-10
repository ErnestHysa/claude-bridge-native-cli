/**
 * Soul.md Validator
 *
 * Validates soul.md file structure and content against schema
 */

import type { SoulContent, SoulMetadata, SoulIdentity, SoulPersonality, SoulConstraints, SoulLearning } from '../nl/types.js';

/**
 * Validation error
 */
export interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Soul Validator class
 */
export class SoulValidator {
  /**
   * Validate soul content
   */
  validate(soul: SoulContent): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Validate metadata
    this.validateMetadata(soul.metadata, errors, warnings);

    // Validate identity
    this.validateIdentity(soul.identity, errors, warnings);

    // Validate personality
    if (soul.personality) {
      this.validatePersonality(soul.personality, warnings);
    }

    // Validate constraints
    if (soul.constraints) {
      this.validateConstraints(soul.constraints, errors, warnings);
    }

    // Validate learning
    if (soul.learning) {
      this.validateLearning(soul.learning, warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate metadata
   */
  private validateMetadata(
    metadata: SoulMetadata,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    if (!metadata.identity && !metadata['identity']) {
      warnings.push({
        path: 'metadata.identity',
        message: 'Missing identity in metadata',
        severity: 'warning',
      });
    }

    if (!metadata.version) {
      warnings.push({
        path: 'metadata.version',
        message: 'Missing version in metadata',
        severity: 'warning',
      });
    } else if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) {
      errors.push({
        path: 'metadata.version',
        message: `Invalid version format: ${metadata.version}. Expected semver (e.g., 1.0.0)`,
        severity: 'error',
      });
    }

    if (metadata.type && !['agent', 'user', 'project'].includes(metadata.type)) {
      errors.push({
        path: 'metadata.type',
        message: `Invalid type: ${metadata.type}. Must be one of: agent, user, project`,
        severity: 'error',
      });
    }
  }

  /**
   * Validate identity
   */
  private validateIdentity(
    identity: SoulIdentity,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    if (!identity.name) {
      errors.push({
        path: 'identity.name',
        message: 'Missing required field: name',
        severity: 'error',
      });
    } else if (identity.name.length > 100) {
      warnings.push({
        path: 'identity.name',
        message: 'Name is very long (over 100 characters)',
        severity: 'warning',
      });
    }

    if (identity.emoji && !/^[\p{Emoji}\p{Emoji_Component}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}]+$/u.test(identity.emoji)) {
      warnings.push({
        path: 'identity.emoji',
        message: 'Emoji field does not contain a valid emoji',
        severity: 'warning',
      });
    }
  }

  /**
   * Validate personality
   */
  private validatePersonality(
    personality: SoulPersonality,
    warnings: ValidationError[]
  ): void {
    if (personality.style && !['professional', 'friendly', 'technical', 'custom'].includes(personality.style)) {
      warnings.push({
        path: 'personality.style',
        message: `Unknown personality style: ${personality.style}`,
        severity: 'warning',
      });
    }

    if (personality.communication?.verbosity &&
        !['concise', 'verbose', 'terse'].includes(personality.communication.verbosity)) {
      warnings.push({
        path: 'personality.communication.verbosity',
        message: `Unknown verbosity level: ${personality.communication.verbosity}`,
        severity: 'warning',
      });
    }
  }

  /**
   * Validate constraints
   */
  private validateConstraints(
    constraints: SoulConstraints,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    // Validate API budget
    if (constraints.apiBudget) {
      const { daily, monthly, perTask } = constraints.apiBudget;

      if (daily !== undefined && (typeof daily !== 'number' || daily < 0)) {
        errors.push({
          path: 'constraints.apiBudget.daily',
          message: 'Daily API budget must be a non-negative number',
          severity: 'error',
        });
      }

      if (monthly !== undefined && (typeof monthly !== 'number' || monthly < 0)) {
        errors.push({
          path: 'constraints.apiBudget.monthly',
          message: 'Monthly API budget must be a non-negative number',
          severity: 'error',
        });
      }

      if (perTask !== undefined && (typeof perTask !== 'number' || perTask < 0)) {
        errors.push({
          path: 'constraints.apiBudget.perTask',
          message: 'Per-task API budget must be a non-negative number',
          severity: 'error',
        });
      }

      if (daily && monthly && daily > monthly) {
        warnings.push({
          path: 'constraints.apiBudget',
          message: 'Daily API budget exceeds monthly budget',
          severity: 'warning',
        });
      }
    }

    // Validate max concurrent tasks
    if (constraints.maxConcurrentTasks !== undefined) {
      if (typeof constraints.maxConcurrentTasks !== 'number' || constraints.maxConcurrentTasks < 1) {
        errors.push({
          path: 'constraints.maxConcurrentTasks',
          message: 'Max concurrent tasks must be a positive number',
          severity: 'error',
        });
      } else if (constraints.maxConcurrentTasks > 20) {
        warnings.push({
          path: 'constraints.maxConcurrentTasks',
          message: 'High max concurrent tasks may cause performance issues',
          severity: 'warning',
        });
      }
    }

    // Validate time windows
    if (constraints.timeWindows) {
      for (let i = 0; i < constraints.timeWindows.length; i++) {
        const window = constraints.timeWindows[i];
        const path = `constraints.timeWindows[${i}]`;

        if (!window.start || !window.end) {
          errors.push({
            path,
            message: 'Time window must have start and end times',
            severity: 'error',
          });
          continue;
        }

        const startValid = this.validateTimeFormat(window.start);
        const endValid = this.validateTimeFormat(window.end);

        if (!startValid) {
          errors.push({
            path: `${path}.start`,
            message: `Invalid time format: ${window.start}. Expected HH:MM`,
            severity: 'error',
          });
        }

        if (!endValid) {
          errors.push({
            path: `${path}.end`,
            message: `Invalid time format: ${window.end}. Expected HH:MM`,
            severity: 'error',
          });
        }

        // Validate days
        if (window.days) {
          for (const day of window.days) {
            if (day < 0 || day > 6) {
              errors.push({
                path: `${path}.days`,
                message: `Invalid day: ${day}. Must be 0-6 (Sunday-Saturday)`,
                severity: 'error',
              });
            }
          }
        }
      }
    }

    // Validate path arrays
    if (constraints.allowedPaths) {
      for (let i = 0; i < constraints.allowedPaths.length; i++) {
        const path = constraints.allowedPaths[i];
        if (typeof path !== 'string' || path.length === 0) {
          errors.push({
            path: `constraints.allowedPaths[${i}]`,
            message: 'Allowed paths must be non-empty strings',
            severity: 'error',
          });
        }
      }
    }

    if (constraints.deniedPaths) {
      for (let i = 0; i < constraints.deniedPaths.length; i++) {
        const path = constraints.deniedPaths[i];
        if (typeof path !== 'string' || path.length === 0) {
          errors.push({
            path: `constraints.deniedPaths[${i}]`,
            message: 'Denied paths must be non-empty strings',
            severity: 'error',
          });
        }
      }
    }

    // Check for overlapping allowed and denied paths
    if (constraints.allowedPaths && constraints.deniedPaths) {
      const overlap = constraints.allowedPaths.filter(p => constraints.deniedPaths?.includes(p));
      if (overlap.length > 0) {
        warnings.push({
          path: 'constraints',
          message: `Paths in both allowed and denied: ${overlap.join(', ')}`,
          severity: 'warning',
        });
      }
    }
  }

  /**
   * Validate learning section
   */
  private validateLearning(
    learning: SoulLearning,
    warnings: ValidationError[]
  ): void {
    if (learning.remembers) {
      for (let i = 0; i < learning.remembers.length; i++) {
        const item = learning.remembers[i];
        if (typeof item !== 'string' || item.length === 0) {
          warnings.push({
            path: `learning.remembers[${i}]`,
            message: 'Remember items should be non-empty strings',
            severity: 'warning',
          });
        }
      }
    }
  }

  /**
   * Validate time format (HH:MM)
   */
  private validateTimeFormat(time: string): boolean {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
  }

  /**
   * Validate soul.md file
   */
  async validateFile(_filePath: string): Promise<ValidationResult> {
    // This would read and parse the file, then validate
    // For now, return a placeholder
    return {
      valid: false,
      errors: [{
        path: 'file',
        message: 'File validation not implemented',
        severity: 'error',
      }],
      warnings: [],
    };
  }
}

/**
 * Default singleton instance
 */
let defaultValidator: SoulValidator | null = null;

export function getSoulValidator(): SoulValidator {
  if (!defaultValidator) {
    defaultValidator = new SoulValidator();
  }
  return defaultValidator;
}
