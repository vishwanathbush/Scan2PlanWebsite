# Scan2Plan website · handoff

One static page. No build step, no server code, no framework.

## What is here
- `index.html`, and one `index.html` in each route's folder (`/work/`, `/case/castle/`, `/assurance/`, `/articles/`, `/article/lod-is-a-language/`, `/about/`, `/faq/`, `/book/`, `/legal/privacy/`, 39 in all) — each is the whole site with that page shown first and that page's own `<title>`, description, canonical, Open Graph tags and JSON-LD (Organization and WebSite on every page; Article and BreadcrumbList on the papers; BreadcrumbList on the case studies; FAQPage on the FAQ). A small router at the end of the file switches pages in place by the URL path (history API), so navigation stays instant; the old `#/…` links still work and are rewritten to their paths. Fonts come from Google Fonts; everything else is in this folder.
- `sitemap.xml`, `robots.txt`, `404.html` (the site with no page shown; the router shows its not-found page).
- `img/` — the pictures the pages use (376 files, 48 MB): `img/inl/` are pictures that were once inlined, `img/cases/` the case-study pictures, `img/cap/` the Capabilities row pictures.
- `hero/` — the Home page's opening animation (`hero.js`, an ES module) and its pictures.

## To run it
Serve the folder at the root of a domain (GitHub Pages with a custom domain, Netlify, S3 + CloudFront, nginx). Asset and link paths are root-relative (`/img/…`, `/case/castle/`), so it must sit at the domain root, not in a subfolder. No rewrite rule is needed: every route is a real folder with its own `index.html`. Serve `404.html` for unknown paths. It does not open from disk any more (root paths); use any local static server.

## What needs hooking up (the only server-side work)
Every form on the site posts to one endpoint and falls back to email until it exists. In `index.html` find:

    window.GATE_ENDPOINT=""

Set it to a URL that accepts `POST` with a JSON body `{file, email, page}` (a form service, a serverless function, or the CRM). The forms that use it:
1. The download gates (the Client Guide and the Vendor Pack, on As-Built Assurance and Capabilities): `file` is the document name; after the post, the page opens the Drive file in a new tab.
2. The Proof Vault request (Samples): `file` is `"Proof Vault · <what the visitor typed>"`.
3. While the endpoint is empty, the gates only log to the console and the Proof Vault request opens a mail to building@scan2plan.io.

The three "Open the Door" links on Start a Project and the Contact lines are plain `mailto:` links. The booking widget on Start a Project is an iframe (Google Calendar); the Podcast page embeds players; the Guild House case embeds a YouTube film.

## Owner's notes
- Search: the canonical domain in the heads and the sitemap is `https://scan2plan.io`; if the site goes live elsewhere, the owner re-runs the build with that domain (`seo_build.py --site`). Submit `sitemap.xml` in Search Console.
- Analytics: none installed. Add the tag before `</head>` if wanted; the Privacy page should then say so.
- The Privacy and Accessibility pages are plain-English drafts for counsel.
- Two Careers postings, the Workshops booking link and the Vendor Pack document are the owner's to confirm.
- Source of truth for the content and the build lives with the owner (the copy decks and the compile scripts); edit the content there, not in `index.html`, or the next compile overwrites it.
