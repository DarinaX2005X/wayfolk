"""Makes a contact sheet of world frames: python -I tests/world/sheet.py out.png a.png b.png ..."""
import sys
from PIL import Image

out, files = sys.argv[1], sys.argv[2:]
cols = 4
w, h = 400, 250
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * h), (20, 20, 20))
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((w, h))
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(out)
