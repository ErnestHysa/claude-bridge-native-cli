/**
 * Claude Bridge Native CLI - Main Entry Point
 *
 * A Telegram bot that bridges Claude Code CLI with Telegram messaging
 * allowing users to interact with Claude through their mobile devices.
 */

import { getGlobalConfig } from "./config.js";
import { TelegramBotHandler } from "./telegram-bot.js";
import { Logger } from "./utils.js";
import { killClaudeProcess } from "./claude-spawner.js";

const logger = new Logger(getGlobalConfig().logLevel);

// Session cleanup interval reference
let sessionCleanupInterval: NodeJS.Timeout | null = null;

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    // Load configuration
    const config = getGlobalConfig();
    logger.info("Configuration loaded successfully", {
      projectsBase: config.projectsBase,
      allowedUsers: config.allowedUsers.length,
      logLevel: config.logLevel,
    });

    // Initialize bot
    logger.info("Starting Telegram bot...");
    const bot = new TelegramBotHandler(config.telegramBotToken, config);

    // Start project auto-scan
    bot.getProjectManager().startAutoScan();
    logger.info("Project auto-scan started", {
      interval: config.autoScanIntervalMs,
    });

    // Start the bot
    await bot.start();
    logger.info("Bot is running. Press Ctrl+C to stop.");

    // Start session cleanup timer (runs every 15 minutes)
    const sessionManager = bot.getSessionManager();
    sessionCleanupInterval = setInterval(async () => {
      const removed = await sessionManager.cleanupIdleSessions(config.sessionTimeoutMs);
      if (removed.length > 0) {
        logger.info("Cleaned up idle sessions", { count: removed.length });
      }
    }, Math.min(config.sessionTimeoutMs, 900_000)); // Cleanup at least every 15 min

    // Setup graceful shutdown
    setupShutdownHandlers(bot);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to start bot", { error: errorMessage });
    process.exit(1);
  }
}

/**
 * Setup graceful shutdown handlers
 */
function setupShutdownHandlers(bot: TelegramBotHandler): void {
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      // Stop session cleanup
      if (sessionCleanupInterval) {
        clearInterval(sessionCleanupInterval);
        sessionCleanupInterval = null;
      }

      // Stop auto-scan
      bot.getProjectManager().stopAutoScan();

      // Kill all active Claude processes
      const sessionManager = bot.getSessionManager();
      const activeProcesses = sessionManager.getActiveClaudeProcesses();
      logger.info(`Terminating ${activeProcesses.length} active Claude processes...`);

      for (const claudeProc of activeProcesses) {
        try {
          killClaudeProcess(claudeProc);
        } catch {
          // Process may already be dead
        }
      }

      // Stop the bot
      await bot.stop();

      // Stop recovery manager (marks as clean shutdown)
      try {
        const { getRecoveryManager } = await import('./brain/recovery/index.js');
        await getRecoveryManager().stop();
      } catch {
        // Recovery manager might not be initialized
      }

      logger.info("Shutdown complete.");
      process.exit(0);
    } catch (error) {
      logger.error("Error during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGUSR2", () => shutdown("SIGUSR2")); // nodemon restart
}

// Handle uncaught errors
process.on("uncaughtException", (error: Error) => {
  logger.error("Uncaught exception", { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  logger.error("Unhandled rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

// Start the application
main();
