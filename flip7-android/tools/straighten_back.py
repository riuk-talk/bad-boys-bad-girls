# Straightens a photo of the card back (perspective) using the teal border. Usage: python3 straighten_back.py PHOTO OUT.png
import cv2, numpy as np, sys
src, out = sys.argv[1], sys.argv[2]
img = cv2.imread(src); H, W = img.shape[:2]
hsv = cv2.cvtColor(cv2.GaussianBlur(img, (9, 9), 0), cv2.COLOR_BGR2HSV)
teal = (hsv[:, :, 0] > 70) & (hsv[:, :, 0] < 115) & (hsv[:, :, 1] > 15)
def first(arr):
    idx = np.where(arr)[0]
    return idx[0] if len(idx) else None
L, R, T, B = [], [], [], []
for y in list(range(int(H * .07), int(H * .22), 8)) + list(range(int(H * .6), int(H * .92), 8)):
    row = teal[y]
    x = first(row[: W // 4]); 
    if x is not None: L.append((x, y))
    x = first(row[::-1][: W // 4])
    if x is not None and y > H * .5: R.append((W - 1 - x, y))  # top-right corner is washed out by glare
for x in list(range(int(W * .08), int(W * .3), 8)) + list(range(int(W * .7), int(W * .92), 8)):
    col = teal[:, x]
    y = first(col[: H // 4])
    if y is not None and x < W * .5: T.append((x, y))
    y = first(col[::-1][: H // 4])
    if y is not None: B.append((x, H - 1 - y))
def fit(p):
    p = np.float32(p)
    for _ in range(3):
        vx, vy, x0, y0 = cv2.fitLine(p, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        res = np.abs((p[:, 0] - x0) * vy - (p[:, 1] - y0) * vx)
        p = p[res < max(6, np.median(res) * 3)]
    return np.array([x0, y0]), np.array([vx, vy])
lines = [fit(T), fit(R), fit(B), fit(L)]
print([len(a) for a in (T, R, B, L)])
def cr(a, b):
    return a[0] * b[1] - a[1] * b[0]
def inter(l1, l2):
    p, r = l1; q, s = l2
    return p + cr(q - p, s) / cr(r, s) * r
c = np.float32([inter(lines[3], lines[0]), inter(lines[0], lines[1]), inter(lines[1], lines[2]), inter(lines[2], lines[3])])
print(c)
OW, OH = 1000, 1400
dst = np.float32([[0, 0], [OW - 1, 0], [OW - 1, OH - 1], [0, OH - 1]])
cv2.imwrite(out, cv2.warpPerspective(img, cv2.getPerspectiveTransform(c, dst), (OW, OH), flags=cv2.INTER_CUBIC))
