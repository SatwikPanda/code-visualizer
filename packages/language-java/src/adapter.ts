import path from "node:path";
import { writeFile, mkdir, chmod } from "node:fs/promises";
import { processLines, javaExecutable } from "../../../apps/runner/src/process";
import type { Analysis, EntryPoint } from "../../contracts/src/index";

export const javaManifest = {
  id: "java",
  displayName: "Java",
  adapterVersion: "1.0.0",
  invocationModes: ["method", "program"],
  trace: {
    granularity: "line",
    parameters: true,
    locals: true,
    returns: true,
    exceptions: true,
    heapPreview: true,
    conditionValues: true,
    exactBranchOutcomes: false,
  },
};
export interface LanguageAdapter {
  manifest: Omit<typeof javaManifest, "trace"> & { trace: Record<string, boolean | string> };
  analyze(
    job: string,
    source: string,
    signal: AbortSignal,
  ): Promise<Partial<Analysis>>;
  execute(
    job: string,
    analysis: Analysis,
    entry: EntryPoint,
    args: unknown[],
    stdin: string,
    signal: AbortSignal,
    emit: (line: string) => void,
  ): Promise<void>;
}
export const backend =
  process.env.CODEVIZ_BACKEND === "local" ? "local" : "docker";
const toolClasses = path.resolve(process.env.CODEVIZ_JAVA_CLASSES || ".data/java");
let imageId: string | undefined;
async function docker(
  args: string[],
  signal: AbortSignal,
  line?: (line: string) => void,
) {
  return processLines("docker", args, { signal, line, timeout: 45000 });
}
async function image(signal: AbortSignal) {
  if (!imageId) {
    const id = await docker(
      [
        "image",
        "inspect",
        process.env.CODEVIZ_IMAGE || "codeviz-java:21",
        "--format",
        "{{.Id}}",
      ],
      signal,
    );
    imageId = id.trim();
  }
  return imageId;
}
function profile(name: string, job: string, readOnly: boolean) {
  return [
    "--name",
    name,
    "--label",
    "codeviz.managed=true",
    "--memory",
    "512m",
    "--cpus",
    "1",
    "--pids-limit",
    "128",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--mount",
    `type=bind,src=${job},dst=/job${readOnly ? ",readonly" : ""}`,
  ];
}
async function cleanup(names: string[]) {
  for (const name of names)
    await processLines("docker", ["rm", "-f", name], {
      signal: new AbortController().signal,
      timeout: 5000,
    }).catch(() => {});
}
export const javaAdapter: LanguageAdapter = {
  manifest: javaManifest,
  async analyze(job, source, signal) {
    await mkdir(job, { recursive: true });
    if (backend === "docker") await chmod(job, 0o777);
    await writeFile(path.join(job, "Source.java"), source);
    let raw: string;
    if (backend === "local")
      raw = await processLines(
        javaExecutable(),
        [
          "--add-modules",
          "jdk.compiler",
          "-Xmx256m",
          "-cp",
          toolClasses,
          "codeviz.Analyzer",
          job,
        ],
        { signal, timeout: 15000 },
      );
    else {
      const name = `codeviz-compile-${path.basename(job)}`;
      try {
        raw = await docker(
          [
            "run",
            "--rm",
            "--network",
            "none",
            ...profile(name, job, false),
            await image(signal),
            "java",
            "--add-modules",
            "jdk.compiler",
            "-Xmx256m",
            "-cp",
            "/opt/codeviz",
            "codeviz.Analyzer",
            "/job",
          ],
          signal,
        );
      } finally {
        await cleanup([name]);
      }
    }
    return JSON.parse(raw);
  },
  async execute(job, analysis, entry, args, stdin, signal, emit) {
    await writeFile(
      path.join(job, "invocation.json"),
      JSON.stringify({ entry, classNames: analysis.classNames, args, stdin }),
    );
    if (backend === "local") {
      await processLines(
        javaExecutable(),
        [
          "--add-modules",
          "jdk.jdi",
          "-Xmx256m",
          "-cp",
          toolClasses,
          "codeviz.Tracer",
          job,
        ],
        { signal, line: emit, timeout: 20000 },
      );
      return;
    }
    const target = `codeviz-target-${path.basename(job)}`,
      tracer = `codeviz-tracer-${path.basename(job)}`;
    try {
      const pinned = await image(signal);
      await docker(
        [
          "run",
          "-d",
          "--network",
          "none",
          ...profile(target, job, true),
          pinned,
          "java",
          "-Xmx128m",
          "-Dfile.encoding=UTF-8",
          "-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:5005,timeout=5000,quiet=y",
          "-cp",
          "/opt/codeviz:/job/classes",
          "codeviz.Harness",
          "/job/invocation.json",
        ],
        signal,
      );
      await docker(
        [
          "run",
          "--rm",
          "--network",
          `container:${target}`,
          ...profile(tracer, job, true),
          pinned,
          "java",
          "--add-modules",
          "jdk.jdi",
          "-Xmx256m",
          "-cp",
          "/opt/codeviz",
          "codeviz.Tracer",
          "/job",
          "5005",
        ],
        signal,
        emit,
      );
      const logs = await processLines("docker", ["logs", target], {
        signal,
        timeout: 5000,
        stderr: (text) =>
          emit(JSON.stringify({ kind: "output", channel: "stderr", text })),
      });
      if (logs)
        emit(JSON.stringify({ kind: "output", channel: "stdout", text: logs }));
    } finally {
      await cleanup([tracer, target]);
    }
  },
};
