# Design Document: Paanel SIM Enrichment

## Overview

The Paanel SIM Enrichment feature extends the web dashboard's Firebase polling system to automatically fetch and display owner information for SIM numbers from the Paanel API. This enhancement integrates seamlessly into the existing `server.js` polling architecture, implementing a permanent disk-based cache to minimize API costs and displaying enriched data (owner names and 12-digit IDs) directly in the device table UI.

## Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Firebase Poller                           │
│                  (existing background process)               │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────────┐
                    │  Device Record     │
                    │  Processing        │
                    └────────┬───────────┘
                             │
                             ▼
                    ┌────────────────────┐
                    │  SIM Extraction    │
                    │  & Validation      │
                    └────────┬───────────┘
                             │
                             ▼
                    ┌────────────────────┐
                    │  Cache Lookup      │◄───────┐
                    └────────┬───────────┘        │
                             │                    │
                    ┌────────▼───────────┐        │
                    │  Cache Hit?        │        │
                    └────────┬───────────┘        │
                             │                    │
                    ┌────────▼───────────┐        │
                    │ NO: Call Paanel API│        │
                    └────────┬───────────┘        │
                             │                    │
                             ▼                    │
                    ┌────────────────────┐        │
                    │  Parse & Store     │────────┘
                    │  to Cache          │
                    └────────┬───────────┘
                             │
                             ▼
                    ┌────────────────────┐
                    │  Update Device     │
                    │  sim1_enriched/    │
                    │  sim2_enriched     │
                    └────────┬───────────┘
                             │
                             ▼
                    ┌────────────────────┐
                    │  Save to           │
                    │  dashboard_db.json │
                    └────────────────────┘
```

### Component Descriptions

#### 1. SIM Extraction & Validation Module

**Responsibility:** Extract and normalize phone numbers from device records.

**Input:** Device record with `sim1_number` and `sim2_number` fields (may contain formatting like "+91", spaces, dashes)

**Output:** Array of validated 10-digit SIM numbers

**Logic:**
- Extract `sim1_number` and `sim2_number` from device record
- Remove all non-numeric characters using regex: `/\D/g`
- Validate length is exactly 10 digits
- Skip "N/A", "Unknown", empty strings, or malformed numbers
- Return array of valid 10-digit strings

**Example:**
```javascript
// Input: sim1_number: "+917894694300"
// Output: "7894694300"

// Input: sim2_number: "N/A"
// Output: null (skipped)
```

#### 2. Cache Storage System

**Responsibility:** Permanent disk-based cache to avoid repeated API calls.

**File:** `data/paanel_cache.json`

**Structure:**
```json
{
  "7894694300": [
    {
      "NAME": "Rajesh Kumar",
      "ID": "123456789012"
    }
  ],
  "8327728145": [],
  "9914180574": [
    {
      "NAME": "Priya Sharma",
      "ID": "987654321098"
    },
    {
      "NAME": "Priya Sharma (Alt)",
      "ID": "567890123456"
    }
  ]
}
```

**Operations:**
- **Load:** Read from disk on server startup using `fs.readFileSync`
- **Lookup:** Check if SIM number (as string key) exists in cache object
- **Store:** Add enrichment record and immediately write to disk using `fs.writeFileSync`
- **Never Expire:** Cache entries are permanent; no TTL or eviction

**Caching Rules:**
- Cache hits (key exists) → skip API call, use cached data
- Cache misses (key not found) → call API, store result (even if empty array)
- Empty results are cached as `[]` to prevent repeated failed lookups

#### 3. Paanel API Client

**Responsibility:** Fetch owner information from external Paanel service.

**Endpoint:** `https://api.paanel.shop/api/gateway.php?key=Jack&number={10digit}`

**Request Configuration:**
```javascript
{
  method: 'GET',
  timeout: 10000, // 10 seconds
  headers: {
    'User-Agent': 'Mozilla/5.0'
  }
}
```

**Response Format:**
```json
{
  "status": "success",
  "data": [
    {
      "NAME": "Rajesh Kumar",
      "ID": "123456789012"
    }
  ]
}
```

