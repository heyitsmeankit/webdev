# Implementation Plan: Paanel SIM Enrichment

## Overview

This implementation adds automatic SIM owner enrichment from the Paanel API service. The feature integrates into the existing Firebase polling background process, implements permanent disk-based caching to minimize API costs, and displays enriched data (owner names and 12-digit IDs) directly in the device table UI. The implementation uses JavaScript (Node.js) for the server-side logic and vanilla JavaScript for the client-side rendering.

## Tasks

- [x] 1. Set up Paanel cache infrastructure
  - Create cache file constant `PAANEL_CACHE_FILE` in server.js data directory section
  - Add `paanelCache` in-memory object variable (initialized as empty object)
  - Implement `loadPaanelCache()` function to read from `data/paanel_cache.json` on startup
  - Implement `savePaanelCache()` function to write cache to disk with JSON.stringify
  - Add error handling for cache file operations (log errors, initialize empty cache on failure)
  - Call `loadPaanelCache()` during server initialization after `loadDashboardDb()`
  - _Requirements: 2.1, 2.2, 2.3_

- [ ] 2. Implement SIM extraction and validation
  - [x] 2.1 Create SIM extraction utility function
    - Write `extractValidSim(simField)` function that takes a string parameter
    - Validate input is non-null, non-undefined string type
    - Remove all non-numeric characters using regex `/\D/g`
    - Check if cleaned string is exactly 10 digits long
    - Reject values containing "n/a" or "unknown" (case-insensitive)
    - Return validated 10-digit string or null for invalid inputs
    - _Requirements: 1.1, 1.2_
  
  - [ ]* 2.2 Write unit tests for SIM extraction
    - Test valid 10-digit numbers with formatting ("+91 7894694300", "7894-694-300")
    - Test invalid inputs (9 digits, 11 digits, empty string, null, undefined, "N/A")
    - Test edge cases (all zeros, special characters, mixed content)
    - _Requirements: 1.1, 1.2_

- [ ] 3. Implement Paanel API client
  - [ ] 3.1 Create API fetch function
    - Write `fetchPaanelEnrichment(simNumber)` async function
    - Construct URL: `https://api.paanel.shop/api/gateway.php?key=Jack&number=${simNumber}`
    - Use fetch with 10-second timeout via `AbortSignal.timeout(10000)`
    - Set User-Agent header to "Mozilla/5.0"
    - Parse JSON response and extract data array
    - Handle both `{status: "success", data: [...]}` and direct array responses
    - Filter records to ensure NAME and ID fields exist
    - Return empty array on any error (HTTP error, timeout, invalid JSON)
    - Log all errors with format: `[Paanel API Error] {simNumber}: {errorMessage}`
    - _Requirements: 1.3, 1.4, 1.5, 6.1, 6.2, 6.3, 6.4_
  
  - [ ]* 3.2 Write unit tests for API client
    - Mock successful API response with single record
    - Mock successful API response with multiple records
    - Mock empty result response
    - Mock HTTP error (4xx, 5xx status codes)
    - Mock timeout scenario (request exceeds 10 seconds)
    - Mock invalid JSON response
    - Verify error logging format
    - _Requirements: 1.3, 1.4, 1.5, 6.1, 6.2, 6.3, 6.4_

- [ ] 4. Implement enrichment orchestrator
  - [ ] 4.1 Create single SIM enrichment function
    - Write `enrichSimNumber(simNumber)` async function
    - Check if `paanelCache[simNumber]` exists (cache hit)
    - Return cached value immediately if found
    - On cache miss, call `fetchPaanelEnrichment(simNumber)`
    - Store result in `paanelCache[simNumber]` (even if empty array)
    - Call `savePaanelCache()` immediately after storing
    - Return enrichment array
    - _Requirements: 1.6, 1.7, 2.3, 2.5_
  
  - [ ] 4.2 Create device enrichment function
    - Write `enrichDeviceSims(device)` async function
    - Extract sim1 using `extractValidSim(device.sim1_number)`
    - Extract sim2 using `extractValidSim(device.sim2_number)`
    - Use `Promise.allSettled()` to enrich both SIMs in parallel
    - Set `device.sim1_enriched` from sim1 enrichment result (empty array if failed)
    - Set `device.sim2_enriched` from sim2 enrichment result (empty array if failed)
    - Handle promise rejection gracefully (assign empty arrays)
    - _Requirements: 3.3, 6.6_
  
  - [ ]* 4.3 Write integration tests for enrichment orchestrator
    - Test cache hit scenario (no API call made)
    - Test cache miss scenario (API called, result cached)
    - Test parallel enrichment of two SIMs
    - Test device with one valid SIM, one invalid SIM
    - Test device with both SIMs invalid
    - Test API failure handling (empty arrays assigned)
    - _Requirements: 1.7, 2.5, 3.3, 6.6_

- [ ] 5. Checkpoint - Verify server-side enrichment logic
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Integrate enrichment into polling loop
  - [ ] 6.1 Modify pollTarget function
    - Locate `pollTarget(target)` function in server.js
    - After device processing loop completes (after all `upsertDevice` calls)
    - Before `saveDashboardDb()` call
    - Get all devices from target using `Object.values(getTargetDb(target))`
    - Call `Promise.allSettled(devices.map(device => enrichDeviceSims(device)))`
    - Do not await individual device enrichments (non-blocking)
    - Continue to `saveDashboardDb()` after enrichment completes
    - _Requirements: 3.1, 3.2, 3.4, 3.5_
  
  - [ ] 6.2 Initialize enrichment fields in existing device records
    - Create one-time migration logic to add `sim1_enriched: []` and `sim2_enriched: []` to all existing devices
    - Iterate through `dashboardDb.new`, `dashboardDb.old`, `dashboardDb.pp`, `dashboardDb.srk`
    - For each target's device map, add enrichment fields if missing
    - Save updated database with `saveDashboardDb()`
    - _Requirements: 3.3_

