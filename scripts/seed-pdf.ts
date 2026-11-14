import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { Marked } from "marked";
import { PDFDocument } from "pdf-lib";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { LiteElement } from "@mathjax/src/js/adaptors/lite/Element.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import "@mathjax/src/js/util/asyncLoad/node.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import { CourseManifestSchema } from "../src/lib/contracts";

const courseRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../seed/calc2");
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const css = `
  @page { size: Letter; margin: 0.65in 0.7in; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #20272c; font: 11pt/1.42 Georgia, "Times New Roman", serif; }
  .sheet { display: flow-root; width: 6.9in; min-height: 9.6in; position: relative; padding-bottom: 0.3in; }
  .sheet + .sheet { break-before: page; }
  h1, h2, h3 { font-family: Arial, sans-serif; line-height: 1.2; color: #183f50; }
  h1 { font-size: 22pt; margin: 0 0 10pt; border-bottom: 2pt solid #183f50; padding-bottom: 9pt; }
  h2 { font-size: 14pt; margin: 14pt 0 7pt; }
  h3 { font-size: 11pt; margin: 10pt 0 5pt; }
  p { margin: 7pt 0; } li { margin: 4pt 0; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 12pt 0; }
  th, td { text-align: left; padding: 6pt; border-bottom: 0.6pt solid #bdcbd1; }
  th { background: #edf3f5; font-family: Arial, sans-serif; }
  mjx-container[display="true"] { margin: 10pt 0 !important; }
  mjx-container svg { overflow: visible; }
  .triangle { display: block; width: 3.5in; height: 1.28in; margin: 3pt auto; }
  .triangle text { font: 15px Arial, sans-serif; }
  footer { position: absolute; bottom: 0; width: 100%; border-top: 0.5pt solid #bdcbd1;
    padding-top: 5pt; font: 8pt Arial, sans-serif; color: #53646d; }
`;

async function main() {
  // Only manifest PDFs are built. answers.md and maintenance files never enter this path.
  const manifest = CourseManifestSchema.parse(JSON.parse(await readFile(resolve(courseRoot, "manifest.json"), "utf8")));
  const adaptor = liteAdaptor({ fontSize: 11 * 96 / 72 });
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: ["base", "ams"], formatError: (_jax: unknown, error: unknown) => { throw error; } });
  const svg = new SVG({ fontCache: "none" });
  const math = mathjax.document("", { InputJax: tex, OutputJax: svg });
  const markdown = new Marked({ gfm: true });
  const browser = await chromium.launch();
  const report: Array<{ path: string; sourceSha256: string; pdfSha256: string; pages: number; bytes: number }> = [];
  try {
    const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
    // SVG paths and system fonts are local. An accidental external asset must fail the build.
    await page.route("**/*", (route) => route.abort());
    await page.emulateMedia({ media: "print" });
    for (const file of manifest.files) {
      if (!file.path.startsWith("pdf/") || !file.path.endsWith(".pdf")) throw new Error(`Not a seed PDF: ${file.path}`);
      const sourcePath = file.path.slice(4, -4) + ".md";
      const source = await readFile(resolve(courseRoot, sourcePath), "utf8");
      const sheets = source.split(/<!--\s*pagebreak\s*-->/);
      const rendered: string[] = [];
      for (const [index, sheet] of sheets.entries()) {
        const equations: string[] = [];
        // Protect TeX from Markdown's backslash escaping, then replace it with local SVG.
        const protectedText = sheet.replace(/\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g, (_raw, block: string | undefined, inline: string | undefined) => {
          equations.push(block ?? inline ?? "");
          return `SEEDMATH${equations.length - 1}${block === undefined ? "INLINE" : "BLOCK"}TOKEN`;
        });
        if (protectedText.includes("$")) throw new Error(`Unmatched math delimiter in ${sourcePath}`);
        let html = await markdown.parse(protectedText);
        for (const [number, equation] of equations.entries()) {
          const token = new RegExp(`SEEDMATH${number}(INLINE|BLOCK)TOKEN`);
          const display = token.exec(html)?.[1] === "BLOCK";
          const node = await math.convertPromise(equation, { display, em: 11 * 96 / 72, ex: 7, containerWidth: 662.4 });
          if (!(node instanceof LiteElement)) throw new Error(`MathJax did not produce SVG HTML: ${equation}`);
          const output = adaptor.outerHTML(node);
          if (/data-mjx-error|data-mjx-unknown|<merror/.test(output)) throw new Error(`Invalid math in ${sourcePath}: ${equation}`);
          html = html.replace(token, () => output);
        }
        rendered.push(`<section class="sheet">${html}<footer>CALC2 · Synthetic course · ${index + 1} / ${sheets.length}</footer></section>`);
      }
      const style = svg.styleSheet(math);
      if (!(style instanceof LiteElement)) throw new Error("MathJax stylesheet missing");
      const mathCss = adaptor.cssText(style);
      await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${file.title}</title><style>${css}\n${mathCss}</style></head><body>${rendered.join("\n")}</body></html>`);
      await page.evaluate(() => document.fonts.ready);
      const defects = await page.evaluate(() => {
        const errors: string[] = [];
        for (const [index, sheet] of Array.from(document.querySelectorAll<HTMLElement>(".sheet")).entries()) {
          const bounds = sheet.getBoundingClientRect();
          const footerTop = sheet.querySelector("footer")!.getBoundingClientRect().top;
          if (bounds.height > 9.6 * 96 + 1) errors.push(`page ${index + 1} exceeds print height`);
          for (const child of sheet.querySelectorAll("h1,h2,h3,p,table,ol,ul,mjx-container,svg.triangle")) {
            const rect = child.getBoundingClientRect();
            if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.bottom > footerTop - 3) {
              errors.push(`page ${index + 1} overflow: ${child.textContent?.slice(0, 65)}`);
            }
          }
        }
        return errors;
      });
      if (defects.length) throw new Error(`${sourcePath}: ${defects.join("; ")}`);
      const bytes = await page.pdf({ format: "Letter", preferCSSPageSize: true, printBackground: true });
      const pdf = await PDFDocument.load(bytes);
      const pages = pdf.getPageCount();
      if (pages !== sheets.length || pages >= 10 || bytes.length >= 4_000_000) throw new Error(`PDF bounds failed: ${file.path}, ${pages} pages, ${bytes.length} bytes`);
      const target = resolve(courseRoot, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      report.push({ path: file.path, sourceSha256: sha256(source), pdfSha256: sha256(bytes), pages, bytes: bytes.length });
      console.log(`${file.path}: ${pages} pages, ${bytes.length} bytes`);
    }
    await writeFile(resolve(courseRoot, "pdf-build.json"), JSON.stringify({
      generatorSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
      chromium: browser.version(), files: report,
    }, null, 2) + "\n");
    console.log(`Built ${manifest.files.length} student PDFs; answers.md excluded.`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
