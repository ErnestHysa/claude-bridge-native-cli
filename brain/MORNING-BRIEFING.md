# MORNING-BRIEFING.md - Daily Briefing Protocol

## Task Trigger
- Triggered daily at 12:00 PM via node-cron
- When triggered, spawn isolated CLI worker to execute
- Send briefing via Telegram to user

## Required Sections (in order)

### 1. Good Morning Greeting
- Simple, friendly greeting
- Include current date (day of week, day month year)
- Format: DD-MM-YYYY

### 2. Weather for User's Location
**Default:** Kos, Greece (configurable via `/profile location`)

**Method:** PowerShell via exec
```powershell
Invoke-WebRequest -Uri "https://wttr.in/Kos,Greece?format=j1" -UseBasicParsing
```

**Include:**
- Current temperature (°C and °F)
- Current weather condition (rain, clouds, sun, etc.)
- Chance of precipitation (%)
- High/low temperature for the day
- Wind direction and speed
- Humidity
- Cloud cover
- Brief comment/advice based on weather

### 3. Yesterday's Recap
**Source:** Memory files at `brain/memory/{yesterday-date}.md`
**Format:** DD-MM-YYYY.md

**Include:**
- Key events from yesterday
- Important decisions made
- Projects worked on
- Notable achievements or issues
- Any reminders for today

If no yesterday memory exists, note that this is the first day of logging.

### 4. GitHub Activity
**Method:** gh CLI command
```bash
gh repo list --limit 10 --json name,updatedAt,primaryLanguage,description
```

**Include:**
- List of recently updated repositories (last 5-10)
- For each repo: name, language, last update date
- Brief description if notable
- Highlight most recent activity

### 5. X/Twitter Feed Digest
**Method:** Nitter RSS (simpler, no auth required)
```bash
# Use a public Nitter instance RSS feed
# Example: https://nitter.net/elonmusk/rss
```

**Focus:** AI/tools topics
**Timeframe:** Last 12 hours
**Quantity:** 10 tweets

**Include:**
- Summary of AI/tool-related tweets
- Key trends or discussions
- Notable announcements
- Tools or libraries mentioned
- Relevant threads or conversations

### 6. New Project Ideas
**Based on:** X/Twitter feed + GitHub activity analysis

**Generate 3-5 ideas:**
- Connect trending AI/tools from Twitter to existing projects
- Leverage current tech stack
- Consider local context where relevant
- Each idea should be practical and actionable
- Brief description per idea

### 7. Error Summary
**Source:** `brain/errors/` directory

**Include:**
- Count of errors since last briefing
- Critical errors with descriptions
- Pattern analysis (if errors repeat)
- Suggested actions for recurring issues

## Telegram Delivery
**Format:** Clean, readable with section dividers and emoji icons

**Example sections:**
- ☀️ Good morning...
- 🌤️ Weather...
- 📅 Yesterday's recap...
- 💻 GitHub Activity...
- 🐦 X/Twitter Digest...
- 💡 Project Ideas...
- ⚠️ Error Summary...

## Technical Notes
- Use PowerShell exec for weather data (wttr.in)
- Use gh CLI for GitHub data
- Use Nitter RSS for Twitter/X (no browser automation needed)
- Memory files use format: brain/memory/DD-MM-YYYY.md
- Yesterday's date calculated dynamically

## Logging
After sending briefing, update today's memory file with:
- Time of briefing
- Message ID
- Key contents delivered
- Any issues or notes

## Current Constraints
- No web_search calls (keep minimal, only when absolutely necessary)
- All workers spawn in isolated CLI instances
- Errors logged with PID/timestamp/sessionId for traceability
