export function isValidConfigResponse(response) {
  return response !== null &&
    typeof response === "object" &&
    typeof response.ok === "boolean";
}

export function sendRuntimeMessage(runtime, message) {
  return new Promise((resolve, reject) => {
    try {
      runtime.sendMessage(message, (response) => {
        if (runtime.lastError) {
          reject(new Error("Extension service-worker messaging failed."));
          return;
        }
        resolve(response);
      });
    } catch {
      reject(new Error("Extension service-worker messaging failed."));
    }
  });
}