- [ ] 7. Implement client-side enrichment display
  - [ ] 7.1 Create SIM column rendering function
    - Locate device table rendering code in index.html
    - Write `renderSimColumn(simNumber, enriched)` JavaScript function
    - Validate SIM using client-side `extractValidSim()` (reuse server logic or reimplement)
    - If invalid SIM, return `<td>${simNumber}</td>` without link
    - Construct Paanel URL: `https://api.paanel.shop/api/gateway.php?key=Jack&number=${validSim}`
    - Create anchor element with `href`, `target="_blank"`, and `class="sim-link"`
    - If `enriched` array has records, create `<div class="enriched-info">` wrapper
    - For each record, create `<div>` with `<span>${NAME}</span> <span>${ID}</span>`
    - Apply HTML escaping using `escapeHtml()` helper for NAME and ID fields
    - Return complete HTML string for table cell
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4_
  
  - [ ] 7.2 Update device table row rendering
    - Locate `renderDeviceRow()` or equivalent table rendering function
    - Replace SIM1 column rendering with call to `renderSimColumn(device.sim1_number, device.sim1_enriched)`
    - Replace SIM2 column rendering with call to `renderSimColumn(device.sim2_number, device.sim2_enriched)`
    - Ensure enrichment arrays default to empty arrays if undefined
    - _Requirements: 4.1, 4.2_
  
  - [ ] 7.3 Add CSS styles for enrichment display
    - Add `.enriched-info` style: font-size 11px, color var(--muted), margin-top 4px
    - Add `.enriched-info span` style: color var(--text)
    - Add `.enriched-info div` style: margin-top 2px (for multiple records)
    - Verify `.sim-link` class exists with color var(--accent), no text-decoration
    - Verify `.sim-link:hover` has text-decoration underline
    - _Requirements: 4.7, 5.4, 5.5_
  
  - [ ]* 7.4 Write UI rendering tests
    - Test rendering with single enrichment record
    - Test rendering with multiple enrichment records
    - Test rendering with empty enrichment (no extra text)
    - Test HTML escaping prevents XSS (inject script tags in NAME/ID)
    - Test anchor element has correct attributes (href, target, class)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4_

- [ ] 8. Add HTML escaping utility
  - Create `escapeHtml(text)` function in index.html
  - Use DOM method: create div element, set textContent, return innerHTML
  - Prevents XSS from enrichment data containing special characters
  - _Requirements: 6.5_

- [ ] 9. Checkpoint - Verify end-to-end enrichment flow
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Testing and validation
  - [ ]* 10.1 Write property-based tests for cache effectiveness
    - **Property 2: Cache Effectiveness**
    - **Validates: Requirements 1.7, 2.5**
    - Generate random 10-digit SIM numbers
    - Enrich each number twice
    - Verify second enrichment uses cached data (no API call)
    - Assert cache file contains all enriched numbers
  
  - [ ]* 10.2 Write property-based tests for error resilience
    - **Property 8: Error Resilience**
    - **Validates: Requirements 3.5, 6.1, 6.3, 6.4**
    - Mock various API failures (timeouts, HTTP errors, invalid JSON)
    - Verify system continues processing without throwing exceptions
    - Verify empty arrays cached for failed lookups
    - Verify error logs follow expected format
  
  - [ ]* 10.3 Write property-based tests for enrichment field population
    - **Property 7: Enrichment Field Population**
    - **Validates: Requirements 3.3**
    - Generate devices with various SIM configurations (valid, invalid, missing)
    - Process each device through enrichment flow
    - Assert every device has `sim1_enriched` and `sim2_enriched` arrays (never null/undefined)
  
  - [ ]* 10.4 Write integration test for cache persistence
    - Enrich devices and verify cache written to disk
    - Restart server (reload cache from disk)
    - Verify cached data loaded correctly
    - Enrich same devices again (no API calls made)
    - Verify cache file format is valid JSON
  
  - [ ] 10.5 Manual testing checklist
    - Start server and wait for first polling cycle
    - Verify `data/paanel_cache.json` file created
    - Inspect cache file structure matches specification
    - Load dashboard in browser
    - Verify enrichment displayed below SIM numbers
    - Verify NAME and ID separated by space
    - Verify multiple records displayed on separate lines
    - Click SIM number link, verify opens Paanel in new tab
    - Verify hover effect applies underline to link
    - Check console for API errors (should be minimal)
    - Trigger API failure (disconnect network), verify polling continues
    - _Requirements: All acceptance criteria_

- [ ] 11. Documentation and deployment
  - [ ] 11.1 Add inline code comments
    - Document cache structure format in `loadPaanelCache()`
    - Document API response format in `fetchPaanelEnrichment()`
    - Document enrichment flow in `enrichDeviceSims()`
    - Document rendering logic in `renderSimColumn()`
  
  - [ ] 11.2 Create deployment checklist
    - Document backup procedure for `dashboard_db.json`
    - Document cache initialization step
    - Document rollback procedure
    - Add verification steps (cache file, UI display, console logs)

- [ ] 12. Final checkpoint - Complete implementation review
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property-based tests validate universal correctness properties from design document
- Unit tests validate specific examples and edge cases
- Integration tests verify end-to-end flow with real components
- Manual testing ensures visual/UX requirements are met
- Checkpoints ensure incremental validation throughout implementation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "8"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "6.1"] },
    { "id": 6, "tasks": ["6.2", "7.1"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["7.3", "7.4"] },
    { "id": 9, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5"] },
    { "id": 10, "tasks": ["11.1", "11.2"] }
  ]
}
```
