/**
 * Edge quality of a cut-out (9i), pure and testable: the alpha matte from the model (MODNet, or
 * the MediaPipe mask as a fallback) is brought to the size of the photo, refined against the photo
 * itself (guided filter: the strands of hair follow the picture), softened by a pixel or two,
 * faded where the person touches the side or the bottom of the original picture (no straight cut
 * on the wall), and the colour of the old background is taken out of the semi-transparent edge
 * (decontamination). Alpha values are 0–1, images are RGBA bytes.
 */

/** Bilinear resize of a single-channel matte. */
export function resizeMatte(
  source: ArrayLike<number>,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Float32Array {
  const out = new Float32Array(width * height);
  const sx = sourceWidth / width;
  const sy = sourceHeight / height;
  for (let y = 0; y < height; y += 1) {
    const fy = Math.min(sourceHeight - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x += 1) {
      const fx = Math.min(sourceWidth - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const wx = fx - x0;
      const top =
        (source[y0 * sourceWidth + x0] ?? 0) * (1 - wx) + (source[y0 * sourceWidth + x1] ?? 0) * wx;
      const bottom =
        (source[y1 * sourceWidth + x0] ?? 0) * (1 - wx) + (source[y1 * sourceWidth + x1] ?? 0) * wx;
      out[y * width + x] = top * (1 - wy) + bottom * wy;
    }
  }
  return out;
}

/** Mean over a (2r+1)² box, clamped at the borders, in O(n) (summed-area table). */
export function boxMean(source: Float32Array, width: number, height: number, radius: number) {
  const stride = width + 1;
  const table = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += source[y * width + x] ?? 0;
      table[(y + 1) * stride + x + 1] = (table[y * stride + x + 1] ?? 0) + row;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const sum =
        (table[bottom * stride + right] ?? 0) -
        (table[top * stride + right] ?? 0) -
        (table[bottom * stride + left] ?? 0) +
        (table[top * stride + left] ?? 0);
      out[y * width + x] = sum / ((bottom - top) * (right - left));
    }
  }
  return out;
}

/** Luminance (0–1) of RGBA bytes: the guide of the filter. */
export function luminance(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    out[i] =
      (0.299 * (rgba[i * 4] ?? 0) +
        0.587 * (rgba[i * 4 + 1] ?? 0) +
        0.114 * (rgba[i * 4 + 2] ?? 0)) /
      255;
  }
  return out;
}

/**
 * Guided filter (He, Sun, Tang, 2010) of the matte `input` by the grey `guide`: the edge of the
 * matte snaps to the edges of the picture (hair, ears) while flat areas stay flat.
 */
export function guidedFilter(
  guide: Float32Array,
  input: Float32Array,
  width: number,
  height: number,
  radius: number,
  epsilon: number,
): Float32Array {
  const n = width * height;
  const product = new Float32Array(n);
  const square = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const g = guide[i] ?? 0;
    product[i] = g * (input[i] ?? 0);
    square[i] = g * g;
  }
  const meanGuide = boxMean(guide, width, height, radius);
  const meanInput = boxMean(input, width, height, radius);
  const meanProduct = boxMean(product, width, height, radius);
  const meanSquare = boxMean(square, width, height, radius);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const mg = meanGuide[i] ?? 0;
    const mi = meanInput[i] ?? 0;
    const covariance = (meanProduct[i] ?? 0) - mg * mi;
    const variance = (meanSquare[i] ?? 0) - mg * mg;
    a[i] = covariance / (variance + epsilon);
    b[i] = mi - (a[i] ?? 0) * mg;
  }
  const meanA = boxMean(a, width, height, radius);
  const meanB = boxMean(b, width, height, radius);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = Math.min(1, Math.max(0, (meanA[i] ?? 0) * (guide[i] ?? 0) + (meanB[i] ?? 0)));
  }
  return out;
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export type TouchedEdges = { left: boolean; right: boolean; bottom: boolean };

/** Share of a side's length the person must cover there to count as touching it. */
const TOUCH_SHARE = 0.01;

