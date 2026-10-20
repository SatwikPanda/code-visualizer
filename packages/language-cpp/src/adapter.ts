import path from "node:path";
import { mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { processLines, ProcessFailure } from "../../../apps/runner/src/process";
import { backend, type LanguageAdapter } from "../../language-java/src/adapter";
import type {
  Analysis,
  Diagnostic,
  InputType,
} from "../../contracts/src/index";
import { instrument, type AstNode } from "./instrument";
import { CPP_RUNTIME } from "./runtime";

export const cppManifest = {
  id: "cpp",
  displayName: "C++20",
  adapterVersion: "1.0.0",
  invocationModes: ["method", "program"],
  trace: {
    granularity: "statement",
    parameters: true,
    locals: true,
    returns: true,
    exceptions: true,
    heapPreview: true,
    conditionValues: true,
    exactBranchOutcomes: true,
  },
};
async function command(
  job: string,
  args: string[],
  signal: AbortSignal,
  options: { input?: string; stderr?: (text: string) => void } = {},
) {
  if (backend === "local")
    return processLines(process.env.CODEVIZ_CLANGXX || "clang++", args, {
      signal,
      cwd: job,
      timeout: 30000,
      ...options,
    });
  const name = `codeviz-cpp-${path.basename(job)}`;
  try {
    return await processLines(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "--name",
        name,
        "--network",
        "none",
        "--memory",
        "512m",
        "--cpus",
        "1",
        "--pids-limit",
        "64",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,nosuid,size=64m",
        "--mount",
        `type=bind,src=${job},dst=/job`,
        "--workdir",
        "/job",
        process.env.CODEVIZ_CPP_IMAGE || "codeviz-cpp:20",
        ...args,
      ],
      { signal, timeout: 45000, ...options },
    );
  } finally {
    await processLines("docker", ["rm", "-f", name], {
      signal: new AbortController().signal,
      timeout: 5000,
    }).catch(() => {});
  }
}
function diagnostics(raw: string): Diagnostic[] {
  const result: Diagnostic[] = [];
  for (const s of raw.split("\n")) {
    const m = s.match(
      /(?:Source|Ast)\.cpp:(\d+):(\d+):\s*(error|warning|fatal error):\s*(.*)/,
    );
    if (m)
      result.push({
        line: Number(m[1]),
        column: Number(m[2]),
        severity: m[3] === "warning" ? "warning" : "error",
        message: m[4],
      });
  }
  return result.length
    ? result
    : [{ line: 1, severity: "error", message: raw.slice(0, 4000) }];
}
export function cppLiteral(v: unknown, type: InputType): string {
  if (type.kind === "array")
    return `{${(v as unknown[]).map((x) => cppLiteral(x, type.element!)).join(",")}}`;
  if (type.kind === "string") return `std::string(${JSON.stringify(v)})`;
  if (type.kind === "character")
    return `'${String(v).replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t").replaceAll("\0", "\\0")}'`;
  if (type.kind === "boolean") return v ? "true" : "false";
  if (type.kind === "float" && /NaN|Infinity/.test(String(v)))
    return String(v) === "NaN"
      ? "std::numeric_limits<double>::quiet_NaN()"
      : `${String(v).startsWith("-") ? "-" : ""}std::numeric_limits<double>::infinity()`;
  if (type.kind === "integer")
    return `static_cast<${type.languageType.replace(/\bconst\b|&/g, "").trim()}>(${v}${/unsigned|size_t/.test(type.languageType) ? "ULL" : /long/.test(type.languageType) ? "LL" : ""})`;
  return String(v);
}
export const cppAdapter: LanguageAdapter = {
  manifest: cppManifest,
  async analyze(job, source, signal) {
    await mkdir(job, { recursive: true });
    if (backend === "docker") await chmod(job, 0o777);
    await writeFile(path.join(job, "Source.cpp"), source);
    const compiler = backend === "docker" ? ["clang++"] : [];
    try {
      await command(
        job,
        [
          ...compiler,
          "-std=c++20",
          "-fsyntax-only",
          "-fno-color-diagnostics",
          "Source.cpp",
        ],
        signal,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error(
          "C++20 needs clang++ on PATH. Install LLVM/Clang, or set CODEVIZ_CLANGXX to its executable.",
        );
      if (e instanceof ProcessFailure && e.code === "internal_error")
        return {
          valid: false,
          entryPoints: [],
          diagnostics: diagnostics(e.message),
          warnings: [],
          classNames: [],
          fileName: "Source.cpp",
        };
      throw e;
    }
    const includes: string[] = [];
    const masked = source.replace(/^[ \t]*#[ \t]*include[^\n]*/gm, (s) => {
      includes.push(s);
      return s.replace(/[^\r\n]/g, " ");
    });
    const prefix =
      includes.join("\n") +
      '\nnamespace __codeviz_ast_user {\n#line 1 "Source.cpp"\n';
    await writeFile(path.join(job, "Ast.cpp"), prefix + masked + "\n}\n");
    const raw = await command(
      job,
      [
        ...compiler,
        "-std=c++20",
        "-fsyntax-only",
        "-fno-color-diagnostics",
        "-Xclang",
        "-ast-dump=json",
        "-Xclang",
        "-ast-dump-filter=__codeviz_ast_user",
        "Ast.cpp",
      ],
      signal,
    );
    let result;
    try {
      result = instrument(
        source,
        JSON.parse(raw) as AstNode,
        Buffer.byteLength(prefix),
        backend === "local" && process.platform === "win32" ? 32 : 64,
      );
    } catch (e) {
      return {
        valid: false,
        entryPoints: [],
        diagnostics: [
          { severity: "error", line: 1, message: (e as Error).message },
        ],
        warnings: [],
        classNames: [],
        fileName: "Source.cpp",
      };
    }
    await writeFile(path.join(job, "instrumented.cpp"), result.source);
    return {
      valid: result.entries.some((x) => x.supported),
      entryPoints: result.entries,
      conditions: result.conditions,
      diagnostics: [],
      warnings: [],
      classNames: ["C++"],
      fileName: "Source.cpp",
      runtimeVersion: "C++20 · Clang · statement snapshots",
    };
  },
  async execute(job, analysis, entry, args, stdin, signal, emit) {
    await writeFile(
      path.join(job, "codeviz.hpp"),
      CPP_RUNTIME + "\n#include <limits>\n#include <iostream>\n",
    );
    const transformed = await readFile(
      path.join(job, "instrumented.cpp"),
      "utf8",
    );
    const variables = entry.parameters
      .map(
        (p, i) =>
          `${p.type.languageType.replace(/\bconst\b|&/g, "").trim()} __arg${i} = ${cppLiteral(args[i], p.type)};`,
      )
      .join("\n");
    const call =
      entry.mode === "program"
        ? `__codeviz_main(${entry.parameterTypes.length === 2 ? "1, cvz_argv" : ""})`
        : `${entry.methodName}(${args.map((_, i) => `__arg${i}`).join(",")})`;
    const invocation =
      entry.returnType === "void"
        ? `${call}; std::string __result=R"({"kind":"void"})";`
        : `auto __value=${call}; std::string __result=codeviz::value(__value);`;
    await writeFile(
      path.join(job, "Run.cpp"),
      `#include "codeviz.hpp"\n#line 1 "Source.cpp"\n${transformed}\nint main() { codeviz::emit(R"({"kind":"run-start"})"); try { char __name[]="program"; char* cvz_argv[]={__name,nullptr}; ${variables}\n${invocation}\ncodeviz::emit(R"({"kind":"result","outcome":"returned","value":)"+__result+"}"); } catch(const std::exception& e) { codeviz::emit(R"({"kind":"result","outcome":"threw","error":{"type":"std::exception","message":)"+codeviz::quote(e.what())+"}}"); } catch(...) { codeviz::emit(R"({"kind":"result","outcome":"threw","error":{"type":"C++ exception","message":"Uncaught exception"}})"); } }`,
    );
    const executable =
      process.platform === "win32" && backend === "local"
        ? "program.exe"
        : "program";
    await command(
      job,
      [
        ...(backend === "docker" ? ["clang++"] : []),
        "-std=c++20",
        "-O0",
        "-g",
        "-fno-color-diagnostics",
        "Run.cpp",
        "-o",
        executable,
      ],
      signal,
    );
    let stdout = "",
      stderr = "",
      failure: unknown;
    try {
      stdout =
        backend === "local"
          ? await processLines(path.join(job, executable), [], {
              signal,
              cwd: job,
              input: stdin,
              timeout: 15000,
              stderr: (s) => (stderr += s),
            })
          : await command(job, ["./program"], signal, {
              input: stdin,
              stderr: (s) => (stderr += s),
            });
    } catch (e) {
      failure = e;
    }
    const trace = await readFile(path.join(job, "trace.jsonl"), "utf8").catch(
      () => "",
    );
    for (const line of trace.split("\n")) if (line.trim()) emit(line);
    if (stdout)
      emit(JSON.stringify({ kind: "output", channel: "stdout", text: stdout }));
    if (stderr)
      emit(JSON.stringify({ kind: "output", channel: "stderr", text: stderr }));
    if (failure) throw failure;
    if (!trace.includes('"kind":"result"'))
      throw new ProcessFailure(
        "C++ program exited without a result",
        "runtime_error",
      );
  },
};
