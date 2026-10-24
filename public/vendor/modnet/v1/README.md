# MODNet, portrait matting (fp16 ONNX)

- Model: MODNet (Ke et al., « MODNet: Trimap-Free Portrait Matting in Real Time », AAAI 2022),
  https://github.com/ZHKKKe/MODNet — « The code, models, and demos in this repository (excluding
  GIF files under the folder doc/gif) are released under the Apache License 2.0 » (LICENSE here).
- File: `modnet-fp16.onnx` = `onnx/model_fp16.onnx` of https://huggingface.co/Xenova/modnet
  (ONNX conversion, licence apache-2.0), 12 984 781 bytes,
  SHA-256 `25f165da9bfd30830a575f1f0490f1acd995975cb349bc02f3d79332e1fe5cf6`.
- Run by onnxruntime-web (MIT) in public/workers/cutout-worker.js. Input: RGB, (x/255 − 0.5)/0.5,
  sizes divisible by 32; output: the alpha matte (0–1).
- A new file gets a new folder (`v2`…): the files of a folder never change (cached for a year).
