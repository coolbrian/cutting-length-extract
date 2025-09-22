#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function usage() {
  console.error('Usage: cp-extract <srcDir>');
}

function listTxtFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.txt'))
    .map((d) => d.name)
    .sort();
}

function parseCpSections(lines, startIndex) {
  const results = [];
  const re = /<(\d+)>\s+([0-9]+(?:\.[0-9]+)?)\s+([^\s<]+)/g;

  for (let i = startIndex; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line.startsWith('<')) break; // end of CP groups per spec

    re.lastIndex = 0;
    let pos = 0;
    let m;
    let hadAny = false;
    while ((m = re.exec(line)) !== null) {
      hadAny = true;
      if (m.index !== pos) {
        const gap = line.slice(pos, m.index);
        if (gap.trim() !== '') {
          throw new Error(`Malformed CP line: unexpected text between sections: '${gap}' in line: '${raw}'`);
        }
      }
      const pieceIndex = m[1];
      const pieceLength = m[2];
      const pieceOD = m[3];
      results.push({ pieceIndex, pieceLength, pieceOD });
      pos = re.lastIndex;
    }
    const tail = line.slice(pos);
    if (!hadAny || tail.trim() !== '') {
      throw new Error(`Malformed CP line: could not fully parse: '${raw}'`);
    }
  }

  return results;
}

function findCpStart(lines) {
  for (let i = 0; i < lines.length - 2; i++) {
    const l1 = lines[i].trim();
    const l2 = lines[i + 1].trim();
    const l3 = lines[i + 2].trim();
    if (
      l1 === 'CUT PIPE LENGTH FOR REFERENCE ONLY' &&
      l2.startsWith('PIECE CUT N.S. REMARKS') &&
      l3.startsWith('NO LENGTH (INS)')
    ) {
      return i + 3; // CP sections start after these 3 lines
    }
  }
  return -1;
}

async function main() {
  const srcDirArg = process.argv[2];
  if (!srcDirArg) {
    usage();
    process.exit(1);
  }

  const srcDir = path.resolve(process.cwd(), srcDirArg);
  let stat;
  try {
    stat = fs.statSync(srcDir);
  } catch (e) {
    console.error(`Error: directory not found: ${srcDir}`);
    process.exit(1);
  }
  if (!stat.isDirectory()) {
    console.error(`Error: not a directory: ${srcDir}`);
    process.exit(1);
  }

  const txtFiles = listTxtFiles(srcDir);
  const total = txtFiles.length;
  if (total === 0) {
    console.log('No TXT files found. Nothing to do.');
    return;
  }

  // Output CSV named as "$srcDir.csv" relative to CWD
  const outputCsvName = `${srcDirArg.replace(/\/+$/, '')}.csv`;
  const outputCsvPath = path.resolve(process.cwd(), outputCsvName);

  const out = [];
  out.push(['流水號', '料號', '長度', '管徑']);

  for (let i = 0; i < txtFiles.length; i++) {
    const name = txtFiles[i];
    const base = path.basename(name, path.extname(name));
    const sn = base.split('.')[0]; // $sn from file name pattern $sn.$name.txt
    const filePath = path.join(srcDir, name);

    console.log(`Processing ${i + 1}/${total}: ${name} ...`);

    const content = await fsp.readFile(filePath, 'utf8');
    const lines = content.split(/\r\n|\n|\r/);

    const start = findCpStart(lines);
    if (start < 0) {
      console.error(`Error: CP paragraph not found in '${name}'`);
      process.exit(1);
    }

    let sections;
    try {
      sections = parseCpSections(lines, start);
    } catch (err) {
      console.error(`Error parsing '${name}': ${err.message}`);
      process.exit(1);
    }

    if (sections.length === 0) {
      console.error(`Error: no CP sections found in '${name}'`);
      process.exit(1);
    }

    for (const s of sections) {
      out.push([sn, s.pieceIndex, s.pieceLength, s.pieceOD]);
    }
  }

  // Write CSV
  const csv = out.map((row) => row.join(',')).join('\n') + '\n';
  await fsp.writeFile(outputCsvPath, csv, 'utf8');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});

