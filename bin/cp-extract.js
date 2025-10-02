#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function usage() {
  console.error('Usage: cp-extract <srcDir,prj> [<srcDir,prj> ...]');
}

function listTxtFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.txt'))
    .map((d) => d.name)
    .sort();
}

function extractSn(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  const sn = base.split('.')[0] || base;
  return sn;
}

function sortBySnWithDashSuffix(names) {
  return names
    .map((name, idx) => {
      const sn = extractSn(name);
      const m = sn.match(/^(.*?)-(\d+)$/);
      const hasDash = !!m;
      const baseSn = hasDash ? m[1] : sn;
      const dashNum = hasDash ? parseInt(m[2], 10) : null;
      const baseNum = /^\d+$/.test(baseSn) ? parseInt(baseSn, 10) : NaN;
      return { name, idx, sn, hasDash, baseSn, baseNum, dashNum };
    })
    .sort((a, b) => {
      const aIsNum = !Number.isNaN(a.baseNum);
      const bIsNum = !Number.isNaN(b.baseNum);
      if (aIsNum && bIsNum) {
        if (a.baseNum !== b.baseNum) return a.baseNum - b.baseNum;
      } else if (aIsNum !== bIsNum) {
        // Numbers before non-numbers
        return aIsNum ? -1 : 1;
      } else {
        const c = a.baseSn.localeCompare(b.baseSn);
        if (c !== 0) return c;
      }
      // Same base; base (no -suffix) first, then by suffix integer ascending
      if (a.hasDash !== b.hasDash) return a.hasDash ? 1 : -1;
      if (a.hasDash && b.hasDash) {
        return (a.dashNum || 0) - (b.dashNum || 0);
      }
      // Stable fallback
      return a.idx - b.idx;
    })
    .map((x) => x.name);
}

function parseCpSections(lines, startIndex) {
  const results = [];
  const re = /<(\d+)>\s+([0-9]+(?:\.[0-9]+)?)\s+([^\s<]+)/g;

  let i = startIndex;
  for (; i < lines.length; i++) {
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
          throw new Error(`Malformed CP line: unexpected text between sections: '${raw}'`);
        }
      }
      const pieceIndex = m[1];
      const pieceLength = m[2];
      const pieceOD = m[3];
      results.push({ pieceIndex, pieceLength, pieceOD });
      pos = re.lastIndex;
    }
    if (!hadAny) {
      throw new Error(`Malformed CP line: could not parse any CP section: '${raw}'`);
    }
    const tail = line.slice(pos);
    // Ignore any trailing text after the last valid CP section on the line
    // Example: "<9> 586 3 CHHW-15215-3"-S1P1-C75" -> keep the section, ignore trailing
  }

  return { sections: results, endIndex: i };
}

