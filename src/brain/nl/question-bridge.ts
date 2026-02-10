/**
 * AskUserQuestion Bridge for CLI ↔ Telegram communication
 *
 * Intercepts AskUserQuestion tool calls from Claude CLI,
 * forwards questions to Telegram user, collects responses,
 * and feeds them back to the waiting CLI process.
 */

import TelegramBot from 'node-telegram-bot-api';
import type { Message } from 'node-telegram-bot-api';
import { Logger, generateId } from '../../utils.js';
import type {
  AgentQuestion,
  QuestionOption,
  QuestionResponse,
} from './types.js';

const logger = new Logger('info');

/**
 * Default timeout for questions (5 minutes)
 */
const DEFAULT_QUESTION_TIMEOUT = 5 * 60 * 1000;

/**
 * Pending question state
 */
interface PendingQuestion extends Omit<AgentQuestion, 'timeout'> {
  chatId: number;
  resolve: (response: QuestionResponse) => void;
  timeoutHandle: NodeJS.Timeout;
  timeoutValue: number; // Store the timeout value separately
}

/**
 * Question Bridge class
 *
 * Manages the flow of questions between Claude CLI and Telegram users
 */
export class QuestionBridge {
  private pendingQuestions: Map<string, PendingQuestion>;
  private multiSelectSelections: Map<string, Set<number>>;
  private bot: TelegramBot;

  constructor(bot: TelegramBot) {
    this.bot = bot;
    this.pendingQuestions = new Map();
    this.multiSelectSelections = new Map();
  }

  /**
   * Check if a chat has a pending question
   */
  hasPendingQuestion(chatId: number): boolean {
    for (const pending of this.pendingQuestions.values()) {
      if (pending.chatId === chatId) return true;
    }
    return false;
  }

  /**
   * Get pending question for a chat
   */
  getPendingQuestion(chatId: number): PendingQuestion | undefined {
    for (const pending of this.pendingQuestions.values()) {
      if (pending.chatId === chatId) return pending;
    }
    return undefined;
  }

  /**
   * Format a question for Telegram display
   */
  formatQuestionMessage(question: AgentQuestion): string {
    let message = `🤔 *Question*\n\n${question.question}\n\n`;

    if (question.options.length > 0) {
      message += '*Options:*\n';
      question.options.forEach((option, index) => {
        const emoji = this.getOptionEmoji(index);
        message += `${emoji} ${option.label}`;
        if (option.description) {
          message += `\n   └ ${option.description}`;
        }
        message += '\n';
      });
    }

    if (question.allowsCustom) {
      message += `\n✏️ Type a custom answer or select an option above.`;
    }

    if (question.multiSelect && question.options.length > 1) {
      message += `\n\n📌 *Multiple selections allowed*`;
    }

    return message;
  }

  /**
   * Get emoji for option index
   */
  private getOptionEmoji(index: number): string {
    const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    return emojis[index % emojis.length];
  }

  /**
   * Create inline keyboard for question options
   */
  private createKeyboard(question: AgentQuestion): TelegramBot.InlineKeyboardButton[][] {
    if (question.options.length === 0) {
      return [[{ text: 'Continue', callback_data: 'q_continue' }]];
    }

    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];

    if (question.multiSelect) {
      // Multi-select: show checkboxes and a submit button
      const rows: TelegramBot.InlineKeyboardButton[] = [];
      question.options.forEach((option, index) => {
        rows.push({
          text: `${this.getOptionEmoji(index)} ${option.label}`,
          callback_data: `q_select_${question.id}_${index}`,
        });
      });

      // Add rows in pairs for better layout
      for (let i = 0; i < rows.length; i += 2) {
        if (i + 1 < rows.length) {
          keyboard.push([rows[i], rows[i + 1]]);
        } else {
          keyboard.push([rows[i]]);
        }
      }

      // Add submit button
      keyboard.push([
        { text: '✅ Submit', callback_data: `q_submit_${question.id}` },
        { text: '❌ Cancel', callback_data: `q_cancel_${question.id}` },
      ]);
    } else {
      // Single select: one button per option
      const rows: TelegramBot.InlineKeyboardButton[] = [];
      question.options.forEach((option, index) => {
        rows.push({
          text: `${this.getOptionEmoji(index)} ${option.label}`,
          callback_data: `q_answer_${question.id}_${index}`,
        });
      });

      // Add rows in pairs for better layout
      for (let i = 0; i < rows.length; i += 2) {
        if (i + 1 < rows.length) {
          keyboard.push([rows[i], rows[i + 1]]);
        } else {
          keyboard.push([rows[i]]);
        }
      }

      // Add cancel button
      keyboard.push([{ text: '❌ Cancel', callback_data: `q_cancel_${question.id}` }]);
    }

