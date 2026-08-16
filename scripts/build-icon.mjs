import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDirectory);
const sourcePath = path.join(projectRoot, "src", "renderer", "favicon.svg");
const outputDirectory = path.join(projectRoot, "assets");
const outputPath = path.join(outputDirectory, "icon.png");

const source = (await readFile(sourcePath, "utf8"))
  .replace(/fill="#000"/g, 'fill="#fff"')
  .replace(/fill="#000000"/g, 'fill="#ffffff"');
const mark = await sharp(Buffer.from(source)).resize(350, 350).png().toBuffer();
const background = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <defs>
      <linearGradient id="b" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#315BFF"/>
        <stop offset="1" stop-color="#1837A8"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="118" fill="url(#b)"/>
  </svg>
`);

await mkdir(outputDirectory, { recursive: true });
await sharp(background)
  .composite([{ input: mark, gravity: "center" }])
  .png()
  .toFile(outputPath);