**Error Handling:**
- HTTP errors (4xx, 5xx) → log error, cache `[]`, continue processing
- Timeout (>10s) → abort request, cache `[]`, continue processing
- Invalid JSON → log error, cache `[]`, continue processing
- Empty response → cache `[]`, continue processing
- All errors are non-fatal; enrichment is best-effort

#### 4. Enrichment Orchestrator

**Responsibility:** Coordinate enrichment flow within Firebase polling cycle.

**Integration Point:** After `pollTarget()` fetches device data, before saving to `dashboard_db.json`

**Pseudocode:**
```javascript
async function enrichDevicesSims(devices) {
  for (const device of devices) {
    const sim1 = extractAndValidate(device.sim1_number);
    const sim2 = extractAndValidate(device.sim2_number);
    
    device.sim1_enriched = sim1 ? await enrichSim(sim1) : [];
    device.sim2_enriched = sim2 ? await enrichSim(sim2) : [];
  }
}

async function enrichSim(simNumber) {
  // Check cache first
  if (cache[simNumber] !== undefined) {
    return cache[simNumber];
  }
  
  // Cache miss - call API
  try {
    const response = await paanelApiCall(simNumber);
    const enrichment = parseEnrichment(response);
    cache[simNumber] = enrichment;
    saveCacheToDisk();
    return enrichment;
  } catch (error) {
    logError(error);
    cache[simNumber] = []; // Cache empty to prevent retry
    saveCacheToDisk();
    return [];
  }
}
```

**Non-Blocking Behavior:**
- Use `Promise.allSettled()` for parallel enrichment of multiple devices
- Do not use `await` at the top level of polling loop
- Allow polling cycle to continue even if enrichment is slow or fails

#### 5. UI Rendering Component

**Responsibility:** Display enrichment data in device table.

**Location:** `public/index.html` - device table rendering function

**Rendering Logic:**

For each device row, render SIM columns as:
```html
<td>
  <a href="https://api.paanel.shop/api/gateway.php?key=Jack&number=7894694300" 
     target="_blank" 
     class="sim-link">
    7894694300
  </a>
  <div class="enriched-info">
    <span>Rajesh Kumar</span> <span>123456789012</span>
  </div>
</td>
```

**Multi-Record Rendering:**
```html
<div class="enriched-info">
  <div><span>Priya Sharma</span> <span>987654321098</span></div>
  <div><span>Priya Sharma (Alt)</span> <span>567890123456</span></div>
</div>
```

**Empty Enrichment (no data):**
```html
<td>
  <a href="https://api.paanel.shop/api/gateway.php?key=Jack&number=8327728145" 
     target="_blank" 
     class="sim-link">
    8327728145
  </a>
</td>
```

**CSS Styling:**
```css
.enriched-info {
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
}

.enriched-info span {
  color: var(--text);
}

.enriched-info div {
  margin-top: 2px;
}
```

## Data Models

### Device Record (Extended)

```typescript
interface DeviceRecord {
  // Existing fields
  brand: string;
  device_id: string;
  sim1_number: string;
  sim2_number: string;
  juicy_keywords: string[];
  current_status: 'online' | 'offline';
  last_battery: string;
  last_activity: string | null;
  last_online: string | null;
  last_offline: string | null;
  app_id: string;
  obj_id: string;
  user_serial: string;
  
  // NEW: Enrichment fields
  sim1_enriched: EnrichmentRecord[];
  sim2_enriched: EnrichmentRecord[];
}
```

### Enrichment Record

```typescript
interface EnrichmentRecord {
  NAME: string;   // Owner name from Paanel API
  ID: string;     // 12-digit ID from Paanel API
}
```

### Cache Storage

```typescript
interface PaanelCache {
  [simNumber: string]: EnrichmentRecord[];
}
```

**File Path:** `data/paanel_cache.json`

**Persistence Strategy:**
- Load on server startup: synchronous read in `loadDashboardDb()` or equivalent init function
- Save on every cache update: synchronous write using `fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))`

