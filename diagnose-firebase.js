#!/usr/bin/env node

/**
 * Firebase Database Diagnostic Tool
 * 
 * Tests connectivity to all 4 malware Firebase databases and reports:
 * - Reachability status
 * - Data structure (schema detection)
 * - Number of devices found
 * - Number of SMS messages
 * - Sample device info
 */

const TARGETS = [
  { id: 1, url: 'https://colana-84ce2-default-rtdb.firebaseio.com', schema: 1, apk: 'my hr5.apk' },
  { id: 2, url: 'https://sirelech1-default-rtdb.firebaseio.com', schema: 2, apk: 'hr1.apk' },
  { id: 3, url: 'https://vish-4a6de-default-rtdb.firebaseio.com', schema: 2, apk: 'hr2.apk' },
  { id: 4, url: 'https://gggggg-979bd-default-rtdb.firebaseio.com', schema: 1, apk: 'hr3.apk' },
];

async function fbFetch(url, timeout = 15000) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(timeout),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  if (!text || text[0] === '<') throw new Error('HTML response (auth error)');
  return JSON.parse(text);
}

function countNested(obj, depth = 0, maxDepth = 5) {
  if (!obj || typeof obj !== 'object' || depth > maxDepth) return 0;
  let count = 0;
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') {
      count++;
      count += countNested(val, depth + 1, maxDepth);
    }
  }
  return count;
}

function findDevices(data) {
  const devices = [];
  
  // Try to find device-like objects
  if (data && typeof data === 'object') {
    // Check common patterns
    if (data.Data?.DeviceInfo) {
      return Object.keys(data.Data.DeviceInfo);
    }
    if (data.clients) {
      return Object.keys(data.clients);
    }
    if (data.user_data) {
      return Object.keys(data.user_data);
    }
    if (data.devices) {
      return Object.keys(data.devices);
    }
    // Generic search
    for (const [key, val] of Object.entries(data)) {
      if (val && typeof val === 'object') {
        const subKeys = Object.keys(val);
        if (subKeys.length > 0 && subKeys.length < 100) {
          devices.push(...subKeys);
        }
      }
    }
  }
  
  return devices;
}

async function diagnoseTarget(target) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 Target ${target.id}: ${target.url}`);
  console.log(`   APK: ${target.apk} | Expected Schema: ${target.schema}`);
  console.log(`${'='.repeat(80)}`);
  
  try {
    // Determine endpoint based on schema
    let endpoint;
    if (target.schema === 1) {
      endpoint = `${target.url}/All_Users.json`;
    } else if (target.schema === 2) {
      endpoint = `${target.url}/clients.json`;
    } else {
      endpoint = `${target.url}/.json`;
    }
    
    console.log(`📡 Fetching: ${endpoint}`);
    const data = await fbFetch(endpoint);
    
    if (!data) {
      console.log(`❌ No data returned`);
      return;
    }
    
    console.log(`✅ Connected successfully`);
    
    // Analyze structure
    const rootKeys = Object.keys(data);
    console.log(`\n📊 Root Keys (${rootKeys.length}):`);
    for (const key of rootKeys.slice(0, 10)) {
      const val = data[key];
      const type = Array.isArray(val) ? 'array' : typeof val;
      const count = (val && typeof val === 'object') ? Object.keys(val).length : 0;
      console.log(`   - ${key}: ${type}${count > 0 ? ` (${count} items)` : ''}`);
    }
    if (rootKeys.length > 10) {
      console.log(`   ... and ${rootKeys.length - 10} more`);
    }
    
    // Find devices
    const devices = findDevices(data);
    console.log(`\n👥 Devices Found: ${devices.length}`);
    if (devices.length > 0) {
      console.log(`   Sample device IDs:`);
      for (const did of devices.slice(0, 5)) {
        console.log(`   - ${did}`);
      }
      if (devices.length > 5) {
        console.log(`   ... and ${devices.length - 5} more`);
      }
    }
    
    // Count messages
    let messageCount = 0;
    if (data.sms) messageCount += countNested(data.sms, 0, 3);
    if (data.messages) messageCount += countNested(data.messages, 0, 3);
    if (data.user_sms) messageCount += countNested(data.user_sms, 0, 3);
    
    console.log(`\n💬 Approximate SMS Count: ${messageCount}`);
    
    // Check for specific schema indicators
    console.log(`\n🔎 Schema Indicators:`);
    if (data.Data?.DeviceInfo) console.log(`   ✓ Schema 1: Data.DeviceInfo found`);
    if (data.clients) console.log(`   ✓ Schema 2/4: clients found`);
    if (data.user_data) console.log(`   ✓ Schema 3: user_data found`);
    if (data.devices) console.log(`   ✓ Schema 5: devices found`);
    if (data.sms) console.log(`   ✓ SMS data at root level`);
    if (data.simDetails) console.log(`   ✓ simDetails found`);
    
    // Try to get a sample device
    if (devices.length > 0) {
      console.log(`\n📱 Sample Device Details:`);
      const sampleId = devices[0];
      let deviceData = null;
      
      if (data.Data?.DeviceInfo?.[sampleId]) {
        deviceData = data.Data.DeviceInfo[sampleId];
      } else if (data.clients?.[sampleId]) {
        deviceData = data.clients[sampleId];
      } else if (data.user_data?.[sampleId]) {
        deviceData = data.user_data[sampleId];
      }
      
      if (deviceData) {
        const keys = Object.keys(deviceData);
        console.log(`   Device ${sampleId} has ${keys.length} fields:`);
        for (const k of keys.slice(0, 10)) {
          const v = deviceData[k];
          const preview = typeof v === 'object' 
            ? `{${Object.keys(v).length} keys}` 
            : String(v).slice(0, 50);
          console.log(`   - ${k}: ${preview}`);
        }
        if (keys.length > 10) {
          console.log(`   ... and ${keys.length - 10} more fields`);
        }
      }
    }
    
    // Summary
    console.log(`\n✅ SUMMARY:`);
    console.log(`   Status: Reachable`);
    console.log(`   Devices: ${devices.length}`);
    console.log(`   Messages: ~${messageCount}`);
    console.log(`   Root Keys: ${rootKeys.length}`);
    
  } catch (error) {
    console.log(`\n❌ ERROR: ${error.message}`);
    console.log(`   This database may be:`);
    console.log(`   - Empty or have no data`);
    console.log(`   - Authentication protected`);
    console.log(`   - Incorrect schema endpoint`);
    console.log(`   - Network/connectivity issue`);
  }
}

async function main() {
  console.log(`\n🚀 Firebase Database Diagnostic Tool`);
  console.log(`   Testing ${TARGETS.length} malware databases...\n`);
  
  for (const target of TARGETS) {
    await diagnoseTarget(target);
    // Pause between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Diagnostic complete!`);
  console.log(`${'='.repeat(80)}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
