#!/usr/bin/env python3
"""Flatten a meeting transcriber's .docx export into the bench's reference
format: one paragraph per line, alternating "<speaker> HH:MM:SS" and what was
said (as the export already lays it out). Standard library only.

    python3 eval/meeting-bench/docx_to_reference.py in.docx out.txt
"""
import html
import re
import sys
import zipfile


def paragraphs(docx_path):
    xml = zipfile.ZipFile(docx_path).read("word/document.xml").decode("utf8")
    for para in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
        text = html.unescape("".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", para, flags=re.S)))
        if text.strip():
            yield text.strip()


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    lines = list(paragraphs(src))
    with open(dst, "w", encoding="utf8") as out:
        out.write("\n".join(lines) + "\n")
    heads = sum(1 for line in lines if re.match(r"^\S+\s+\d\d:\d\d:\d\d$", line))
    print(f"{len(lines)} lines, {heads} speaker/time headers -> {dst}")
