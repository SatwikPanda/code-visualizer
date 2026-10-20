import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
export class ProcessFailure extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
export function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32")
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}
export async function processLines(
  executable: string,
  args: string[],
  options: {
    signal: AbortSignal;
    timeout?: number;
    line?: (line: string) => void;
    stderr?: (text: string) => void;
    cwd?: string;
    input?: string;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new ProcessFailure("Run cancelled", "cancelled"));
      return;
    }
    const env = { ...process.env };
    for (const key of [
      "JAVA_TOOL_OPTIONS",
      "JDK_JAVA_OPTIONS",
      "_JAVA_OPTIONS",
      "_JAVA_JDWP_OPTIONS",
      "RUNNER_SECRET",
      "CODEVIZ_DESKTOP_TOKEN",
      "CODEVIZ_DESKTOP_OWNER",
      "NODE_OPTIONS",
    ])
      delete env[key];
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "",
      errors = "",
      buffer = "",
      settled = false;
    let failure: Error | undefined;
    const stop = (error: Error) => {
      failure = error;
      killTree(child);
    };
    const abort = () =>
      stop(new ProcessFailure("Execution cancelled", "cancelled"));
    options.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () =>
        stop(
          new ProcessFailure(
            "Execution exceeded its wall-clock limit",
            "timed_out",
          ),
        ),
      options.timeout || 20000,
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > 9 * 1024 * 1024) {
        stop(
          new ProcessFailure("Process output limit reached", "trace_limited"),
        );
        return;
      }
      if (options.line) {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end).trim();
          buffer = buffer.slice(end + 1);
          if (line)
            try {
              options.line(line);
            } catch (e) {
              stop(e as Error);
            }
        }
      }
    });
    child.stderr.on("data", (chunk: string) => {
      errors = (errors + chunk).slice(-65536);
      if (options.stderr)
        try {
          options.stderr(chunk);
        } catch (e) {
          stop(e as Error);
        }
    });
    child.on("error", (e) => finish(e));
    child.on("close", (code) => {
      if (buffer.trim() && options.line)
        try {
          options.line(buffer.trim());
        } catch (e) {
          failure = e as Error;
        }
      finish(
        failure ||
          (code !== 0
            ? new ProcessFailure(
                errors || `Process exited with code ${code}`,
                "internal_error",
              )
            : undefined),
      );
    });
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(output);
    }
    child.stdin.on("error", () => {});
    child.stdin.end(options.input || "");
  });
}
export const javaExecutable = () =>
  process.env.JAVA_HOME
    ? path.join(
        process.env.JAVA_HOME,
        "bin",
        process.platform === "win32" ? "java.exe" : "java",
      )
    : "java";
