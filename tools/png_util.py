# -*- coding: utf-8 -*-
"""极简纯 Python PNG 编解码（8bit RGB/RGBA/PALETTE），用于题库插图后处理。

环境里没有 PIL / numpy，所以这里手写 IHDR 解析 + filter 还原 + zlib 压缩写回。
"""
import struct
import zlib


class Image:
    def __init__(self, w, h, pixels, mode="RGB"):
        self.w = w
        self.h = h
        self.pixels = pixels  # bytearray, 每像素 3 字节
        self.mode = mode

    def get(self, x, y):
        i = (y * self.w + x) * 3
        p = self.pixels
        return p[i], p[i + 1], p[i + 2]

    def put(self, x, y, rgb):
        i = (y * self.w + x) * 3
        self.pixels[i:i + 3] = bytes(rgb)


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def read_png(path):
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a png"
    pos = 8
    width = height = bitdepth = colortype = None
    idat = []
    palette = []
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, bitdepth, colortype, comp, filt, interlace = struct.unpack(">IIBBBBB", body)
            assert bitdepth == 8, "only 8-bit supported"
            assert interlace == 0, "interlace not supported"
        elif ctype == b"PLTE":
            palette = [tuple(body[i:i + 3]) for i in range(0, len(body), 3)]
        elif ctype == b"IDAT":
            idat.append(body)
        elif ctype == b"IEND":
            break

    raw = zlib.decompress(b"".join(idat))
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colortype]
    stride = width * channels
    out = bytearray(height * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(height):
        ft = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if ft == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                ul = prev[i - channels] if i >= channels else 0
                line[i] = (line[i] + _paeth(left, prev[i], ul)) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line

    rgb = bytearray(width * height * 3)
    if colortype == 2:
        rgb[:] = out
    elif colortype == 6:
        for i in range(width * height):
            rgb[i * 3:i * 3 + 3] = out[i * 4:i * 4 + 3]
    elif colortype == 3:
        for i in range(width * height):
            idx = out[i]
            r, g, b = palette[idx] if idx < len(palette) else (0, 0, 0)
            rgb[i * 3:i * 3 + 3] = bytes((r, g, b))
    elif colortype == 0:
        for i in range(width * height):
            v = out[i]
            rgb[i * 3:i * 3 + 3] = bytes((v, v, v))
    else:
        raise ValueError("unsupported color type %s" % colortype)

    return Image(width, height, rgb)


def write_png(path, img):
    raw = bytearray()
    stride = img.w * 3
    for y in range(img.h):
        raw.append(0)
        raw += img.pixels[y * stride:(y + 1) * stride]
    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, body):
        return (struct.pack(">I", len(body)) + tag + body
                + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", img.w, img.h, 8, 2, 0, 0, 0)
    out = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", comp) + chunk(b"IEND", b"")
    open(path, "wb").write(out)


def crop(img, box):
    """box = (left, top, right, bottom)，右/下不含。"""
    l, t, r, b = box
    l, t = max(0, l), max(0, t)
    r, b = min(img.w, r), min(img.h, b)
    w, h = r - l, b - t
    out = Image(w, h, bytearray(w * h * 3))
    for y in range(h):
        src = ((t + y) * img.w + l) * 3
        dst = y * w * 3
        out.pixels[dst:dst + w * 3] = img.pixels[src:src + w * 3]
    return out


def binarize(img, ink=150, green_guard=28, keep_gray=0):
    """把线稿图转为纯黑白，并剔除荧光笔绿色高亮。

    - green_guard: G 明显高于 R/B 的像素判为高亮底色，直接变白
    - ink: 灰度低于该值判为墨线
    - keep_gray: >0 时保留部分灰阶（用于抗锯齿），先二值再轻度回灰
    """
    p = img.pixels
    for i in range(0, len(p), 3):
        r, g, b = p[i], p[i + 1], p[i + 2]
        if g - max(r, b) > green_guard and g > 120:
            p[i] = p[i + 1] = p[i + 2] = 255
            continue
        lum = (r * 299 + g * 587 + b * 114) // 1000
        v = 0 if lum < ink else 255
        p[i] = p[i + 1] = p[i + 2] = v
    return img


def _morph(img, r, expand):
    """灰度形态学：expand=True 为膨胀（取邻域最小值），False 为腐蚀（取最大值）。"""
    w, h = img.w, img.h
    src = img.pixels
    out = Image(w, h, bytearray(src))
    pick = min if expand else max
    for y in range(h):
        y0, y1 = max(0, y - r), min(h - 1, y + r)
        row = y * w * 3
        for x in range(w):
            x0, x1 = max(0, x - r), min(w - 1, x + r)
            v = 255 if expand else 0
            for yy in range(y0, y1 + 1):
                base = yy * w * 3
                for xx in range(x0, x1 + 1):
                    v = pick(v, src[base + xx * 3])
            i = row + x * 3
            out.pixels[i] = out.pixels[i + 1] = out.pixels[i + 2] = v
    return out


def close(img, r=1):
    """闭运算：先膨胀再腐蚀，用于把扫描件的虚线/网点连成实线。"""
    return _morph(_morph(img, r, True), r, False)


def tight_bbox(img, margin=8, thresh=200):
    """自动去掉四周空白，保留 margin 白边。"""
    w, h = img.w, img.h
    p = img.pixels
    left, top, right, bottom = w, h, 0, 0
    for y in range(h):
        row = y * w * 3
        for x in range(w):
            i = row + x * 3
            if p[i] < thresh:
                if x < left:
                    left = x
                if x > right:
                    right = x
                if y < top:
                    top = y
                if y > bottom:
                    bottom = y
    if right <= left:
        return img
    return crop(img, (left - margin, top - margin, right + margin + 1, bottom + margin + 1))


def scale(img, factor):
    """整数/浮点缩放（双线性，先灰度）。"""
    nw, nh = max(1, int(img.w * factor)), max(1, int(img.h * factor))
    out = Image(nw, nh, bytearray(nw * nh * 3))
    for y in range(nh):
        sy = min(img.h - 1, y / factor)
        y0 = int(sy)
        y1 = min(img.h - 1, y0 + 1)
        fy = sy - y0
        for x in range(nw):
            sx = min(img.w - 1, x / factor)
            x0 = int(sx)
            x1 = min(img.w - 1, x0 + 1)
            fx = sx - x0
            i00 = (y0 * img.w + x0) * 3
            i10 = (y0 * img.w + x1) * 3
            i01 = (y1 * img.w + x0) * 3
            i11 = (y1 * img.w + x1) * 3
            v = (img.pixels[i00] * (1 - fx) * (1 - fy) + img.pixels[i10] * fx * (1 - fy)
                 + img.pixels[i01] * (1 - fx) * fy + img.pixels[i11] * fx * fy)
            v = int(v)
            o = (y * nw + x) * 3
            out.pixels[o] = out.pixels[o + 1] = out.pixels[o + 2] = v
    return out
