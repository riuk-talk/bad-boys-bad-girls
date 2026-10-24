import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

describe("cut-out runtime (9i)", () => {
  it("the worker loads the onnxruntime-web version that is installed", () => {
    const worker = readFileSync(join(ROOT, "public/workers/cutout-worker.js"), "utf8");
    const { version } = JSON.parse(
      readFileSync(join(ROOT, "node_modules/onnxruntime-web/package.json"), "utf8"),
    ) as { version: string };
    expect(worker).toContain(`const ORT = "/vendor/onnxruntime/${version}";`);
  });

  it("the MODNet model served by the site is the fp16 file documented, Apache-2.0", () => {
    const model = readFileSync(join(ROOT, "public/vendor/modnet/v1/modnet-fp16.onnx"));
    expect(createHash("sha256").update(model).digest("hex")).toBe(
      "25f165da9bfd30830a575f1f0490f1acd995975cb349bc02f3d79332e1fe5cf6",
    );
    expect(readFileSync(join(ROOT, "public/vendor/modnet/v1/LICENSE"), "utf8")).toContain(
      "Apache License",
    );
  });

  it("never the forbidden background removers (AGPL, non-commercial)", () => {
    const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
    expect(pkg).not.toMatch(/@imgly\/background-removal|briaai|RMBG/i);
  });
});
