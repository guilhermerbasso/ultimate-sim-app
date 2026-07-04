#!/usr/bin/env python3
# ── gen-instrument-assets.py ──────────────────────────────────────────────────
# OPTIONAL build-time pipeline that procedurally generates brand-neutral SVG
# instrument enrichments (bezels, tick-rings, carbon/brushed textures, a telltale
# sprite) plus a JSON manifest. Everything is first-party / CC0 — no manufacturer
# logos, names or copyrighted assets.
#
# IMPORTANT: the React+SVG instrument primitives in
# src/renderer/src/instruments render FULLY without these assets (each draws a
# procedural SVG fallback). This pipeline only ENRICHES; it is never required by
# `electron-vite build`. Run it manually:
#
#     bash scripts/gen-instrument-assets.sh
#     # or: python3 scripts/gen-instrument-assets.py --out <dir>
#
# Dependencies: pure Python stdlib (writes SVG strings). Pillow / svgwrite are used
# OPTIONALLY to additionally rasterise PNG textures when available; their absence is
# not an error.

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone

# Optional accelerators — never required.
try:  # pragma: no cover - environment dependent
    import svgwrite  # type: ignore  # noqa: F401
    HAVE_SVGWRITE = True
except Exception:  # pragma: no cover
    HAVE_SVGWRITE = False

try:  # pragma: no cover - environment dependent
    from PIL import Image  # type: ignore
    HAVE_PIL = True
except Exception:  # pragma: no cover
    HAVE_PIL = False


# Warm-chrome discipline (matches src/renderer/src/instruments/tokens.ts).
BEZEL_HI = "#6E6E6E"
BEZEL_MID = "#3A3A3A"
BEZEL_LO = "#141414"
RECESS = "#040404"
TICK = "#F4F4F4"
TICK_DIM = "#8A8A8A"


def _wrap_svg(width: int, height: int, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">{body}</svg>'
    )


def gen_bezel(size: int) -> str:
    """Layered warm-chrome bezel ring (brand-neutral)."""
    cx = cy = size / 2
    r_outer = size / 2 - 0.5
    t = size * 0.07
    grad = (
        f'<defs><linearGradient id="bz" x1="0" y1="0" x2="0.4" y2="1">'
        f'<stop offset="0%" stop-color="{BEZEL_HI}"/>'
        f'<stop offset="30%" stop-color="{BEZEL_MID}"/>'
        f'<stop offset="70%" stop-color="{BEZEL_LO}"/>'
        f'<stop offset="100%" stop-color="#000000"/></linearGradient></defs>'
    )
    body = (
        grad
        + f'<circle cx="{cx}" cy="{cy}" r="{r_outer}" fill="#000000"/>'
        + f'<circle cx="{cx}" cy="{cy}" r="{r_outer - t / 2}" fill="none" '
        f'stroke="url(#bz)" stroke-width="{t}"/>'
        + f'<circle cx="{cx}" cy="{cy}" r="{r_outer - t}" fill="{RECESS}" '
        f'stroke="#2E2E2E" stroke-width="1"/>'
    )
    return _wrap_svg(size, size, body)


def _point(cx: float, cy: float, r: float, angle_deg: float):
    rad = math.radians(angle_deg)
    return cx + r * math.sin(rad), cy - r * math.cos(rad)


def gen_tickring(size: int, sweep_deg: float, majors: int = 9, minors: int = 4) -> str:
    """Graduated tick-ring at an arbitrary sweep angle (degrees, symmetric)."""
    cx = cy = size / 2
    r = size / 2 - 4
    start = -sweep_deg / 2
    end = sweep_deg / 2
    major_len = r * 0.16
    minor_len = r * 0.09
    parts = []
    seg = max(1, majors - 1)
    for i in range(majors):
        frac = i / seg
        a = start + (end - start) * frac
        x1, y1 = _point(cx, cy, r, a)
        x2, y2 = _point(cx, cy, r - major_len, a)
        parts.append(
            f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" '
            f'stroke="{TICK}" stroke-width="2" stroke-linecap="round"/>'
        )
        if i < majors - 1 and minors > 0:
            for j in range(1, minors + 1):
                mf = (i + j / (minors + 1)) / seg
                ma = start + (end - start) * mf
                mx1, my1 = _point(cx, cy, r, ma)
                mx2, my2 = _point(cx, cy, r - minor_len, ma)
                parts.append(
                    f'<line x1="{mx1:.2f}" y1="{my1:.2f}" x2="{mx2:.2f}" y2="{my2:.2f}" '
                    f'stroke="{TICK_DIM}" stroke-width="1" stroke-linecap="round"/>'
                )
    return _wrap_svg(size, size, "".join(parts))


def gen_carbon_texture(size: int = 64) -> str:
    """2×2 carbon-weave tile (brand-neutral)."""
    cell = size // 8
    tiles = []
    for ty in range(0, size, cell * 2):
        for tx in range(0, size, cell * 2):
            tiles.append(
                f'<rect x="{tx}" y="{ty}" width="{cell}" height="{cell}" fill="#161616"/>'
                f'<rect x="{tx + cell}" y="{ty + cell}" width="{cell}" height="{cell}" fill="#161616"/>'
                f'<rect x="{tx + cell}" y="{ty}" width="{cell}" height="{cell}" fill="#0b0b0b"/>'
                f'<rect x="{tx}" y="{ty + cell}" width="{cell}" height="{cell}" fill="#0b0b0b"/>'
            )
    body = f'<rect width="{size}" height="{size}" fill="{RECESS}"/>' + "".join(tiles)
    return _wrap_svg(size, size, body)