    return keyboard;
  }

  /**
   * Ask a question and wait for response
   */
  async askQuestion(
    chatId: number,
    question: string,
    options: QuestionOption[],
    multiSelect: boolean = false,
    allowsCustom: boolean = true,
    timeout: number = DEFAULT_QUESTION_TIMEOUT
  ): Promise<QuestionResponse> {
    // Generate unique question ID
    const questionId = generateId();

    // Check if there's already a pending question for this chat
    if (this.hasPendingQuestion(chatId)) {
      const existing = this.getPendingQuestion(chatId);
      // Cancel the existing question
      this.cancelQuestion(existing!.id);
    }

    // Create the question object
    const agentQuestion: AgentQuestion = {
      id: questionId,
      question,
      options,
      multiSelect,
      allowsCustom,
      timeout,
      timestamp: Date.now(),
    };

    // Send the question to Telegram
    try {
      const message = this.formatQuestionMessage(agentQuestion);
      const keyboard = this.createKeyboard(agentQuestion);

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      logger.error(`Failed to send question to chat ${chatId}: ${error}`);
      throw error;
    }

    // Wait for response
    return new Promise<QuestionResponse>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingQuestions.delete(questionId);
        resolve({
          questionId,
          selectedValues: [],
          timestamp: Date.now(),
        });
      }, timeout);

      const pending: PendingQuestion = {
        ...agentQuestion,
        chatId,
        resolve,
        timeoutHandle,
        timeoutValue: timeout,
      };

      this.pendingQuestions.set(questionId, pending);
      logger.debug(`Asked question ${questionId} to chat ${chatId}`);
    });
  }

  /**
   * Handle callback query from inline keyboard
   */
  async handleCallbackQuery(query: TelegramBot.CallbackQuery): Promise<boolean> {
    const data = query.data;
    if (!data || !data.startsWith('q_')) return false;

    const chatId = query.message!.chat.id;
    const parts = data.split('_');

    // Extract question ID and related info
    // Format: q_answer_questionId_optionIndex or q_select_questionId_optionIndex
    const action = parts[1];
    const questionId = parts[2];

    const pending = this.pendingQuestions.get(questionId);
    if (!pending || pending.chatId !== chatId) {
      // Question not found or wrong chat
      await this.bot.answerCallbackQuery(query.id, { text: 'Question expired', show_alert: true });
      return true;
    }

    switch (action) {
      case 'answer':
        // Single select answer
        const optionIndex = parseInt(parts[3], 10);
        this.resolveQuestion(questionId, [pending.options[optionIndex].value]);
        await this.bot.answerCallbackQuery(query.id, { text: 'Answer recorded' });
        await this.bot.deleteMessage(chatId, query.message!.message_id);
        break;

      case 'select': {
        const optionIndex = parseInt(parts[3], 10);
        if (Number.isNaN(optionIndex) || optionIndex < 0 || optionIndex >= pending.options.length) {
          await this.bot.answerCallbackQuery(query.id, { text: 'Invalid selection', show_alert: true });
          break;
        }

        const selections = this.multiSelectSelections.get(questionId) ?? new Set<number>();
        if (selections.has(optionIndex)) {
          selections.delete(optionIndex);
        } else {
          selections.add(optionIndex);
        }
        this.multiSelectSelections.set(questionId, selections);

        await this.bot.answerCallbackQuery(query.id, {
          text: selections.has(optionIndex) ? 'Selected' : 'Deselected',
        });
        break;
      }

      case 'submit': {
        const selections = this.multiSelectSelections.get(questionId) ?? new Set<number>();
        const selectedValues = [...selections]
          .filter(index => index >= 0 && index < pending.options.length)
          .map(index => pending.options[index].value);

        this.resolveQuestion(questionId, selectedValues);
        await this.bot.answerCallbackQuery(query.id, { text: 'Answer recorded' });
        await this.bot.deleteMessage(chatId, query.message!.message_id);
        break;
      }

      case 'cancel':
        // Cancel question
        this.cancelQuestion(questionId);
        await this.bot.answerCallbackQuery(query.id, { text: 'Question cancelled' });
        await this.bot.deleteMessage(chatId, query.message!.message_id);
        break;

      default:
        await this.bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
    }

    return true;
  }

  /**
   * Handle text response to a question
   */
  handleTextMessage(msg: Message): boolean {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    if (!text) return false;

    const pending = this.getPendingQuestion(chatId);
    if (!pending) return false;

    // If custom input is allowed, treat text as custom response
    if (pending.allowsCustom) {
      this.resolveQuestion(pending.id, [], text);
      return true;
    }

    // Try to match text to an option
    const matchedOption = pending.options.find(opt =>
      opt.label.toLowerCase() === text.toLowerCase()
    );

    if (matchedOption) {
      this.resolveQuestion(pending.id, [matchedOption.value]);
      return true;
    }

    return false;
  }

  /**
   * Resolve a question with a response
   */
  private resolveQuestion(
    questionId: string,
    selectedValues: string[],
    customInput?: string
  ): void {
    const pending = this.pendingQuestions.get(questionId);
    if (!pending) return;

    // Clear timeoutHandle
    clearTimeout(pending.timeoutHandle);

    // Remove from pending
    this.pendingQuestions.delete(questionId);
    this.multiSelectSelections.delete(questionId);

    // Resolve promise
    const response: QuestionResponse = {
      questionId,
      selectedValues,
      customInput,
      timestamp: Date.now(),
    };

    pending.resolve(response);
    logger.debug(`Resolved question ${questionId} with ${selectedValues.length} selections`);
  }

  /**
   * Cancel a pending question
   */
  cancelQuestion(questionId: string): void {
    const pending = this.pendingQuestions.get(questionId);
    if (!pending) return;

    clearTimeout(pending.timeoutHandle);
    this.pendingQuestions.delete(questionId);
    this.multiSelectSelections.delete(questionId);

    // Resolve with empty response
    pending.resolve({
      questionId,
      selectedValues: [],
      timestamp: Date.now(),
    });

    logger.debug(`Cancelled question ${questionId}`);
  }

  /**
   * Cancel all pending questions for a chat
   */
  cancelChatQuestions(chatId: number): void {
    for (const [questionId, pending] of this.pendingQuestions.entries()) {
      if (pending.chatId === chatId) {
        this.cancelQuestion(questionId);
      }
    }
  }

  /**
   * Get all pending question IDs
   */
  getPendingQuestionIds(): string[] {
    return Array.from(this.pendingQuestions.keys());
  }

  /**
   * Clean up expired questions
   */
  cleanup(): void {
    const now = Date.now();
    for (const [questionId, pending] of this.pendingQuestions.entries()) {
      const elapsed = now - pending.timestamp;
      if (elapsed > pending.timeoutValue) {
        this.cancelQuestion(questionId);
      }
    }
  }
}

/**
 * Default singleton instance
 */
let defaultBridge: QuestionBridge | null = null;

export function getQuestionBridge(bot: TelegramBot): QuestionBridge {
  if (!defaultBridge || defaultBridge['bot'] !== bot) {
    defaultBridge = new QuestionBridge(bot);
  }
  return defaultBridge;
}
