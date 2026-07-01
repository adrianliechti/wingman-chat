import fs from "node:fs";
import type { ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite-plus";

const src = path.resolve(import.meta.dirname, "src");

// ── Dev parity for the server's /skills and /notebooks inventory endpoints ──
// In production these are served by the Go server (pkg/server/library) from the
// runtime ./skills and ./notebook dirs. That server isn't running under
// `npm run dev`, so this plugin serves the same inventory + content locally.

// tiny frontmatter parser with mixed value types
function parseFrontmatter(text: string): Record<string, any> {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, any> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      out[key] = raw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (raw === "true" || raw === "false") {
      out[key] = raw === "true";
    } else {
      out[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

function stripFrontmatterBody(text: string): string {
  const m = text.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return m ? text.slice(m[0].length).replace(/^\n+/, "") : text;
}

function walkFiles(dir: string, match: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(p, match));
    else if (match(entry.name)) out.push(p);
  }
  return out;
}

const toRel = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");

// Mirror of the Go server's skill-resource listing (pkg/server/library): list
// every bundled file except the SKILL.md itself and hidden files (e.g. .DS_Store).
function inventorySkillResources(skillDir: string): string[] {
  if (!fs.existsSync(skillDir)) return [];
  const out: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue; // skip .DS_Store and other hidden files
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      const rel = toRel(skillDir, p);
      if (rel === "SKILL.md") continue;
      out.push(rel);
    }
  };

  walk(skillDir);
  return out.sort((a, b) => a.localeCompare(b));
}

function inventorySkills(root: string) {
  return walkFiles(root, (n) => n === "SKILL.md")
    .map((p) => {
      const fm = parseFrontmatter(fs.readFileSync(p, "utf8"));
      const r = toRel(root, p);
      const parts = r.split("/");
      return {
        name: fm.name ?? "",
        description: fm.description ?? "",
        category: parts.length > 2 ? parts[0] : "",
        path: `/skills/${r}`,
        compatibility: fm.compatibility,
        resources: inventorySkillResources(path.dirname(p)),
      };
    })
    .filter((e) => e.name)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function inventoryNotebooks(root: string) {
  return walkFiles(root, (n) => n.endsWith(".md"))
    .map((p) => ({ p, parts: toRel(root, p).split("/") }))
    .filter(({ parts }) => parts.length >= 2) // style files live under a <type>/ folder
    .map(({ p, parts }) => {
      const fm = parseFrontmatter(fs.readFileSync(p, "utf8"));
      const id = path.basename(p, ".md");
      return {
        type: parts[0],
        id,
        label: fm.label ?? id,
        description: fm.description,
        voices: fm.voices,
        default: fm.default ?? false,
        path: `/notebooks/${parts.join("/")}`,
      };
    })
    .sort(
      (a, b) => a.type.localeCompare(b.type) || Number(b.default) - Number(a.default) || a.label.localeCompare(b.label),
    );
}

function libraryDevPlugin(): Plugin {
  const SKILLS = "skills";
  const NOTEBOOK = "notebook";

  const sendFile = (res: ServerResponse, root: string, urlRel: string, strip: boolean) => {
    const clean = path.posix.normalize(`/${urlRel}`).replace(/^\/+/, "");
    const full = path.join(root, clean);
    if (
      !path.resolve(full).startsWith(path.resolve(root) + path.sep) ||
      !fs.existsSync(full) ||
      fs.statSync(full).isDirectory()
    ) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const body = fs.readFileSync(full, "utf8");
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.end(strip ? stripFrontmatterBody(body) : body);
  };

  const json = (res: ServerResponse, data: unknown) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  };

  return {
    name: "library-dev",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (url === "/skills") return json(res, inventorySkills(SKILLS));
        if (url.startsWith("/skills/")) return sendFile(res, SKILLS, decodeURIComponent(url.slice(8)), false);
        if (url === "/notebooks") return json(res, inventoryNotebooks(NOTEBOOK));
        if (url.startsWith("/notebooks/")) return sendFile(res, NOTEBOOK, decodeURIComponent(url.slice(11)), true);
        next();
      });
    },
  };
}