def gen_brushed_texture(size: int = 64) -> str:
    """Brushed-metal tile: vertical gradient + faint horizontal hatch."""
    grad = (
        f'<defs><linearGradient id="bm" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0%" stop-color="{BEZEL_HI}"/>'
        f'<stop offset="50%" stop-color="{BEZEL_MID}"/>'
        f'<stop offset="100%" stop-color="{BEZEL_LO}"/></linearGradient></defs>'
    )
    lines = "".join(
        f'<line x1="0" y1="{y}" x2="{size}" y2="{y}" stroke="#ffffff" '
        f'stroke-opacity="0.04" stroke-width="0.5"/>'
        for y in range(0, size, 2)
    )
    body = grad + f'<rect width="{size}" height="{size}" fill="url(#bm)"/>' + lines
    return _wrap_svg(size, size, body)


def gen_telltale_sprite() -> str:
    """Brand-neutral telltale lamp sprite (geometric warning glyphs)."""
    cell = 24
    glyphs = {
        "warning": '<path d="M12 4 L21 20 H3 Z" fill="none" stroke="currentColor" stroke-width="2"/>'
        '<line x1="12" y1="10" x2="12" y2="15" stroke="currentColor" stroke-width="2"/>'
        '<circle cx="12" cy="18" r="1.2" fill="currentColor"/>',
        "circle": '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/>',
        "bar": '<rect x="5" y="9" width="14" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>',
        "bolt": '<path d="M13 3 L6 13 H11 L10 21 L18 10 H13 Z" fill="currentColor"/>',
    }
    n = len(glyphs)
    parts = []
    for i, (name, geom) in enumerate(glyphs.items()):
        parts.append(f'<g id="tt-{name}" transform="translate({i * cell},0)">{geom}</g>')
    return _wrap_svg(n * cell, cell, "".join(parts))


def _write(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


def _maybe_png_from_svg_tile(kind: str, out_dir: str, size: int) -> str | None:
    """Optionally rasterise a flat texture PNG with Pillow (best-effort)."""
    if not HAVE_PIL:
        return None
    try:  # pragma: no cover - environment dependent
        img = Image.new("RGB", (size, size), (4, 4, 4))
        px = img.load()
        if kind == "carbon":
            cell = max(1, size // 8)
            for y in range(size):
                for x in range(size):
                    block = ((x // cell) + (y // cell)) % 2
                    v = 22 if block else 11
                    px[x, y] = (v, v, v)
        else:  # brushed
            for y in range(size):
                t = y / max(1, size - 1)
                v = int(110 * (1 - t) + 20 * t)
                for x in range(size):
                    px[x, y] = (v, v, v)
        rel = f"{kind}-{size}.png"
        img.save(os.path.join(out_dir, rel))
        return rel
    except Exception:
        return None


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Generate optional instrument assets.")
    default_out = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "src", "renderer", "src", "assets", "instruments",
    )
    parser.add_argument("--out", default=default_out, help="Output directory.")
    parser.add_argument("--sizes", default="160,200,260", help="Bezel/tickring sizes (px).")
    args = parser.parse_args(argv)

    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    sizes = [int(s) for s in str(args.sizes).split(",") if s.strip().isdigit()]

    assets: dict[str, dict] = {}

    def add(asset_id: str, kind: str, src: str, fmt: str, **meta):
        entry = {"id": asset_id, "kind": kind, "src": f"assets/instruments/{src}", "format": fmt}
        if meta:
            entry["meta"] = meta
        assets[asset_id] = entry

    # Bezels + tick-rings per size.
    for size in sizes:
        bz = f"bezel-chrome-{size}.svg"
        _write(os.path.join(out_dir, bz), gen_bezel(size))
        add(f"bezel-chrome-{size}", "bezel", bz, "svg", size=size, material="chrome")

        for sweep in (270, 240, 300):
            tr = f"tickring-{sweep}-{size}.svg"
            _write(os.path.join(out_dir, tr), gen_tickring(size, sweep))
            add(f"tickring-{sweep}-{size}", "tickring", tr, "svg", size=size, sweepDeg=sweep)

    # Textures (SVG always; PNG when Pillow present).
    _write(os.path.join(out_dir, "carbon-64.svg"), gen_carbon_texture(64))
    add("carbon-64", "texture", "carbon-64.svg", "svg", material="carbon", size=64)
    _write(os.path.join(out_dir, "brushed-64.svg"), gen_brushed_texture(64))
    add("brushed-64", "texture", "brushed-64.svg", "svg", material="brushed", size=64)

    for kind in ("carbon", "brushed"):
        rel = _maybe_png_from_svg_tile(kind, out_dir, 128)
        if rel:
            add(f"{kind}-128", "texture", rel, "png", material=kind, size=128)

    # Telltale sprite.
    _write(os.path.join(out_dir, "telltale-sprite.svg"), gen_telltale_sprite())
    add("telltale-sprite", "sprite", "telltale-sprite.svg", "svg")

    manifest = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "assets": assets,
    }
    _write(os.path.join(out_dir, "manifest.json"), json.dumps(manifest, indent=2))

    print(f"[gen-instrument-assets] wrote {len(assets)} assets → {out_dir}")
    print(f"[gen-instrument-assets] svgwrite={HAVE_SVGWRITE} pillow={HAVE_PIL}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
