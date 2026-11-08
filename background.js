const BASE_URL = "https://lms.vitonline.in";

// Build cookie string from chrome.cookies API
async function getCookieString() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: "lms.vitonline.in" }, (cookies) => {
      const str = (cookies || []).map((c) => `${c.name}=${c.value}`).join("; ");
      resolve(str);
    });
  });
}

function getHeaders(cookieStr, csrfToken) {
  return {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "X-CSRF-Token": csrfToken || "",
    Cookie: cookieStr,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  };
}

function getBrowseHeaders(cookieStr, csrfToken) {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    Cookie: cookieStr,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true; // keep channel open for async
});

async function handleMessage(msg) {
  const cookieStr = await getCookieString();

  // Extract CSRF from cookies
  const csrfMatch = cookieStr.match(/_csrf_token=([^;]+)/);
  const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : "";

  if (msg.type === "GET_COOKIES_INFO") {
    const count = cookieStr.split(";").filter(Boolean).length;
    return {
      count,
      hasSession: cookieStr.includes("_normandy_session"),
      csrf: !!csrfToken,
    };
  }

  if (msg.type === "GET_MODULES") {
    const { courseId } = msg;
    // Fetch full modules list from the API so we get ALL modules (not just progressions)
    const url = `${BASE_URL}/api/v1/courses/${courseId}/modules?per_page=100`;
    const res = await fetch(url, { headers: getHeaders(cookieStr, csrfToken) });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching modules list`);
    const data = await res.json();
    const moduleIds = (Array.isArray(data) ? data : [])
      .map((m) => m.id)
      .filter(Boolean);
    return { moduleIds };
  }

  if (msg.type === "GET_MODULE_DETAIL") {
    const { courseId, moduleId } = msg;
    const url = `${BASE_URL}/api/v1/courses/${courseId}/modules/${moduleId}?include[]=items&per_page=100`;
    const res = await fetch(url, { headers: getHeaders(cookieStr, csrfToken) });
    if (!res.ok) throw new Error(`HTTP ${res.status} on module ${moduleId}`);
    return await res.json();
  }

  if (msg.type === "MARK_COMPLETE") {
    const { courseId, moduleId, itemId, title } = msg;
    const slug = title.replace(/ /g, "-");
    const pageUrl = `${BASE_URL}/courses/${courseId}/pages/${encodeURIComponent(slug)}?module_item_id=${itemId}`;
    const res = await fetch(pageUrl, {
      headers: getBrowseHeaders(cookieStr, csrfToken),
      redirect: "follow",
    });
    if (!res.ok && res.status !== 302)
      throw new Error(`HTTP ${res.status} marking complete`);
    // Re-fetch module for updated status
    const detailUrl = `${BASE_URL}/api/v1/courses/${courseId}/modules/${moduleId}?include[]=items&per_page=100`;
    const res2 = await fetch(detailUrl, {
      headers: getHeaders(cookieStr, csrfToken),
    });
    if (!res2.ok) throw new Error(`HTTP ${res2.status} refreshing module`);
    return await res2.json();
  }

  throw new Error("Unknown message type: " + msg.type);
}
