# Paanel Queue System Implementation Summary

## ✅ Implementation Complete

**Date:** 2026-07-08  
**Status:** Core functionality implemented, ready for testing

---

## Overview

Transformed the synchronous SIM enrichment system into a background batch queue that:
- Processes requests at a controlled rate (20/min, safely under 30/min API limit)
- Persists to disk for restart resilience
- Integrates with existing cache mechanisms
- Exposes monitoring and control endpoints
- **Automatically discovers SIMs from dashboard database AND manual UI edits**

---

## Key Features Implemented

### 1. **TypeScript-Style Type Definitions**
- `QueueStatus`: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
- `QueueItem`: Full item structure with id, simNumber, status, attempts, timestamps
- `QueueState`: Complete state including items array, worker status, and statistics
- `QueueStats`: Comprehensive metrics tracking

### 2. **Queue State Management**
- ✅ `initializeQueue()` - Loads from disk, recovers stuck PROCESSING items
- ✅ `saveQueueState()` - Atomic writes with temp file + rename
- ✅ Automatic recovery from unclean shutdown

### 3. **Queue Operations**
- ✅ `enqueueSimNumber()` - Add with validation, deduplication, and cache checking
- ✅ `dequeueNextItem()` - Atomic PENDING → PROCESSING transition
- ✅ `markItemCompleted()` - Success handling with statistics update
- ✅ `markItemFailed()` - Retry logic with MAX_RETRIES (3 attempts)

### 4. **Background Worker**
- ✅ `startWorker()` / `stopWorker()` - Graceful lifecycle management
- ✅ `processSimQueue()` - Main processing loop with:
  - 3-second rate limiting between API calls
  - Cache-first strategy
  - Circuit breaker integration
  - Automatic retry on temporary failures
  - Statistics tracking

### 5. **Automatic SIM Discovery** 🆕
- ✅ `scanAndEnqueueAllSims()` - Scans dashboard database for all SIMs
  - Reads all sections: new, old, pp, srk
  - Extracts SIM1 and SIM2 from each device
  - Checks sim_overrides.json for manual edits
  - Deduplicates and enqueues
- ✅ `watchDashboardForSimChanges()` - File watcher on dashboard_db.json
- ✅ `watchSimOverridesForChanges()` - File watcher on sim_overrides.json
- ✅ Initial full scan on server startup
- ✅ Periodic scan every 10 minutes (safety net)

### 6. **API Endpoints**

#### Queue Management
- `GET /api/paanel/queue/status` - Status, counts, statistics, ETA
- `GET /api/paanel/queue/items` - All items with details
- `POST /api/paanel/queue/start` - Start worker
- `POST /api/paanel/queue/stop` - Stop worker (graceful)
- `POST /api/paanel/queue/clear-failed` - Reset failed items to pending
- `POST /api/paanel/queue/enqueue/:simNumber` - Manually queue a SIM

#### Immediate Enrichment
- `POST /api/paanel/enrich-now/:simNumber` - Bypass queue, get instant result
  - Checks cache first
  - Falls back to immediate API call
  - Queues on failure for retry

#### Legacy Compatibility
- `GET /api/queue/status` - Redirects to new endpoint
- `POST /api/queue/clear` - Clears PENDING/FAILED items
- `POST /api/queue/pause` - Stops worker
- `POST /api/queue/resume` - Starts worker
- `POST /api/queue/add/:simNumber` - Enqueues SIM

### 7. **System Integration**
- ✅ Graceful shutdown handler (SIGTERM/SIGINT)
- ✅ Auto-start worker on pending items
- ✅ Cache integration (paanel_cache.json)
- ✅ Statistics tracking (API calls, cache hits, success/failure counts)

---

## How It Works

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   SERVER STARTUP                             │
├─────────────────────────────────────────────────────────────┤
│ 1. Load dashboard_db.json                                    │
│ 2. Load paanel_cache.json                                    │
│ 3. Initialize queue (recover from disk)                      │
│ 4. Scan all SIMs → Enqueue new ones                         │
│ 5. Set up file watchers                                      │
│ 6. Auto-start worker if pending items exist                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                 SIM DISCOVERY TRIGGERS                       │
├─────────────────────────────────────────────────────────────┤
│ • Dashboard database modified (Firebase poll updates it)     │
│ • SIM overrides modified (user edits SIM in UI)             │
│ • Manual API call: POST /api/paanel/enqueue/:simNumber      │
│ • Periodic scan every 10 minutes                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                 ENQUEUE PROCESS                              │
├─────────────────────────────────────────────────────────────┤
│ 1. Validate SIM (10 digits)                                 │
│ 2. Check cache → Skip if cached                             │
│ 3. Check queue → Skip if already PENDING/PROCESSING          │
│ 4. Create QueueItem (status: PENDING, attempts: 0)          │
│ 5. Save to disk (paanel_queue.json)                         │
│ 6. Auto-start worker if not running                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              BACKGROUND WORKER LOOP                          │
├─────────────────────────────────────────────────────────────┤
│ While isRunning:                                             │
│   1. Dequeue next PENDING item → Mark PROCESSING            │
│   2. Check cache (may have been cached externally)          │
│   3. If cached: Mark COMPLETED, continue                    │
│   4. If not cached: Call fetchPaanelEnrichment()            │
│   5. Success: Cache result, mark COMPLETED                  │
│   6. Failure: Increment attempts                            │
│      - If attempts < 3: Mark PENDING (retry)                │
│      - If attempts >= 3: Mark FAILED                        │
│   7. Wait 3 seconds (rate limiting)                         │
│   8. Repeat                                                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                 GRACEFUL SHUTDOWN                            │
├─────────────────────────────────────────────────────────────┤
│ On SIGTERM/SIGINT:                                          │
│   1. Stop worker (completes current item)                   │
│   2. Save queue state to disk                               │
│   3. Save dashboard database                                │
│   4. Exit cleanly                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## File Locations

