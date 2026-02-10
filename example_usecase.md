# Example Use Case: Shipping a Fix from Telegram

This scenario shows an end-to-end flow with the upgraded bot.

## Situation

You are away from your desk and need to patch a production bug in `payment-service`.

## Flow

### 1) Open the session

```text
/start
/projects
/select
```

Select `payment-service`.

### 2) Ask Claude for diagnosis

```text
Investigate intermittent checkout failures. Focus on retry logic and timeout handling.
```

Bot streams Claude output and reports candidate root causes.

### 3) Persist the key finding

```text
/remember payment-root-cause Retry helper swallows timeout error and returns success path
```

### 4) Build an implementation task

```text
/task Patch retry helper to propagate timeout errors and add regression tests --bg
/tasks
```

### 5) Trigger specialized review

```text
/agent reviewer Verify patch risk around idempotency and side effects
```

### 6) Validate code intelligence

```text
/index
/search retry timeout
/file src/retry/retry-helper.ts
```

### 7) Finalize and ship

```text
/git status
/git commit
```

If autonomous decisions are pending:

```text
/decisions
/approve <decision-id>
```

### 8) Confirm health

```text
/metrics
/state
/recovery
```

## Result

You can triage, patch, review, and push a well-documented fix from Telegram while preserving memory, audit trails, and recovery state.
