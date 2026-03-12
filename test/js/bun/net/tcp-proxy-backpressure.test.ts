import { describe, expect, test } from "bun:test";
import net from "net";

function listen(srv: net.Server): Promise<number> {
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r((srv.address() as net.AddressInfo).port)));
}

describe("TCP proxy backpressure", () => {
  test.each([
    [4 * 1024 * 1024, 64 * 1024],
    [2 * 1024 * 1024, 16 * 1024],
    [1 * 1024 * 1024, 8 * 1024],
  ])("proxy forwards %i bytes in %i byte chunks without stalling", async (PAYLOAD, CHUNK) => {
    let serverBytes = 0;

    const server = net.createServer(s => {
      serverBytes = 0;
      s.on("data", c => {
        serverBytes += c.length;
        if (serverBytes >= PAYLOAD) {
          s.write("F");
        }
      });
      s.on("error", () => {});
    });
    const sp = await listen(server);

    let proxyToServerBytes = 0;
    const proxy = net.createServer(c => {
      const t = net.createConnection(sp, "127.0.0.1", () => {
        c.on("data", d => {
          proxyToServerBytes += d.length;
          if (!t.write(d)) c.pause();
        });
        t.on("drain", () => c.resume());
        t.on("data", d => {
          c.write(d);
        });
      });
      c.on("error", () => t.destroy());
      t.on("error", () => c.destroy());
      c.on("close", () => t.destroy());
      t.on("close", () => c.destroy());
    });
    const pp = await listen(proxy);

    const { promise, resolve, reject } = Promise.withResolvers<void>();

    const client = net.connect(pp, "127.0.0.1", () => {
      const chunk = Buffer.alloc(CHUNK, 0xab);
      let sent = 0;
      function send() {
        while (sent < PAYLOAD) {
          if (!client.write(chunk)) {
            client.once("drain", send);
            return;
          }
          sent += CHUNK;
        }
      }
      send();
    });

    client.on("data", c => {
      if (c.toString().includes("F")) {
        client.destroy();
        resolve();
      }
    });
    client.on("error", e => {
      reject(e);
    });

    await promise;
    server.close();
    proxy.close();

    expect(proxyToServerBytes).toBeGreaterThanOrEqual(PAYLOAD);
    expect(serverBytes).toBeGreaterThanOrEqual(PAYLOAD);
  });
});
