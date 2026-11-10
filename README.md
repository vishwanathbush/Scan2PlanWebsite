# Scan2Plan website · handoff for hosting

Version 93g · 2026-11-10. One static site. No build step, no server code, no framework.

## What is here

- `index.html`, and one `index.html` in each route's folder (`/work/`, `/case/castle/`, `/assurance/`, `/articles/`, `/article/lod-is-a-language/`, `/about/`, `/faq/`, `/book/`, `/legal/privacy/`, 39 in all). Each file is the whole site with that page shown first and that page's own `<title>`, description, canonical, Open Graph tags and JSON-LD (Organization and WebSite on every page; Article and BreadcrumbList on the papers; BreadcrumbList on the case studies; FAQPage on the FAQ). A small router at the end of the file switches pages in place by the URL path (history API), so navigation stays instant. The old `#/…` links still work and are rewritten to their paths.
- `sitemap.xml`, `robots.txt`, `404.html` (the site with no page shown; the router shows its not-found page).
- `img/` · the pictures the pages use (`img/inl/` pictures that were once inlined, `img/cases/` the case studies, `img/cap/` the Capabilities rows, `img/og/` the share pictures).
- `hero/` · the Home page's opening animation (`hero.js`, an ES module) and its pictures.
- `img/aviation-hero.mp4` · one film (20 seconds, silent, H.264, 1280 × 720, 5.7 MB). It plays as a silent loop in two places: the Home page's opening screen and the Aviation Terminal block on `/work/`. `img/aviation-hero-poster.webp` is its first frame, shown until the film starts. The page asks for the film only when its block is on screen, and not at all when the visitor's system asks for reduced motion. The host must serve `.mp4` as `video/mp4` and answer byte-range requests (every static host named below does); Safari will not play it otherwise.
- `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`.

## To run it

Serve the folder at the root of a domain (GitHub Pages with a custom domain, Netlify, S3 + CloudFront, nginx). Asset and link paths are root-relative (`/img/…`, `/case/castle/`), so it must sit at the domain root, not in a subfolder. No rewrite rule is needed: every route is a real folder with its own `index.html`. Serve `404.html` for unknown paths. It does not open from disk (root paths); use any local static server to preview, for example `python3 -m http.server` in this folder.

## Everything the site reaches outside this folder

If the host sets a Content-Security-Policy or blocks third-party requests, these are the domains to allow.

### Scripts and fonts (every page)

| What | Where | Used by |
|---|---|---|
| Roboto 300/400/700, Roboto Mono 700, Libre Baskerville Bold Italic, Noto Sans Math, Noto Sans Symbols 2 | `fonts.googleapis.com`, `fonts.gstatic.com` | all pages |
| three.js 0.170.0 (`build/three.module.js`, `examples/jsm/`) | `cdn.jsdelivr.net` | the Home hero animation |
| GSAP 3.13.0 (`index.js`, `ScrollTrigger.js`) | `cdn.jsdelivr.net` | the Home hero and the scroll reveals |

No analytics tag is installed. Add one before `</head>` if wanted; the Privacy page should then say so.

### Embedded frames