function findPartNumbers(lines, startIndex, pieceIndexes, onMissingWarning) {
  const result = new Map();
  const content = lines.slice(startIndex).join('\n');

  // Scan for all tags like <...> where ... is whitespace/newlines and digits
  const occ = [];
  const tagRe = /<([\s\d]+)>/g; // capture digits with optional whitespace/newlines
  let m;
  while ((m = tagRe.exec(content)) !== null) {
    const rawInside = m[1];
    const digits = (rawInside.match(/\d/g) || []).join('');
    if (digits.length === 0) continue; // skip non-digit tags
    const end = m.index + m[0].length; // position right after '>'
    occ.push({ digits, end });
  }

  for (const pIdx of pieceIndexes) {
    let foundCount = 0;
    let firstPart = null;

    for (const o of occ) {
      if (o.digits !== String(pIdx)) continue;

      const after = content.slice(o.end);
      // Skip whitespace/newlines, then capture leading digits as Part No.
      const mTok = after.match(/^\s*(\d+)/);
      if (!mTok) {
        // If the very next non-whitespace token doesn't start with a digit, discard non-digit and keep scanning
        const mAny = after.match(/^\s*([^\s]+)/);
        if (mAny) {
          const token = mAny[1];
          const num = token.replace(/\D+/g, '').slice(0, 3);
          if (num.length === 0) {
            // No digits at all -> treat as missing and continue searching
            continue;
          }
          foundCount++;
          if (foundCount === 1) firstPart = num;
          if (foundCount > 1) break;
        } else {
          continue;
        }
      } else {
        const num = mTok[1].slice(0, 3); // cap to max 3 digits
        foundCount++;
        if (foundCount === 1) firstPart = num;
        if (foundCount > 1) break;
      }
    }

    if (foundCount === 0) {
      if (typeof onMissingWarning === 'function') onMissingWarning(pIdx);
      else console.warn(`Warning: Part No. not found for <${pIdx}>`);
      continue;
    }
    if (foundCount > 1) {
      throw new Error(`Multiple Part No. entries found for <${pIdx}>`);
    }
    result.set(pIdx, firstPart);
  }

  return result;
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
  const args = process.argv.slice(2);
  if (args.length === 0) {
    usage();
    process.exit(1);
  }

  // Parse pairs: <srcDir,prj>
  const pairs = [];
  for (const raw of args) {
    const idx = raw.indexOf(',');
    if (idx === -1) {
      console.error(`Error: invalid argument '${raw}'. Expected '<srcDir,prj>'.`);
      process.exit(1);
    }
    const srcDirArg = raw.slice(0, idx).trim();
    const prj = raw.slice(idx + 1).trim();
    if (!srcDirArg || !prj) {
      console.error(`Error: invalid argument '${raw}'. Both srcDir and prj are required.`);
      process.exit(1);
    }
    const srcDirAbs = path.resolve(process.cwd(), srcDirArg);
    let stat;
    try {
      stat = fs.statSync(srcDirAbs);
    } catch (e) {
      console.error(`Error: directory not found: ${srcDirAbs}`);
      process.exit(1);
    }
    if (!stat.isDirectory()) {
      console.error(`Error: not a directory: ${srcDirAbs}`);
      process.exit(1);
    }
    pairs.push({ srcDirArg, srcDirAbs, prj });
  }

  // Determine output filename
  let outputTsvName;
  if (pairs.length === 1) {
    // Per spec: "$srcDir-cp.tsv"
    outputTsvName = `${pairs[0].srcDirArg.replace(/\/+$/, '')}-cp.tsv`;
  } else {
    const names = pairs.map((p) => path.basename(p.srcDirArg.replace(/\/+$/, '')));
    outputTsvName = `999.COMBO_CP--${names.join('+')}.tsv`;
  }
  const outputTsvPath = path.resolve(process.cwd(), outputTsvName);
  const outputLogPath = `${outputTsvPath}.log`;

  const out = [];
  out.push(['流水號', '料號', '長度', '管徑', 'Part No.', 'PartID', '案號']);
  const warnings = [];

  for (const { srcDirArg, srcDirAbs, prj } of pairs) {
    const txtFiles = sortBySnWithDashSuffix(listTxtFiles(srcDirAbs));
    const total = txtFiles.length;
    if (total === 0) {
      console.log(`No TXT files found in '${srcDirArg}'. Skipping.`);
      continue;
    }

    for (let i = 0; i < txtFiles.length; i++) {
      const name = txtFiles[i];
      const base = path.basename(name, path.extname(name));
      const sn = base.split('.')[0]; // $sn from file name pattern $sn.$name.txt
      const filePath = path.join(srcDirAbs, name);

      console.log(`Processing ${i + 1}/${total}: ${name} ...`);

      const content = await fsp.readFile(filePath, 'utf8');
      const lines = content.split(/\r\n|\n|\r/);

      const start = findCpStart(lines);
      if (start < 0) {
        console.warn(`Warning: CP paragraph not found in '${name}', skipping.`);
        continue;
      }

      let sectionsWrapped;
      try {
        sectionsWrapped = parseCpSections(lines, start);
      } catch (err) {
        console.error(`Error parsing '${name}': ${err.message}`);
        process.exit(1);
      }
      const sections = sectionsWrapped.sections;
      const afterCpIndex = sectionsWrapped.endIndex;

      if (sections.length === 0) {
        console.warn(`Warning: no CP sections found in '${name}', skipping.`);
        continue;
      }

      // Collect unique piece indexes
      const pieceIndexes = Array.from(new Set(sections.map((s) => s.pieceIndex)));
      let partMap;
      try {
        partMap = findPartNumbers(
          lines,
          afterCpIndex,
          pieceIndexes,
          (pieceIdx) => {
            const msg = `Part No. not found for <${pieceIdx}> in ${name}`;
            console.warn(`Warning: ${msg}`);
            warnings.push(msg);
          }
        );
      } catch (err) {
        console.error(`Error parsing Part No. in '${name}': ${err.message}`);
        process.exit(1);
      }

      const fmtSn = (v) => v;
      const toDecimalOd = (v) => {
        let s = String(v).trim();
        s = s.replace(/"/g, '');
        if (s.includes('/') && s.includes('.')) {
          const dot = s.indexOf('.');
          const wholeStr = s.slice(0, dot);
          const fracStr = s.slice(dot + 1);
          const whole = /^\d+$/.test(wholeStr) ? parseInt(wholeStr, 10) : 0;
          const m = fracStr.match(/^(\d+)\/(\d+)$/);
          if (m) {
            const num = parseInt(m[1], 10);
            const den = parseInt(m[2], 10) || 1;
            const val = whole + num / den;
            return String(val);
          }
          // Fallback: try parsing float
          const f = Number(s);
          if (!Number.isNaN(f)) return String(f);
          return s;
        }
        if (s.includes('/')) {
          const m = s.match(/^(\d+)\/(\d+)$/);
          if (m) {
            const num = parseInt(m[1], 10);
            const den = parseInt(m[2], 10) || 1;
            return String(num / den);
          }
          const parts = s.split('/');
          if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
            const num = parseInt(parts[0], 10);
            const den = parseInt(parts[1], 10) || 1;
            return String(num / den);
          }
          return s;
        }
        if (s.includes('.')) {
          const f = Number(s);
          if (!Number.isNaN(f)) return String(f);
        }
        return s;
      };
      for (const s of sections) {
        const pno = partMap.get(s.pieceIndex) ?? 'NA';
        const partId = `${prj}--${fmtSn(sn)}--${pno}`;
        out.push([fmtSn(sn), s.pieceIndex, s.pieceLength, toDecimalOd(s.pieceOD), pno, partId, prj]);
      }
    }
  }

  // Write TSV
  const tsv = out.map((row) => row.join('\t')).join('\n') + '\n';
  await fsp.writeFile(outputTsvPath, tsv, 'utf8');
  console.log(`<OUTPUT> Wrote TSV: ${outputTsvPath}`);

  // Write warnings log (always create the log file)
  const body = warnings.length > 0 ? warnings.join('\n') + '\n' : '';
  await fsp.writeFile(outputLogPath, body, 'utf8');
  console.log(`<OUTPUT> Wrote log: ${outputLogPath}`);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