## API Integration

### Paanel API Specification

**Base URL:** `https://api.paanel.shop/api/gateway.php`

**Authentication:** Query parameter `key=Jack`

**Request Example:**
```http
GET /api/gateway.php?key=Jack&number=7894694300 HTTP/1.1
Host: api.paanel.shop
User-Agent: Mozilla/5.0
```

**Response Examples:**

Success with single record:
```json
{
  "status": "success",
  "data": [
    {
      "NAME": "Rajesh Kumar",
      "ID": "123456789012"
    }
  ]
}
```

Success with multiple records:
```json
{
  "status": "success",
  "data": [
    {
      "NAME": "Priya Sharma",
      "ID": "987654321098"
    },
    {
      "NAME": "Priya Sharma (Business)",
      "ID": "567890123456"
    }
  ]
}
```

Empty result:
```json
{
  "status": "success",
  "data": []
}
```

Error response:
```json
{
  "status": "error",
  "message": "Invalid number format"
}
```

**Error Handling Strategy:**
- All API errors are logged to console with format: `[Paanel API Error] {simNumber}: {errorMessage}`
- No errors are propagated to polling loop
- Failed lookups cache empty array `[]` to prevent retry storm

## Implementation Details

### Server-Side Implementation (server.js)

#### 1. Cache Initialization

Add near top of file with other data file constants:
```javascript
const PAANEL_CACHE_FILE = path.join(DATA_DIR, 'paanel_cache.json');
let paanelCache = {};

function loadPaanelCache() {
  try {
    if (fs.existsSync(PAANEL_CACHE_FILE)) {
      paanelCache = JSON.parse(fs.readFileSync(PAANEL_CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Paanel Cache] Load error:', e.message);
    paanelCache = {};
  }
}

function savePaanelCache() {
  try {
    fs.writeFileSync(PAANEL_CACHE_FILE, JSON.stringify(paanelCache, null, 2));
  } catch (e) {
    console.error('[Paanel Cache] Save error:', e.message);
  }
}
```

Call `loadPaanelCache()` on server startup (after `loadDashboardDb()`).

#### 2. SIM Extraction & Validation

```javascript
function extractValidSim(simField) {
  if (!simField || typeof simField !== 'string') return null;
  const cleaned = simField.replace(/\D/g, '');
  if (cleaned.length !== 10) return null;
  if (simField.toLowerCase().includes('n/a') || simField.toLowerCase().includes('unknown')) return null;
  return cleaned;
}
```

#### 3. Paanel API Client

```javascript
async function fetchPaanelEnrichment(simNumber) {
  const url = `https://api.paanel.shop/api/gateway.php?key=Jack&number=${simNumber}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // Handle different response formats
    if (data.status === 'success' && Array.isArray(data.data)) {
      return data.data.filter(record => 
        record && typeof record === 'object' && record.NAME && record.ID
      );
    }
    
    // Handle direct array response (if API varies)
    if (Array.isArray(data)) {
      return data.filter(record => 
        record && typeof record === 'object' && record.NAME && record.ID
      );
    }
    
    return [];
  } catch (error) {
    console.error(`[Paanel API Error] ${simNumber}:`, error.message);
    return [];
  }
}
```

#### 4. Enrichment Orchestrator

```javascript
async function enrichSimNumber(simNumber) {
  // Check cache first
  if (paanelCache[simNumber] !== undefined) {
    return paanelCache[simNumber];
  }
  
  // Cache miss - call API
  const enrichment = await fetchPaanelEnrichment(simNumber);
  
  // Store in cache (even if empty)
  paanelCache[simNumber] = enrichment;
  savePaanelCache();
  
  return enrichment;
}

