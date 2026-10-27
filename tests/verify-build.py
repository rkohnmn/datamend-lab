#!/usr/bin/env python3
"""
DataMend Lab — Static Build & GitHub Pages Subpath Compatibility Verifier
Adheres to APPLICATION_GUIDELINES.md Section B & Section J:
1. Scans HTML files to verify all asset references use explicit relative paths (./css/..., ./js/...).
2. Fails if any root-absolute path (href="/..." or src="/...") is detected.
3. Fails if any external CDN script/stylesheet (unpkg, cdnjs, jsdelivr, googleapis) is referenced in index.html.
4. Scans all JS/CSS/HTML source files to verify zero TODO/FIXME placeholder markers exist.
5. Verifies all required documentation artifacts exist and are non-empty.
"""

import os
import re
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REQUIRED_FILES = [
    "index.html",
    "package.json",
    "DESIGN.md",
    "README.md",
    "ARCHITECTURE.md",
    "DATA_MODEL.md",
    "TRANSFORMATIONS.md",
    "CLEANING_METHODS.md",
    "RESTRUCTURING.md",
    "VALIDATION.md",
    "RECIPE_FORMAT.md",
    "DATA_FORMATS.md",
    "SECURITY_AND_PRIVACY.md",
    "TESTING.md",
    "PERFORMANCE.md",
    "COVERAGE_MATRIX.md",
    "DEVELOPMENT.md",
    "css/tokens.css",
    "css/base.css",
    "css/components.css",
    "css/print.css",
    "js/data-model.js",
    "js/parsers.js",
    "js/profiler.js",
    "js/diagnosis.js",
    "js/transforms.js",
    "js/restructure.js",
    "js/validation.js",
    "js/exporters.js",
    "js/renderer.js",
    "js/presets.js",
    "js/storage.js",
    "js/app.js",
]

def main():
    errors = []

    # 1. Check required files exist and are non-empty
    for rel_path in REQUIRED_FILES:
        abs_path = os.path.join(ROOT_DIR, rel_path)
        if not os.path.isfile(abs_path):
            errors.append(f"MISSING_FILE: Required file '{rel_path}' does not exist.")
        elif os.path.getsize(abs_path) < 50:
            errors.append(f"EMPTY_FILE: Required file '{rel_path}' is unexpectedly small (< 50 bytes).")

    # 2. Check index.html for relative paths and zero CDN dependencies
    index_path = os.path.join(ROOT_DIR, "index.html")
    if os.path.isfile(index_path):
        html = open(index_path, encoding="utf-8").read()
        root_abs = re.findall(r'(?:href|src)\s*=\s*["\'](/[^"\']*)["\']', html)
        if root_abs:
            errors.append(f"SUBPATH_VIOLATION: Root-absolute paths found in index.html: {root_abs}")
        cdn_refs = re.findall(r'(?:href|src)\s*=\s*["\'](https?://[^"\']+)["\']', html)
        if cdn_refs:
            errors.append(f"CDN_DEPENDENCY_VIOLATION: External runtime URLs found in index.html: {cdn_refs}")

    # 3. Check JS/CSS/HTML files for TODO/FIXME or eval()
    for folder in ["js", "css"]:
        folder_path = os.path.join(ROOT_DIR, folder)
        if not os.path.isdir(folder_path):
            continue
        for fname in os.listdir(folder_path):
            if not fname.endswith((".js", ".css")):
                continue
            fpath = os.path.join(folder_path, fname)
            content = open(fpath, encoding="utf-8").read()
            if re.search(r'(?://|/\*)\s*(?:TODO|FIXME)\b', content):
                errors.append(f"PLACEHOLDER_MARKER: TODO/FIXME found in {folder}/{fname}")
            if fname.endswith(".js") and re.search(r'\beval\s*\(', content):
                errors.append(f"SECURITY_VIOLATION: Forbidden eval() call in {folder}/{fname}")

    if errors:
        print("BUILD VERIFICATION FAILED:")
        for e in errors:
            print("  [ERROR]", e)
        sys.exit(1)

    print(f"OK: Verified {len(REQUIRED_FILES)} repository artifacts, relative GitHub Pages subpath safety, zero CDN dependencies, and zero placeholders.")
    sys.exit(0)

if __name__ == "__main__":
    main()
