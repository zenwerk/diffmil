// Patterns matched against the file basename (case-insensitive).
const BASENAME_EXACT = new Set([
  // Lock files
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "go.sum",
  "cargo.lock",
  "poetry.lock",
  "pdm.lock",
  "pipfile.lock",
  "composer.lock",
  "gemfile.lock",
  "podfile.lock",
  "packages.lock.json",
  "mix.lock",
  "flake.lock",
  // OS / IDE noise
  ".ds_store",
  "thumbs.db",
]);

// Patterns matched as suffix on the basename (case-insensitive).
const SUFFIX_PATTERNS: string[] = [
  // Generated code
  ".pb.go",
  ".pb.cc",
  ".pb.h",
  ".pb.py",
  "_pb2.py",
  "_pb2_grpc.py",
  ".generated.ts",
  ".generated.tsx",
  ".generated.js",
  ".generated.dart",
  ".generated.cs",
  ".gen.go",
  ".gen.ts",
  ".gen.dart",
  ".g.dart",
  ".freezed.dart",
  ".designer.cs",
  ".g.cs",
  ".g.i.cs",
  // Minified bundles / source maps
  ".min.js",
  ".min.css",
  ".min.mjs",
  ".bundle.js",
  ".js.map",
  ".css.map",
  ".mjs.map",
  // Unity / Unreal noise
  ".meta",
  ".asset",
  ".unity",
  ".prefab",
  ".mat",
  ".controller",
  ".anim",
  ".shadergraph",
  ".shadersubgraph",
  ".shadervariants",
  ".vfx",
  ".vfxoperator",
  ".lighting",
  ".terrainlayer",
  ".physicmaterial",
  ".physicsmaterial2d",
  ".uasset",
  ".umap",
  // Xcode / iOS
  ".pbxproj",
  ".xcuserstate",
  ".xcsettings",
  ".storyboardc",
  // Snapshots
  ".snap",
  // Misc binary/data
  ".lockb",
];

// Substring patterns matched against the full path (case-insensitive).
const PATH_SUBSTRINGS: string[] = [
  "/node_modules/",
  "/vendor/",
  "/.next/",
  "/.nuxt/",
  "/dist/",
  "/build/",
  "/__generated__/",
  "/generated/",
  "/.terraform/",
];

const HEADER_REGEX = /^[a-z0-9_-]+\.(?:lock|sum|toml)$/i;

export function isAutoFoldPath(path: string): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  const slash = lower.lastIndexOf("/");
  const basename = slash >= 0 ? lower.slice(slash + 1) : lower;

  if (BASENAME_EXACT.has(basename)) return true;
  for (const suf of SUFFIX_PATTERNS) {
    if (basename.endsWith(suf)) return true;
  }
  for (const sub of PATH_SUBSTRINGS) {
    if (lower.includes(sub)) return true;
  }
  // Specific filename patterns
  if (basename === "go.work.sum") return true;
  if (HEADER_REGEX.test(basename) && basename.endsWith(".lock")) return true;
  return false;
}
