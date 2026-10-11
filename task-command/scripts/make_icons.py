"""Generate the PNG app icons (navy square, white check mark, red star) with no dependencies.
Run: python3 scripts/make_icons.py"""
import math, struct, zlib

NAVY, WHITE, RED = (0x1D, 0x34, 0x61), (255, 255, 255), (0xA6, 0x3A, 0x2B)

def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def in_star(px, py, cx, cy, r_out, r_in):
    pts = []
    for i in range(10):
        r = r_out if i % 2 == 0 else r_in
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]; xj, yj = pts[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside

def color_at(x, y):  # x, y in 0..1
    if in_star(x, y, 0.70, 0.30, 0.13, 0.055):
        return RED
    check = [(0.26, 0.54), (0.42, 0.70), (0.62, 0.46)]
    if min(seg_dist(x, y, *check[0], *check[1]), seg_dist(x, y, *check[1], *check[2])) < 0.055:
        return WHITE
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
