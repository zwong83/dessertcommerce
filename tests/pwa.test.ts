import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import sharp from "sharp";
import manifest from "../frontend/app/manifest";

async function worker(fetch: typeof globalThis.fetch) {
  const handlers: Record<string, (event: any) => void> = {};
  const saved = new Map<string, Response>();
  const removed: string[] = [];
  let claimed = false;
  const cache = { put: async (key: string, response: Response) => { saved.set(key, response); },
    match: async (key: string) => saved.get(key)?.clone() };
  const context = { URL, Response, fetch, caches: { open: async () => cache,
    keys: async () => ["another-app-cache", "gather-dessert-public-offline-v0", "gather-dessert-public-offline-v1"],
    delete: async (key: string) => { removed.push(key); return true; } },
    self: { location: { origin: "https://shop.test" }, skipWaiting: async () => {},
      clients: { claim: async () => { claimed = true; } },
      addEventListener: (name: string, fn: (event: any) => void) => { handlers[name] = fn; } } };
  vm.runInNewContext(await readFile("frontend/public/sw.js", "utf8"), context);
  const lifecycle = (name: string) => new Promise<void>((resolve, reject) => {
    handlers[name]({ waitUntil: (promise: Promise<void>) => promise.then(resolve, reject) });
  });
  const request = (path: string, method = "GET", mode = "navigate") => {
    let result: Promise<Response> | undefined;
    handlers.fetch({ request: { url: new URL(path, "https://shop.test").href, method, mode },
      respondWith: (promise: Promise<Response>) => { result = promise; } });
    return result;
  };
  return { saved, removed, lifecycle, request, claimed: () => claimed };
}

test("PWA install metadata and PNG icons match the advertised dimensions", async () => {
  const app = manifest();
  assert.equal(app.display, "standalone");
  assert.equal(app.scope, "/");
  assert.equal(app.start_url, "/");
  for (const icon of app.icons ?? []) {
    const metadata = await sharp("frontend/public" + icon.src).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(`${metadata.width}x${metadata.height}`, icon.sizes);
  }
  const apple = await sharp("frontend/public/pwa/apple-touch-icon.png").metadata();
  assert.equal(apple.width, 180);
  assert.equal(apple.height, 180);
});

test("service worker caches only public fallback, never private pages or payment requests", async () => {
  let offline = false;
  const fetch = (async (request: any, options: any) => {
    if (request === "/offline.html") {
      assert.equal(options.credentials, "omit");
      return new Response("Public offline page");
    }
    if (offline) throw new TypeError("Network unavailable");
    return new Response("PRIVATE ACCOUNT DATA", { headers: { "Cache-Control": "no-store" } });
  }) as typeof globalThis.fetch;
  const sw = await worker(fetch);
  await sw.lifecycle("install");
  assert.equal(await (await sw.request("/account"))!.text(), "PRIVATE ACCOUNT DATA");
  assert.deepEqual([...sw.saved.keys()], ["/offline.html"]);
  offline = true;
  assert.equal(await (await sw.request("/account"))!.text(), "Public offline page");
  assert.equal(sw.request("/api/v1/orders"), undefined);
  assert.equal(sw.request("/api/v1/events/one/invoices/booking/pdf"), undefined);
  assert.equal(sw.request("/checkout", "POST"), undefined);
  assert.equal(sw.request("/_next/data"), undefined);
  assert.equal(sw.request("/account", "GET", "cors"), undefined);
  assert.equal(sw.request("https://another.test/"), undefined);
  await sw.lifecycle("activate");
  assert.deepEqual(sw.removed, ["gather-dessert-public-offline-v0"]);
  assert.equal(sw.claimed(), true);
});

test("offline fallback failure does not install a bad cache; HTTP errors pass through", async () => {
  const sw = await worker((async () => new Response("Unavailable", { status: 503 })) as typeof fetch);
  await assert.rejects(sw.lifecycle("install"), /Offline page unavailable/);
  assert.equal(sw.saved.size, 0);
  assert.equal((await sw.request("/account"))!.status, 503);
  const empty = await worker((async () => { throw new TypeError("Offline"); }) as typeof fetch);
  assert.equal((await empty.request("/account"))!.status, 503);
});
