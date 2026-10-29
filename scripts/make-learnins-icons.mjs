import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const svg = readFileSync(new URL("../app/icon.svg", import.meta.url), "utf8");
const render = (width) => new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
writeFileSync(new URL("../build/learnins.png", import.meta.url), render(512));
const png = render(256);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); // icon file
header.writeUInt16LE(1, 4); // one 256px PNG image
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(header.length, 18);
writeFileSync(new URL("../build/learnins.ico", import.meta.url), Buffer.concat([header, png]));
