"""
«Общая карта»: our own drawing of the region (src/assets/world-map/region.webp), made once by hand:

  python -I scripts/world-map/make-world-map.py <stencil.jpg> <out.webp>

The stencil — where the locations lie and how they join — is tarkov.dev's «openworld-2d» («Nick's Open World V5» by
LastNickLeft, the-hideout/tarkov-dev, MIT): https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/public/maps/openworld-2d.jpg
(8192 px, 15.11.2026). The owner (15.11.2026): «карту мы делаем с нуля… по трафарету»; players never see a source name.

The picture is drawn anew from it: every pixel of the stencil is sorted into what it shows (water, meadow, forest, rock,
road, rail, building, sand, trail), its place names, icons and signature are cleaned away, the areas are smoothed into
plain shapes, and everything is painted flat in the colours of our schemes (src/data schemes' .land/.trees/.water/…),
with soft edges. None of the stencil's own pixels, textures or lettering are kept.
Needs Pillow, numpy and opencv-python.
"""
import sys
import cv2
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
SIZE = 4096

# what the stencil's colours show (its main colours, k-means of the whole picture)
KINDS = {
  'meadow': [[138, 174, 136], [126, 161, 124], [162, 183, 160]],
  'forest': [[116, 151, 115], [87, 101, 87]],
  'building': [[218, 170, 115]],
  'water': [[120, 178, 216], [100, 158, 195]],
  'rock': [[62, 63, 62]],
  'road': [[208, 209, 208], [252, 253, 252]],
  'rail': [[121, 124, 113]],
  'field': [[188, 195, 171]],
  'trail': [[171, 160, 114]],
}
# our schemes' colours, a touch varied so the big areas read apart
PAINT = {
  'meadow': (31, 80, 84),     # .land #1f5054
  'forest': (20, 64, 67),     # .trees #144043
  'building': (43, 55, 68),   # between .building #1a2632 and .locked #37414c
  'water': (74, 107, 150),    # .water #4a6b96
  'rock': (14, 40, 44),
  'road': (124, 133, 141),    # .tarmac #768089, lighter
  'rail': (58, 66, 74),
  'field': (44, 90, 90),
  'trail': (120, 98, 66),     # .gravel #946d3e, darker
}
# how much each kind is smoothed (px of the 4096 picture): areas a lot, lines and houses little
SMOOTH = {'meadow': 6, 'forest': 6, 'water': 2.5, 'rock': 3, 'field': 5, 'trail': 1.2, 'road': 1.1, 'rail': 1.1, 'building': 1.3}
NAMES = list(KINDS)
# the stencil's signature, all in the sea
SIGNATURE = (slice(3730, SIZE), slice(3250, SIZE))


def classify(picture):
  centres = np.array([c for name in NAMES for c in KINDS[name]], np.float32)
  owner = np.array([i for i, name in enumerate(NAMES) for _ in KINDS[name]])
  out = np.empty(picture.shape[:2], np.uint8)
  for y in range(0, picture.shape[0], 256):
    block = picture[y:y + 256].reshape(-1, 1, 3)
    out[y:y + 256] = owner[((block - centres[None]) ** 2).sum(-1).argmin(1)].reshape(-1, picture.shape[1])
  return out


def lettering_mask(picture):
  """The stencil's place names: an icon square (green, orange or red) with white letters to its right; and its signature."""
  r, g, b = (picture[..., i].astype(np.int16) for i in range(3))
  icons = ((g > 170) & (r > 100) & (r < 190) & (b < 80)) | ((r > 220) & (g > 120) & (g < 190) & (b < 60)) | ((r > 200) & (g < 60) & (b < 80))
  mask = np.zeros(picture.shape[:2], np.uint8)
  count, _, stats, _ = cv2.connectedComponentsWithStats(icons.astype(np.uint8))
  bright = (np.minimum(np.minimum(r, g), b) > 226).astype(np.uint8)
  for x, y, w, h, _ in stats[1:]:
    if not (25 <= w <= 80 and 25 <= h <= 80):
      continue
    x0, y0, x1, y1 = x - 6, y - 8, min(SIZE, x + w + 520), y + h + 8
    mask[y0:y1, x0:x + w + 6] = 1
    mask[y0:y1, x0:x1] |= bright[y0:y1, x0:x1]
  mask[SIGNATURE] = 1  # the signature in the south-east sea
  return cv2.dilate(mask, np.ones((7, 7), np.uint8))


def main(source, target):
  picture = np.asarray(Image.open(source).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS))
  lettering = lettering_mask(picture)
  kinds = classify(picture.astype(np.float32))
  water = NAMES.index('water')
  # under the signature: sea; under the place names: the kind most common around them
  kinds[SIGNATURE] = water
  hidden = lettering > 0
  hidden[SIGNATURE] = False
  valid = (~hidden).astype(np.float32)
  around = cv2.GaussianBlur(valid, (0, 0), 14) + 1e-6
  guess = np.stack([cv2.GaussianBlur(((kinds == i) & ~hidden).astype(np.float32), (0, 0), 14) / around for i in range(len(NAMES))], -1).argmax(-1)
  kinds = np.where(hidden, guess, kinds).astype(np.uint8)
  # each kind's share around every pixel, smoothed; the strongest kind paints it, softly at the borders
  shares = np.stack([cv2.GaussianBlur((kinds == i).astype(np.float32), (0, 0), SMOOTH[name]) for i, name in enumerate(NAMES)], -1)
  # lines and houses win over the areas they cross where they are clearly there
  for name, boost in (('road', 2.2), ('rail', 2.2), ('building', 2.6)):
    shares[..., NAMES.index(name)] *= boost
  shares = np.exp((shares - shares.max(-1, keepdims=True)) * 18)
  shares /= shares.sum(-1, keepdims=True)
  paint = np.array([PAINT[name] for name in NAMES], np.float32)
  out = np.empty((SIZE, SIZE, 3), np.float32)
  for y in range(0, SIZE, 512):
    out[y:y + 512] = shares[y:y + 512] @ paint
  Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(target, quality=82, method=6)


if __name__ == '__main__':
  main(sys.argv[1], sys.argv[2])
