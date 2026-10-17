/**
 * WebGL feature detection utility for FocusLock Avatar.
 * Ensures graceful fallback when WebGL is unavailable or hardware acceleration is disabled.
 */

export type WebGLSupport = {
  supported: boolean;
  version: 1 | 2 | null;
  renderer?: string;
  errorMessage?: string;
};

export function checkWebGLSupport(): WebGLSupport {
  if (typeof window === "undefined" || !window.document) {
    return { supported: false, version: null, errorMessage: "WebGL is not available during server-side rendering." };
  }

  try {
    const canvas = document.createElement("canvas");

    // Check WebGL 2 first
    const gl2 = canvas.getContext("webgl2");
    if (gl2) {
      const debugInfo = gl2.getExtension("WEBGL_debug_renderer_info");
      const renderer = debugInfo ? gl2.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "WebGL 2 Hardware";
      return { supported: true, version: 2, renderer: String(renderer) };
    }

    // Fall back to WebGL 1
    const gl1 = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl1) {
      const debugInfo = (gl1 as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
      const renderer = debugInfo
        ? (gl1 as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : "WebGL 1 Hardware";
      return { supported: true, version: 1, renderer: String(renderer) };
    }

    return {
      supported: false,
      version: null,
      errorMessage: "WebGL is disabled or unsupported in this browser/device.",
    };
  } catch (error) {
    return {
      supported: false,
      version: null,
      errorMessage: error instanceof Error ? error.message : "Failed to initialize WebGL context.",
    };
  }
}
