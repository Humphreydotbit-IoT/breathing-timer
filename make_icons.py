# Generates app icons (run: python3 make_icons.py). Requires Pillow.
from PIL import Image, ImageDraw

BG = (18, 52, 59)      # deep teal
RING = (94, 196, 182)  # soft aqua
LUNG = (232, 246, 243)

def draw(size, maskable):
    S = size * 4  # supersample
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = S / 2
    if maskable:
        d.rectangle([0, 0, S, S], fill=BG)
        scale = 0.62  # keep content inside the 80% safe zone
    else:
        d.ellipse([S*0.02, S*0.02, S*0.98, S*0.98], fill=BG)
        scale = 0.80
    R = S / 2 * scale
    # breathing rings
    for f, w in ((1.0, 0.035), (0.86, 0.02)):
        r = R * f
        d.ellipse([c-r, c-r, c+r, c+r], outline=RING, width=max(2, int(S*w*scale)))
    # lungs: two rounded lobes + trachea
    lw, lh = R*0.36, R*0.62
    gap = R*0.07
    top = c - lh*0.42
    d.rounded_rectangle([c-gap-lw, top, c-gap, top+lh], radius=lw*0.48, fill=LUNG)
    d.rounded_rectangle([c+gap, top, c+gap+lw, top+lh], radius=lw*0.48, fill=LUNG)
    tw = R*0.07
    d.rectangle([c-tw/2, c-R*0.60, c+tw/2, top+lh*0.25], fill=LUNG)
    # bronchi cut-outs
    d.line([c, top+lh*0.18, c-gap-lw*0.35, top+lh*0.45], fill=BG, width=int(tw*0.6))
    d.line([c, top+lh*0.18, c+gap+lw*0.35, top+lh*0.45], fill=BG, width=int(tw*0.6))
    d.rectangle([c-tw/2, c-R*0.60, c+tw/2, top+lh*0.2], fill=LUNG)
    return img.resize((size, size), Image.LANCZOS)

for s in (192, 512):
    draw(s, False).save(f"icons/icon-{s}.png")
    draw(s, True).save(f"icons/icon-maskable-{s}.png")
draw(180, True).convert("RGB").save("icons/apple-touch-icon.png")
print("icons written")
