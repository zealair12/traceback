# Traceback Performance Report

- Generated: 2026-04-07T17:01:33.120Z
- Target: `http://localhost:4000`
- Output directory: `server/reports/performance/`

## Server Snapshot

### Before run
- PID: `92587`
- Uptime: `141.46s`
- RSS: `65.94 MB`
- Heap used: `15.63 MB`
- Sessions: `7`
- Messages: `64`

### After run
- PID: `92587`
- Uptime: `141.69s`
- RSS: `73.48 MB`
- Heap used: `16.08 MB`
- Sessions: `8`
- Messages: `64`

## Step Timings

| Step | OK | HTTP | Duration | Heap delta | RSS delta | Sessions after | Messages after | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| create_session | yes | 201 | 2.79 ms | +0.13 MB | +0.84 MB | 8 | 64 |  |
| list_sessions | yes | 200 | 8.78 ms | +0.10 MB | +0.25 MB | 8 | 64 |  |
| send_root_message | no | 500 | 202.32 ms | -0.19 MB | +5.30 MB | 8 | 64 | 403 {"error":{"message":"Access denied. Please check your network settings."}} |
| send_branch_message | no | — | 0.00 ms | +0.00 MB | +0.00 MB | 8 | 64 | Skipped because root message creation failed. |
| fetch_session_messages | yes | 200 | 1.65 ms | +0.11 MB | +0.17 MB | 8 | 64 |  |
| delete_root_subtree | no | — | 0.00 ms | +0.00 MB | +0.00 MB | 8 | 64 | Skipped because no root subtree was created. |

## Notes

- `send_root_message` and `send_branch_message` include the LLM round-trip, so they are the most expensive operations.
- Memory numbers are sampled from the Traceback server via `/debug/metrics`.
- RSS reflects overall resident memory; heap used is usually the clearer signal for app allocations.
- The script cleans up the created message subtree, but keeps the created session row so session growth remains observable over time.
