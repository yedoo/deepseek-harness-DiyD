import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDirectory);
const source = path.join(projectRoot, "src", "renderer");
const destination = path.join(projectRoot, "dist", "renderer");

await mkdir(destination, { recursive: true });
await cp(source, destination, { force: true, recursive: true });