/**
 * Where the person reaches the left, right or bottom border of the original picture, that side
 * fades out (`share` of the width or the height, 12 % by default, smoothly): the stored cut-out
 * then has no straight cut. The top is left alone (the head never needs it). In place; returns
 * which sides were faded.
 */
export function fadeTouchingEdges(
  alpha: Float32Array,
  width: number,
  height: number,
  share = 0.12,
): TouchedEdges {
  let left = 0;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    if ((alpha[y * width] ?? 0) > 0.5) left += 1;
    if ((alpha[y * width + width - 1] ?? 0) > 0.5) right += 1;
  }
  for (let x = 0; x < width; x += 1) if ((alpha[(height - 1) * width + x] ?? 0) > 0.5) bottom += 1;
  const touched = {
    left: left > height * TOUCH_SHARE,
    right: right > height * TOUCH_SHARE,
    bottom: bottom > width * TOUCH_SHARE,
  };
  const rampX = Math.max(1, Math.round(width * share));
  const rampY = Math.max(1, Math.round(height * share));
  for (let y = 0; y < height; y += 1) {
    const fromBottom = height - 1 - y;
    const vertical = touched.bottom && fromBottom < rampY ? smoothstep(fromBottom / rampY) : 1;
    for (let x = 0; x < width; x += 1) {
      let factor = vertical;
      if (touched.left && x < rampX) factor *= smoothstep(x / rampX);
      const fromRight = width - 1 - x;
      if (touched.right && fromRight < rampX) factor *= smoothstep(fromRight / rampX);
      if (factor < 1) alpha[y * width + x] = (alpha[y * width + x] ?? 0) * factor;
    }
  }
  return touched;
}

/**
 * Takes the colour of the old background out of the semi-transparent edge: the background behind
 * each edge pixel is estimated from the nearby background (blurred, weighted by 1 − alpha), and
 * the foreground colour solved from I = αF + (1 − α)B. In place on the RGB bytes.
 */
export function decontaminate(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
  radius = 16,
): void {
  const n = width * height;
  const weight = new Float32Array(n);
  const channels = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i += 1) {
    const w = 1 - (alpha[i] ?? 0);
    weight[i] = w;
    channels.forEach((channel, c) => {
      channel[i] = (rgba[i * 4 + c] ?? 0) * w;
    });
  }
  const meanWeight = boxMean(weight, width, height, radius);
  const background = channels.map((channel) => boxMean(channel, width, height, radius));
  for (let i = 0; i < n; i += 1) {
    const a = alpha[i] ?? 0;
    // Almost transparent pixels are left as they are: barely visible, and too noisy to solve.
    if (a < 0.1 || a >= 0.99) continue;
    const mw = meanWeight[i] ?? 0;
    if (mw < 1e-3) continue;
    for (let c = 0; c < 3; c += 1) {
      const b = (background[c]?.[i] ?? 0) / mw;
      const observed = rgba[i * 4 + c] ?? 0;
      // A floor on α keeps the solution steady where the edge is almost transparent.
      rgba[i * 4 + c] = Math.round((observed - (1 - a) * b) / Math.max(a, 0.15));
    }
  }
}

/**
 * The whole edge treatment, from the model's matte to the alpha of the photo (`rgba`, written in
 * place): resized, guided by the photo, softened (1 to 2 px), faded at the borders it touches,
 * and the edge colours cleaned.
 */
export function refineCutout(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  matte: ArrayLike<number>,
  matteWidth: number,
  matteHeight: number,
): TouchedEdges {
  const resized = resizeMatte(matte, matteWidth, matteHeight, width, height);
  const scale = Math.max(width, height) / 1200;
  const guided = guidedFilter(
    luminance(rgba, width, height),
    resized,
    width,
    height,
    Math.max(2, Math.round(8 * scale)),
    1e-3,
  );
  const alpha = boxMean(guided, width, height, 1);
  // The colours are cleaned with the real coverage of the person, before the borders fade (the
  // fade is a look, not a coverage: dividing by it would amplify the noise).
  decontaminate(rgba, alpha, width, height, Math.max(4, Math.round(16 * scale)));
  const touched = fadeTouchingEdges(alpha, width, height);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, alpha[i] ?? 0)) * 255);
  }
  return touched;
}
