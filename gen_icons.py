#!/usr/bin/env python3
import struct, zlib, math, os

def png_write(path, w, h, rows):
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        return c
    raw = b"".join(b"\x00" + row for row in rows)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)

def rounded_rect(x, y, w, h, r, px, py):
    dx = abs(px - (x + w / 2)); dy = abs(py - (y + h / 2))
    if dx < (w / 2 - r) or dy < (h / 2 - r):
        return 1.0
    if dx > w / 2 or dy > h / 2:
        return 0.0
    return max(0.0, min(1.0, math.hypot(dx - (w / 2 - r), dy - (h / 2 - r)) <= r))

def infinity_cover(px, py, cx, cy, r1, r2, th, pr, pl):
    d1 = math.hypot(px - (cx - r1), py - cy)
    d2 = math.hypot(px - (cx + r1), py - cy)
    cover = 0.0
    for d in (d1, d2):
        cover += max(0.0, min(1.0, (th / 2) - abs(d - r2)))
    cx1, cx2 = cx - r1, cx + r1
    pin = min(d1, d2)
    if abs(px - cx) <= r1 * 0.6 and pr:
        cover += max(0.0, min(1.0, th / 2 - abs(d1 + d2 - 2 * r2)))
    return min(1.0, cover)

def make_icon(size, path):
    SS = 4
    bg = (0x14, 0x14, 0x14)
    fg = (0xF0, 0x8A, 0x7A)
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            a = 0.0; fa = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    px = x + (sx + 0.5) / SS
                    py = y + (sy + 0.5) / SS
                    ux, uy = px / size, py / size
                    if rounded_rect(0, 0, 1, 1, 0.235, ux, uy) > 0.5:
                        a += 1.0
                        if infinity_cover(ux, uy, 0.5, 0.52, 0.115, 0.062, 0.047, 1, 1) > 0.5:
                            fa += 1.0
            total = SS * SS
            alpha = a / total
            falpha = fa / total
            r = bg[0] + (fg[0] - bg[0]) * (falpha / alpha if alpha > 0 else 0)
            g = bg[1] + (fg[1] - bg[1]) * (falpha / alpha if alpha > 0 else 0)
            b = bg[2] + (fg[2] - bg[2]) * (falpha / alpha if alpha > 0 else 0)
            al = int(round(255 * min(1.0, alpha * 1.15)))
            row += bytes((int(r), int(g), int(b), al))
        rows.append(bytes(row))
    png_write(path, size, size, rows)

here = os.path.dirname(os.path.abspath(__file__))
for s in (16, 48, 128):
    make_icon(s, os.path.join(here, "icons", f"icon{s}.png"))
    print("ok", s)
