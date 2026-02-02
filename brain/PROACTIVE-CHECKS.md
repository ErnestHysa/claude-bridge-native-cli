# PROACTIVE-CHECKS.md

# Proactive Checks System

Runs automated checks every 30 minutes in an isolated CLI instance to identify potential issues before they become problems.

## Checks Performed

### 1. Unpushed Commits
**Threshold:** Older than 1 hour

**Method:** Check each indexed project for unpushed commits
```bash
cd /path/to/project && git log @{u}.. --oneline
```

**Alert Format:**
```
🔴 Unpushed commits detected in {project_name}:
- {commit_hash} {commit_message} ({age})
```

**Severity:** High if older than 4 hours, Medium if 1-4 hours

---

### 2. Stuck Tasks
**Threshold:** Running longer than 2 hours

**Method:** Query task queue for tasks stuck in 'in_progress' status

**Alert Format:**
```
🟡 Task stuck in {project_name}:
- Task: {task_description}
- Running for: {duration}
- Consider checking if it needs intervention
```

**Severity:** Medium if 2-4 hours, High if 4+ hours

---

### 3. Code Quality Alerts
**Scan for:** TODO, FIXME, HACK, XXX, BUG comments

**Method:** Search indexed code for comment patterns
```bash
# Search in project files
grep -rn "TODO\|FIXME\|HACK\|XXX\|BUG" --include="*.ts" --include="*.js" --include="*.py"
```

**Alert Format:**
```
🟠 Code quality alerts in {project_name}:
- {file}:{line}: {comment_content}
- Found {count} total markers
```

**Severity:** Low (informational)

---

### 4. Skipped Briefing Sections
**Threshold:** Same section skipped 3+ days in a row

**Method:** Check memory files for missing sections

**Alert Format:**
```
⚪ Briefing section "{section}" consistently skipped
- Skipped {count} days in a row
- Consider if this section is needed
```

**Severity:** Low (informational)

---

## Execution

**Frequency:** Every 30 minutes
**Isolation:** Separate CLI instance via worker-manager
**Error Handling:** Log to `brain/errors/pid-{pid}-{timestamp}-{sessionId}.log`

## Output

**No Alerts:**
```
✅ PROACTIVE_CHECKS_OK - All systems nominal
```

**With Alerts:**
- Send alert via Telegram for High/Medium severity
- Log all alerts to today's memory file
- Include in next heartbeat response

## Alert Priorities

| Severity | Telegram | Log | Briefing |
|----------|----------|-----|----------|
| High     | ✅       | ✅  | ✅       |
| Medium   | ✅       | ✅  | ✅       |
| Low      | ❌       | ✅  | ✅       |

## Integration

- Results logged to `brain/memory/DD-MM-YYYY.md`
- Critical alerts trigger immediate Telegram notification
- Summary included in daily briefing
- High-severity items included in heartbeat response
