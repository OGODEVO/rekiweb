// Minimal Whop API client over fetch. No SDK dependency.
// Docs: https://docs.whop.com/developer/guides/memberships
// Versioned API pinned with Api-Version-Date.

function headers(apiKey, versionDate) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Api-Version-Date": versionDate,
    "Content-Type": "application/json",
  };
}

function url(base, path, query) {
  const u = new URL(path, base.endsWith("/") ? base : `${base}/`);
  if (query)
    for (const [k, v] of Object.entries(query))
      if (v !== undefined && v !== "") u.searchParams.set(k, v);
  return u.toString();
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function err(status, body) {
  const e = new Error(`Whop API ${status}`);
  e.status = status;
  e.body = body;
  return e;
}

export function createWhopClient({
  apiKey,
  apiBase,
  versionDate,
  fetchImpl = globalThis.fetch,
}) {
  const h = () => headers(apiKey, versionDate);
  return {
    async checkAccess(userId, resourceId) {
      const res = await fetchImpl(
        url(apiBase, `/api/v1/users/${userId}/access/${resourceId}`),
        { headers: h() },
      );
      const body = await readJson(res);
      if (!res.ok) throw err(res.status, body);
      return body;
    },
    async listMemberships({ userId, accountId, productId, planId } = {}) {
      const res = await fetchImpl(
        url(apiBase, "/api/v1/memberships", {
          user_id: userId,
          account_id: accountId,
          product_id: productId,
          plan_id: planId,
          first: "50",
        }),
        { headers: h() },
      );
      const body = await readJson(res);
      if (!res.ok) throw err(res.status, body);
      return Array.isArray(body?.data) ? body.data : [];
    },
    async retrieveMembership(id) {
      const res = await fetchImpl(url(apiBase, `/api/v1/memberships/${id}`), {
        headers: h(),
      });
      const body = await readJson(res);
      if (!res.ok) throw err(res.status, body);
      return body;
    },
    async retrievePayment(id) {
      const res = await fetchImpl(url(apiBase, `/api/v1/payments/${id}`), {
        headers: h(),
      });
      const body = await readJson(res);
      if (!res.ok) throw err(res.status, body);
      return body;
    },
    async userInfo(accessToken, fetchUserImpl = fetchImpl) {
      const res = await fetchUserImpl(`${apiBase}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await readJson(res);
      if (!res.ok) throw err(res.status, body);
      return body;
    },
  };
}