| File | Purpose |
|------|---------|
| `data/paanel_queue.json` | Queue state persistence |
| `data/paanel_cache.json` | SIM enrichment cache |
| `data/dashboard_db.json` | Main dashboard database (watched) |
| `data/sim_overrides.json` | Manual SIM edits (watched) |

---

## Configuration Constants

```javascript
MAX_RETRIES = 3                // Max attempts before marking FAILED
WORKER_INTERVAL_MS = 3000      // 3 seconds between API calls
QUEUE_FILE_V2 = 'data/paanel_queue.json'
```

---

## Statistics Tracked

- `totalProcessed` - Items completed or failed
- `successCount` - Successfully enriched
- `failureCount` - Failed after max retries
- `apiCallsTotal` - Total API calls made
- `cacheHitsTotal` - Cache hits (skipped API calls)
- `lastProcessedAt` - Last successful processing timestamp

---

## Example Usage

### Start the server
```bash
cd /home/ank/Downloads/Malware-analysis/new/web-dashboard
node server.js
```

### Monitor queue status
```bash
curl http://localhost:3000/api/paanel/queue/status
```

### Manually enqueue a SIM
```bash
curl -X POST http://localhost:3000/api/paanel/queue/enqueue/9876543210
```

### Get immediate enrichment (bypass queue)
```bash
curl -X POST http://localhost:3000/api/paanel/enrich-now/9876543210
```

### View all queue items
```bash
curl http://localhost:3000/api/paanel/queue/items
```

### Reset failed items
```bash
curl -X POST http://localhost:3000/api/paanel/queue/clear-failed
```

---

## Testing Checklist

- [ ] **Startup Test**: Verify initial SIM discovery from dashboard
- [ ] **File Watch Test**: Edit a SIM in UI, verify auto-enrichment
- [ ] **Rate Limiting**: Monitor logs for 3-second intervals
- [ ] **Restart Test**: Stop server, restart, verify queue resumes
- [ ] **Failure Test**: Simulate API timeout, verify retry logic
- [ ] **Circuit Breaker**: Test consecutive failures trigger disable
- [ ] **Manual Edit**: Change SIM in sim_overrides.json, verify detection

---

## Migration from Old System

### Removed
- ❌ Old `simQueue` array
- ❌ Old `queueProcessingActive` boolean
- ❌ Old `loadSimQueue()` / `saveSimQueue()`
- ❌ Old `queueSimForEnrichment()`
- ❌ Old `startQueueProcessor()`
- ❌ Firebase polling queue integration

### Added
- ✅ TypeScript-style type definitions
- ✅ Structured QueueItem with full lifecycle tracking
- ✅ Worker state management (start/stop)
- ✅ Comprehensive statistics
- ✅ File watchers for automatic SIM discovery
- ✅ Immediate enrichment API
- ✅ Graceful shutdown handling
- ✅ Atomic queue state persistence
- ✅ Stuck item recovery on startup

---

## Next Steps

1. **Test in Production**
   - Monitor queue behavior with real traffic
   - Verify rate limiting compliance
   - Check API error handling

2. **Optional Enhancements** (from tasks marked with *)
   - Property-based tests for correctness
   - Unit tests for edge cases
   - Queue item archival/cleanup for COMPLETED items
   - Dashboard UI for queue visualization

3. **Performance Tuning**
   - Adjust WORKER_INTERVAL_MS if needed
   - Consider batch enrichment API if available
   - Monitor memory usage with large queues

---

## Support

For issues or questions, check:
- Server logs: `console.log('[Queue] ...')`
- Queue file: `data/paanel_queue.json`
- Cache file: `data/paanel_cache.json`
- API status: `GET /api/paanel/status`
- Queue status: `GET /api/paanel/queue/status`

---

**Implementation Status:** ✅ Core functionality complete, ready for Task 13 (end-to-end testing)
