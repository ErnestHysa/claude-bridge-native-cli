# Self-Review Learning Log

This file tracks patterns of mistakes and fixes for continuous self-improvement.

## Entry Format

```
[ DD-MM-YYYY HH:MM ] TAG: confidence|uncertainty|speed|depth|repeat
MISS: <what went wrong>
FIX: <what to do instead>
CONTEXT: <optional additional context>
```

## Tags

- **confidence** - Was too sure without verification
- **uncertainty** - Was unsure but didn't ask for clarification
- **speed** - Was too fast or too slow
- **depth** - Analysis was too shallow
- **repeat** - Repeated mistake after user correction

---

## Log Entries

### Initial Template Entries (Examples)

```
[ 02-02-2026 00:00 ] TAG: repeat
MISS: User corrected me 3 times on import path structure
FIX: Always verify import paths match the actual project structure before suggesting
CONTEXT: Project uses src/ but I suggested importing from root/

[ 02-02-2026 00:00 ] TAG: depth
MISS: Gave shallow solution without considering edge cases
FIX: Think through at least 3 scenarios before answering (happy path, error case, edge case)
CONTEXT: Auth flow suggestion didn't handle expired tokens

[ 02-02-2026 00:00 ] TAG: speed
MISS: Added noise instead of signal - suggested unnecessary refactoring
FIX: Only suggest changes that directly address the user's stated problem
CONTEXT: User asked for simple fix, I suggested architecture overhaul

[ 02-02-2026 00:00 ] TAG: confidence
MISS: Assumed user's tech stack without asking
FIX: Always verify assumptions about tools/frameworks before proposing solutions
CONTEXT: Assumed React when project was using Svelte
```

---

## Patterns to Watch

### Repeated Mistakes
Check this section when starting similar tasks:

- Import path structure
- Package manager used (npm/pnpm/yarn)
- Testing framework (vitest/jest/pytest)
- Git workflow (conventional commits vs freeform)
- Code style preferences (semicolons, quotes, etc.)

### User Preferences
Learned from corrections:

- Prefer simple solutions over clever ones
- Add comments for complex logic only
- Use TypeScript strict mode
- Follow existing project patterns over introducing new ones

---

## How This Is Used

1. **Before every response** - Read this file to check for relevant patterns
2. **During heartbeat** - Add new entries when mistakes are identified
3. **On user correction** - Always add a `[repeat]` entry if this has happened before
4. **Weekly review** - Look for patterns and add to User Preferences section

---

Last updated: 02-02-2026
