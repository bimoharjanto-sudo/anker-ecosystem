const RSS_URL =
  "https://bjards.blogspot.com/feeds/posts/default/-/Affiliate?alt=rss&max-results=10";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

function decodeXML(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function getTag(source, tag) {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );

  const match = source.match(re);
  return match ? decodeXML(match[1].trim()) : "";
}

function extractProductImage(page, title = "") {
  const images = [];
  const imgMatches = page.match(/<img\b[^>]*>/gi) || [];

  const badWords =
    /favicon|sprite|logo|avatar|icon|placeholder|loading|spinner|1x1|pixel/i;

  const preferredHosts =
    /ibyteimg\.com|slatic\.net|susercontent\.com|shopee\.co\.id|tokopedia\.net|tokopedia\.com/i;

  const titleWords = String(title)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);

  for (const imgTag of imgMatches) {
    const values = [];

    const attrs = [
      "src",
      "data-src",
      "data-original",
      "data-lazy-src",
      "data-url",
    ];

    for (const attr of attrs) {
      const re = new RegExp(
        `${attr}\\s*=\\s*["']([^"']+)["']`,
        "i"
      );

      const match = imgTag.match(re);
      if (match && match[1]) {
        values.push(match[1]);
      }
    }

    const srcsetMatch = imgTag.match(
      /srcset\\s*=\\s*["']([^"']+)["']/i
    );

    if (srcsetMatch) {
      const firstSrcset = srcsetMatch[1]
        .split(",")[0]
        .trim()
        .split(/\s+/)[0];

      if (firstSrcset) {
        values.push(firstSrcset);
      }
    }

    for (let url of values) {
      url = decodeXML(url).trim();

      if (!url || url.startsWith("data:")) continue;

      if (url.startsWith("//")) {
        url = "https:" + url;
      }

      if (!/^https?:\/\//i.test(url)) continue;
      if (badWords.test(url)) continue;

      let score = 0;

      if (preferredHosts.test(url)) {
        score += 100;
      }

      if (/blogger\.googleusercontent\.com/i.test(url)) {
        score -= 20;
      }

      const lowerUrl = url.toLowerCase();

      for (const word of titleWords) {
        if (lowerUrl.includes(word)) {
          score += 3;
        }
      }

      if (/\.(webp|jpg|jpeg|png)(?:\?|$)/i.test(url)) {
        score += 5;
      }

      images.push({
        url,
        score,
      });
    }
  }

  images.sort((a, b) => b.score - a.score);

  return images.length ? images[0].url : "";
}

async function fetchArticleImage(url, title) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 ANKER-ONE-HUB-ShopFeed/1.0",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return "";
    }

    const page = await response.text();

    return extractProductImage(page, title);
  } catch (error) {
    console.warn("[ANKER SHOP] Article image fetch failed:", url, error);
    return "";
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/shop-feed") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        });
      }

      if (request.method !== "GET") {
        return jsonResponse(
          {
            ok: false,
            error: "Method not allowed",
          },
          405
        );
      }

      try {
        const response = await fetch(RSS_URL, {
          headers: {
            "User-Agent": "ANKER-ONE-HUB-ShopFeed/1.0",
            "Accept":
              "application/rss+xml, application/xml, text/xml",
          },
        });

        if (!response.ok) {
          throw new Error("RSS HTTP " + response.status);
        }

        const xml = await response.text();

        const itemMatches =
          xml.match(/<item[\s\S]*?<\/item>/gi) || [];

        const items = [];

        for (const itemXml of itemMatches.slice(0, 10)) {
          const title = getTag(itemXml, "title");
          const link = getTag(itemXml, "link");

          if (!title || !link) {
            continue;
          }

          const image = await fetchArticleImage(link, title);

          items.push({
            title,
            link,
            image,
          });
        }

        return jsonResponse({
          ok: true,
          source: "bjards.blogspot.com",
          label: "Affiliate",
          count: items.length,
          items,
        });
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: String(error),
          },
          502
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
