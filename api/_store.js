import { put, list, get, del } from "@vercel/blob";

// SN_MEMORY_STORE swaps Blob for a Map so the handlers can be tested without a network.
const memory = process.env.SN_MEMORY_STORE ? new Map() : null;

export async function putJson(path, data, { overwrite = true, suffix = false } = {}) {
  const body = JSON.stringify(data);
  if (memory) {
    const key = suffix ? `${path}-${Math.random().toString(36).slice(2, 8)}` : path;
    if (!overwrite && memory.has(key)) throw new Error("exists");
    memory.set(key, { body, at: Date.now() });
    return;
  }
  await put(path, body, {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: suffix,
    allowOverwrite: overwrite && !suffix,
  });
}

export async function getJson(path) {
  if (memory) {
    const hit = memory.get(path);
    return hit ? JSON.parse(hit.body) : null;
  }
  try {
    const result = await get(path, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return await new Response(result.stream).json();
  } catch (error) {
    if (error?.name === "BlobNotFoundError") return null;
    throw error;
  }
}

// Returns [{ pathname, at }] sorted by pathname.
export async function listBlobs(prefix) {
  if (memory) {
    return [...memory.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([pathname, v]) => ({ pathname, at: v.at }))
      .sort((a, b) => (a.pathname < b.pathname ? -1 : 1));
  }
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const b of page.blobs) out.push({ pathname: b.pathname, at: new Date(b.uploadedAt).getTime() });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => (a.pathname < b.pathname ? -1 : 1));
}

export async function putBinary(path, buffer, contentType) {
  if (memory) {
    memory.set(path, { body: buffer, at: Date.now() });
    return;
  }
  await put(path, buffer, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: false });
}

export async function getBinary(path) {
  if (memory) return memory.get(path)?.body || null;
  try {
    const result = await get(path, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  } catch (error) {
    if (error?.name === "BlobNotFoundError") return null;
    throw error;
  }
}

export async function delPath(path) {
  if (memory) {
    memory.delete(path);
    return;
  }
  try {
    await del(path);
  } catch (error) {
    if (error?.name !== "BlobNotFoundError") throw error;
  }
}
