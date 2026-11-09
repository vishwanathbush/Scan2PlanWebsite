# Scan2Plan website · handoff

One static page. No build step, no server code, no framework.

## What is here
- `index.html` — the whole site: every page is a `<section class="screen">`, and a small router at the end of the file shows one by the URL hash (`#/`, `#/work`, `#/case/castle`, `#/assurance`, `#/articles`, `#/article/lod-is-a-language`, `#/about`, `#/faq`, `#/book`, `#/legal/privacy`, …). Fonts come from Google Fonts; everything else is in this folder.
- `img/` — the pictures the page uses (376 files, 48 MB): `img/inl/` are pictures that were once inlined, `img/cases/` the case-study pictures, `img/cap/` the Capabilities row pictures.
- `hero/` — the Home page's opening animation (`hero.js`, an ES module) and its pictures.

## To run it
Serve the folder from any static host (GitHub Pages, Netlify, S3, nginx). It also opens from disk, except the Home hero module, which browsers block on `file://`.

## What needs hooking up (the only server-side work)
Every form on the site posts to one endpoint and falls back to email until it exists. In `index.html` find:

    window.GATE_ENDPOINT=""

Set it to a URL that accepts `POST` with a JSON body `{file, email, page}` (a form service, a serverless function, or the CRM). The forms that use it:
1. The download gates (the Client Guide and the Vendor Pack, on As-Built Assurance and Capabilities): `file` is the document name; after the post, the page opens the Drive file in a new tab.
2. The Proof Vault request (Samples): `file` is `"Proof Vault · <what the visitor typed>"`.
3. While the endpoint is empty, the gates only log to the console and the Proof Vault request opens a mail to building@scan2plan.io.

The three "Open the Door" links on Start a Project and the Contact lines are plain `mailto:` links. The booking widget on Start a Project is an iframe (Google Calendar); the Podcast page embeds players; the Guild House case embeds a YouTube film.

## Owner's notes
- Analytics: none installed. Add the tag before `</head>` if wanted; the Privacy page should then say so.
- The Privacy and Accessibility pages are plain-English drafts for counsel.
- Two Careers postings, the Workshops booking link and the Vendor Pack document are the owner's to confirm.
- Source of truth for the content and the build lives with the owner (the copy decks and the compile scripts); edit the content there, not in `index.html`, or the next compile overwrites it.

## Hosting notes (from a Lighthouse pass, 2026-11-08)
- Serve with gzip or brotli: `index.html` is 850 KB uncompressed, about 150 KB compressed, and that is most of the phone load time.
- Long cache lifetimes on `img/` and `hero/` (a year is fine; file names change when pictures change).
- The page already preloads the splash poster, lazy-loads every other picture, and loads the hero module after the load event.