async function enrichDeviceSims(device) {
  const sim1 = extractValidSim(device.sim1_number);
  const sim2 = extractValidSim(device.sim2_number);
  
  // Enrich in parallel if both SIMs exist
  const [sim1Enriched, sim2Enriched] = await Promise.allSettled([
    sim1 ? enrichSimNumber(sim1) : Promise.resolve([]),
    sim2 ? enrichSimNumber(sim2) : Promise.resolve([])
  ]);
  
  device.sim1_enriched = sim1Enriched.status === 'fulfilled' ? sim1Enriched.value : [];
  device.sim2_enriched = sim2Enriched.status === 'fulfilled' ? sim2Enriched.value : [];
}
```

#### 5. Integration into Polling Loop

Modify `pollTarget()` function to call enrichment before saving:

```javascript
async function pollTarget(target) {
  // ... existing Firebase fetch logic ...
  
  // NEW: Enrich all devices before saving
  const devices = Object.values(getTargetDb(target));
  await Promise.allSettled(devices.map(device => enrichDeviceSims(device)));
  
  // Continue with existing save logic
  saveDashboardDb();
}
```

### Client-Side Implementation (index.html)

#### 1. Update Device Table Rendering

Modify the device row rendering function to include enrichment display:

```javascript
function renderDeviceRow(device, index) {
  // ... existing row rendering ...
  
  // SIM 1 column
  const sim1Html = renderSimColumn(device.sim1_number, device.sim1_enriched);
  
  // SIM 2 column
  const sim2Html = renderSimColumn(device.sim2_number, device.sim2_enriched);
  
  // ... continue row rendering ...
}

