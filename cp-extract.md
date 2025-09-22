Write a node.js app, 'cp-extract', that takes an input directory ($srcDir), and parses the text in each txt file to a single CSV file.

- The output CSV file is named as "$srcDir.csv".
- $srcDir contains a list of txt files, each named in the pattern: $sn.$name.txt.
- The text in interest in txt file has the pattern described in the "CP Text Pattern" section below.
- The headers in the CSV:
  "流水號","料號","長度","管徑"
- Entries in the CSV file are in the following format:
  $sn,$pieceIndex,$pieceLength,$pieceOD
- When processing, output msg:
  Processing $index/$totalNumberOfTxtFiles: $txtFile ...

CP Text Pattern
=======================
Starting with the CP paragraph, starting with the following three lines:
1. CUT PIPE LENGTH FOR REFERENCE ONLY
2. PIECE CUT N.S. REMARKS
3. NO LENGTH (INS)
Line 1 should be an exact match.
Line 2 and 3 should start with the strings mentioned.

Followed by one or more CP sections:
<$pieceIndex> $pieceLength $pieceOD

Multiple CP sections in a line:
<$pieceIndex> $pieceLength $pieceOD <$pieceIndex> $pieceLength $pieceOD

- $pieceIndex is enclosed by '<>'. If not, output the error and abort.
- The three parts in a CP section always come together and in the order of the sample CP section above.  CP sections may be repeated multiple times within the same line.
  If the sections are not structured as described, output the error and abort.
- After finding the start of CP paragraph, if a line does not start with '<', treat it as the end of CP groups and we can process the next file.


