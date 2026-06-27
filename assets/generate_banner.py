"""Render the Mind Palace README banner — a clean knowledge-graph motif.

Supersamples at 2x and downscales with LANCZOS for crisp edges.
Run: python3 assets/generate_banner.py
"""
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

S = 2                      # supersample factor
W, H = 1280 * S, 384 * S
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

INDIGO = (99, 102, 241)
VIOLET = (139, 92, 246)
WHITE = (240, 242, 246)
MUTED = (150, 158, 175)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background():
    top, bot = (26, 29, 39), (8, 9, 12)
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        row = lerp(top, bot, y / H)
        for x in range(W):
            px[x, y] = row
    # soft indigo glow behind the graph (left-center)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy = 250 * S, 192 * S
    for r, a in [(220 * S, 18), (150 * S, 22), (90 * S, 26)]:
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=INDIGO + (a,))
    glow = glow.filter(ImageFilter.GaussianBlur(40 * S))
    img = Image.alpha_composite(img.convert("RGBA"), glow)
    
    # subtle dot grid
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    grid_draw = ImageDraw.Draw(grid)
    grid_spacing = 32 * S
    for gx in range(0, W, grid_spacing):
        for gy in range(0, H, grid_spacing):
            grid_draw.rectangle([gx, gy, gx + S, gy + S], fill=(255, 255, 255, 8))
    img = Image.alpha_composite(img, grid)
    
    return img


def node(d, x, y, r, color, glow=True, ring=None, glow_alpha=70):
    x, y = x * S, y * S
    r = r * S
    if glow:
        g = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(g)
        gr = r * 2.6
        gd.ellipse([x - gr, y - gr, x + gr, y + gr], fill=color + (glow_alpha,))
        g = g.filter(ImageFilter.GaussianBlur(r * 1.3))
        d._image.alpha_composite(g)
    dd = ImageDraw.Draw(d._image)
    if ring:
        dd.ellipse([x - r, y - r, x + r, y + r], fill=(20, 22, 30, 255), outline=ring + (255,), width=max(1, round(2 * S)))
        dd.ellipse([x - r * 0.45, y - r * 0.45, x + r * 0.45, y + r * 0.45], fill=color + (255,))
    else:
        dd.ellipse([x - r, y - r, x + r, y + r], fill=color + (255,))


def edge(dd, a, b, color=INDIGO, w=1.4, alpha=150):
    dd.line([a[0] * S, a[1] * S, b[0] * S, b[1] * S], fill=color + (alpha,), width=max(1, round(w * S)))


class Canvas:
    def __init__(self, image):
        self._image = image


def main():
    img = background()
    canvas = Canvas(img)
    dd = ImageDraw.Draw(img)

    # ── clean radial knowledge graph (hub + tidy ring + a few leaves) ──────────
    hub = (250, 192)
    R = 96
    
    # Faint concentric rings for a more structured, lattice-like feel
    for radius, alpha in [(R, 40), (R + 46, 20), (R + 92, 10)]:
        dd.ellipse(
            [ (hub[0] - radius) * S, (hub[1] - radius) * S, 
              (hub[0] + radius) * S, (hub[1] + radius) * S ],
            outline=INDIGO + (alpha,), width=max(1, round(1 * S))
        )

    primaries = []
    for i in range(6):
        ang = math.radians(-90 + i * 60)
        primaries.append((hub[0] + R * math.cos(ang), hub[1] + R * math.sin(ang)))

    # leaves on alternating primaries (short outward stubs — no crossing lines)
    leaves = []
    for i, p in enumerate(primaries):
        if i % 2 == 0:
            ang = math.atan2(p[1] - hub[1], p[0] - hub[0])
            for off in (-0.5, 0.5):
                lx = p[0] + 46 * math.cos(ang + off)
                ly = p[1] + 46 * math.sin(ang + off)
                leaves.append((p, (lx, ly)))

    # edges: spokes + a light ring between adjacent primaries
    for p in primaries:
        edge(dd, hub, p, INDIGO, 1.6, 170)
    for i in range(6):
        edge(dd, primaries[i], primaries[(i + 1) % 6], VIOLET, 1.0, 90)
    for p, l in leaves:
        edge(dd, p, l, INDIGO, 1.1, 120)

    # nodes
    for p, l in leaves:
        node(canvas, l[0], l[1], 3.0, VIOLET, glow=False)
    for i, p in enumerate(primaries):
        # alternate "collection" (ringed) vs "memory" (solid) styling
        if i % 2 == 0:
            node(canvas, p[0], p[1], 7.0, INDIGO, glow=True, ring=VIOLET)
        else:
            node(canvas, p[0], p[1], 6.0, VIOLET, glow=True)
    node(canvas, hub[0], hub[1], 8.5, WHITE, glow=True, ring=INDIGO, glow_alpha=42)

    img = canvas._image
    dd = ImageDraw.Draw(img)

    # ── text ───────────────────────────────────────────────────────────────────
    title_font = ImageFont.truetype(FONT_BOLD, 74 * S)
    sub_font = ImageFont.truetype(FONT, 23 * S)
    chip_font = ImageFont.truetype(FONT, 14 * S)

    tx = 540 * S
    dd.text((tx, 120 * S), "Mind Palace", font=title_font, fill=WHITE)
    dd.text((tx + 4 * S, 210 * S), "Unified cognitive memory & knowledge management",
            font=sub_font, fill=MUTED)

    # feature chips
    chips = ["Knowledge Graph", "Hybrid Search", "Agent Memory"]
    cx = tx + 4 * S
    cy = 258 * S
    for label in chips:
        bbox = dd.textbbox((0, 0), label, font=chip_font)
        tw = bbox[2] - bbox[0]
        w = tw + 44 * S
        dd.rounded_rectangle([cx, cy, cx + w, cy + 36 * S], radius=18 * S,
                             fill=(99, 102, 241, 38), outline=(139, 92, 246, 90), width=max(1, round(1 * S)))
        dd.ellipse([cx + 16 * S - 4 * S, cy + 18 * S - 4 * S, cx + 16 * S + 4 * S, cy + 18 * S + 4 * S], fill=VIOLET + (255,))
        dd.text((cx + 30 * S, cy + 9 * S), label, font=chip_font, fill=WHITE)
        cx += w + 14 * S

    out = img.convert("RGB").resize((1280, 384), Image.LANCZOS)
    out.save("assets/banner.png", optimize=True)
    print("wrote assets/banner.png", out.size)


if __name__ == "__main__":
    main()
