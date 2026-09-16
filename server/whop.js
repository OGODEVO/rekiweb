// Pinned Whop REST API. Never retain provider error bodies or credentials.
export async function fetchJson(url, options = {}, fetchImpl = globalThis.fetch, timeoutMs = 4000) {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, { ...options, signal, redirect: "error" });
  if (!response.ok) throw new Error("Provider request failed");
  const data = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid provider response");
  return data;
}

export function createWhopClient({ apiKey, apiBase, versionDate, fetchImpl = globalThis.fetch, timeoutMs = 4000 }) {
  const headers = { Authorization: `Bearer ${apiKey}`, "Api-Version-Date": versionDate };
  const request = (path, signal) => fetchJson(new URL(path, apiBase), { headers, signal }, fetchImpl, timeoutMs);
  const retrieve = (kind, id, signal) => {
    if (typeof id !== "string" || !/^[a-z]+_[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid resource ID");
    return request(`/api/v1/${kind}/${id}`, signal);
  };
  async function list(path, query, signal) {
    const all = [], cursors = new Set();
    signal = signal || AbortSignal.timeout(15000);
    let after;
    for (let page = 0; page < 20; page++) {
      const u = new URL(`/api/v1/${path}`, apiBase);
      for (const [key, value] of Object.entries({ ...query, first: 100, after }))
        if (value !== undefined) u.searchParams.set(key, String(value));
      const body = await request(u.href, signal);
      if (!Array.isArray(body.data) || typeof body.page_info?.has_next_page !== "boolean")
        throw new Error("Invalid provider page");
      all.push(...body.data);
      if (!body.page_info.has_next_page) return all;
      after = body.page_info.end_cursor;
      if (typeof after !== "string" || !after || cursors.has(after)) throw new Error("Invalid provider cursor");
      cursors.add(after);
    }
    throw new Error("Provider pagination limit exceeded");
  }
  return {
    listMemberships: ({ userId, accountId, productId, planId, signal }) => list("memberships", {
      user_id: userId, account_id: accountId, product_id: productId, plan_id: planId,
    }, signal),
    // Payment filters differ from membership filters in the pinned schema.
    listPayments: ({ userId, accountId, productId, planId, signal }) => list("payments", {
      query: userId, account_id: accountId, product_ids: productId, plan_ids: planId,
      order: "created_at", direction: "desc",
    }, signal),
    retrieveMembership: (id, signal) => retrieve("memberships", id, signal),
    retrievePayment: (id, signal) => retrieve("payments", id, signal),
    retrieveRefund: (id, signal) => retrieve("refunds", id, signal),
    userInfo: (accessToken) => fetchJson(`${apiBase}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, fetchImpl, timeoutMs),
  };
}
