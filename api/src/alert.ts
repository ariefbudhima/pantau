/**
 * WhatsApp Alert — sends status change notifications via Twilio.
 *
 * Only sends to the user's whatsapp_number from DB (endpoint → project → user).
 * If the user hasn't set a WA number, alert is silently skipped.
 */
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { users, projects, endpoints } from './schema';
dotenv.config();

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const FROM = process.env.TWILIO_WHATSAPP_FROM || '';

let disabled = false;

if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM) {
  console.warn('[alert] Twilio not configured — alerts disabled');
  disabled = true;
}

export interface AlertPayload {
  endpointId: number;
  endpointName: string;
  method: string;
  path: string;
  url?: string | null;
  oldStatus: string | null;
  newStatus: string;
  responseTimeMs?: number;
  errorMessage?: string | null;
  timestamp: Date;
}

function emoji(status: string): string {
  if (status === 'down') return '🔴';
  if (status === 'up') return '🟢';
  return '⚪';
}

function formatAlert(p: AlertPayload): string {
  const em = emoji(p.newStatus);
  const arrow = p.oldStatus && p.oldStatus !== 'unknown' ? ` (${p.oldStatus} → ${p.newStatus})` : ` (${p.newStatus})`;
  const ms = p.responseTimeMs != null ? ` — ${p.responseTimeMs}ms` : '';
  const err = p.errorMessage ? `\nError: ${p.errorMessage}` : '';
  const target = p.url || `${p.method} ${p.path}`;

  return [
    `${em} *Pantau Alert*${arrow}`,
    ``,
    `${target}${ms}${err}`,
    ``,
    `_${p.timestamp.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB_`,
  ].join('\n');
}

/** Look up the WhatsApp number for the owner of an endpoint. */
async function getUserWhatsapp(endpointId: number): Promise<string | null> {
  const [row] = await db
    .select({ whatsappNumber: users.whatsappNumber })
    .from(endpoints)
    .innerJoin(projects, eq(endpoints.projectId, projects.id))
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(endpoints.id, endpointId))
    .limit(1);

  return row?.whatsappNumber || null;
}

export async function sendAlert(payload: AlertPayload): Promise<void> {
  if (disabled) return;

  const to = await getUserWhatsapp(payload.endpointId);
  if (!to) {
    console.log(`[alert] No WA number for endpoint ${payload.endpointId} — skipping`);
    return;
  }

  const body = new URLSearchParams({
    To: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
    From: FROM,
    Body: formatAlert(payload),
  });

  try {
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[alert] Twilio error ${resp.status}: ${err}`);
      return;
    }

    const data = await resp.json() as { sid: string };
    console.log(`[alert] WA sent to ${to} — ${payload.endpointName} ${payload.newStatus} → ${data.sid}`);
  } catch (err: any) {
    console.error(`[alert] Failed to send: ${err.message}`);
  }
}
