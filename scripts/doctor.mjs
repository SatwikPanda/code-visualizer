import { spawnSync } from "node:child_process";
for (const [cmd, args] of [
  ["node", ["--version"]],
  ["java", ["-version"]],
  ["javac", ["-version"]],
  ["docker", ["info", "--format", "{{.ServerVersion}}"]],
]) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  console.log(
    `${cmd}: ${result.error ? result.error.message : (result.stdout + result.stderr).trim()}`,
  );
}
console.log(
  "Docker mode: build the image with npm run build:sandbox-images. Local trusted-code development: npm run dev:local.",
);
