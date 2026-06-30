# Handoff — Media & Site Data Storage State (2026-06-30)

Short, factual snapshot for the incoming agent. **Nothing here uses Base44 for storage.** All site data and images live on Netlify.

## ⚠️ Read first — this is a CROSS-REPO handoff
- This source is the **`melankoliaagency` public website** project. Its real git remote is a Base44 S3 bucket, NOT GitHub.
- To make it reviewable, the full working tree was pushed as branch **`cursor/netlify-blobs-media-live`** onto the **`github.com/datadrian/fluxtour`** repo.
- **`fluxtour` is a DIFFERENT project** (the Flux Tour ops platform). This branch is here purely as a reviewable handoff of the public-site source — **do NOT merge it into fluxtour `main`.**
- Pushing this branch is **not a deploy** and does **not** touch runtime Blob data. The `melankolia-site-data` / `melankolia-media-assets` Blob stores are Netlify runtime data, fully separate from git. The only thing that mutates Blob data is running a publish/reseed operation — committing/pushing code does nothing at runtime.

## Hosting / storage map (source of truth)
- **Site hosting:** Netlify — `melankoliaagency.com` (Netlify site ID `9554992e-4906-4737-b3db-5673a911c542`).
- **Deploy source:** Deploy from `melankoliaagency/public` with `--functions=netlify/functions`. The root `/app/public` is the GitHub-triggered build used by another agent — keep the two in mind (see note about sync below).
- **Uploaded images (admin Media tab + artist-page editor):** stored in **Netlify Blobs**, store name `melankolia-media-assets`, served back via `/.netlify/functions/media-upload?id=<id>`.
- **Published artist/site data:** **Netlify Blobs**, store `melankolia-site-data`, key `site-data.json`, via `/.netlify/functions/site-data`.
- **Firestore:** legacy / read-only fallback ONLY. It was hitting `Quota exceeded` and must not be the write target for media.
- **Env vars on the Netlify site:** `MELANKOLIA_BLOBS_SITE_ID`, `MELANKOLIA_BLOBS_TOKEN` (shared by both media-upload and site-data). Dep: `@netlify/blobs ^10.7.9`.

## What I changed this session (do not revert without reason)
1. **`netlify/functions/media-upload.js`** — moved image storage from Firestore to Netlify Blobs (store `melankolia-media-assets`).
   - Root cause fixed: upload POST succeeded but **serving** the image back returned `502 Quota exceeded` from Firestore, so new uploads showed as broken. Now both upload and serve go through Blobs.
   - Firestore kept only as a read fallback for old asset ids. Max image raised to ~5MB.
   - Verified live: upload `200` + serve `200` valid JPEG.

2. **Brand-logo filter** — the MELANKOLIAAGEN letterhead strip (1280×184, md5 `90552aea...`) was scraped into ~17 artists' photo vaults as files `<slug>_1.jpg` (22 files) + `bootblacks_0.jpg`, all byte-identical. It kept reappearing on Remove and re-seeding. Added these exact filenames to `isBrandLogoMedia()` in:
   - `public/js/admin.js`
   - `public/js/artist.js`
   - `netlify/functions/site-data.js` (so `sanitizeArtistMedia` strips it on publish)
   - Cache-busted admin/artist JS to `?v=logo-strip-v21`.
   - Re-published current artists through `publishArtists` so the logo was stripped from the live Blob data (server re-sanitizes; profile content unchanged).

## Known open items (NOT yet fixed — these are yours to pick up)
- **(a) Profile image centering / crop persistence.** This is what the user originally asked for and it is NOT covered here — needs to be built on top of the Blobs architecture (persist focal/crop fields through `site-data` publish, not localStorage).
- **(b) 5 dead `media-upload?id=...` references** (uploaded to Firestore BEFORE the Blobs fix, now 404). Clear these fields + re-upload real photos:
  - `healng`: `gridPhoto` + `photo` = `1782750845316_i6ukzb_img_8631.jpeg`; `banner` = `1782750850411_7l7lox_img_9067.jpeg`
  - `donzii`: vault entry `1782782083258_yeycch_image-1-.png`
  - `sleek-teeth`: `banner` = `1782773224450_rvryf0_sleekteethbanner.jpg`
- I was mid-verification of the post-republish state when asked to stop. Confirm the logo is gone and real photos survived before further edits.

## Caution
- Don't repoint media-upload or site-data back to Firestore — that's the quota bug.
- `melankoliaagency/public/js` (what I deploy) vs root `/app/public/js` (GitHub build) can diverge — keep them synced if a GitHub deploy is expected to win.
- This `melankoliaagency` source does not belong in fluxtour `main`. If you want it in version control properly, give it its own repo and open the PR there.