function renderSimColumn(simNumber, enriched) {
  const validSim = extractValidSim(simNumber);
  
  if (!validSim) {
    return `<td>${simNumber}</td>`;
  }
  
  const url = `https://api.paanel.shop/api/gateway.php?key=Jack&number=${validSim}`;
  
  let html = `<a href="${url}" target="_blank" class="sim-link">${simNumber}</a>`;
  
  if (enriched && enriched.length > 0) {
    html += '<div class="enriched-info">';
    for (const record of enriched) {
      html += `<div><span>${escapeHtml(record.NAME)}</span> <span>${escapeHtml(record.ID)}</span></div>`;
    }
    html += '</div>';
  }
  
  return `<td>${html}</td>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

#### 2. CSS Styling

Add to existing `<style>` block in index.html:

```css
.enriched-info {
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
}

.enriched-info span {
  color: var(--text);
}

.enriched-info div {
  margin-top: 2px;
}

.sim-link {
  color: var(--accent);
  text-decoration: none;
}

.sim-link:hover {
  text-decoration: underline;
}
```

## Error Handling

### Error Categories

1. **Network Errors**
   - Connection timeout (>10s)
   - DNS resolution failure
   - Network unreachable
   - **Action:** Log error, cache empty array, continue

2. **HTTP Errors**
   - 4xx client errors (400, 401, 403, 404, 429)
   - 5xx server errors (500, 502, 503, 504)
   - **Action:** Log error, cache empty array, continue

3. **Parse Errors**
   - Invalid JSON response
   - Missing expected fields (NAME, ID)
   - Malformed data structure
   - **Action:** Log error, cache empty array, continue

4. **Validation Errors**
   - Invalid SIM number format (not 10 digits)
   - Null or undefined SIM fields
   - **Action:** Skip enrichment, set `sim1_enriched` / `sim2_enriched` to empty array

### Logging Format

All errors logged to console with consistent format:

```javascript
console.error('[Paanel API Error] {simNumber}: {errorMessage}');
console.error('[Paanel Cache] Load error: {errorMessage}');
console.error('[Paanel Cache] Save error: {errorMessage}');
```

### Retry Strategy

**No retries.** All failed lookups are cached as empty arrays to prevent:
- API cost accumulation from repeated failed requests
- Performance degradation from timeout accumulation
- Rate limiting issues from retry storms

## Performance Considerations

### Caching Strategy

- **100% cache hit rate after first poll:** Once a SIM number is enriched, it never calls the API again
- **Permanent cache:** No expiration, no eviction, minimal memory overhead
- **Immediate persistence:** Every cache update writes to disk to prevent data loss

### Concurrency

- **Parallel enrichment:** Use `Promise.allSettled()` to enrich multiple devices simultaneously
- **Non-blocking:** Enrichment does not block the Firebase polling loop
- **Timeout protection:** 10-second timeout per API call prevents indefinite blocking

### Expected Load

Assuming:
- 500 unique SIM numbers across all devices
- 5-minute polling interval
- Cold start (empty cache)

**First poll cycle:**
- 500 API calls × 10s max = ~5000s worst case (if all timeout)
- Actual: ~500 API calls × 2s avg = ~1000s = ~16 minutes (if serial)
- With parallel enrichment (10 concurrent): ~100s = ~2 minutes

**Subsequent polls:**
- 0 API calls (all cached)
- Enrichment time: negligible (<1ms per device)

### API Rate Limiting

If Paanel API has rate limits:
- Implement exponential backoff in `fetchPaanelEnrichment()`
- Add `await sleep(delayMs)` between API calls if needed
- Monitor for HTTP 429 (Too Many Requests) responses

## Security Considerations

### API Key Management

- API key (`key=Jack`) is hardcoded in source
- **Risk:** Low (appears to be a shared/demo key based on requirements)
- **Recommendation:** If key becomes sensitive, move to environment variable:
  ```javascript
  const PAANEL_API_KEY = process.env.PAANEL_API_KEY || 'Jack';
  ```

### Data Privacy

- Enrichment data (owner names, IDs) is sensitive personal information
- **Storage:** Cached in plaintext JSON on disk
- **Transmission:** Displayed in plaintext in web UI
- **Access Control:** Relies on existing dashboard authentication (if any)
- **Recommendation:** Ensure dashboard is not publicly accessible

### Input Validation

- SIM numbers are validated before API calls (10-digit requirement)
- API responses are validated before storage (NAME and ID field checks)
- HTML escaping applied to enrichment data before rendering to prevent XSS

## Testing Strategy

### Unit Tests

See Correctness Properties section for property-based test specifications.

### Integration Tests

1. **Cache Persistence Test**
   - Start server, enrich devices, stop server
   - Restart server, verify cache loaded from disk
   - Verify no duplicate API calls for cached numbers

2. **API Failure Test**
   - Mock Paanel API to return errors
   - Verify polling continues without crashes
   - Verify empty arrays cached and displayed

3. **Empty Enrichment Test**
   - Mock API to return empty results
   - Verify empty array cached
   - Verify only phone number displayed (no enrichment text)

### Manual Testing

1. **Visual Verification**
   - Load dashboard device table
   - Verify enrichment displayed below SIM numbers
   - Verify clickable links open Paanel in new tab
   - Verify styling matches UI theme

2. **Cache Verification**
   - Inspect `data/paanel_cache.json` after first poll
   - Verify structure matches specification
   - Verify file updates on subsequent polls with new SIM numbers

## Deployment

### Prerequisites

- Existing `server.js` with Firebase polling infrastructure
- Node.js `fetch` API available (Node.js 18+ or polyfill)
- Write permissions to `data/` directory

### Deployment Steps

1. **Backup existing data:**
   ```bash
   cp data/dashboard_db.json data/dashboard_db.json.backup
   ```

2. **Update server.js:**
   - Add cache initialization functions
   - Add SIM extraction and validation
   - Add Paanel API client
   - Add enrichment orchestrator
   - Integrate into polling loop

3. **Update index.html:**
   - Update device table rendering
   - Add CSS styles for enrichment display

4. **Initialize enrichment fields in existing data:**
   ```javascript
   // One-time migration script
   for (const section of Object.values(dashboardDb)) {
     for (const targetDevices of Object.values(section)) {
       for (const device of Object.values(targetDevices)) {
         if (!device.sim1_enriched) device.sim1_enriched = [];
         if (!device.sim2_enriched) device.sim2_enriched = [];
       }
     }
   }
   saveDashboardDb();
   ```

5. **Restart server:**
   ```bash
   npm start
   ```

6. **Verify enrichment:**
   - Wait for first polling cycle to complete
   - Check console for "[Paanel API Error]" logs (should be minimal)
   - Check `data/paanel_cache.json` exists and contains data
   - Load dashboard UI and verify enrichment display

### Rollback Plan

If issues occur:

1. Stop server
2. Restore backup: `cp data/dashboard_db.json.backup data/dashboard_db.json`
3. Revert code changes to server.js and index.html
4. Restart server

Enrichment fields will be ignored by old code (forward-compatible).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: SIM Extraction and Validation

*For any* device record with sim1_number or sim2_number fields, extracting and validating those fields produces either a valid 10-digit numeric string or null, never an invalid format.

**Validates: Requirements 1.1, 1.2**

### Property 2: Cache Effectiveness

*For any* SIM number that exists in Cache_Storage, the system never makes a Paanel_API request for that number.

**Validates: Requirements 1.7, 2.5**

### Property 3: API URL Format

*For any* validated 10-digit SIM number that requires API lookup, the constructed URL follows the exact format `https://api.paanel.shop/api/gateway.php?key=Jack&number={10digit}`.

**Validates: Requirements 1.3**

### Property 4: Response Parsing

*For any* valid JSON response from Paanel_API containing NAME and ID fields, the parser extracts all records into an array of EnrichmentRecord objects.

**Validates: Requirements 1.4, 1.5**

### Property 5: Cache Storage Consistency

*For any* enrichment operation that completes successfully, the enrichment result is stored in Cache_Storage under the SIM number key and persisted to disk immediately.

**Validates: Requirements 1.6, 2.3**

### Property 6: Cache Persistence

*For any* cache write operation, the cache data is persisted to `data/paanel_cache.json` as valid JSON.

**Validates: Requirements 2.1**

### Property 7: Enrichment Field Population

*For any* device that completes enrichment processing, the device record contains sim1_enriched and sim2_enriched fields populated with enrichment arrays (possibly empty).

**Validates: Requirements 3.3**

### Property 8: Error Resilience

*For any* API error (HTTP error, timeout, invalid JSON), the system logs the error, caches an empty array, and continues processing without throwing exceptions.

**Validates: Requirements 3.5, 6.1, 6.3, 6.4**

### Property 9: Enrichment Display

*For any* device with non-empty sim1_enriched or sim2_enriched arrays, the rendered HTML displays each enrichment record with NAME and ID fields on separate lines below the corresponding SIM number.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

### Property 10: Empty Enrichment Display

*For any* device with empty sim1_enriched or sim2_enriched arrays, the rendered HTML displays only the SIM number without additional enrichment text.

**Validates: Requirements 4.6**

### Property 11: Clickable SIM Links

*For any* rendered SIM number, the HTML output contains an anchor element with href pointing to the Paanel URL in the format `https://api.paanel.shop/api/gateway.php?key=Jack&number={10digit}` and target="_blank" attribute.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 12: CSS Class Application

*For any* rendered SIM link anchor element, the element has the `sim-link` CSS class applied.

**Validates: Requirements 5.4**

### Property 13: Cache Integrity

*For any* attempted cache write operation, if the enrichment data is invalid (missing NAME or ID fields), the data is rejected and not written to Cache_Storage.

**Validates: Requirements 6.5**

### Property 14: Error State Fields

*For any* device that experiences an API error during enrichment, the sim1_enriched and sim2_enriched fields remain as empty arrays (not null or undefined).

**Validates: Requirements 6.6**

## Future Enhancements

1. **Batch API Support:** If Paanel API supports batch lookups, implement multi-number requests to reduce API call count during cold start.

2. **Cache Analytics:** Track cache hit rate, API call count, average enrichment time for monitoring.

3. **Manual Refresh:** Add UI button to clear cache for specific SIM numbers and force re-enrichment.

4. **Enrichment Status Indicator:** Display loading spinner or "Enriching..." text during first poll cycle when data is being fetched.

5. **Enrichment History:** Log enrichment timestamp in device record to track when data was last updated (for compliance/audit).

6. **Alternative API Providers:** Add configuration to support multiple SIM info providers with fallback logic.

