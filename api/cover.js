import { database } from '../lib/database.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const id = req.query?.id;
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return res.status(400).end();
  try {
    const sql = database();
    const rows = await sql`SELECT record FROM dashboard_records WHERE kind = 'cover' AND id = ${id}`;
    if (!rows.length) return res.status(404).end();
    res.setHeader('Content-Type', rows[0].record.type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    return res.status(200).send(Buffer.from(rows[0].record.data, 'base64'));
  } catch { return res.status(503).end(); }
}
