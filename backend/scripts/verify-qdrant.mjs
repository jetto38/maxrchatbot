// Standalone Qdrant connectivity + CRUD verification.
//
// Verifies that QDRANT_URL / QDRANT_API_KEY are loaded correctly and that the
// cluster (local OR Qdrant Cloud) supports the operations the app relies on:
// collection creation, idempotent upsert (UUIDv5 ids), vector search (+score).
// Optionally verifies Cohere embeddings when COHERE_API_KEY is set.
//
// Usage (from backend/):  node scripts/verify-qdrant.mjs
//   QDRANT_URL / QDRANT_API_KEY (+ optional COHERE_API_KEY) read from the env.
import { QdrantClient } from '@qdrant/js-client-rest';
import { v5 as uuidv5 } from 'uuid';

const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const url = process.env.QDRANT_URL || 'http://localhost:6333';
const apiKey = process.env.QDRANT_API_KEY || undefined;
const DIM = Number(process.env.COHERE_EMBED_DIM) || 1024;

const mask = (u) => u.replace(/(https?:\/\/[^/@]+).*/, '$1');
console.log(`[verify] QDRANT_URL = ${mask(url)}`);
console.log(`[verify] QDRANT_API_KEY = ${apiKey ? 'set (' + apiKey.length + ' chars)' : 'NOT set'}`);

const client = new QdrantClient({ url, apiKey, checkCompatibility: false });
const COLL = 'verify_qdrant_' + Date.now();

async function getVector(seed) {
  if (process.env.COHERE_API_KEY) {
    const res = await fetch('https://api.cohere.com/v2/embed', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.COHERE_EMBED_MODEL || 'embed-v4.0',
        texts: [`verification sentence number ${seed} about refunds and returns`],
        input_type: 'search_document',
        embedding_types: ['float'],
        output_dimension: DIM,
      }),
    });
    if (!res.ok) throw new Error(`Cohere embed ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.embeddings.float[0];
  }
  return Array.from({ length: DIM }, (_, i) => Math.sin((i + seed) * 0.01));
}

try {
  await client.getCollections();
  console.log('PASS: connection (getCollections)');

  if (process.env.COHERE_API_KEY) {
    const v = await getVector(0);
    console.log(`PASS: Cohere embeddings (dim ${v.length})`);
  } else {
    console.log('SKIP: Cohere embeddings (COHERE_API_KEY not set) — using synthetic vectors');
  }

  await client.createCollection(COLL, { vectors: { size: DIM, distance: 'Cosine' } });
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
