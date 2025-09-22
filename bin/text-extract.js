#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

function usage() {
  console.error('Usage: text-extract <srcDir>');
}

function resolveOutputDir(srcDir) {
  const trimmed = srcDir.replace(/\/+$/, '');
  return `${trimmed}-txt`;
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function listPdfFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.pdf'))
    .map((d) => d.name)
    .sort();
}

function runPdftotext(inputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('pdftotext', ['-raw', inputPath], { stdio: 'ignore' });
    child.on('error', (err) => {
      reject(err);
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pdftotext exited with code ${code}`));
    });
  });
}

async function moveFileOverwrite(src, dest) {
  try {
    await fsp.rm(dest, { force: true });
  } catch (_) {}
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if (err && (err.code === 'EXDEV' || err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'EEXIST')) {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src).catch(() => {});
      return;
    }
    throw err;
  }
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

  const outputDir = resolveOutputDir(srcDir);
  try {
    await ensureDir(outputDir);
  } catch (e) {
    console.error(`Error creating output directory '${outputDir}': ${e.message}`);
    process.exit(1);
  }

  const pdfFiles = listPdfFiles(srcDir);
  const total = pdfFiles.length;
  if (total === 0) {
    console.log('No PDF files found. Nothing to do.');
    return;
  }

  let hadError = false;
  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfName = pdfFiles[i];
    const base = path.basename(pdfName, path.extname(pdfName));
    const txtName = `${base}.txt`;
    const inputPath = path.join(srcDir, pdfName);
    const producedTxtPath = path.join(srcDir, txtName);
    const destTxtPath = path.join(outputDir, txtName);

    console.log(`Processing ${i + 1}/${total}: ${pdfName} -> ${txtName} ...`);

    try {
      await runPdftotext(inputPath);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        console.error('Error: pdftotext not found. Please install poppler-utils or xpdf tools.');
        process.exit(1);
      }
      console.error(`  Failed to extract text for '${pdfName}': ${err.message}`);
      hadError = true;
      continue;
    }

    try {
      await moveFileOverwrite(producedTxtPath, destTxtPath);
    } catch (err) {
      console.error(`  Failed to move '${txtName}' to output: ${err.message}`);
      hadError = true;
      continue;
    }
  }

  if (hadError) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
