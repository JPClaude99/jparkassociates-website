# Email signature — the dark-mode logo problem

## What is going wrong

The signature logo is a **transparent PNG with dark ink**. Transparency means the
image has no background of its own, so whatever the mail client puts behind it
shows through. That is fine on white. It fails in dark mode, because of one
asymmetry:

> **Mail clients recolour text in dark mode. They never recolour images.**

Gmail, Outlook, and Apple Mail all invert or remap the *text* colours in a
message so dark type stays readable on a dark background. Images are left
exactly as authored — the client cannot know which pixels are "ink" and which
are "paper". So the surrounding signature text flips to light and stays
readable, while the navy wordmark inside the PNG stays navy and disappears into
the dark background.

The numbers, against brand navy `#1B2A4A`:

| Background            | Contrast with `#1B2A4A` |
| --------------------- | ----------------------- |
| `#FFFFFF` (light)     | 14.2 : 1 &nbsp; ✅       |
| `#1F1F1F` (Gmail dark)| 1.16 : 1 &nbsp; ❌       |

1.16 : 1 is effectively invisible. Nothing about the file is corrupt — the ink
colour was simply chosen for one background and is being shown on the other.

It also cuts the other way: a white-ink transparent logo (the one the newsletter
header uses, `logo-email-white-760.png`) is invisible on a *light* background.
There is no single transparent, single-tone logo that works in both places.

## The fix used here

**Bake the background into the image.** `logo-signature-navy-760.png` is an
opaque plate — brand navy `#111c33` with the white-ink logo composited onto it.
The client's background can never show through, so the mark renders identically
in every client, in both modes, with no CSS and no client support required.

That asset is what `signature.html` points at.

## The alternatives, and why they lost

Three other approaches were generated and rendered side by side
(open `preview.html` in a browser to compare):

| Option | Asset | Verdict |
| --- | --- | --- |
| **A · Navy plate** *(chosen)* | `logo-signature-navy-760.png` | Opaque navy panel, white ink. Bulletproof. Reads as a deliberate brand block in both modes. |
| **B · Light card** | `logo-signature-light-760.png` | Opaque white panel, navy ink. Equally bulletproof, but in dark mode it is a bright white rectangle — assertive, and it glares. |
| **C · Gold ink, transparent** | `logo-signature-gold-760.png` | Keeps transparency by moving all ink to a mid-tone gold `#B08C33` — 3.16 : 1 on white, 5.22 : 1 on dark, so it clears the 3:1 non-text threshold both ways. Costs the navy/cream duotone. Use if a hard-edged panel is unwanted. |
| **D · Background on the HTML cell** | — | Put `bgcolor` on the `<td>` instead of in the image. Rejected: several clients (notably Outlook.com and the Gmail apps) recolour or drop declared backgrounds in dark mode, which is exactly the failure being fixed. The `bgcolor` in `signature.html` is a *fallback* behind the image, not the mechanism. |
| **E · `prefers-color-scheme` image swap** | — | Two images swapped by a media query. Rejected for signatures: Gmail strips `<style>` blocks from signature HTML entirely, so it degrades to whichever image is the default. Fine inside a full campaign email; useless here. |

## Colour rules for the rest of the signature

Text *is* recoloured by the client, so the risk there is lower — but mid-tone
colours are safest, because they survive whether or not a client decides to
invert them. `signature.html` uses:

- `#B08C33` gold for the firm line and the email link — legible on both.
- `#3A4660` / `#6B7488` for contact and disclaimer copy.
- `#C9A84C` for the vertical rule.

Avoid pure `#000000` and pure `#FFFFFF`: clients special-case them, and the
result differs per client.

## Installing it

1. Replace `{{DISCLAIMER}}` in `signature.html` with the firm's full
   confidentiality text.
2. Make sure the logo is live at
   `https://jparkassociates.com/assets/brand/logo-signature-navy-760.png`
   (it ships from `assets/brand/` with the rest of the site).
3. Open `signature.html` in a browser, select all, copy.
4. Gmail → Settings → See all settings → General → Signature → paste.
5. Check it with Gmail's dark theme on, and on the phone app, before sending.

`preview.html` renders the signature and all four logo options on light and dark
backgrounds side by side, for eyeballing changes without sending test mail. It
also shows `specimen-before-760.png` — the old transparent, navy-ink logo at the
same geometry as the plates — so the before/after is a like-for-like comparison.
That file is a proofing specimen only; it is not a brand asset and should not be
used in a signature.

## Assets

| File | Ink | Background | Use |
| --- | --- | --- | --- |
| `logo-signature-navy-760.png` | white + gold | opaque `#111c33` | email signature (both modes) |
| `logo-signature-light-760.png` | navy + gold | opaque `#FFFFFF` | signature alternative; light-only contexts |
| `logo-signature-gold-760.png` | gold `#B08C33` | transparent | when a panel is unwanted |
| `logo-email-white-760.png` | white + gold | transparent | newsletter header — already sits on a navy `<td>`, unaffected |

All three signature plates are 760 × 238 and are drawn from the same source
raster as `logo-email-white-760.png`, so the letterforms are identical to the
rest of the brand.
