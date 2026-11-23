# TerraAgent — SEO & Google Indexing Next Steps

Steps 1–7 (custom `404.html`, Nginx soft-404 fixes, `robots.txt`, `sitemap.xml`, `llms.txt`, favicons & `site.webmanifest`, OpenGraph/X cards, JSON-LD structured data, build-time pre-rendering, Gzip, and `Referrer-Policy`) are implemented in the repository.

Complete the following steps before and after deploying to production:

---

## 1. Pre-Deploy Build & Full-Stack Verification

1. **Resolve the pre-existing `StageGlobes.ts` TypeScript error** (unrelated to SEO, currently blocks top-level `npm run check` and `npm run build`):
   - `frontend/render/orbit/stage/StageGlobes.ts:106` (`TS2352`).
   - Once resolved, verify the full top-level gates pass:
     ```bash
     npm run check
     npm run build
     ```
2. **Run the full 4-stack local Docker Compose smoke & E2E suites**:
   ```bash
   npm run stack:local
   npm run stack:local:smoke
   npx playwright test tests/e2e/w20.spec.ts tests/e2e/w26.spec.ts
   npm run stack:local:down
   ```

---

## 2. Production Server TLS (`/srv/terraagent/nginx/tls/*.conf`) & Nginx Sync

The `:443 ssl` server blocks in `/srv/terraagent/nginx/tls/*.conf` on the production host are not tracked in git and currently override the `:80` rules in `infra/nginx/hosts/*.conf`. Sync them so live HTTPS traffic gets the same SEO and 404 behavior:

1. **Sync `:443` vhost rules from `infra/nginx/hosts/*.conf`** into `/srv/terraagent/nginx/tls/*.conf`:
   - Add `error_page 404 /404.html;` and `location = /404.html { internal; include /etc/nginx/snippets/security-headers.conf; add_header Cache-Control "no-cache" always; }` across `terraagent.fun`, `play`, `whitepaper`, `pitchdeck`, `playground`, and `design`.
   - Replace `try_files ... /play.html;`, `/whitepaper/index.html;`, `/pitchdeck/index.html;`, and `/playground.html;` in `location /` with `try_files $uri $uri/ =404;` (currently `https://play.terraagent.fun/nonexistent-seo-check` still returns `200 text/html` — a Soft 404).
   - Add `location = /index.html { return 301 /; }` to `terraagent.fun`, `play`, `whitepaper`, `pitchdeck`, and `playground` (currently `https://terraagent.fun/index.html` still returns `200` instead of `301`).
   - Add `location = /me { try_files /me.html =404; }` and `location = /me/ { return 301 /me; }` to `terraagent.fun` and `play.terraagent.fun`.
   - Ensure `include /etc/nginx/snippets/assets-cache.conf;` is present in every `:443` `server {}` block so `site.webmanifest`, icons, `og-cover.png`, and `/assets/deed-entry.{js,css}` inherit the right cache headers, and verify `site.webmanifest` serves `Content-Type: application/manifest+json`.
2. **Enforce HTTP → HTTPS & Forwarded Headers**:
   - Ensure port `80` issues a permanent `301` redirect to `https://` (port `443`) for all 8 hosts (`terraagent.fun`, `www.terraagent.fun`, `play.terraagent.fun`, `whitepaper.terraagent.fun`, `pitchdeck.terraagent.fun`, `playground.terraagent.fun`, `design.terraagent.fun`, `api.terraagent.fun`).
   - Ensure `:443` `proxy-app.conf` locations pass `X-Forwarded-Proto https` and `X-Forwarded-Host` (or `Host`) to `app:3000` so SSR `/deed/:tokenId` emits absolute `https://` `og:image` and `canonical` URLs.
3. **Spot-check live HTTP status codes and headers after syncing TLS configs**:
   - `https://terraagent.fun/robots.txt` → `200`, `text/plain`
   - `https://terraagent.fun/sitemap.xml` → `200`, `application/xml`
   - `https://terraagent.fun/site.webmanifest` → `200`, `application/manifest+json`, `Content-Encoding: gzip`
   - `https://terraagent.fun/nonexistent-page` and `https://play.terraagent.fun/nonexistent-page` → real HTTP `404` (never `200`)
   - `https://terraagent.fun/index.html` → `301` to `https://terraagent.fun/`
   - `https://devchain.terraagent.fun/robots.txt` → `200` with `Disallow: /`

---

## 3. Cloudflare Edge & DNS Configuration

