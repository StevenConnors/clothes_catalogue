#!/usr/bin/env python3
"""Prepare a local wardrobe batch using one reused rembg session."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import resource
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "wardrobe-data"
MODEL = "birefnet-general"
SUPPORTED = {".jpg", ".jpeg", ".png"}


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def atomic_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def safe_batch_id(value: str) -> str:
    if not value or not all(c.isalnum() or c in "_-" for c in value) or not value.isascii():
        raise ValueError("batch ID may contain only ASCII letters, numbers, _ and -")
    return value


def read_manifest(path: Path, batch_id: str) -> dict[str, Any]:
    if not path.exists():
        return {"schemaVersion": 1, "batchId": batch_id, "entries": []}
    if path.is_symlink():
        raise ValueError("manifest may not be a symlink")
    value = json.loads(path.read_text(encoding="utf-8"))
    if set(value) != {"schemaVersion", "batchId", "entries"} or value.get("schemaVersion") != 1 or value.get("batchId") != batch_id or not isinstance(value.get("entries"), list):
        raise ValueError("manifest schema or batch ID is invalid")
    seen = set()
    for e in value["entries"]:
        if not isinstance(e, dict) or set(e) != {"sourcePath", "sourceSha256", "type", "cutoutPath", "cutoutSha256", "model", "warnings", "reviewStatus"}:
            raise ValueError("manifest entry has missing or unknown fields")
        if not isinstance(e["sourcePath"], str) or not e["sourcePath"] or Path(e["sourcePath"]).is_absolute(): raise ValueError("manifest sourcePath must be relative")
        if not isinstance(e["sourceSha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", e["sourceSha256"]): raise ValueError("invalid source digest")
        if e["sourceSha256"] in seen: raise ValueError("duplicate source digest in manifest")
        seen.add(e["sourceSha256"])
        if e["type"] not in (None, "outer", "shirt", "tshirt", "pants", "shorts", "shoes"): raise ValueError("invalid clothing type")
        if e["cutoutPath"] is not None and (not isinstance(e["cutoutPath"], str) or Path(e["cutoutPath"]).is_absolute()): raise ValueError("invalid cutout path")
        if e["cutoutSha256"] is not None and (not isinstance(e["cutoutSha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", e["cutoutSha256"])): raise ValueError("invalid cutout digest")
        if e["model"] != MODEL or e["reviewStatus"] not in ("pending", "approved", "rejected") or not isinstance(e["warnings"], list) or not all(isinstance(w, str) for w in e["warnings"]): raise ValueError("invalid manifest entry values")
    return value


def transform(photo: Image.Image, mask: Image.Image) -> tuple[Image.Image, list[str]]:
    """Apply a predicted mask, preserve all regions, fit to transparent 1024 square."""
    photo = ImageOps.exif_transpose(photo).convert("RGBA")
    mask = mask.convert("L")
    if mask.size != photo.size:
        mask = mask.resize(photo.size, Image.Resampling.LANCZOS)
    alpha = mask.point(lambda p: 0 if p < 12 else p)
    warnings: list[str] = []
    extrema = alpha.getextrema()
    if extrema[1] == 0:
        raise ValueError("empty foreground mask")
    bbox = alpha.getbbox()
    if not bbox:
        raise ValueError("empty foreground bounds")
    w, h = photo.size
    left, top, right, bottom = bbox
    histogram = alpha.histogram()
    coverage = sum(index * count for index, count in enumerate(histogram)) / (w * h * 255)
    if coverage < 0.002:
        warnings.append("near-empty foreground mask; inspect carefully")
    if coverage > 0.94 or (left == 0 and top == 0 and right >= w - 1 and bottom >= h - 1):
        warnings.append("near-full foreground mask; inspect carefully")
    photo.putalpha(alpha)
    # Keep every connected foreground region; crop from overall alpha bounds.
    pad_x, pad_y = max(1, round((right - left) * .05)), max(1, round((bottom - top) * .05))
    crop_box = (max(0, left - pad_x), max(0, top - pad_y), min(w, right + pad_x), min(h, bottom + pad_y))
    cropped = photo.crop(crop_box)
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    scale = min(1024 / cropped.width, 1024 / cropped.height)
    resized = (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale)))
    cropped = cropped.resize(resized, Image.Resampling.LANCZOS)
    canvas.alpha_composite(cropped, ((1024 - cropped.width) // 2, (1024 - cropped.height) // 2))
    return canvas, warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--benchmark", action="store_true")
    parser.add_argument("--reprocess", metavar="SOURCE_SHA256")
    args = parser.parse_args()
    try:
        batch_id = safe_batch_id(args.batch)
        if args.limit is not None and args.limit < 1:
            raise ValueError("--limit must be a positive integer")
        if args.limit is not None and args.reprocess:
            raise ValueError("--limit cannot be combined with --reprocess")
        if args.reprocess and (len(args.reprocess) != 64 or any(c not in "0123456789abcdef" for c in args.reprocess)):
            raise ValueError("--reprocess must be a lowercase SHA-256")
        incoming = DATA / "incoming" / batch_id
        output = DATA / "processed" / batch_id
        incoming.mkdir(parents=True, exist_ok=True)
        output.mkdir(parents=True, exist_ok=True)
        for folder in (ROOT / "wardrobe-data", DATA / "incoming", incoming, DATA / "processed", output):
            if folder.is_symlink():
                raise ValueError(f"batch directory may not be a symlink: {folder}")
        manifest_path = output / "manifest.json"
        manifest = read_manifest(manifest_path, batch_id)
        entries: list[dict[str, Any]] = manifest["entries"]
        by_hash = {e["sourceSha256"]: e for e in entries}
        files = sorted((p for p in incoming.iterdir() if p.is_file()), key=lambda p: p.name.casefold())
        unsupported = [p.name for p in files if p.suffix.lower() not in SUPPORTED]
        for name in unsupported:
            print(f"Unsupported input (export as JPEG or PNG): {name}", file=sys.stderr)
        found: dict[str, Path] = {}
        duplicates = []
        for p in files:
            if p.suffix.lower() not in SUPPORTED:
                continue
            resolved = p.resolve()
            if not resolved.is_relative_to(incoming.resolve()):
                raise ValueError(f"input symlink escapes batch: {p.name}")
            if not resolved.is_file():
                continue
            sha = digest(resolved)
            if sha in found:
                duplicates.append((p.name, found[sha].name, sha))
                continue
            found[sha] = p
            if sha not in by_hash:
                entry = {"sourcePath": p.name, "sourceSha256": sha, "type": None, "cutoutPath": None,
                         "cutoutSha256": None, "model": MODEL, "warnings": [], "reviewStatus": "pending"}
                entries.append(entry)
                by_hash[sha] = entry
        # Missing sources remain in their original positions and are visible in review.
        for e in entries:
            resolved = (incoming / e["sourcePath"]).resolve()
            if not resolved.is_relative_to(incoming.resolve()):
                raise ValueError(f"source path escapes batch: {e['sourcePath']}")
            if not resolved.is_relative_to(incoming.resolve()):
                raise ValueError(f"source path escapes batch: {e['sourcePath']}")
            if e["sourceSha256"] not in found:
                if not resolved.exists():
                    if "source file missing from incoming batch" not in e["warnings"]:
                        e["warnings"].append("source file missing from incoming batch")
                elif digest(resolved) != e["sourceSha256"]:
                    warning = "source file digest changed; original version is missing from incoming batch"
                    if warning not in e["warnings"]:
                        e["warnings"].append(warning)
        # Persist discoveries and missing-file warnings even if session setup fails.
        atomic_json(manifest_path, manifest)
        if args.reprocess:
            selected = by_hash.get(args.reprocess)
            if not selected:
                raise ValueError("requested source hash is not in this batch")
            source = found.get(args.reprocess)
            if source is None:
                raise ValueError("requested source file is missing from this batch")
            todo = [(selected, source)]
        else:
            todo = [(e, found.get(e["sourceSha256"])) for e in entries
                    if found.get(e["sourceSha256"]) and e["reviewStatus"] == "pending" and e["cutoutPath"] is None]
            if args.limit is not None:
                todo = todo[:args.limit]
        default_cache = Path(os.environ.get("XDG_DATA_HOME", "~")).expanduser() / ".u2net"
        model_cache = Path(os.environ.get("U2NET_HOME", default_cache)).expanduser()
        weights_preexisting = (model_cache / "birefnet-general.onnx").is_file()
        downloads_during_init = bool(todo) and not weights_preexisting
        if todo:
            from rembg import new_session, remove
            init_started = time.perf_counter()
            session = new_session(MODEL, providers=["CPUExecutionProvider"])
            init_seconds = time.perf_counter() - init_started
        else:
            session = None
            init_seconds = 0.0
        durations: list[dict[str, Any]] = []
        def run_one(entry: dict[str, Any], src: Path) -> tuple[dict[str, Any], float]:
            started = time.perf_counter()
            try:
                from rembg import remove
                from io import BytesIO
                with Image.open(src) as raw:
                    oriented = ImageOps.exif_transpose(raw).convert("RGB")
                stream = BytesIO()
                oriented.save(stream, format="PNG")
                mask_bytes = remove(stream.getvalue(), session=session, only_mask=True)
                with Image.open(BytesIO(mask_bytes)) as mask:
                    with Image.open(src) as raw_again:
                        cutout, warnings = transform(raw_again.copy(), mask.copy())
                filename = f"{entry['sourceSha256']}.png"
                target = output / filename
                temp_target = output / f".{filename}.tmp"
                cutout.save(temp_target, format="PNG")
                os.replace(temp_target, target)
                entry["cutoutPath"] = filename
                entry["cutoutSha256"] = digest(target)
                entry["warnings"] = [w for w in entry["warnings"] if not w.startswith("Preparation failed:") and not w.startswith("near-")]
                entry["warnings"].extend(warnings)
                if entry.get("type") is None: entry["reviewStatus"] = "pending"
            except Exception as exc:
                entry["cutoutPath"] = None
                entry["cutoutSha256"] = None
                entry["reviewStatus"] = "pending"
                entry["warnings"].append(f"Preparation failed: {exc}")
            elapsed = round(time.perf_counter() - started, 4)
            atomic_json(manifest_path, manifest)
            return {"sourceSha256": entry["sourceSha256"], "seconds": elapsed, "failed": entry["cutoutPath"] is None}, elapsed

        for entry, src in todo:
            if src is None:
                continue
            if args.reprocess:
                entry["reviewStatus"] = "pending"
                entry["warnings"] = [w for w in entry["warnings"] if not w.startswith("Approval reset:")]
                if entry["cutoutPath"] is not None:
                    entry["warnings"].append("Approval reset: cutout was explicitly reprocessed and requires visual review")
            result, _ = run_one(entry, src)
            durations.append(result)
        # Deterministic initial order; appended discoveries retain their append order.
        atomic_json(manifest_path, manifest)
        for duplicate in duplicates:
            print(f"Duplicate source bytes: {duplicate[0]} matches {duplicate[1]} ({duplicate[2]})")
        if args.benchmark:
            import importlib.metadata as metadata
            # ru_maxrss is the process high-water RSS; macOS returns bytes, Linux returns KiB.
            peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            if sys.platform != "darwin":
                peak *= 1024
            packages = {}
            for pkg in ("Pillow", "rembg", "onnxruntime"):
                try: packages[pkg] = metadata.version(pkg)
                except metadata.PackageNotFoundError: packages[pkg] = None
            atomic_json(output / "benchmark.json", {"architecture": platform.machine(), "python": platform.python_version(),
                "packages": packages, "model": MODEL, "sessionInitializationSeconds": round(init_seconds, 4),
                "sessionInitializationIncludedModelDownload": downloads_during_init,
                "processing": durations, "peakProcessMemoryBytes": peak,
                "peakProcessMemoryUnits": "bytes (OS process RSS high-water mark)"})
        print(f"Batch {batch_id}: {len(entries)} unique entries; processed {len(durations)}; unsupported {len(unsupported)}; duplicates {len(duplicates)}")
        return 0
    except Exception as exc:
        print(f"prepare-batch: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
