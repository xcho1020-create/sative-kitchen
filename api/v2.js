import { createHash } from 'node:crypto';

export const config = { maxDuration: 30 };
export async function rpc(action, token, data) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/kitchen_request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ gateway: process.env.KITCHEN_GATEWAY_KEY, action, token, data }), signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error('Database request failed');
  return response.json();
}
export function cookie(req) {
  return /(?:^|;\s*)kitchen_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1] || '';
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Invalid origin' }); } catch { return res.status(403).json({ error: 'Invalid origin' }); } }
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ error: 'JSON required' });
  if (!process.env.KITCHEN_GATEWAY_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) return res.status(503).json({ error: 'Service is not configured' });
  try {
    const { action, data = {} } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const allowed = ['login','logout','password','state','product','archive','delivery','move_payout','accept','crm','issue','payment'];
    if (!allowed.includes(action) || !data || typeof data !== 'object' || JSON.stringify(data).length > 100000) return res.status(400).json({ error: 'Invalid request' });
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0];
    const result = await rpc(action, cookie(req), action === 'login' ? { ...data, ip: createHash('sha256').update(ip).digest('hex') } : data);
    if (result.session) {
      res.setHeader('Set-Cookie', `kitchen_session=${result.session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`);
      delete result.session;
    }
    if (action === 'logout' || result.status === 401) res.setHeader('Set-Cookie', 'kitchen_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
    return res.status(result.status || 200).json(result);
  } catch (error) { return res.status(503).json({ error: 'Service temporarily unavailable. Your changes were not confirmed; reload before retrying.' }); }
}