// ── pdf.js runtime assets ───────────────────────────────────────────────────
// pdfjs-dist v6 decodes the image formats used by *scanned* PDFs (JPEG2000 via
// openjpeg.wasm, JBIG2 via jbig2.wasm) and applies embedded ICC profiles using
// WebAssembly + data files that it fetches at runtime by exact filename, e.g.
// `${wasmUrl}openjpeg.wasm`. They must therefore be served verbatim (no content
// hashing). This plugin serves them from node_modules in dev and copies the
// folders into the build output so `/pdfjs/{wasm,iccs,cmaps,standard_fonts}/`
// resolve in production too.
function pdfjsAssetsPlugin(): Plugin {
  const dirs = ["wasm", "iccs", "cmaps", "standard_fonts"];
  const pkgRoot = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

  const copyDir = (from: string, to: string) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) copyDir(src, dst);
      else fs.copyFileSync(src, dst);
    }
  };

  let outDir = "dist";
  let isBuild = false;

  return {
    name: "pdfjs-assets",
    configResolved(config) {
      outDir = config.build.outDir;
      isBuild = config.command === "build";
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        const m = url.match(/^\/pdfjs\/([^/]+)\/(.+)$/);
        if (!m || !dirs.includes(m[1])) return next();
        const full = path.join(pkgRoot, m[1], path.posix.normalize(`/${m[2]}`).replace(/^\/+/, ""));
        if (!path.resolve(full).startsWith(path.join(pkgRoot, m[1])) || !fs.existsSync(full)) return next();
        res.end(fs.readFileSync(full));
      });
    },
    closeBundle() {
      if (!isBuild) return;
      for (const dir of dirs) {
        const from = path.join(pkgRoot, dir);
        if (fs.existsSync(from)) copyDir(from, path.resolve(outDir, "pdfjs", dir));
      }
    },
  };
}

const wingmanUrl = process.env.WINGMAN_URL?.replace(/\/$/, "") || "http://localhost:8080";
const wingmanToken = process.env.WINGMAN_TOKEN || "none";
const wingmanHeaders: Record<string, string> = { Authorization: `Bearer ${wingmanToken}` };

// In production a reverse proxy provides the user identity; in dev, set
// WINGMAN_USER to impersonate one so the chatstore endpoints work.
if (process.env.WINGMAN_USER) {
  wingmanHeaders["X-Forwarded-User"] = process.env.WINGMAN_USER;
}

// https://vite.dev/config/
export default defineConfig({
  fmt: { printWidth: 120 },
  lint: { options: { typeAware: true, typeCheck: true } },
  resolve: {
    alias: {
      "@": src,
    },
  },
  optimizeDeps: {
    exclude: ["pyodide"],
  },
  worker: {
    // Pyodide 314 (ES-module-only) requires a module worker — classic workers
    // are unsupported. 'es' overrides Vite's default 'iife' so the interpreter
    // worker is emitted as a module (and dynamic imports keep working).
    format: "es",
  },
  server: {
    proxy: {
      "/telemetry/v1": {
        target: "http://localhost:4318",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/telemetry\/v1/, "/v1"),
      },
      "/api/v1/realtime": {
        target: wingmanUrl,
        ws: true,
        changeOrigin: true,
        headers: wingmanHeaders,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/api": {
        target: wingmanUrl,
        changeOrigin: true,
        headers: wingmanHeaders,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset({ target: "19" })] }),
    tailwindcss(),
    libraryDevPlugin(),
    pdfjsAssetsPlugin(),
  ],
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" ||
          warning.message?.includes("externalized for browser compatibility") ||
          warning.message?.includes("is not exported by")
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
});
