/**
 * RN's native XHR supports ImagePicker {uri, name, type} file parts.
 * Expo SDK 57's default fetch rejects those parts before sending the request.
 * Keep this transport limited to multipart uploads; do not replace global fetch.
 */
export type MultipartResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

export function uploadMultipart(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: FormData;
    signal: AbortSignal;
  },
): Promise<MultipartResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    function cleanUp() {
      options.signal.removeEventListener('abort', abort);
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onabort = null;
      xhr.ontimeout = null;
    }
    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      cleanUp();
      reject(error);
    }
    function abort() {
      const error = new Error('Upload aborted');
      error.name = 'AbortError';
      fail(error);
      xhr.abort();
    }
    if (options.signal.aborted) {
      abort();
      return;
    }
    xhr.onload = () => {
      if (settled) return;
      if (xhr.status === 0) {
        fail(new TypeError('Network request failed'));
        return;
      }
      const status = xhr.status;
      const responseText = xhr.responseText;
      settled = true;
      cleanUp();
      resolve({ ok: status >= 200 && status < 300, status, text: async () => responseText });
    };
    xhr.onerror = () => fail(new TypeError('Network request failed'));
    xhr.onabort = () => fail(new Error('Upload aborted'));
    xhr.ontimeout = () => fail(new Error('Upload timed out'));
    options.signal.addEventListener('abort', abort, { once: true });
    try {
      xhr.open(options.method, url);
      // RN must add the multipart boundary itself, including its Content-Type.
      for (const [name, value] of Object.entries(options.headers)) {
        if (name.toLowerCase() !== 'content-type') xhr.setRequestHeader(name, value);
      }
      xhr.send(options.body);
    } catch (error) {
      fail(error);
    }
  });
}