If `terraagent.fun` and `*.terraagent.fun` are proxied through Cloudflare:

1. **SSL/TLS → Overview**:
   - Set encryption mode to **Full (strict)** (with valid Let's Encrypt / Origin certs in `/etc/letsencrypt` + `/srv/terraagent/nginx/tls/`).
   - Enable **Always Use HTTPS** and **Automatic HTTPS Rewrites**.
2. **DNS & Canonical Redirects**:
   - Keep `www.terraagent.fun` proxied (`CNAME` → `terraagent.fun`) with a Redirect Rule (`301` `www.terraagent.fun/*` → `https://terraagent.fun/${1}`) so all apex link equity consolidates onto `https://terraagent.fun/`.
   - Add the Google Search Console DNS `TXT` verification record at the apex (`terraagent.fun`, DNS-only).
3. **Crawler & Bot Access (Do Not Block Googlebot / Social Scrapers)**:
   - Under **Security → Bots**, ensure **Bot Fight Mode** / **Super Bot Fight Mode** does **not** challenge or block `Googlebot`, `Googlebot-Image`, `Bingbot`, `Twitterbot`, `Discordbot`, `Slackbot`, `TelegramBot`, or `GPTBot` / `OAI-SearchBot` / `PerplexityBot` (especially on `/v1/near/deed/*/image.png`, `/deed/*`, `/robots.txt`, `/sitemap.xml`, and `/llms.txt`).
   - Enable **Speed → Optimization → Content Optimization → Brotli** (in addition to origin `gzip`) and **Early Hints** for faster LCP.
4. **Caching Rules**:
   - Keep default **Cache Level: Standard** so HTML pages (`Cache-Control: no-cache`) are not stale-cached at the edge while hashed `/assets/*` (`max-age=31536000, immutable`) and `/og-cover.png`, `/favicon.*`, `/site.webmanifest` (`max-age=86400`) cache cleanly.
   - Do **not** override `Cache-Control` on `/assets/deed-entry.js` or `/assets/deed-entry.css` (they must revalidate so deploys never serve mismatched chunk hashes).
   - After deploying major SEO updates, run **Caching → Configuration → Purge Everything** (or purge `/robots.txt`, `/sitemap.xml`, `/site.webmanifest`, `/og-cover.png`) so Googlebot immediately sees updated headers and MIME types.
5. **Crawler Hints & `devchain` Exclusion**:
   - Enable **Caching → Configuration → Crawler Hints** (IndexNow) to speed up discovery of updates on `terraagent.fun`, `whitepaper.terraagent.fun`, and `pitchdeck.terraagent.fun`.
   - Optionally add a Cloudflare Response Header Transform Rule for `devchain.terraagent.fun/*` adding `X-Robots-Tag: noindex, nofollow` as defense-in-depth alongside its `robots.txt` `Disallow: /`.

---

## 4. Google Search Console Setup

1. Open **Google Search Console** and add `terraagent.fun` as a **Domain Property** (`sc-domain:terraagent.fun`).
2. Verify ownership using the **DNS `TXT` record** at your DNS registrar (this single verification covers `terraagent.fun` and all `*.terraagent.fun` subdomains).
3. Go to **Sitemaps** and submit:
   - `https://terraagent.fun/sitemap.xml`
4. Use **URL Inspection → Test Live URL → Request Indexing** for the primary canonical pages:
   - `https://terraagent.fun/`
   - `https://whitepaper.terraagent.fun/`
   - `https://pitchdeck.terraagent.fun/`
   - `https://play.terraagent.fun/`
   - `https://play.terraagent.fun/trade.html`
   - `https://playground.terraagent.fun/`
   - `https://design.terraagent.fun/`
5. After 24–72 hours, check **Indexing → Pages** and **Enhancements** in Search Console to confirm:
   - Zero **Soft 404** or **Blocked by robots.txt** warnings on public pages.
   - `WebSite`, `Organization`, `VideoGame`, `FAQPage` (`terraagent.fun`), and `TechArticle` (`whitepaper.terraagent.fun`) structured data are valid.

---

## 5. Rich Results & Social Card Validation

1. **Google Rich Results Test**: Validate `https://terraagent.fun/` and `https://whitepaper.terraagent.fun/`.
2. **Social Preview / OG Scrapers**: Test `https://terraagent.fun/`, `https://whitepaper.terraagent.fun/`, and a live Colony Deed share URL (`https://terraagent.fun/deed/<tokenId>`) using OpenGraph / X Card / Discord previewers to verify the `1200×630` image renders cleanly.
