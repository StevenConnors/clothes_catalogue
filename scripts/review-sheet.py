#!/usr/bin/env python3
"""Render private, numbered source/cutout review sheets for a batch."""
from __future__ import annotations
import argparse, hashlib, json, os, re, tempfile
import importlib.util
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "wardrobe-data"
_spec = importlib.util.spec_from_file_location("prepare_batch_manifest", ROOT / "scripts" / "prepare-batch.py")
_prepare = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_prepare)

def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024), b""): h.update(b)
    return h.hexdigest()

def bounded(base: Path, relative: str) -> Path:
    p = (base / relative).resolve()
    if not p.is_relative_to(base.resolve()): raise ValueError(f"path escapes batch folder: {relative}")
    return p

def write_atomic_image(image: Image.Image, path: Path) -> None:
    fd, tmp = tempfile.mkstemp(prefix=".review-", suffix=".png", dir=path.parent); os.close(fd)
    try: image.save(tmp, "PNG"); os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def main() -> int:
    ap=argparse.ArgumentParser(); ap.add_argument("--batch", required=True); args=ap.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.batch): ap.error("invalid batch ID")
    folder=DATA/"processed"/args.batch; incoming=DATA/"incoming"/args.batch
    manifest_path=folder/"manifest.json"
    try:
        for path in (DATA, DATA / "incoming", incoming, DATA / "processed", folder):
            if path.is_symlink(): raise ValueError(f"batch directory may not be a symlink: {path}")
        if not manifest_path.is_file(): raise ValueError("manifest is missing; run preparation first")
        manifest=_prepare.read_manifest(manifest_path,args.batch)
        entries=manifest["entries"]
        index=[]
        for start in range(0,len(entries),4):
            page=entries[start:start+4]
            width,height=1200,4*340+30
            sheet=Image.new("RGB",(width,height),(246,246,246)); draw=ImageDraw.Draw(sheet)
            for offset,e in enumerate(page):
                number=start+offset+1; y=offset*340
                draw.text((18,y+8),f"#{number}  Type: {e.get('type') or 'Unclassified'}  Status: {e.get('reviewStatus','unknown')}",fill=(20,20,20))
                warnings=e.get("warnings",[])
                if warnings: draw.text((18,y+30),"Warnings: "+"; ".join(warnings)[:150],fill=(150,45,30))
                for col,label in ((0,"Source"),(1,"Cutout")):
                    x=18+col*590; draw.text((x,y+54),label,fill=(60,60,60))
                    tile=Image.new("RGBA",(560,260),(255,255,255,255))
                    rel=e.get("sourcePath") if col==0 else e.get("cutoutPath")
                    base=incoming if col==0 else folder
                    if rel:
                        try:
                            p=bounded(base,rel)
                            if not p.is_file(): raise ValueError("file is missing")
                            expected=e.get("sourceSha256") if col==0 else e.get("cutoutSha256")
                            if expected and sha(p)!=expected: raise ValueError("digest mismatch")
                            with Image.open(p) as im:
                                im=ImageOps.exif_transpose(im).convert("RGBA")
                                im.thumbnail((540,240),Image.Resampling.LANCZOS)
                                tile.alpha_composite(im,((560-im.width)//2,(260-im.height)//2))
                        except Exception as exc:
                            ImageDraw.Draw(tile).text((12,110),f"Unavailable: {exc}",fill=(180,0,0))
                    else: ImageDraw.Draw(tile).text((12,110),"Not processed",fill=(90,90,90))
                    sheet.paste(tile.convert("RGB"),(x,y+75))
                index.append({"number":number,"sourceSha256":e.get("sourceSha256"),"cutoutSha256":e.get("cutoutSha256")})
            write_atomic_image(sheet,folder/f"review-{start//4+1:03d}.png")
        fd,tmp=tempfile.mkstemp(prefix=".review-index-",dir=folder); os.close(fd)
        try:
            with open(tmp,"w") as f: json.dump({"batchId":args.batch,"entries":index},f,indent=2); f.write("\n")
            os.replace(tmp,folder/"review-index.json")
        finally:
            if os.path.exists(tmp): os.unlink(tmp)
        print(f"Wrote {(len(entries)+3)//4} review sheet(s) for {len(entries)} entries")
        return 0
    except Exception as exc:
        print(f"review-sheet: {exc}")
        return 2
if __name__ == "__main__": raise SystemExit(main())
