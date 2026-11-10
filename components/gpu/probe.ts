/// <reference types="@webgpu/types" />
// Whether WebGPU can actually draw to a canvas here. Some adapters (software
// renderers, blocklisted drivers) hand out a device but fail at present
// time; those visitors get the WebGL2 or 2D path instead. Checked once.
let result: Promise<boolean> | undefined;

export function canPresentWebGPU(): Promise<boolean> {
  result ??= (async () => {
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) return false;
      const device = await adapter.requestDevice();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 4;
      const ctx = canvas.getContext("webgpu");
      if (!ctx) return false;
      device.pushErrorScope("validation");
      ctx.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: "premultiplied" });
      const enc = device.createCommandEncoder();
      enc
        .beginRenderPass({
          colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store" }],
        })
        .end();
      device.queue.submit([enc.finish()]);
      const error = await device.popErrorScope();
      device.destroy();
      return !error;
    } catch {
      return false;
    }
  })();
  return result;
}
