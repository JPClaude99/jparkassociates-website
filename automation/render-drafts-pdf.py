#!/usr/bin/env python3
"""Render a month's email drafts into one combined review PDF.

Used by the monthly-email routine (see automation/EMAILS.md): as soon as the
drafts for a month are written, render them to a single PDF so Justin gets an
inbox-ready copy to review — no ESP/sending integration required.

Usage:
    python3 automation/render-drafts-pdf.py 2026-07
    python3 automation/render-drafts-pdf.py 2026-07 --out /tmp/drafts.pdf

Dependencies (install once):
    pip3 install weasyprint pypdf

Segments are ordered to match emails/segments.json; any *.html draft present
that isn't in the known order is appended alphabetically so nothing is dropped.
"""
import argparse
import sys
from pathlib import Path

# Preferred segment order (general first, then industry segments).
PREFERRED_ORDER = [
    "general",
    "restaurants",
    "optometrists",
    "wholesalers",
    "service-stations",
    "law-firms",
    "grocery",
]


def ordered_drafts(draft_dir: Path):
    drafts = {p.stem: p for p in draft_dir.glob("*.html")}
    ordered = [drafts.pop(s) for s in PREFERRED_ORDER if s in drafts]
    ordered += [drafts[k] for k in sorted(drafts)]  # any extras, alpha
    return ordered


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("month", help="Target month directory, e.g. 2026-07")
    parser.add_argument("--out", help="Output PDF path (default: emails/drafts/<month>/<month>-drafts.pdf)")
    args = parser.parse_args()

    repo = Path(__file__).resolve().parent.parent
    draft_dir = repo / "emails" / "drafts" / args.month
    if not draft_dir.is_dir():
        sys.exit(f"No draft directory found: {draft_dir}")

    drafts = ordered_drafts(draft_dir)
    if not drafts:
        sys.exit(f"No .html drafts found in {draft_dir}")

    try:
        from weasyprint import HTML, default_url_fetcher
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        sys.exit("Missing deps. Run: pip3 install weasyprint pypdf")

    # The drafts reference assets by absolute production URL
    # (https://jparkassociates.com/assets/...). That host isn't reachable from
    # the build environment, so without this the header logo fails to load and
    # WeasyPrint falls back to the alt text in default black — making the PDF
    # header look broken even though the email itself is fine. Map those URLs
    # to the local repo copy so the real (white-on-navy) logo renders.
    site_prefix = "https://jparkassociates.com/"

    def local_first_fetcher(url):
        if url.startswith(site_prefix):
            local = repo / url[len(site_prefix):]
            if local.is_file():
                return {"file_obj": open(local, "rb"), "mime_type": None}
        return default_url_fetcher(url)

    out_path = Path(args.out) if args.out else draft_dir / f"{args.month}-drafts.pdf"
    writer = PdfWriter()
    for draft in drafts:
        rendered = HTML(str(draft), url_fetcher=local_first_fetcher).write_pdf()
        import io
        for page in PdfReader(io.BytesIO(rendered)).pages:
            writer.add_page(page)
        print(f"rendered {draft.name}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as fh:
        writer.write(fh)
    print(f"\nCombined PDF: {out_path} ({out_path.stat().st_size:,} bytes, {len(drafts)} segments)")


if __name__ == "__main__":
    main()
