# HEARTBEAT.md

# Self-Check System (runs every hour)

During heartbeat, ask yourself these questions:

1. "What sounded right but went nowhere?" - Track good ideas that didn't lead to action
2. "Where did I default to consensus?" - Track when I agreed without critical thinking
3. "What assumption didn't I pressure test?" - Track assumptions I made without validation
4. "What mistakes did I repeat after user correction?" - Track patterns of repeated errors
5. "Was I too fast or too shallow?" - Track speed and depth of analysis

Log answers to `brain/self-review.md`

## Proactive Checks (Before Self-Reflection)

**Before** doing self-reflection questions, run proactive checks:

```bash
node brain/scripts/proactive-checks.js
```

This will check for:
- Unpushed commits (older than 1 hour)
- Stuck tasks (running longer than 2 hours)
- Code quality alerts (TODO/FIXME/HACK comment blocks)
- Consistently skipped briefing sections

**If alerts are found:**
- Include them in your heartbeat response (don't just say HEARTBEAT_OK)
- Prioritize high-severity alerts
- Offer to help resolve them

**If no alerts:**
- Proceed with self-reflection questions as normal

Tag each entry with:
- `[confidence]` - How sure I was
- `[uncertainty]` - What I wasn't sure about
- `[speed]` - Was I too fast/slow?
- `[depth]` - Shallow vs deep thinking
- `[repeat]` - Repeated mistake after user correction

## Startup Prompt Addition

On boot, read `brain/self-review.md`. When task context overlaps with a recent MISS entry, force a counter-check before responding.

## Self-Improvement Loop

1. Heartbeat → Question yourself
2. Log MISS/FIX to `brain/self-review.md`
3. Next heartbeat → Read the log
4. Adjust based on patterns found

## Entry Format

```
[ DD-MM-YYYY HH:MM ] TAG: confidence
MISS: defaulted to consensus
FIX: challenge obvious assumption first

[ DD-MM-YYYY HH:MM ] TAG: speed
MISS: added noise not signal
FIX: remove anything that doesn't move task forward

[ DD-MM-YYYY HH:MM ] TAG: repeat
MISS: user corrected me 3 times on import paths
FIX: always verify import paths match project structure

[ DD-MM-YYYY HH:MM ] TAG: depth
MISS: gave shallow solution without considering edge cases
FIX: think through at least 3 scenarios before answering
```

## Trigger

- Frequency: Every hour
- Isolation: Separate CLI instance via worker-manager
- Error handling: Log to `brain/errors/pid-{pid}-{timestamp}-{sessionId}.log`
