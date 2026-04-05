#!/usr/bin/env python3
"""Generate simple PNG icons for the Work VPN extension."""

import struct
import zlib
import os

def create_png(size, color_rgb):
    """Create a PNG with a colored circle on transparent background."""
    r, g, b = color_rgb
    cx, cy = size / 2, size / 2
    radius = size / 2 - 1

    # Build RGBA pixel data
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter byte: None
        for x in range(size):
            dx = x - cx + 0.5
            dy = y - cy + 0.5
            dist = (dx * dx + dy * dy) ** 0.5
            if dist <= radius:
                # Anti-alias the edge
                if dist > radius - 1:
                    alpha = int(255 * (radius - dist + 1))
                    alpha = max(0, min(255, alpha))
                else:
                    alpha = 255
                raw.extend([r, g, b, alpha])
            else:
                raw.extend([0, 0, 0, 0])

    # PNG file structure
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    compressed = zlib.compress(bytes(raw))

    return signature + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")

def main():
    os.makedirs("icons", exist_ok=True)
    gray = (107, 114, 128)
    for size in [16, 48, 128]:
        data = create_png(size, gray)
        path = f"icons/icon-{size}.png"
        with open(path, "wb") as f:
            f.write(data)
        print(f"Created {path} ({len(data)} bytes)")

if __name__ == "__main__":
    main()
