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

## 2. Production Server TLS & Nginx Verification

1. On the production host, inspect `/srv/terraagent/nginx/tls/*.conf` (mounted into `/etc/nginx/tls/*.conf`) and verify:
   - Port `80` issues a permanent `301` redirect to `https://` (port `443`) for all 8 hosts (`terraagent.fun`, `www.terraagent.fun`, `play.terraagent.fun`, `whitepaper.terraagent.fun`, `pitchdeck.terraagent.fun`, `playground.terraagent.fun`, `design.terraagent.fun`, `api.terraagent.fun`).
   - TLS proxy blocks pass `X-Forwarded-Proto https` and `X-Forwarded-Host` (or `Host`) to `app:3000` so SSR `/deed/:tokenId` emits absolute `https://` `og:image` and `canonical` URLs.
2. Spot-check live HTTP status codes and headers after deploy:
   - `https://terraagent.fun/robots.txt` → `200`, `text/plain`
   - `https://terraagent.fun/sitemap.xml` → `200`, `application/xml`
   - `https://terraagent.fun/site.webmanifest` → `200`, `application/manifest+json`, `Content-Encoding: gzip`
   - `https://terraagent.fun/nonexistent-page` and `https://play.terraagent.fun/nonexistent-page` → real HTTP `404` (never `200`)
   - `https://terraagent.fun/index.html` → `301` to `https://terraagent.fun/`
   - `https://devchain.terraagent.fun/robots.txt` → `200` with `Disallow: /`

---

## 3. Google Search Console Setup

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

## 4. Rich Results & Social Card Validation

1. **Google Rich Results Test**: Validate `https://terraagent.fun/` and `https://whitepaper.terraagent.fun/`.
2. **Social Preview / OG Scrapers**: Test `https://terraagent.fun/`, `https://whitepaper.terraagent.fun/`, and a live Colony Deed share URL (`https://terraagent.fun/deed/<tokenId>`) using OpenGraph / X Card / Discord previewers to verify the `1200×630` image renders cleanly.
