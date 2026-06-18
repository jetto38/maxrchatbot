// Standalone Qdrant connectivity + CRUD verification.
//
// Verifies that QDRANT_URL / QDRANT_API_KEY are loaded correctly and that the
// cluster (local OR Qdrant Cloud) supports the operations the app relies on:
// collection creation, idempotent upsert (UUIDv5 ids), vector search (+score).
// Optionally verifies OpenAI embeddings when OPENAI_API_KEY is set.
//
// Usage (from backend/):  node scripts/verify-qdrant.mjs
//   QDRANT_URL / QDRANT_API_KEY (+ optional OPENAI_API_KEY) read from the env.
import { QdrantClient } from '@qdrant/js-client-rest';
import { v5 as uuidv5 } from 'uuid';

const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const url = process.env.QDRANT_URL || 'http://localhost:6333';
const apiKey = process.env.QDRANT_API_KEY || undefined;

const mask = (u) => u.replace(/(https?:\/\/[^/@]+).*/, '$1');
console.log(`[verify] QDRANT_URL = ${mask(url)}`);
console.log(`[verify] QDRANT_API_KEY = ${apiKey ? 'set (' + apiKey.length + ' chars)' : 'NOT set'}`);

const client = new QdrantClient({ url, apiKey, checkCompatibility: false });
const COLL = 'verify_qdrant_' + Date.now();

async function getVector(seed) {
  if (process.env.OPENAI_API_KEY) {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: `verification sentence number ${seed} about refunds and returns`,
    });
    return r.data[0].embedding;
  }
  return Array.from({ length: 1536 }, (_, i) => Math.sin((i + seed) * 0.01));
}

try {
  await client.getCollections();
  console.log('PASS: connection (getCollections)');

  if (process.env.OPENAI_API_KEY) {
    const v = await getVector(0);
    console.log(`PASS: OpenAI embeddings (dim ${v.length})`);
  } else {
    console.log('SKIP: OpenAI embeddings (OPENAI_API_KEY not set) — using synthetic vectors');
  }

  await client.createCollection(COLL, { vectors: { size: 1536, distance: 'Cosine' } });
  console.log('PASS: createCollection');

  const articleId = 'a1b2c3d4-0000-0000-0000-000000000001';
  const vectors = await Promise.all([0, 1, 2].map(getVector));
  const points = [0, 1, 2].map((i) => ({
    id: uuidv5(`${articleId}-${i}`, NS),
    vector: vectors[i],
    payload: { article_id: articleId, text: `chunk ${i} about refunds and returns`, chunk_index: i },
  }));
  await client.upsert(COLL, { points });
  await client.upsert(COLL, { points }); // idempotent
  const { count } = await client.count(COLL, {});
  if (count !== 3) throw new Error(`expected 3 points, got ${count}`);
  console.log(`PASS: upsert + idempotency (count=${count})`);

  const res = await client.search(COLL, { vector: vectors[1], limit: 2, with_payload: true });
  if (typeof res[0]?.score !== 'number') throw new Error('search score missing');
  console.log(`PASS: search (top score=${res[0].score.toFixed(4)}, text=${JSON.stringify(res[0].payload.text)})`);

  await client.deleteCollection(COLL);
  console.log('PASS: deleteCollection (cleanup)');
  console.log('\n✅ ALL QDRANT VERIFICATION CHECKS PASSED');
} catch (e) {
  console.error('\n❌ FAIL:', e?.message || e);
  try { await client.deleteCollection(COLL); } catch {}
  process.exit(1);
}
