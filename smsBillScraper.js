import { PermissionsAndroid, Platform } from 'react-native';
import SmsAndroid from 'react-native-get-sms-android';

const DEFAULT_INCLUDE_REGEX =
  '(bill|invoice|statement|amount\\s*due|total\\s*due|due\\s*date|subscription|auto\\s*renew|autopay|charged|renewal|payment|successful|confirmed|deducted|balance|unifi|tnb|astro|maxis|celcom|digi|tm|time|indah\\s*water|syabas|air\\s*selangor|rm|myr)';

const DEFAULT_EXCLUDE_REGEX =
  '(otp|tac|verification|verifikasi|kata\\s*laluan|password|pin|kod\\s*pengesahan|one\\s*time\\s*password)';

function normalizeText(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function ensureReadSmsPermission() {
  if (Platform.OS !== 'android') return { granted: false, reason: 'not-android' };

  const permission = PermissionsAndroid.PERMISSIONS.READ_SMS;
  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) return { granted: true };

  const result = await PermissionsAndroid.request(permission, {
    title: 'Allow SMS access',
    message: 'Walley needs SMS access to detect bills/subscriptions and record them as transactions.',
    buttonPositive: 'Allow',
    buttonNegative: 'Deny',
  });

  return { granted: result === PermissionsAndroid.RESULTS.GRANTED };
}

export function listSms(filter) {
  return new Promise((resolve, reject) => {
    SmsAndroid.list(
      JSON.stringify(filter),
      (fail) => reject(new Error(String(fail))),
      (count, smsList) => {
        try {
          const parsed = JSON.parse(smsList);
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

function extractAmount(text) {
  const input = normalizeText(text);
  if (!input) return null;

  const matches = [];

  for (const m of input.matchAll(/(?:RM|MYR)\s*([0-9]{1,6}(?:\.[0-9]{1,2})?)/gi)) {
    matches.push(Number(m[1]));
  }

  for (const m of input.matchAll(/([0-9]{1,6}(?:\.[0-9]{1,2})?)\s*(?:RM|MYR)/gi)) {
    matches.push(Number(m[1]));
  }

  const cleaned = matches
    .filter((n) => Number.isFinite(n))
    .filter((n) => n > 0 && n < 100000);

  if (cleaned.length === 0) return null;
  return cleaned[0];
}

function isExcluded(text) {
  const input = normalizeText(text).toLowerCase();
  if (!input) return true;
  return new RegExp(DEFAULT_EXCLUDE_REGEX, 'i').test(input);
}

function isBillLike(text) {
  const input = normalizeText(text).toLowerCase();
  if (!input) return false;
  if (isExcluded(input)) return false;
  return new RegExp(DEFAULT_INCLUDE_REGEX, 'i').test(input);
}

function guessMerchant(address, body) {
  const addr = normalizeText(address);
  // Accept both alphabetic names AND numeric short codes (e.g. 62003 for Maxis)
  if (addr && addr.length <= 15) return addr;

  const text = normalizeText(body);

  // Try to find a known telco/brand name mentioned in the body
  const telcoMatch = text.match(/(Maxis|Celcom|Digi|Unifi|TM|TNB|Astro|Time|Syabas|Indah Water|Air Selangor|Spotify|Netflix|Disney\+)/i);
  if (telcoMatch?.[1]) return telcoMatch[1];

  const fromMatch = text.match(/(?:from|daripada|kepada|to)\s+([A-Za-z0-9 &.'-]{3,30})/i);
  if (fromMatch?.[1]) return normalizeText(fromMatch[1]);

  return addr || 'Bill';
}

function guessCategory(merchant, body) {
  const m = normalizeText(merchant).toLowerCase();
  const b = normalizeText(body).toLowerCase();

  if (/(spotify|netflix|prime|disney\+|youtube)/i.test(m) || /(subscription|renewal|charged|auto\s*renew)/i.test(b)) {
    return 'Entertainment';
  }

  if (/(tnb|unifi|astro|maxis|celcom|digi|tm|time|indah|syabas|air\s*selangor)/i.test(m + ' ' + b)) {
    return 'Utilities';
  }

  return 'Utilities';
}

function stableSmsKey(message) {
  const id = message?._id ?? message?.id;
  if (id != null) return String(id);

  const address = normalizeText(message?.address);
  const date = String(message?.date ?? '');
  const body = normalizeText(message?.body).slice(0, 80);
  return `${address}|${date}|${body}`;
}

export function smsToBillTransactionCandidate(message) {
  const body = message?.body;
  const billLike = isBillLike(body);
  console.log(`[SMS] From: ${message?.address} | Match: ${billLike} | "${body?.substring(0, 60)}..."`);
  if (!billLike) return null;

  const amount = extractAmount(body);
  if (!amount) {
    console.log(`[SMS] ⚠️ No amount found in: "${body?.substring(0, 60)}..."`);
    return null;
  }

  const merchant = guessMerchant(message?.address, body);
  const category = guessCategory(merchant, body);
  const dateMs = Number(message?.date);

  if (!Number.isFinite(dateMs)) return null;

  return {
    key: stableSmsKey(message),
    from: normalizeText(message?.address),
    merchant,
    category,
    amount,
    dateMs,
    desc: `${merchant} (SMS bill)`,
    rawText: normalizeText(body),
  };
}

export async function scrapeBillsAndSubscriptionsFromSms({ daysBack = 180 } = {}) {
  if (Platform.OS !== 'android') return [];

  const minDate = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  // NOTE: Do NOT pass bodyRegex here — Android's SMS content provider does not
  // reliably support complex regex patterns and silently returns 0 results.
  // We fetch all inbox SMS in the date range and filter in JS instead.
  const filter = {
    box: 'inbox',
    minDate,
    maxCount: 500, // safety cap — adjust higher if needed
  };

  console.log(`[SMS SCRAPER] 📱 Scanning ${daysBack} days of SMS...`);
  const messages = await listSms(filter);
  console.log(`[SMS SCRAPER] 📨 Fetched ${messages.length} total SMS, now filtering in JS...`);

  const candidates = messages
    .map(smsToBillTransactionCandidate)
    .filter(Boolean);

  console.log(`[SMS SCRAPER] ✅ Extracted ${candidates.length} valid transactions:`);
  candidates.forEach(c => console.log(`   → ${c.merchant}: RM${c.amount}`));

  // Most recent first
  candidates.sort((a, b) => b.dateMs - a.dateMs);
  return candidates;
}
