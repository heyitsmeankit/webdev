# Requirements Document

## Introduction

The Paanel SIM Enrichment feature enhances the web dashboard by fetching and displaying owner name and 12-digit ID information for SIM numbers from the Paanel API service. This enrichment integrates into the existing Firebase polling background process, implements permanent caching to avoid API charges, and displays results directly in the device table UI.

## Glossary

- **Dashboard**: The web-based device monitoring application that displays malware-infected device information
- **Paanel_API**: The external API service at https://api.paanel.shop that provides SIM owner information
- **SIM_Number**: A 10-digit phone number associated with a device's SIM card (SIM1 or SIM2)
- **Enrichment_Record**: A data structure containing NAME and 12-digit ID retrieved from Paanel API for a specific SIM number
- **Firebase_Poller**: The existing server-side background process that periodically fetches device data from Firebase databases
- **Cache_Storage**: A persistent JSON file that stores enrichment records permanently to avoid repeated API calls
- **Device_Table**: The UI table component that displays device information including SIM numbers

## Requirements

### Requirement 1

**User Story:** As a malware analyst, I want SIM numbers to be enriched with owner names and IDs from Paanel API, so that I can identify device owners without manual lookups.

#### Acceptance Criteria

1. WHEN THE Firebase_Poller processes a device record, THE Dashboard SHALL extract all 10-digit SIM numbers from sim1_number and sim2_number fields
2. WHEN a SIM_Number is extracted, THE Dashboard SHALL remove all non-numeric characters and validate the number is exactly 10 digits
3. WHEN a validated SIM_Number is not present in Cache_Storage, THE Dashboard SHALL call the Paanel_API endpoint with the format `https://api.paanel.shop/api/gateway.php?key=Jack&number={10digit}`
4. WHEN THE Paanel_API returns a response, THE Dashboard SHALL parse the JSON response to extract NAME and ID fields
5. IF THE Paanel_API response contains multiple records, THEN THE Dashboard SHALL store all records as an array of Enrichment_Record objects
6. THE Dashboard SHALL store each Enrichment_Record in Cache_Storage using the 10-digit SIM_Number as the key
7. THE Dashboard SHALL never make a Paanel_API request for a SIM_Number that exists in Cache_Storage

### Requirement 2

**User Story:** As a malware analyst, I want enrichment data to be cached permanently, so that I avoid incurring repeated API charges for the same phone numbers.

#### Acceptance Criteria

1. THE Dashboard SHALL persist Cache_Storage to a JSON file in the data directory
2. THE Dashboard SHALL load Cache_Storage from the JSON file on server startup
3. WHEN an Enrichment_Record is added to Cache_Storage, THE Dashboard SHALL write the updated cache to disk immediately
4. THE Cache_Storage SHALL never expire or remove cached Enrichment_Record entries
5. WHEN a SIM_Number has a cached Enrichment_Record, THE Dashboard SHALL use the cached data without making an API request

### Requirement 3

**User Story:** As a malware analyst, I want enrichment to happen automatically during the existing polling cycle, so that I don't need to manually trigger the enrichment process.

#### Acceptance Criteria

1. WHEN THE Firebase_Poller completes fetching device data for a target, THE Dashboard SHALL check each device's SIM numbers for enrichment
2. THE Dashboard SHALL process SIM enrichment before saving the device record to dashboard_db.json
3. WHEN enrichment is completed for a device, THE Dashboard SHALL store the enrichment results in sim1_enriched and sim2_enriched fields
4. THE Dashboard SHALL not delay or block the Firebase_Poller main loop while waiting for Paanel_API responses
5. IF THE Paanel_API request fails or times out, THEN THE Dashboard SHALL continue processing without throwing errors

### Requirement 4

**User Story:** As a malware analyst, I want to see NAME and ID information displayed below each SIM number in the device table, so that I can quickly identify device owners.

#### Acceptance Criteria

1. WHEN THE Device_Table renders a device row, THE Dashboard SHALL display sim1_enriched data below the SIM1 number
2. WHEN THE Device_Table renders a device row, THE Dashboard SHALL display sim2_enriched data below the SIM2 number
3. WHEN an Enrichment_Record contains NAME, THE Dashboard SHALL display the NAME as plain text
4. WHEN an Enrichment_Record contains ID, THE Dashboard SHALL display the ID as plain text after the NAME
5. WHEN sim1_enriched or sim2_enriched contains multiple records, THE Dashboard SHALL display each record on a separate line
6. WHEN a SIM_Number has no enrichment data, THE Dashboard SHALL display only the phone number without additional text
7. THE Dashboard SHALL style enrichment text to match the existing UI theme using CSS variables

### Requirement 5

**User Story:** As a malware analyst, I want phone numbers to be clickable links that open the Paanel website, so that I can view detailed information on the Paanel platform.

#### Acceptance Criteria

1. WHEN THE Device_Table renders a SIM_Number, THE Dashboard SHALL wrap the number in an HTML anchor element
2. THE anchor element SHALL have an href attribute pointing to `https://api.paanel.shop/api/gateway.php?key=Jack&number={10digit}`
3. WHEN a user clicks a SIM_Number link, THE Dashboard SHALL open the Paanel URL in a new browser tab
4. THE anchor element SHALL use the existing sim-link CSS class for consistent styling
5. WHEN THE user hovers over a SIM_Number link, THE Dashboard SHALL apply the hover underline effect defined in the CSS

### Requirement 6

**User Story:** As a system administrator, I want the enrichment process to handle API errors gracefully, so that temporary API failures do not crash the dashboard or corrupt data.

#### Acceptance Criteria

1. WHEN THE Paanel_API returns an HTTP error status, THE Dashboard SHALL log the error and continue processing
2. WHEN THE Paanel_API request times out, THE Dashboard SHALL abort the request after 10 seconds
3. WHEN THE Paanel_API returns invalid JSON, THE Dashboard SHALL log the error and skip enrichment for that SIM_Number
4. IF THE Paanel_API returns an empty result, THEN THE Dashboard SHALL cache an empty array to prevent repeated failed requests
5. THE Dashboard SHALL not write invalid or incomplete Enrichment_Record data to Cache_Storage
6. WHEN an API error occurs, THE Dashboard SHALL leave sim1_enriched or sim2_enriched as an empty array
