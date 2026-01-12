import path from "node:path";
import pkg from "../package.json";

const sha = await fetch(
  "https://api.github.com/repos/Effect-TS/effect-smol/commits/main",
)
  .then((res) => res.json() as Promise<{ sha: string }>)
  .then((data) => data.sha.slice(0, 7));

const url = (pkg: string) =>
  `https://pkg.pr.new/Effect-TS/effect-smol/${pkg}@${sha}`;

const keys = <T extends Record<string, any>>(obj: T) =>
  Object.keys(obj) as (keyof T)[];

const isEffectPackage = (key: string) =>
  (key === "effect" || key.startsWith("@effect/")) &&
  key !== "@effect/language-service";

for (const key of keys(pkg.peerDependencies)) {
  if (isEffectPackage(key)) {
    pkg.peerDependencies[key] = url(key);
  }
}
for (const key of keys(pkg.devDependencies)) {
  if (isEffectPackage(key)) {
    pkg.devDependencies[key] = url(key);
  }
}

await Bun.write(
  path.join(__dirname, "../package.json"),
  `${JSON.stringify(pkg, null, 2)}\n`,
);
