# Cuts the official logo out of the rules cover (page 10 rendered at 1200 dpi, y offset 1600). Usage: python3 extract_logo.py PAGE.png OUT.png
import cv2, numpy as np, sys
img = cv2.imread(sys.argv[1]); H, W = img.shape[:2]; out = sys.argv[2]
k = -0.2671
yy, xx = np.mgrid[0:H, 0:W]
ytop = 1161 + (xx - 200) * k          # top edge of the band's upper border line
ybot = 2830 + (xx - 200) * k + 46     # bottom edge of the band's lower border line
band = (yy >= ytop) & (yy <= ybot)
b, g, r = [img[:, :, i].astype(int) for i in range(3)]
navy = (b > 80) & (r < 100) & (g < 90) & (b - r > 35)
XMIN, XMAX = 400, 4140
inx = (xx > XMIN) & (xx < XMAX)
above = (yy < ytop) & inx
free = (~(navy | band)).astype(np.uint8)
n, lab = cv2.connectedComponents(free)
edge_labels = set(np.unique(np.concatenate([lab[0], lab[:, XMIN + 2], lab[:, XMAX - 2]]))) - {0}
outside_bg = np.isin(lab, list(edge_labels))
outer = above & ~outside_bg            # fan, top of the 7 (outlines and fills)
outer = cv2.morphologyEx(outer.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)).astype(bool)
# Extent along the band: keep every content pixel, then cut the ribbon ends perpendicular to it.
inner_lines = band & navy & (yy > ytop + 60) & (yy < ybot - 60)
content = outer | inner_lines
t = (xx + k * yy) / np.sqrt(1 + k * k)
tmin, tmax = t[content].min() - 140, t[content].max() + 140
mask = (band & (t >= tmin) & (t <= tmax)) | outer
ys, xs = np.where(mask)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
alpha = cv2.GaussianBlur(mask.astype(np.uint8) * 255, (3, 3), 0)
rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA); rgba[:, :, 3] = alpha
crop = rgba[y0:y1, x0:x1]
scale = 1400 / crop.shape[1]
cv2.imwrite(out, cv2.resize(crop, (1400, int(crop.shape[0] * scale)), interpolation=cv2.INTER_AREA))
print(crop.shape, tmin, tmax)