| Page | Frame | Source |
|---|---|---|
| `/book/` (Start a Project) | Google Calendar appointment booking | `calendar.google.com/calendar/appointments/schedules/AcZssZ1OJdHClle_0X8Skw30J-pgnXCHq5hx8vY-mntiaTF_GVu-ftQj7BYBapnIY_dT7Qu3o0RIAPiS` |
| `/case/guild/` (The Guild House) | the project film | `www.youtube-nocookie.com/embed/SFkJOYRsXEs` |
| `/podcast/<n>/` (33 episode pages) | the episode player | `creators.spotify.com/pod/profile/practice-forward-podcast/embed/episodes/…` (one per episode; the id comes from the episode's Spotify link) |

### Outside links

| Page | Link | Goes to |
|---|---|---|
| `/workshops/` | the four booking links | `calendar.app.google/DKJs66boWGezev6r5` (Google Calendar booking page) |
| `/podcast/` and the episode pages | Apple Podcasts, Spotify, YouTube per episode | `podcasts.apple.com/us/podcast/…/id1818278951`, `podcasters.spotify.com/pod/show/practice-forward-podcast/…`, `www.youtube.com/watch?v=…`; the channels `www.youtube.com/@PracticeForwardPodcast` and `www.youtube.com/@scan2plan878` |
| `/podcast/<n>/` | each guest's firm | the firm's own site (about thirty, for example `www.shoparc.com`, `www.bunchdesign.net`) |
| footer (every page) | social | `www.linkedin.com/company/scan2plan/`, `www.youtube.com/@scan2plan878`, `x.com/Scan2Plan_io` |
| `/case/guild/` | the newspaper story | `www.timesunion.com` |
| `/assurance/`, `/spec/…`, the papers | cited standards | `bimforum.org`, `usibd.org`, `boma.org`, `www.cmaanet.org` (one PDF), `content.aia.org` (one PDF), `ascelibrary.org`, `getitright.uk.com`, `www.autodesk.com`, `www.twinearch.com` |

### Email addresses and phone

| Where | Address | How |
|---|---|---|
| footer (every page), `/book/`, `/about/` | `building@scan2plan.io` | plain `mailto:` links, printed |
| `/book/` (the three Open the Door links), `/partners/` (Reuse, Education, Heritage), `/careers/`, `/podcast/` | `v@scan2plan.io` | `mailto:` links with a subject filled in; the address is in the link, not printed |
| footer (every page), `/book/` | `(518) 362-2403` | a `tel:+15183622403` link |

Mail is the fallback for every form until the endpoint below exists.

### Downloadable documents (Google Drive)

Two documents sit behind an email gate. The gate asks for an address, records it (see the endpoint), then opens the Drive file in a new tab.

| Document | Gate on | Drive file |
|---|---|---|
| Client Guide v3.1 | `/assurance/` and the spec pages (`/spec/language/`, `/spec/castle/`, `/spec/chart/`); `/partners/` links to it | `drive.google.com/file/d/1mx6oX7Lo3VeZioQYLM4xjCpt2YPisr3N/view` |
| Vendor Pack | `/work/capabilities/`; `/partners/` links to it | `drive.google.com/file/d/1KNZwMBygGsvwYLWJFuJ9-iCleKt1nUfH/view` |

Both files must stay shared as "anyone with the link" on the owner's Drive, or the gate opens a sign-in page.

A third gate has no file yet: "Scan2Plan BIM Standards" (the button "Download Scan2Plan BIM Standards (PDF)" under the three cards on `/assurance/`). It takes the address and says "Not on the site yet. Tell us where to send it." When the owner supplies the PDF, add its link to `window.GATE_URL` under that name.

### Downloads waiting on files

Nothing on the site offers a file that does not exist. These are hidden until the owner supplies them; each returns by deleting one line in the owner's build:

- the RFP clauses as Word files (18) and the insert pack, on `/spec/language/` (COPY on each clause copies its text today);
- the BIM Standards Chart as a PDF or spreadsheet, on `/spec/chart/`;
- the Castle sample files (Revit `.RVT`, AutoCAD `.DWG`, the PDF sheet set) and the nine CAD sheet pictures, on `/spec/castle/`.

The Sample Vault request on `/work/samples/` takes what the visitor is looking for plus an email, and until the endpoint exists opens a mail to `building@scan2plan.io` with both filled in.

## What needs hooking up (the only server-side work)

Every form on the site posts to one endpoint. In `index.html` (and, because every route's file is a copy of the page, in each `*/index.html`) find:

    window.GATE_ENDPOINT=""

Set it to a URL that accepts `POST` with a JSON body `{file, email, page}` (a form service, a serverless function, or the CRM). `file` is the document name from the tables above, or `"Sample Vault · <what the visitor typed>"`. While it is empty, the gates only log to the browser console and the Sample Vault request falls back to mail. The simplest change is a one-line find-and-replace across the 40 html files; the owner can also set it in the build and re-export.

## Owner's notes

- Search: the canonical domain in the heads and the sitemap is `https://scan2plan.io`; if the site goes live elsewhere, the owner re-runs the build with that domain. Submit `sitemap.xml` in Search Console.
- The Privacy and Accessibility pages are plain-English drafts for counsel.
- Two Careers postings, the Workshops booking link and the Vendor Pack document are the owner's to confirm.
- Source of truth for the content and the build lives with the owner (the copy decks and the compile scripts); edit the content there, not in `index.html`, or the next export overwrites it. Each export is one commit on this repository, named by version.
