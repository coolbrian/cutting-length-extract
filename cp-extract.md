Write a node.js app, 'cp-extract', that takes an input directory ($srcDir), along with a remark string ($remark) and parses the text in each txt file to a single TSV file.

- The output TSV file ($outTsv) is named as "$srcDir-cp.tsv".
- $srcDir contains a list of txt files, each named in the pattern: $sn.$name.txt.
- Sort the txt files based on $sn. Treat $sn as integer.  If $sn contains '-$integer', put it after $sn.
- The text in interest in txt file has the pattern described in the "CP Text Pattern" section below.
- The headers in the TSV:
  "流水號","料號","長度","管徑","Part No.","Remark"
- Entries in the TSV file are in the following format:
  $sn,$pieceIndex,$pieceLength,$pieceOD,$partNo,$remark
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
- After finding the start of CP paragraph, if a line does not start with '<', treat it as the end of CP groups and proceed with processing the part number.

Piece Number vs Part No.
==========================
After finding all the CP sections, a list of $pieceIndex is kept.
Please note that the lines in interest is AFTER the end of CP group.
Go through all the $pieceIndex:
For <$pieceIndex>, find "<$pieceIndex>". The following text is $partNo.
$partNo may be right after '>' or ' ' or in the next line.  $partNo must be an integer. If not, throw and error and abort.

If any "<$pieceIndex>$partNo" combo is not found for a $pieceIndex, report the error and abort.
After finding a matching combo, go through all the remaining lines and try to find the next match.
If a second matched combo is found, report the error and abort.

If $partNo is not found for a $pieceIndex, issue a warning about it and keep the warnings in log ($srcDir-cp.tsv.log).

There are some quirky "<$pieceIndex>$partNo" patterns. Handle these cases as well.
Quirky Pattern #1
-----------------
<
5
>
1
-----------------
  * The above pattern shall be parsed as : <5>1
    -> $pieceIndex=5 $partNo=1

Quirky Pattern #2
-----------------
<
1
0
>
1
-----------------
  * The above pattern shall be parsed as : <10>1
    -> $pieceIndex=10 $partNo=1
  * Try to find the enclosing '>' for the $partNo. Max of 3-digit $partNo is allowed.

Please note that $partNo is always an integer.  If a non-digit is found during $partNo detection, discard it.
