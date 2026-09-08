#!/usr/bin/env python3
"""Minimal PNG reader for render evidence: no third-party deps in this box.

Handles the 8-bit RGB/RGBA non-interlaced files Godot's Image.save_png writes.
Sub-commands: `rows` (sample pixels), `band` (find horizontal runs of a flat
row colour), `grid` (coarse colour census).
"""
import sys, zlib, struct

def load(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', 'not a png'
    i, idat, meta = 8, [], None
    while i < len(d):
        ln = struct.unpack('>I', d[i:i+4])[0]
        typ = d[i+4:i+8]
        body = d[i+8:i+8+ln]
        if typ == b'IHDR':
            w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', body)
            assert depth == 8 and interlace == 0 and ctype in (2, 6), (depth, ctype, interlace)
            meta = (w, h, 3 if ctype == 2 else 4)
        elif typ == b'IDAT':
            idat.append(body)
        elif typ == b'IEND':
            break
        i += 12 + ln
    w, h, ch = meta
    raw = zlib.decompress(b''.join(idat))
    stride = w * ch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        f = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos+stride]); pos += stride
        if f == 1:
            for x in range(ch, stride): line[x] = (line[x] + line[x-ch]) & 255
        elif f == 2:
            for x in range(stride): line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x-ch] if x >= ch else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x-ch] if x >= ch else 0
                b = prev[x]
                c = prev[x-ch] if x >= ch else 0
                p = a + b - c
                pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return w, h, ch, out

def px(w, ch, buf, x, y):
    o = (y*w + x)*ch
    return (buf[o], buf[o+1], buf[o+2])

def cmd_rows(path, ys):
    w, h, ch, buf = load(path)
    print(f"{path} {w}x{h}")
    xs = [int(w*f) for f in (0.05, 0.25, 0.5, 0.75, 0.95)]
    for y in ys:
        if y < 0: y += h
        if not (0 <= y < h): continue
        print(y, [px(w, ch, buf, x, y) for x in xs])

def cmd_band(path):
    """Report each maximal run of rows whose 9 samples are within tol of each
    other -- a flat row is what a clipped/empty region looks like."""
    w, h, ch, buf = load(path)
    xs = [int(w*(0.5+i)/9) for i in range(9)]
    print(f"{path} {w}x{h}")
    flat = []
    for y in range(h):
        s = [px(w, ch, buf, x, y) for x in xs]
        spread = max(max(c[k] for c in s) - min(c[k] for c in s) for k in range(3))
        flat.append((spread <= 6, s[4]))
    y = 0
    while y < h:
        if flat[y][0]:
            j = y
            while j+1 < h and flat[j+1][0] and flat[j+1][1] == flat[y][1]:
                j += 1
            if j - y >= 8:
                print(f"  flat rows {y}..{j} ({j-y+1}px, {100.0*(j-y+1)/h:.1f}% of frame) colour {flat[y][1]}")
            y = j+1
        else:
            y += 1

def cmd_grid(path, nx=8, ny=12):
    w, h, ch, buf = load(path)
    print(f"{path} {w}x{h} grid {nx}x{ny}")
    for gy in range(ny):
        y0, y1 = gy*h//ny, (gy+1)*h//ny
        cells = []
        for gx in range(nx):
            x0, x1 = gx*w//nx, (gx+1)*w//nx
            n = 0; acc = [0,0,0]
            for y in range(y0, y1, max(1,(y1-y0)//6)):
                for x in range(x0, x1, max(1,(x1-x0)//6)):
                    p = px(w, ch, buf, x, y)
                    acc[0]+=p[0]; acc[1]+=p[1]; acc[2]+=p[2]; n+=1
            cells.append("%02x%02x%02x" % tuple(v//n for v in acc))
        print(f"  y{y0:>5}-{y1:<5} " + " ".join(cells))

if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'rows':
        cmd_rows(sys.argv[2], [int(v) for v in sys.argv[3:]])
    elif mode == 'band':
        for p in sys.argv[2:]: cmd_band(p)
    elif mode == 'grid':
        for p in sys.argv[2:]: cmd_grid(p)
    else:
        raise SystemExit("modes: rows <png> <y...> | band <png...> | grid <png...>")
