Write a node.js app, 'text-extract' that takes an input directory ($srcDir) and extracts the text in the pdf files within $srcDir.

- Create an output directory ($outputDir) named "$srcDir-txt"
- Use 'pdftotext $inputFile.pdf' command to extract text from pdf.  The resulting file is saved as $inputFile.txt within the same directory of the source pdf file. Move it to $outputDir.
- Process all the pdf files within $srcDir. When processing, output msg:
  Processing $index/$totalNumPdfFiles: $inputFile.pdf -> $inputFile.txt ...

