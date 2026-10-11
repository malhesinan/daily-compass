"""Generate the PNG app icons ("Pick three": three slots, the first ticked) with no dependencies.
Run: python3 scripts/make_icons.py"""
import math, struct, zlib

NAVY, WHITE, BRICK = (0x1D, 0x34, 0x61), (255, 255, 255), (0xA6, 0x3A, 0x2B)
S = 1 / 96  # design is drawn on a 96 x 96 grid
SCALE = 0.94  # keep everything inside the iPhone/Android safe area

def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def in_rrect(x, y, rx, ry, w, h, r):
    if not (rx <= x <= rx + w and ry <= y <= ry + h):
        return False
    cx = min(max(x, rx + r), rx + w - r)
    cy = min(max(y, ry + r), ry + h - r)
    return math.hypot(x - cx, y - cy) <= r

def mix(a, b, t):
    return tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(3))

def color_at(x, y):  # x, y in 0..1
    x, y = (x - 0.5) / SCALE / S + 48, (y - 0.5) / SCALE / S + 48  # to the 96 grid
    if in_rrect(x, y, 20, 22, 56, 14, 5):  # slot 1: brick, ticked
        if min(seg_dist(x, y, 26, 29, 30, 33), seg_dist(x, y, 30, 33, 37, 25)) < 1.6:
            return WHITE
        if in_rrect(x, y, 42, 27.5, 26, 3, 1.5):
            return WHITE
        return BRICK
    if in_rrect(x, y, 20, 41, 56, 14, 5):
        return mix(NAVY, WHITE, 0.9)
    if in_rrect(x, y, 20, 60, 56, 14, 5):
        return mix(NAVY, WHITE, 0.55)
    return NAVY

def render(size, path, ss=4):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = color_at((px + (sx + .5) / ss) / size, (py + (sy + .5) / ss) / size)
                    for k in range(3): acc[k] += c[k]
            row += bytes(v // (ss * ss) for v in acc)
        rows.append(bytes(row))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)

for size, name in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
    render(size, f'public/icons/{name}')
    print('wrote', name)
