import { put, list } from "@vercel/blob";

const PREFIX = "visits/";
const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

async function countVisits() {
  let total = 0;
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    total += page.blobs.length;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return total;
}

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// GET returns the current count without recording a visit.
export async function GET() {
  try {
    return respond({ count: await countVisits() });
  } catch (error) {
    console.error(error);
    return respond({ error: "Could not read visitors" }, 500);
  }
}

// POST records one visit as a blob named by its timestamp, then returns the count.
export async function POST() {
  try {
    const timestamp = new Date().toISOString();
    await put(`${PREFIX}${timestamp}.json`, JSON.stringify({ timestamp }), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: true,
    });
    return respond({ count: await countVisits() });
  } catch (error) {
    console.error(error);
    return respond({ error: "Could not record visit", detail: String(error?.message) }, 500);
  }
}
