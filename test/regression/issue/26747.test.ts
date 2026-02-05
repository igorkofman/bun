import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26747
// Server config objects with a `stop` method should still auto-start.
// The previous fix for #26142 incorrectly used the presence of a `stop` method
// to detect Server instances, but user config objects (like Elysia apps) can
// legitimately have a `stop` method.

test("server config with stop method as default export should auto-start", async () => {
  using dir = tempDir("issue-26747", {
    "server.js": `
// Export a config object with a stop method
// This should still trigger auto-start
export default {
  port: 0,
  fetch(req) {
    return new Response("Hello from server with stop method");
  },
  stop() {
    // Custom stop method - should not prevent auto-start
  },
};
`,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Set a timeout to kill the server after checking output
  const timeout = setTimeout(() => proc.kill(), 3000);

  try {
    // Wait for first bit of stdout to verify server started
    const reader = proc.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    // Decode the output
    const decoder = new TextDecoder();
    const output = decoder.decode(value);

    // Should have started the server (look for the debug message on stdout)
    expect(output).toContain("Started");
  } finally {
    clearTimeout(timeout);
    proc.kill();
    await proc.exited;
  }
});

test("server config with both stop and reload methods should not auto-start", async () => {
  // A config object with a `reload` method is likely a Server instance
  // or something that manages itself, so we should not auto-start it
  using dir = tempDir("issue-26747-reload", {
    "server.js": `
export default {
  port: 0,
  fetch(req) {
    return new Response("Hello");
  },
  stop() {},
  reload() {},
};
console.log("Script completed without auto-starting");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should NOT have started the server because it has a reload method
  expect(stdout).not.toContain("Started");
  expect(stdout).toContain("Script completed without auto-starting");
  expect(exitCode).toBe(0);
});
